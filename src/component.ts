import path from "node:path";
import { join, dirname } from "node:path";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { readFile, writeFile } from 'node:fs/promises';
import { transpile } from '@bytecodealliance/jco';

function findProjectRoot(start: string) {
  let dir = start;

  while (true) {
    if (existsSync(join(dir, "package.json")) || existsSync(join(dir, "deno.json"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  throw new Error("Project root not found");
}

function detectWasmKind(bytes: Uint8Array): "module" | "component" | "unknown" {
  // Magic for all WASM files: 00 61 73 6D
  if (
    bytes[0] !== 0x00 ||
    bytes[1] !== 0x61 ||
    bytes[2] !== 0x73 ||
    bytes[3] !== 0x6D
  ) {
    return "unknown"; // Not a wasm binary
  }

  // top-level type (little-endian)
  const version =
    bytes[4]! |
    (bytes[5]! << 8) |
    (bytes[6]! << 16) |
    (bytes[7]! << 24);

  if (version === 0x01) return "module";
  if (version === 0x1000D) return "component";

  return "unknown"; // Future versions or malformed input
}

async function getFileHash(buffer: Buffer<ArrayBuffer>) {
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
  return hashHex;
}

function cleanupOldGenTs() {
  const genTsDir = "./gen-ts";
  if (!existsSync(genTsDir)) return;
  const folders = readdirSync(genTsDir);
  for (const folder of folders) {
    // only delete folders that match the pattern that our project creates
    // in case the user has their own `gen-ts` folder for some reason
    if (folder.match(/-[a-f0-9]{8}$/)) {
      rmSync(join(genTsDir, folder));
    }
  }
}

// TODO: don't delete old files
//       as this loader may be called by different build targets that have different imports
//       as one build target breaking another could leave to subtle bugs
// cleanupOldGenTs();

export async function resolve(specifier: string, context: any, nextResolve: any) {
  // 1) Ignore things that aren't WASM files
  if (!specifier.endsWith(".wasm")) {
    return nextResolve(specifier, context);
  }
  // 2) Ignore WASM modules (only want WASM components)
  const wasmFileContent = await readFile(specifier);
  const kind = detectWasmKind(new Uint8Array(wasmFileContent.buffer));
  if (kind !== "component") {
    return nextResolve(specifier, context);
  }
  // 3) generate the type and bindings
  const wasmHash = await getFileHash(wasmFileContent);
  const filename = path.parse(specifier).name;
  const folderName = `${filename}-${wasmHash.substring(0, 8)}`;
  mkdirSync(`./gen-ts/${folderName}`, { recursive: true });
  const transpiledResult = await transpile(wasmFileContent, {
    name: filename,
    outDir: `./gen-ts/${folderName}`
  });
  for (const [key, value] of Object.entries(transpiledResult.files)) {
    await writeFile(key, value as Uint8Array);
  }
  const newPath = `./gen-ts/${folderName}/${filename}.js`;

  // 4) Register the type mapping with TS
  const projectRoot = findProjectRoot(specifier);
  // Convert from the path where the WASM file exists to the root folder
  const pathToRoot = path.relative(path.dirname(specifier), projectRoot);
  const tsMapping = `
export * from '${pathToRoot}/gen-ts/${folderName}/${filename}.js'
`;
  await writeFile(specifier + ".d.ts", tsMapping);
  return nextResolve(newPath, context);
}

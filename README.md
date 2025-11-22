# `node-wasm-component-loader`

Load WASM components based on nodejs [customization hooks](https://nodejs.org/api/module.html#customization-hooks) (custom loaders)

## Installation

```sh
npm install --save-dev node-wasm-component-loader
```

## Usage

If you have a file `index.ts` that uses a WASM component (ex: `import { add } from "./adder.wasm"`)

You can register your custom hook (custom loader) when calling `node` as follows:
```bash
node --import node-wasm-component-loader ./index.ts
```

## Caveats

1. This only works for ESM (`type: module`)
2. Custom loaders (hooks) are still experimental in nodejs

## Release

1. `npm install`
2. `npm publish`

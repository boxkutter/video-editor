import { defineConfig } from "tsup";

export default defineConfig([
  // core and react build together so the ESM output shares one copy of the core
  { entry: { core: "src/core/index.ts", react: "src/react/index.ts" }, format: ["esm", "cjs"], dts: true, clean: true, sourcemap: true, splitting: true, external: ["react", "react-dom", "react/jsx-runtime"], esbuildOptions: (o) => { o.jsx = "automatic"; } },
  // the web component bundles React so a host with none can use it as one file
  { entry: { element: "src/element/index.ts" }, format: ["esm"], dts: true, sourcemap: true, noExternal: [/.*/], esbuildOptions: (o) => { o.jsx = "automatic"; } },
]);

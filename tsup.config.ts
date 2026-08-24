import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node18",
  outDir: "build",
  clean: true,
  sourcemap: true,
  // Bundle deps so `node build/index.js` runs without a separate `npm install`
  // in the consumer directory — important for the .mcpb one-click path where
  // Claude Desktop supplies the Node runtime but not our node_modules.
  noExternal: [/.*/],
  banner: { js: "#!/usr/bin/env node" },
});

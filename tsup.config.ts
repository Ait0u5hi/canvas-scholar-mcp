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
  // Express (used only by the opt-in HTTP transport) is CommonJS and does
  // dynamic `require()` of node builtins. Bundling CJS into a single ESM file
  // makes esbuild emit a `__require` shim that throws "Dynamic require of X is
  // not supported". Providing a real top-level `require` via createRequire makes
  // that shim delegate to it. Harmless for the stdio path (never hits express).
  banner: {
    js: [
      "#!/usr/bin/env node",
      "import { createRequire as __createRequire } from 'module';",
      "const require = __createRequire(import.meta.url);",
    ].join("\n"),
  },
});

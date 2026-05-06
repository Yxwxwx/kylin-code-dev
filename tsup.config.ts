import { defineConfig } from "tsup";
export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["cjs"],
  target: "node20",
  platform: "node",
  dts: false,
  sourcemap: true,
  clean: true,
  shims: true,
  banner: { js: "#!/usr/bin/env node --no-deprecation" },
  noExternal: [/./],
});

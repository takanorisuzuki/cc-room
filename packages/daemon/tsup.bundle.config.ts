import { defineConfig } from "tsup";

/** setup-cc-room 同梱用: 依存を巻き込み単一ファイルにする */
export default defineConfig({
  entry: ["src/index.ts"],
  // CJS: 依存の dynamic require('process') 等と相性が良い
  format: ["cjs"],
  platform: "node",
  target: "node20",
  outDir: "dist-bundle",
  outExtension() {
    return { js: ".js" };
  },
  splitting: false,
  clean: true,
  sourcemap: false,
  dts: false,
  shims: true,
  noExternal: [/.*/],
  banner: {
    js: "#!/usr/bin/env node",
  },
});

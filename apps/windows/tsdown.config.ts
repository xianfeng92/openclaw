import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/main/index.ts", "src/preload/index.ts"],
  format: "esm",
  target: "node22",
  sourcemap: true,
  clean: true,
  dts: false,
  external: ["electron"],
});

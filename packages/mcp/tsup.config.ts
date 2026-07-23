import { defineConfig } from "tsup";
import { fileURLToPath } from "node:url";

const coreEntry = fileURLToPath(new URL("../core/src/index.ts", import.meta.url));

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  target: "node20",
  esbuildOptions(options) {
    options.alias = { ...options.alias, "@ai-hub/agent-trade-core": coreEntry };
  }
});

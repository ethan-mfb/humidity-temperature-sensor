import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { BUILDS_DIR, VERSIONS } from "./versions";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

export default async function buildVersions(): Promise<void> {
  for (const version of Object.values(VERSIONS)) {
    await build({
      root: ROOT,
      logLevel: "warn",
      define: { __APP_VERSION__: JSON.stringify(version) },
      build: { outDir: join(BUILDS_DIR, version), emptyOutDir: true },
    });
  }
}

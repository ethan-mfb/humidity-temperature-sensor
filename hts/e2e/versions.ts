import { fileURLToPath } from "node:url";

export const BUILDS_DIR = fileURLToPath(new URL("./.builds", import.meta.url));

// Two builds of the app that differ only in version, standing in for one
// deploy to the pi and the next.
export const VERSIONS = {
  current: "0.0.1-e2e",
  next: "0.0.2-e2e",
} as const;

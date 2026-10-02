import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, normalize } from "node:path";

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};
const INDEX = "/index.html";

export type StaticServer = Readonly<{
  url: string;
  // Serve a different build, like deploying a new version to the pi.
  deploy: (directory: string) => void;
  // Drop every connection, like the pi going offline.
  setDown: (isDown: boolean) => void;
  close: () => Promise<void>;
}>;

export async function startStaticServer(
  directory: string,
): Promise<StaticServer> {
  const state = { directory, isDown: false };
  const server = createServer((request, response) => {
    if (state.isDown) {
      request.socket.destroy();
      return;
    }
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    const path = normalize(pathname === "/" ? INDEX : pathname);
    readFile(join(state.directory, path)).then(
      (body) => {
        response.writeHead(200, {
          "content-type":
            CONTENT_TYPES[extname(path)] ?? "application/octet-stream",
          "cache-control": "no-cache",
        });
        response.end(body);
      },
      () => {
        response.writeHead(404);
        response.end();
      },
    );
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  return Object.freeze({
    url: `http://localhost:${port}/`,
    deploy: (next) => {
      state.directory = next;
    },
    setDown: (isDown) => {
      state.isDown = isDown;
    },
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  });
}

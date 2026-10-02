import { vi } from "vitest";
import { webcrypto } from "node:crypto";

// Polyfill crypto.getRandomValues for Node.js 16
if (!globalThis.crypto) {
  // @ts-expect-error - Adding crypto polyfill
  globalThis.crypto = webcrypto;
}

// Ensure crypto.getRandomValues is available
if (!globalThis.crypto?.getRandomValues) {
  Object.defineProperty(globalThis.crypto, "getRandomValues", {
    value: (arr: Uint8Array) => {
      const randomBytes = require("node:crypto").randomBytes(arr.length);
      arr.set(randomBytes);
      return arr;
    },
    writable: false,
    enumerable: true,
    configurable: false,
  });
}
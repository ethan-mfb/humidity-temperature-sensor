/**
 * ESM-compatible utilities for getting directory and file paths
 * Replaces CommonJS __dirname and __filename functionality in ES modules
 */

import path from "path";
import { fileURLToPath } from "url";

/**
 * Get the directory name of the current ES module (equivalent to __dirname in CommonJS)
 * @param importMetaUrl - Pass import.meta.url from the calling module
 * @returns The directory path of the calling module
 * @example
 * ```typescript
 * import { getDirname } from './dirname.js';
 * const __dirname = getDirname(import.meta.url);
 * ```
 */
export function getDirname(importMetaUrl: string): string {
  return path.dirname(fileURLToPath(importMetaUrl));
}

/**
 * Get the file name of the current ES module (equivalent to __filename in CommonJS)
 * @param importMetaUrl - Pass import.meta.url from the calling module
 * @returns The file path of the calling module
 * @example
 * ```typescript
 * import { getFilename } from './dirname.js';
 * const __filename = getFilename(import.meta.url);
 * ```
 */
export function getFilename(importMetaUrl: string): string {
  return fileURLToPath(importMetaUrl);
}

/**
 * Resolve a path relative to the calling module's directory
 * @param importMetaUrl - Pass import.meta.url from the calling module
 * @param relativePath - The relative path to resolve
 * @returns The resolved absolute path
 * @example
 * ```typescript
 * import { resolveFromModule } from './dirname.js';
 * const configPath = resolveFromModule(import.meta.url, './config.json');
 * ```
 */
export function resolveFromModule(importMetaUrl: string, relativePath: string): string {
  const dirname = getDirname(importMetaUrl);
  return path.resolve(dirname, relativePath);
}
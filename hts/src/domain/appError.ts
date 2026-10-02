// Non-fatal failures are returned, not thrown. The returned Error keeps the
// call stack, a message for this layer and whatever caused it.
export function createAppError(message: string, cause: unknown): Error {
  return new Error(message, { cause });
}

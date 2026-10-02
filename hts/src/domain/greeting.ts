export type Greeting = Readonly<{ message: string }>;

export const DEFAULT_AUDIENCE = "World";

export function createGreeting(audience: string): Greeting {
  const trimmed = audience.trim();
  const resolved = trimmed === "" ? DEFAULT_AUDIENCE : trimmed;
  return Object.freeze({ message: `Hello, ${resolved}!` });
}

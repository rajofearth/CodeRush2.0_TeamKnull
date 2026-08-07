/** Shared greeter — intentional type hole for LSP diagnostics demo. */
export function greet(name: string): string {
  return `Hello, ${name}!`;
}

/** Wrong return type on purpose — diagnostics should flag this. */
export function add(a: number, b: number): string {
  return a + b;
}

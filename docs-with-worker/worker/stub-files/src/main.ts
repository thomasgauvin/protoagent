/**
 * Main entry point for the sample project
 */

export function greet(name: string): string {
  return `Hello, ${name}!`;
}

export function add(a: number, b: number): number {
  return a + b;
}

// Example usage
if (import.meta.main) {
  console.log(greet('World'));
  console.log('2 + 3 =', add(2, 3));
}

import { add, greet } from "./greeter.js";

export function run(): string {
  const sum = add(2, 3);
  return `${greet("CLAI")} sum=${sum}`;
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
  console.log(run());
}

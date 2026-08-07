export function tokenize(command) {
  return command.split(/\s+/).filter(Boolean);
}

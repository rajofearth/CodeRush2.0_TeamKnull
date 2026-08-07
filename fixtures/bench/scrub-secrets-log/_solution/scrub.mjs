export function scrubSecrets(text) {
  return text
    .replace(/sk-[A-Za-z0-9]{8,}/g, "[REDACTED]")
    .replace(/AKIA[0-9A-Z]{16}/g, "[REDACTED]");
}

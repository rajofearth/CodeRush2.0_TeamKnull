export function shouldRetry(status) {
  return status === 429 || (status >= 500 && status <= 599);
}

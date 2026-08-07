export function runTracked(promise, onError) {
  promise.catch(onError);
}

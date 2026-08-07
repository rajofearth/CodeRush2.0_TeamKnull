export function corsMiddleware(options) {
  return (_req, res, next) => {
    res.headers = res.headers ?? {};
    res.headers["Access-Control-Allow-Origin"] = options.origin ?? "*";
    next();
  };
}

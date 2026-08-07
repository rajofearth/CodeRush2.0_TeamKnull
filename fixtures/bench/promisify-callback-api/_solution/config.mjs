import fs from "node:fs";

export function readConfig(path, cb) {
  fs.readFile(path, "utf8", (err, text) => {
    if (err) return cb(err);
    cb(null, JSON.parse(text));
  });
}

export function readConfigAsync(path) {
  return new Promise((resolve, reject) => {
    readConfig(path, (err, cfg) => (err ? reject(err) : resolve(cfg)));
  });
}

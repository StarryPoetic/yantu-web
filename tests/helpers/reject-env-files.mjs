import fs from "node:fs";
import fsPromises from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";

// Test guard: fail before even probing an environment file; never read its data.
const guard = (path) => {
  const value = path instanceof URL ? path.pathname : String(path);
  if (/(?:^|[\\/])\.env(?:$|[.\\/])/.test(value))
    throw new Error("ENV_FILE_ACCESS_FORBIDDEN");
};
for (const name of [
  "readFileSync",
  "readFile",
  "openSync",
  "open",
  "statSync",
  "stat",
  "accessSync",
  "access",
  "existsSync",
]) {
  const original = fs[name];
  fs[name] = function (path, ...args) {
    guard(path);
    return original.call(this, path, ...args);
  };
}
for (const name of ["readFile", "open", "stat", "access"]) {
  const original = fsPromises[name];
  fsPromises[name] = function (path, ...args) {
    guard(path);
    return original.call(this, path, ...args);
  };
}
syncBuiltinESMExports();

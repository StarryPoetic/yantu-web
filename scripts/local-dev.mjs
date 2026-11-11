import { resolve } from "node:path";

// A repeatable local demonstration with no provider calls or bootstrap accounts.
// No local environment file is loaded, read, created or changed.
Object.assign(process.env, {
  NODE_ENV: "development",
  YANTU_DATABASE_PATH: resolve("var/yantu.sqlite"),
  YANTU_SAMPLE_DATA: "true",
  YANTU_MODEL_ENABLED: "false",
  YANTU_SEARCH_ENABLED: "false",
  YANTU_ADMIN_CREDENTIALS: "[]",
  YANTU_BOOTSTRAP_ADMINS: "[]",
});
delete process.env.YANTU_ORIGIN;
await import("./dev.mjs");

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const guard = new URL("../helpers/reject-env-files.mjs", import.meta.url).href;

test("Vite development and build resolution do not probe any environment file", () => {
  for (const command of ["serve", "build"]) {
    const output = execFileSync(
      process.execPath,
      [
        "--import",
        guard,
        "--input-type=module",
        "-e",
        `import { resolveConfig } from 'vite';
       const config = await resolveConfig({envFile:false}, ${JSON.stringify(command)});
       if(config.envFile !== false) throw new Error('Environment isolation lost');
       console.log('isolated');`,
      ],
      { cwd: root, encoding: "utf8", timeout: 30000 },
    );
    assert.match(output, /isolated/);
  }
});

test("checked-in development, production and verification entries never opt into env-file loading", () => {
  const pkg = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
  );
  for (const name of ["dev", "dev:local", "start", "preview", "build", "check"])
    assert.doesNotMatch(pkg.scripts[name], /--env-file|dotenv|vite build/);
  for (const name of ["dev.mjs", "build.mjs"])
    assert.match(
      readFileSync(new URL(`../../scripts/${name}`, import.meta.url), "utf8"),
      /envFile:\s*false/,
    );
  const local = readFileSync(
    new URL("../../scripts/local-dev.mjs", import.meta.url),
    "utf8",
  );
  assert.match(local, /YANTU_MODEL_ENABLED:\s*"false"/);
  assert.match(local, /YANTU_SEARCH_ENABLED:\s*"false"/);
});

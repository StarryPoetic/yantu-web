import { createHash, randomUUID } from "node:crypto";
import {
  readFile,
  readdir,
  realpath,
  lstat,
  mkdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { backupDatabase } from "./backup-database.mjs";
import { DatabaseSync } from "node:sqlite";

const prefix = /^yantu-backup-[0-9a-f-]{36}\.sqlite$/;
const checksum = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fail = (code) => {
  throw Object.assign(new Error(code), { code });
};

async function ownedFile(directory, name) {
  if (basename(name) !== name) fail("BACKUP_PATH_INVALID");
  const path = join(directory, name);
  const info = await lstat(path);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    (await realpath(path)) !== path
  )
    fail("BACKUP_PATH_INVALID");
  return path;
}

async function inventory(directory, source) {
  const items = [];
  let names;
  try {
    names = await readdir(directory);
  } catch (error) {
    if (error.code === "ENOENT") return items;
    throw error;
  }
  for (const name of names.filter((name) => prefix.test(name))) {
    try {
      const file = await ownedFile(directory, name);
      const manifestPath = await ownedFile(directory, `${name}.json`);
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      if (
        manifest.schemaVersion !== 1 ||
        manifest.name !== name ||
        manifest.source !== source ||
        !Number.isFinite(Date.parse(manifest.createdAt)) ||
        manifest.sha256 !== checksum(await readFile(file))
      )
        continue;
      items.push({
        name,
        createdAt: manifest.createdAt,
        sha256: manifest.sha256,
      });
    } catch {
      /* Unowned, damaged or unmanifested files are never retention targets. */
    }
  }
  return items.sort(
    (a, b) =>
      b.createdAt.localeCompare(a.createdAt) || a.name.localeCompare(b.name),
  );
}

export async function managedBackup(configPath, { apply = false } = {}) {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  if (
    !config ||
    Array.isArray(config) ||
    Object.keys(config).some(
      (key) =>
        ![
          "enabled",
          "source",
          "directory",
          "retainCount",
          "minimumAgeHours",
        ].includes(key),
    )
  )
    fail("BACKUP_CONFIG_INVALID");
  if (config.enabled === false) return { status: "disabled" };
  if (
    config.enabled !== true ||
    typeof config.source !== "string" ||
    !isAbsolute(config.source) ||
    typeof config.directory !== "string" ||
    !isAbsolute(config.directory) ||
    !Number.isInteger(config.retainCount) ||
    config.retainCount < 2 ||
    config.retainCount > 10000 ||
    !Number.isInteger(config.minimumAgeHours) ||
    config.minimumAgeHours < 1 ||
    config.minimumAgeHours > 87600
  )
    fail("BACKUP_CONFIG_INVALID");
  const source = await realpath(config.source);
  if (!(await lstat(source)).isFile()) fail("BACKUP_SOURCE_INVALID");
  let directory = resolve(config.directory);
  try {
    if ((await lstat(directory)).isSymbolicLink())
      fail("BACKUP_DIRECTORY_INVALID");
    directory = await realpath(directory);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const sourceRelative = relative(directory, source);
  if (
    !sourceRelative ||
    (!sourceRelative.startsWith("..") && !isAbsolute(sourceRelative))
  )
    fail("BACKUP_SOURCE_INSIDE_DESTINATION");
  if (!apply)
    return {
      status: "dry-run",
      existingOwnedSnapshots: (await inventory(directory, source)).length,
      retainCount: config.retainCount,
      minimumAgeHours: config.minimumAgeHours,
    };
  await mkdir(directory, { recursive: true, mode: 0o700 });
  directory = await realpath(directory);
  const finalSourceRelative = relative(directory, source);
  if (
    !finalSourceRelative ||
    (!finalSourceRelative.startsWith("..") && !isAbsolute(finalSourceRelative))
  )
    fail("BACKUP_SOURCE_INSIDE_DESTINATION");
  const name = `yantu-backup-${randomUUID()}.sqlite`;
  const destination = join(directory, name);
  await backupDatabase(source, destination);
  // Published archives are standalone files; inspection must not create WAL sidecars.
  const standalone = new DatabaseSync(destination);
  try {
    standalone.exec("PRAGMA journal_mode=DELETE");
  } finally {
    standalone.close();
  }
  const manifest = {
    schemaVersion: 1,
    name,
    source,
    createdAt: new Date().toISOString(),
    sha256: checksum(await readFile(destination)),
  };
  await writeFile(
    `${destination}.json`,
    JSON.stringify(manifest, null, 2) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  const owned = await inventory(directory, source);
  const cutoff = Date.now() - config.minimumAgeHours * 3600000;
  const candidates = owned
    .slice(config.retainCount)
    .filter(
      (item) => Date.parse(item.createdAt) < cutoff && item.name !== name,
    );
  let removed = 0;
  for (const item of candidates) {
    const file = await ownedFile(directory, item.name);
    const manifestPath = await ownedFile(directory, `${item.name}.json`);
    if (checksum(await readFile(file)) !== item.sha256)
      fail("BACKUP_CHANGED_DURING_RETENTION");
    // Delete only the exact regular files owned by this manager, never a directory.
    await unlink(file);
    await unlink(manifestPath);
    removed++;
  }
  return {
    status: "ok",
    snapshot: destination,
    integrity: "ok",
    removed,
    retainedOwnedSnapshots: owned.length - removed,
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const { values } = parseArgs({
      options: {
        config: { type: "string" },
        apply: { type: "boolean", default: false },
      },
      strict: true,
    });
    if (!values.config) fail("BACKUP_CONFIG_REQUIRED");
    console.log(
      JSON.stringify(
        await managedBackup(values.config, { apply: values.apply }),
      ),
    );
  } catch (error) {
    console.error(
      JSON.stringify({ status: "error", code: error.code ?? "BACKUP_FAILED" }),
    );
    process.exitCode = 1;
  }
}

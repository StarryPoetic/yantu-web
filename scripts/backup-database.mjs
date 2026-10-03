import { backup, DatabaseSync } from "node:sqlite";
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  realpath,
  rmdir,
  stat,
  unlink,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

class BackupError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

async function targetExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

/** Online SQLite snapshot; publication never replaces an existing destination. */
export async function backupDatabase(sourcePath, destinationPath) {
  if (
    typeof sourcePath !== "string" ||
    !sourcePath.trim() ||
    sourcePath === ":memory:" ||
    typeof destinationPath !== "string" ||
    !destinationPath.trim() ||
    destinationPath === ":memory:"
  )
    throw new BackupError(
      "INVALID_PATH",
      "请明确提供源数据库和新的备份文件路径。",
    );
  const source = resolve(sourcePath);
  const destination = resolve(destinationPath);
  if (source === destination)
    throw new BackupError("SAME_PATH", "备份文件不能覆盖源数据库。");
  if (await targetExists(destination))
    throw new BackupError(
      "TARGET_EXISTS",
      "备份目标已存在，请使用新的文件名。",
    );
  let database;
  let temporaryDirectory;
  try {
    const sourceFile = await realpath(source);
    if (!(await stat(sourceFile)).isFile())
      throw new BackupError("INVALID_SOURCE", "源数据库必须是已有的普通文件。");
    database = new DatabaseSync(sourceFile, { readOnly: true, timeout: 5000 });
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    const destinationDirectory = await realpath(dirname(destination));
    temporaryDirectory = await mkdtemp(
      join(destinationDirectory, ".yantu-backup-"),
    );
    await chmod(temporaryDirectory, 0o700);
    const snapshot = join(temporaryDirectory, "snapshot.sqlite");
    await backup(database, snapshot);
    await chmod(snapshot, 0o600);
    const verification = new DatabaseSync(snapshot, {
      readOnly: true,
      timeout: 5000,
    });
    try {
      const integrity = verification.prepare("PRAGMA integrity_check").all();
      if (
        integrity.length !== 1 ||
        Object.values(integrity[0])[0] !== "ok" ||
        verification.prepare("PRAGMA foreign_key_check").all().length
      )
        throw new BackupError(
          "INTEGRITY_FAILED",
          "备份未通过完整性或外键校验，未发布备份文件。",
        );
    } finally {
      verification.close();
    }
    const snapshotFile = await open(snapshot, "r+");
    try {
      await snapshotFile.sync();
    } finally {
      await snapshotFile.close();
    }
    // Hard-link publication is atomic and fails if the destination appeared meanwhile.
    await link(snapshot, destination);
    return { status: "ok", destination, integrity: "ok" };
  } catch (error) {
    if (error instanceof BackupError) throw error;
    if (error.code === "ENOENT")
      throw new BackupError(
        "SOURCE_NOT_FOUND",
        "源数据库不存在，未创建替代数据库。",
      );
    if (error.code === "EEXIST")
      throw new BackupError(
        "TARGET_EXISTS",
        "备份目标已存在，请使用新的文件名。",
      );
    throw new BackupError(
      "BACKUP_FAILED",
      "备份失败，请检查源数据库、磁盘空间与目录权限。",
    );
  } finally {
    database?.close();
    if (temporaryDirectory) {
      for (const name of [
        "snapshot.sqlite",
        "snapshot.sqlite-wal",
        "snapshot.sqlite-shm",
        "snapshot.sqlite-journal",
      ]) {
        await unlink(join(temporaryDirectory, name)).catch((error) => {
          if (error.code !== "ENOENT") throw error;
        });
      }
      await rmdir(temporaryDirectory);
    }
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const { values } = parseArgs({
      options: { source: { type: "string" }, destination: { type: "string" } },
      allowPositionals: false,
    });
    if (!values.source || !values.destination) {
      console.error(
        "用法：node scripts/backup-database.mjs --source <数据库> --destination <新的备份文件>",
      );
      process.exitCode = 1;
    } else {
      console.log(
        JSON.stringify(await backupDatabase(values.source, values.destination)),
      );
    }
  } catch (error) {
    console.error(
      error instanceof BackupError
        ? `备份失败：${error.message} (${error.code})`
        : "备份失败：请核对命令参数、路径和目录权限。",
    );
    process.exitCode = 1;
  }
}

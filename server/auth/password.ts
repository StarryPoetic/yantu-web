import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { HttpError } from "../http.ts";

const cost = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const keyLength = 32;
// Unknown users perform the same expensive derivation as existing accounts.
const dummyHash = `scrypt-v1$32768$8$1$${"00".repeat(16)}$${"00".repeat(keyLength)}`;

export function usernameInput(value: unknown): {
  username: string;
  usernameKey: string;
} {
  if (typeof value !== "string")
    throw new HttpError(
      422,
      "invalid_username",
      "用户名须为 3 至 32 位字母、数字、中文或 _ . -。",
    );
  const username = value.trim().normalize("NFKC");
  if (!/^[\p{L}\p{N}][\p{L}\p{N}_.-]{2,31}$/u.test(username))
    throw new HttpError(
      422,
      "invalid_username",
      "用户名须为 3 至 32 位字母、数字、中文或 _ . -。",
    );
  return { username, usernameKey: username.toLowerCase() };
}

export function passwordInput(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < 8 ||
    value.length > 128 ||
    Buffer.byteLength(value, "utf8") > 512
  )
    throw new HttpError(422, "invalid_password", "密码须为 8 至 128 个字符。");
  return value;
}

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, keyLength, cost, (error, result) =>
      error ? reject(error) : resolve(result),
    ),
  );
}

export async function hashPassword(password: string): Promise<string> {
  passwordInput(password);
  const salt = randomBytes(16);
  const hash = await derive(password, salt);
  return `scrypt-v1$${cost.N}$${cost.r}$${cost.p}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  storedHash?: string,
): Promise<boolean> {
  const value = storedHash ?? dummyHash;
  const parts = value.split("$");
  const valid =
    parts.length === 6 &&
    parts[0] === "scrypt-v1" &&
    parts[1] === String(cost.N) &&
    parts[2] === "8" &&
    parts[3] === "1" &&
    /^[0-9a-f]{32}$/.test(parts[4]) &&
    /^[0-9a-f]{64}$/.test(parts[5]);
  const salt = Buffer.from(valid ? parts[4] : "00".repeat(16), "hex");
  const expected = Buffer.from(
    valid ? parts[5] : "00".repeat(keyLength),
    "hex",
  );
  const actual = await derive(password, salt);
  return Boolean(storedHash) && valid && timingSafeEqual(actual, expected);
}

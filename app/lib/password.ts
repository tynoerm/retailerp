import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;
const COST = 16384;

function derive(password: string, salt: Buffer, cost: number) {
  return new Promise<Buffer>((resolve, reject) =>
    scrypt(password, salt, KEY_LENGTH, { N: cost, r: 8, p: 1 }, (error, key) => (error ? reject(error) : resolve(key)))
  );
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await derive(password, salt, COST);
  return `scrypt$${COST}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [algorithm, cost, salt, hash] = stored.split("$");
  if (algorithm !== "scrypt" || !salt || !hash || !Number.isInteger(Number(cost))) return false;

  const expected = Buffer.from(hash, "base64");
  const key = await derive(password, Buffer.from(salt, "base64"), Number(cost));
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export const PASSWORD_MIN_LENGTH = 8;

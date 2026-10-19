import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomBytes } from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import db, { ensureSchema } from "./db";
import { SESSION_COOKIE, type SessionUser } from "./permissions";

export type AuthUser = SessionUser & { sessionId: number };

const SESSION_HOURS = 12;
const REMEMBER_HOURS = 24 * 30;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSession(userId: number, remember: boolean, meta: { ip?: string | null; userAgent?: string | null }) {
  const token = randomBytes(32).toString("base64url");
  const hours = remember ? REMEMBER_HOURS : SESSION_HOURS;

  await db.query("DELETE FROM user_sessions WHERE expires_at <= NOW()");
  await db.query(
    `INSERT INTO user_sessions (user_id, token_hash, expires_at, ip_address, user_agent)
     VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? HOUR), ?, ?)`,
    [userId, hashToken(token), hours, meta.ip?.slice(0, 64) ?? null, meta.userAgent?.slice(0, 255) ?? null]
  );
  await db.query("UPDATE users SET last_login_at = NOW() WHERE id = ?", [userId]);

  return {
    token,
    cookie: {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      // Without "remember me" the cookie ends with the browser session (server still expires it after 12h).
      maxAge: remember ? hours * 3600 : undefined,
    },
  };
}

export async function findSessionUser(token: string | undefined): Promise<AuthUser | null> {
  if (!token) return null;

  const [[row]] = await db.query<RowDataPacket[]>(
    `SELECT s.id AS sessionId, u.id, u.name, u.email, u.role
     FROM user_sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > NOW() AND u.status = 'Active'`,
    [hashToken(token)]
  );

  return row ? (row as AuthUser) : null;
}

export async function deleteSession(token: string | undefined) {
  if (token) await db.query("DELETE FROM user_sessions WHERE token_hash = ?", [hashToken(token)]);
}

export async function deleteUserSessions(userId: number, exceptSessionId?: number) {
  const [result] = await db.query<ResultSetHeader>(
    "DELETE FROM user_sessions WHERE user_id = ? AND id <> ?",
    [userId, exceptSessionId ?? 0]
  );
  return result.affectedRows;
}

/** Signed-in user for Server Components (deduplicated per request). */
export const getSessionUser = cache(async (): Promise<AuthUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  await ensureSchema();
  return findSessionUser(token);
});

const userContext = new AsyncLocalStorage<AuthUser>();

export const runAsUser = <T>(user: AuthUser, fn: () => Promise<T>) => userContext.run(user, fn);

/** The user making the current API request (set by `handle()`). */
export const currentUser = () => userContext.getStore() ?? null;

export const currentUserName = () => currentUser()?.name ?? "System";

import { NextResponse } from "next/server";
import { ApiError, handle, queryRows } from "@/app/lib/crud";
import { createSession } from "@/app/lib/auth";
import { hashPassword, verifyPassword } from "@/app/lib/password";
import { SESSION_COOKIE, type Role } from "@/app/lib/permissions";

const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;

const globalForAuth = globalThis as unknown as { loginFailures?: Map<string, { count: number; since: number }> };
const failures = (globalForAuth.loginFailures ??= new Map());

let dummyHash: Promise<string> | undefined;

export const POST = handle(
  async (request) => {
    const body = await request.json().catch(() => ({}));
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");

    if (!email || !password) throw new ApiError("Email and password are required");

    const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || null;
    const key = `${ip ?? "local"}|${email}`;
    const entry = failures.get(key);

    if (entry && Date.now() - entry.since > LOCK_MINUTES * 60_000) failures.delete(key);
    else if (entry && entry.count >= MAX_FAILURES) {
      throw new ApiError(`Too many failed attempts. Try again in ${LOCK_MINUTES} minutes.`, 429);
    }

    const [user] = await queryRows<{ id: number; name: string; email: string; role: Role; status: string; password_hash: string }>(
      "SELECT id, name, email, role, status, password_hash FROM users WHERE email = ?",
      [email]
    );

    // Always run a hash comparison so response time does not reveal whether the email exists.
    const valid = await verifyPassword(password, user?.password_hash ?? (await (dummyHash ??= hashPassword("not-a-real-password"))));

    if (!user || !valid) {
      const current = failures.get(key);
      failures.set(key, { count: (current?.count ?? 0) + 1, since: current?.since ?? Date.now() });
      throw new ApiError("Invalid email or password", 401);
    }

    if (user.status !== "Active") throw new ApiError("This account has been deactivated. Contact your administrator.", 403);

    failures.delete(key);

    const { token, cookie } = await createSession(user.id, Boolean(body.remember), {
      ip,
      userAgent: request.headers.get("user-agent"),
    });

    const response = NextResponse.json({
      success: true,
      data: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
    response.cookies.set(SESSION_COOKIE, token, cookie);
    return response;
  },
  { access: "public" }
);

import { NextResponse } from "next/server";
import type { ResultSetHeader } from "mysql2/promise";
import db from "@/app/lib/db";
import { ApiError, handle, pickFields, queryRows, requireId, type FieldSpec, type Row } from "@/app/lib/crud";
import { currentUser, deleteUserSessions } from "@/app/lib/auth";
import { hashPassword, PASSWORD_MIN_LENGTH } from "@/app/lib/password";
import { ROLES } from "@/app/lib/permissions";

const fields: Record<string, FieldSpec> = {
  name: { type: "string", required: true },
  email: { type: "string", required: true },
  role: { type: "string", required: true, options: ROLES },
  status: { type: "string", options: ["Active", "Inactive"] },
};

const COLUMNS = "id, name, email, role, status, last_login_at, created_at";

async function findUser(id: number) {
  const [row] = await queryRows(`SELECT ${COLUMNS} FROM users WHERE id = ?`, [id]);
  if (!row) throw new ApiError("User not found", 404);
  return row;
}

async function readUser(body: Row, partial: boolean) {
  const values = pickFields(body, fields, partial);

  if (typeof values.email === "string") {
    const email = values.email.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError("Enter a valid email address");
    values.email = email;
  }

  const password = String(body.password ?? "");
  if (password) {
    if (password.length < PASSWORD_MIN_LENGTH) throw new ApiError(`Password must be at least ${PASSWORD_MIN_LENGTH} characters`);
    values.password_hash = await hashPassword(password);
  } else if (!partial) {
    throw new ApiError("Password is required for new users");
  }

  return values;
}

async function assertAnotherAdministrator(excludingId: number) {
  const [{ count }] = await queryRows<{ count: number }>(
    "SELECT COUNT(*) AS count FROM users WHERE role = 'Administrator' AND status = 'Active' AND id <> ?",
    [excludingId]
  );
  if (count === 0) throw new ApiError("At least one active Administrator is required");
}

export const GET = handle(async () =>
  NextResponse.json({ success: true, data: await queryRows(`SELECT ${COLUMNS} FROM users ORDER BY name`) })
);

export const POST = handle(async (request) => {
  const values = await readUser(await request.json(), false);
  const [result] = await db.query<ResultSetHeader>("INSERT INTO users SET ?", [values]);
  return NextResponse.json({ success: true, data: await findUser(result.insertId) }, { status: 201 });
});

export const PUT = handle(async (request) => {
  const body = await request.json();
  const id = requireId(request, body);
  const me = currentUser()!;
  const before = await findUser(id);
  const values = await readUser(body, true);

  const demoted = before.role === "Administrator" && values.role !== undefined && values.role !== "Administrator";
  const deactivated = values.status === "Inactive" && before.status !== "Inactive";

  if (id === me.id && (demoted || deactivated)) {
    throw new ApiError("You cannot remove your own administrator access or deactivate your own account");
  }
  if (before.role === "Administrator" && (demoted || deactivated)) await assertAnotherAdministrator(id);

  await db.query("UPDATE users SET ? WHERE id = ?", [values, id]);

  // Force re-login when access is revoked or the password is reset (keep the admin's own current session).
  if (deactivated || values.password_hash) await deleteUserSessions(id, id === me.id ? me.sessionId : undefined);

  return NextResponse.json({ success: true, data: await findUser(id) });
});

export const DELETE = handle(async (request) => {
  const id = requireId(request);
  const before = await findUser(id);

  if (id === currentUser()!.id) throw new ApiError("You cannot delete your own account");
  if (before.role === "Administrator") await assertAnotherAdministrator(id);

  await db.query("DELETE FROM users WHERE id = ?", [id]);
  return NextResponse.json({ success: true });
});

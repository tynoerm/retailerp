import { NextResponse } from "next/server";
import { ApiError, handle, queryRows } from "@/app/lib/crud";
import { currentUser, deleteUserSessions } from "@/app/lib/auth";
import { hashPassword, PASSWORD_MIN_LENGTH, verifyPassword } from "@/app/lib/password";

export const GET = handle(
  async () => {
    const { id, name, email, role } = currentUser()!;
    return NextResponse.json({ success: true, data: { id, name, email, role } });
  },
  { access: "authenticated" }
);

/** Change own password: { currentPassword, newPassword }. Signs out the user's other sessions. */
export const PUT = handle(
  async (request) => {
    const user = currentUser()!;
    const body = await request.json();
    const newPassword = String(body.newPassword ?? "");

    const [row] = await queryRows<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = ?", [user.id]);
    if (!row || !(await verifyPassword(String(body.currentPassword ?? ""), row.password_hash))) {
      throw new ApiError("Current password is incorrect");
    }
    if (newPassword.length < PASSWORD_MIN_LENGTH) {
      throw new ApiError(`New password must be at least ${PASSWORD_MIN_LENGTH} characters`);
    }

    await queryRows("UPDATE users SET password_hash = ? WHERE id = ?", [await hashPassword(newPassword), user.id]);
    await deleteUserSessions(user.id, user.sessionId);

    return NextResponse.json({ success: true });
  },
  { access: "authenticated" }
);

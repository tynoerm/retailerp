import { NextResponse } from "next/server";
import { handle } from "@/app/lib/crud";
import { deleteSession } from "@/app/lib/auth";
import { SESSION_COOKIE } from "@/app/lib/permissions";

export const POST = handle(
  async (request) => {
    await deleteSession(request.cookies.get(SESSION_COOKIE)?.value);

    const response = NextResponse.json({ success: true });
    response.cookies.delete(SESSION_COOKIE);
    return response;
  },
  { access: "public" }
);

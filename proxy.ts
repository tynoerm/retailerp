import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "./app/lib/permissions";

// Optimistic check only: sends visitors without a session cookie to /login.
// Sessions are fully verified (and roles enforced) by RouteGuard layouts and API `handle()`.
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (pathname === "/login" || request.cookies.has(SESSION_COOKIE)) return NextResponse.next();

  const url = new URL("/login", request.url);
  if (pathname !== "/") url.searchParams.set("next", pathname + search);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};

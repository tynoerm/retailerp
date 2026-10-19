"use client";

import { createContext, useContext, useEffect } from "react";
import { usePathname } from "next/navigation";
import { canAccessPage, canCallApi, type SessionUser } from "../lib/permissions";

const AuthContext = createContext<SessionUser | null>(null);

export function AuthProvider({ user, children }: { user: SessionUser | null; children: React.ReactNode }) {
  const pathname = usePathname();

  useEffect(() => {
    if (!user && pathname !== "/login") {
      window.location.replace(`/login${pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`}`);
    }
  }, [user, pathname]);

  return <AuthContext value={user}>{children}</AuthContext>;
}

export function useAuth() {
  const user = useContext(AuthContext);

  return {
    user,
    canView: (path: string) => canAccessPage(user?.role, path),
    canCall: (endpoint: string, method: string) => canCallApi(user?.role, endpoint, method),
  };
}

export async function signOut() {
  await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full reload clears client state and the root layout session
  window.location.href = "/login";
}

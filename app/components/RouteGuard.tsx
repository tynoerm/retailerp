import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { getSessionUser } from "../lib/auth";
import { canAccessPage } from "../lib/permissions";

/** Server-side guard for a module's layout: requires a valid session and a role allowed for `path`. */
export default async function RouteGuard({ path, children }: { path: string; children: React.ReactNode }) {
  const user = await getSessionUser();

  if (!user) redirect(`/login?next=${encodeURIComponent(path)}`);
  if (canAccessPage(user.role, path)) return children;

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F6F7F9] p-6 text-slate-800">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
          <ShieldAlert size={26} />
        </div>

        <h1 className="mt-5 text-xl font-bold text-[#0F2A3B]">Access restricted</h1>
        <p className="mt-2 text-sm text-slate-500">
          Your role <span className="font-semibold text-slate-700">{user.role}</span> does not have access to this
          module. Ask an administrator if you need it.
        </p>

        <Link
          href="/"
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[#1C9A9A] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#168383]"
        >
          <ArrowLeft size={17} />
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
}

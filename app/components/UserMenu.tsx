"use client";

import { useEffect, useRef, useState } from "react";
import { KeyRound, Loader2, LogOut, Save, X } from "lucide-react";
import { api, errorMessage } from "../lib/api-client";
import { initials } from "../lib/permissions";
import { signOut, useAuth } from "./AuthProvider";

const inputClass =
  "w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-[#1C9A9A] focus:bg-white focus:ring-2 focus:ring-[#1C9A9A]/10";

/** Avatar button with account dropdown (change password, sign out). `showName` renders the name/role beside it. */
export default function UserMenu({ showName = false }: { showName?: boolean }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => !ref.current?.contains(event.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (!user) return null;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-3 rounded-full text-left"
        aria-haspopup="menu"
        aria-expanded={open}
        title={`${user.name} • ${user.role}`}
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#173B4F] text-xs font-bold text-white">
          {initials(user.name)}
        </span>

        {showName && (
          <span className="hidden lg:block">
            <span className="block text-sm font-semibold text-slate-800">{user.name}</span>
            <span className="block text-xs text-slate-500">{user.role}</span>
          </span>
        )}
      </button>

      {open && (
        <div role="menu" className="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg">
          <div className="border-b border-slate-100 p-4">
            <p className="truncate text-sm font-semibold text-slate-800">{user.name}</p>
            <p className="truncate text-xs text-slate-500">{user.email}</p>
            <span className="mt-2 inline-block rounded-full bg-[#1C9A9A]/10 px-2.5 py-1 text-[11px] font-semibold text-[#1C9A9A]">
              {user.role}
            </span>
          </div>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setChangingPassword(true);
            }}
            className="flex w-full items-center gap-3 px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            <KeyRound size={16} className="text-slate-400" />
            Change password
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={signOut}
            className="flex w-full items-center gap-3 border-t border-slate-100 px-4 py-3 text-sm font-medium text-red-600 hover:bg-red-50"
          >
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      )}

      {changingPassword && <ChangePasswordModal onClose={() => setChangingPassword(false)} />}
    </div>
  );
}

function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (form.newPassword !== form.confirm) return setError("New passwords do not match");

    setSaving(true);
    setError("");

    try {
      await api("/api/auth/me", { method: "PUT", body: JSON.stringify(form) });
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const fields = [
    { key: "currentPassword", label: "Current password", autoComplete: "current-password" },
    { key: "newPassword", label: "New password", autoComplete: "new-password" },
    { key: "confirm", label: "Confirm new password", autoComplete: "new-password" },
  ] as const;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
      <form onSubmit={submit} className="w-full max-w-md rounded-3xl bg-white text-left shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-bold text-[#0F2A3B]">Change Password</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-4 p-6">
          {done ? (
            <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              Password updated. Other devices signed in to your account have been signed out.
            </p>
          ) : (
            <>
              {error && (
                <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
              )}

              {fields.map((field) => (
                <label key={field.key} className="block">
                  <span className="mb-1.5 block text-sm font-medium text-slate-700">{field.label}</span>
                  <input
                    type="password"
                    required
                    autoComplete={field.autoComplete}
                    value={form[field.key]}
                    onChange={(event) => setForm((current) => ({ ...current, [field.key]: event.target.value }))}
                    className={inputClass}
                  />
                </label>
              ))}
            </>
          )}
        </div>

        <div className="flex justify-end gap-3 border-t border-slate-200 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            {done ? "Close" : "Cancel"}
          </button>

          {!done && (
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 rounded-xl bg-[#1C9A9A] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#178686] disabled:opacity-60"
            >
              {saving ? <Loader2 size={17} className="animate-spin" /> : <Save size={17} />}
              Update Password
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

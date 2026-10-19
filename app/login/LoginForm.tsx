"use client";

import { useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  Boxes,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  LogIn,
  Mail,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
} from "lucide-react";
import { api, errorMessage } from "../lib/api-client";

const highlights = [
  { icon: ShoppingCart, title: "Point of Sale", description: "Fast checkout with multi-currency payments" },
  { icon: Boxes, title: "Inventory Control", description: "Real-time stock across every warehouse" },
  { icon: BarChart3, title: "Reports & Analytics", description: "Sales, margins and stock insights" },
];

const inputClass =
  "w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-4 text-sm outline-none transition focus:border-[#1C9A9A] focus:bg-white focus:ring-2 focus:ring-[#1C9A9A]/10";

export default function LoginForm({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password, remember }) });
      window.location.assign(next);
    } catch (err) {
      setError(errorMessage(err));
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-[#F6F7F9] text-slate-800">
      {/* BRAND PANEL */}
      <aside className="relative hidden w-[44%] max-w-xl flex-col justify-between overflow-hidden bg-[#0F2A3B] p-10 text-white lg:flex">
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[#1C9A9A]/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-16 h-80 w-80 rounded-full bg-[#1C9A9A]/10 blur-3xl" />

        <div className="relative flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#1C9A9A]">
            <ShoppingBag size={22} />
          </div>
          <div>
            <p className="text-lg font-bold tracking-tight">RetailERP</p>
            <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400">Enterprise Retail</p>
          </div>
        </div>

        <div className="relative">
          <h2 className="text-3xl font-bold leading-tight tracking-tight">
            Run your entire retail operation from one place.
          </h2>
          <p className="mt-3 text-sm text-slate-400">
            Sales, stock, procurement and finance — connected in real time.
          </p>

          <div className="mt-8 space-y-3">
            {highlights.map(({ icon: Icon, title, description }) => (
              <div key={title} className="flex items-center gap-4 rounded-2xl bg-white/5 p-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#1C9A9A]/20 text-[#5FD3D3]">
                  <Icon size={19} />
                </div>
                <div>
                  <p className="text-sm font-semibold">{title}</p>
                  <p className="text-xs text-slate-400">{description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="relative flex items-center gap-2 text-xs text-slate-500">
          <ShieldCheck size={14} />
          Role-based access • Secure sessions
        </p>
      </aside>

      {/* FORM */}
      <main className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1C9A9A] text-white">
              <ShoppingBag size={21} />
            </div>
            <p className="text-lg font-bold tracking-tight text-[#0F2A3B]">RetailERP</p>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
            <p className="text-sm font-medium text-[#1C9A9A]">Welcome back</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-[#0F2A3B]">Sign in to your account</h1>
            <p className="mt-1 text-sm text-slate-500">Use the email and password provided by your administrator.</p>

            <form onSubmit={submit} className="mt-6 space-y-4">
              {error && (
                <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  <AlertTriangle size={17} className="mt-0.5 shrink-0" />
                  <p>{error}</p>
                </div>
              )}

              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-slate-700">Email</span>
                <div className="relative">
                  <Mail size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="email"
                    required
                    autoFocus
                    autoComplete="username"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@company.com"
                    className={inputClass}
                  />
                </div>
              </label>

              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-slate-700">Password</span>
                <div className="relative">
                  <Lock size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="••••••••"
                    className={`${inputClass} pr-12`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
              </label>

              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(event) => setRemember(event.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 accent-[#1C9A9A]"
                />
                Keep me signed in for 30 days
              </label>

              <button
                type="submit"
                disabled={submitting}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#1C9A9A] px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#168383] disabled:opacity-60"
              >
                {submitting ? <Loader2 size={18} className="animate-spin" /> : <LogIn size={18} />}
                {submitting ? "Signing in…" : "Sign in"}
              </button>
            </form>
          </div>

          <p className="mt-6 text-center text-xs text-slate-400">
            Forgot your password? Ask an administrator to reset it.
          </p>
        </div>
      </main>
    </div>
  );
}

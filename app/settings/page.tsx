"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Save, Settings } from "lucide-react";
import { ErrorBanner, inputClass, PageShell } from "../components/ModulePage";
import { api, errorMessage } from "../lib/api-client";
import { defaultSettings, type Settings as SettingsState } from "../lib/settings-defaults";

const textFields: { key: keyof SettingsState; label: string; type?: string }[] = [
  { key: "businessName", label: "Business Name" },
  { key: "email", label: "Contact Email", type: "email" },
  { key: "phone", label: "Phone" },
  { key: "address", label: "Address" },
  { key: "taxRate", label: "Tax Rate (%)", type: "number" },
  { key: "receiptFooter", label: "Receipt Footer" },
  { key: "laybyMinDepositPercent", label: "Minimum Lay-by Deposit (%)", type: "number" },
];

const toggles: { key: keyof SettingsState; label: string; description: string }[] = [
  { key: "lowStockAlerts", label: "Low stock alerts", description: "Notify when items drop below reorder level" },
  { key: "emailReceipts", label: "Email receipts", description: "Send receipts to customers with an email on file" },
  { key: "allowNegativeStock", label: "Allow negative stock", description: "Permit sales when stock on hand is zero" },
];

export default function SettingsPage() {
  const [settings, setSettings] = useState(defaultSettings);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api<SettingsState>("/api/settings")
      .then(setSettings)
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  const update = <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => {
    setSettings((current) => ({ ...current, [key]: value }));
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    setError("");

    try {
      const body = {
        ...settings,
        currencies: settings.currencies.map((c) => (c.code === settings.currency ? { ...c, rate: 1 } : c)),
      };
      setSettings(await api<SettingsState>("/api/settings", { method: "PUT", body: JSON.stringify(body) }));
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageShell
      title="Settings"
      subtitle="System Configuration"
      icon={<Settings size={22} />}
      action={
        <button
          type="button"
          onClick={save}
          disabled={saving || loading}
          className="flex items-center gap-2 rounded-xl bg-[#1C9A9A] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#178686] disabled:opacity-60"
        >
          {saving ? <Loader2 size={18} className="animate-spin" /> : saved ? <CheckCircle2 size={18} /> : <Save size={18} />}
          {saved ? "Saved" : "Save Changes"}
        </button>
      }
    >
      {error && <ErrorBanner message={error} />}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="font-bold text-[#0F2A3B]">Business Profile</h3>
        <p className="mt-1 text-xs text-slate-500">Shown on receipts and invoices</p>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {textFields.map((field) => (
            <label key={field.key} className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-700">{field.label}</span>
              <input
                type={field.type ?? "text"}
                value={String(settings[field.key])}
                onChange={(event) => update(field.key, event.target.value)}
                className={inputClass}
              />
            </label>
          ))}

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700">Base Currency</span>
            <select
              value={settings.currency}
              onChange={(event) => update("currency", event.target.value)}
              className={inputClass}
            >
              {settings.currencies.map((c) => (
                <option key={c.code}>{c.code}</option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-slate-400">
              All prices, costs and reports are kept in this currency. Changing it does not convert existing prices.
            </span>
          </label>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-bold text-[#0F2A3B]">Currencies &amp; Exchange Rates</h3>
            <p className="mt-1 text-xs text-slate-500">
              Rate = how many units of the currency equal 1 {settings.currency}. A currency with rate 0 is hidden at the POS.
            </p>
          </div>
          <button
            type="button"
            onClick={() => update("currencies", [...settings.currencies, { code: "", rate: 0 }])}
            className="shrink-0 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-[#1C9A9A] hover:bg-slate-50"
          >
            + Add currency
          </button>
        </div>

        <div className="mt-4 space-y-2">
          {settings.currencies.map((currency, index) => {
            const isBase = currency.code === settings.currency;
            const change = (patch: Partial<typeof currency>) =>
              update(
                "currencies",
                settings.currencies.map((c, i) => (i === index ? { ...c, ...patch } : c))
              );

            return (
              <div key={index} className="grid grid-cols-[110px_1fr_auto] items-center gap-3">
                <input
                  value={currency.code}
                  maxLength={3}
                  placeholder="ZWG"
                  onChange={(event) => change({ code: event.target.value.toUpperCase() })}
                  className={inputClass}
                />
                <input
                  type="number"
                  min="0"
                  step="any"
                  disabled={isBase}
                  value={isBase ? 1 : currency.rate}
                  onChange={(event) => change({ rate: Number(event.target.value) })}
                  className={`${inputClass} disabled:opacity-60`}
                />
                <button
                  type="button"
                  disabled={isBase}
                  onClick={() => update("currencies", settings.currencies.filter((_, i) => i !== index))}
                  className="rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50 disabled:invisible"
                >
                  Remove
                </button>
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 p-5">
          <h3 className="font-bold text-[#0F2A3B]">Preferences</h3>
          <p className="mt-1 text-xs text-slate-500">Operational behaviour</p>
        </div>

        <div className="divide-y divide-slate-100">
          {toggles.map((toggle) => {
            const enabled = Boolean(settings[toggle.key]);

            return (
              <div key={toggle.key} className="flex items-center justify-between gap-4 p-5">
                <div>
                  <p className="text-sm font-semibold text-slate-800">{toggle.label}</p>
                  <p className="text-xs text-slate-500">{toggle.description}</p>
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  onClick={() => update(toggle.key, !enabled)}
                  className={`relative h-6 w-11 shrink-0 rounded-full transition ${enabled ? "bg-[#1C9A9A]" : "bg-slate-300"}`}
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${enabled ? "left-[22px]" : "left-0.5"}`}
                  />
                </button>
              </div>
            );
          })}
        </div>
      </section>
    </PageShell>
  );
}

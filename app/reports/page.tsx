"use client";

import { useEffect, useState } from "react";
import { BarChart3, DollarSign, Loader2, Package, Receipt, TrendingUp } from "lucide-react";
import { ErrorBanner, money, PageShell, StatCards } from "../components/ModulePage";
import { api, errorMessage } from "../lib/api-client";

const ranges = [
  { id: "7d", label: "Last 7 Days" },
  { id: "30d", label: "Last 30 Days" },
  { id: "year", label: "This Year" },
] as const;

type RangeId = (typeof ranges)[number]["id"];

type ReportData = {
  trend: { label: string; value: number }[];
  topProducts: { name: string; units: number; revenue: number }[];
  categoryShare: { name: string; share: number }[];
  grossMargin: number;
  unitsSold: number;
  transactions: number;
};

export default function ReportsPage() {
  const [range, setRange] = useState<RangeId>("7d");
  const [data, setData] = useState<ReportData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    api<ReportData>(`/api/reports?range=${range}`)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError("");
      })
      .catch((err) => !cancelled && setError(errorMessage(err)))
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [range]);

  const rangeLabel = ranges.find((r) => r.id === range)!.label;
  const trend = data?.trend ?? [];
  const total = trend.reduce((s, d) => s + d.value, 0);
  const max = Math.max(1, ...trend.map((d) => d.value));

  return (
    <PageShell title="Reports & Analytics" subtitle="Business Insights" icon={<BarChart3 size={22} />}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex w-fit items-center gap-1 rounded-xl border border-slate-200 bg-white p-1.5">
          {ranges.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => {
                setLoading(true);
                setRange(r.id);
              }}
              className={`rounded-lg px-4 py-2.5 text-sm font-semibold transition ${
                range === r.id ? "bg-[#0F2A3B] text-white shadow-sm" : "text-slate-500 hover:bg-slate-50"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        {loading && <Loader2 size={18} className="animate-spin text-slate-400" />}
      </div>

      {error && <ErrorBanner message={error} />}

      <StatCards
        stats={[
          { label: "Revenue", value: money(total), subtitle: `${rangeLabel} • POS + invoices`, icon: <DollarSign size={21} /> },
          { label: "Avg. per Period", value: money(trend.length ? total / trend.length : 0), subtitle: `${trend.length} periods`, icon: <TrendingUp size={21} /> },
          { label: "Gross Margin", value: `${data?.grossMargin ?? 0}%`, subtitle: "POS sales after cost of goods", icon: <BarChart3 size={21} /> },
          { label: "Units Sold", value: (data?.unitsSold ?? 0).toLocaleString(), subtitle: `${data?.transactions ?? 0} POS transactions`, icon: <Package size={21} /> },
        ]}
      />

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="font-bold text-[#0F2A3B]">Sales Trend</h3>
        <p className="mt-1 text-xs text-slate-500">Revenue for {rangeLabel.toLowerCase()}</p>

        <div className="mt-6 flex h-64 items-end gap-3">
          {trend.map((d) => (
            <div key={d.label} className="flex min-w-0 flex-1 flex-col items-center gap-2">
              <span className="truncate text-[10px] font-semibold text-slate-500">{money(d.value).replace(/\.\d\d$/, "")}</span>
              <div
                className="w-full rounded-t-lg bg-[#1C9A9A] transition-all hover:bg-[#168383]"
                style={{ height: `${Math.max((d.value / max) * 200, d.value > 0 ? 2 : 0)}px` }}
              />
              <span className="truncate text-xs text-slate-500">{d.label}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-5">
            <h3 className="font-bold text-[#0F2A3B]">Top Products</h3>
            <p className="mt-1 text-xs text-slate-500">Best sellers by POS revenue</p>
          </div>
          <div className="divide-y divide-slate-100">
            {data?.topProducts.length === 0 && <p className="p-6 text-center text-sm text-slate-500">No sales in this period.</p>}
            {(data?.topProducts ?? []).map((p, index) => (
              <div key={p.name} className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#0F2A3B]/5 text-xs font-bold text-[#0F2A3B]">
                    {index + 1}
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{p.name}</p>
                    <p className="text-[11px] text-slate-400">{p.units.toLocaleString()} units</p>
                  </div>
                </div>
                <p className="text-sm font-bold text-slate-800">{money(p.revenue)}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="font-bold text-[#0F2A3B]">Sales by Category</h3>
          <p className="mt-1 text-xs text-slate-500">Share of POS revenue</p>
          <div className="mt-5 space-y-4">
            {data?.categoryShare.length === 0 && <p className="text-center text-sm text-slate-500">No sales in this period.</p>}
            {(data?.categoryShare ?? []).map((c) => (
              <div key={c.name}>
                <div className="mb-1.5 flex justify-between text-sm">
                  <span className="font-medium text-slate-700">{c.name}</span>
                  <span className="font-semibold text-slate-500">{c.share}%</span>
                </div>
                <div className="h-2.5 rounded-full bg-slate-100">
                  <div className="h-2.5 rounded-full bg-[#1C9A9A]" style={{ width: `${c.share}%` }} />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-6 flex items-center gap-2 rounded-xl bg-slate-50 p-3 text-xs text-slate-500">
            <Receipt size={15} />
            Live figures from completed POS sales and issued invoices.
          </div>
        </section>
      </div>
    </PageShell>
  );
}

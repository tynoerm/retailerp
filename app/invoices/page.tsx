"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, DollarSign, FileText, Loader2, Plus, Printer, Trash2 } from "lucide-react";
import ModulePage, {
  ErrorBanner,
  FieldInput,
  inputClass,
  Modal,
  ModalFooter,
  money,
  StatusBadge,
  today,
  useRecords,
  type Column,
  type EditorProps,
} from "../components/ModulePage";
import { api, errorMessage } from "../lib/api-client";
import type { Settings } from "../lib/settings-defaults";

type Invoice = {
  id: number;
  invoice_number: string;
  customer_id: number | null;
  customer_name: string;
  issued_date: string;
  due_date: string;
  subtotal: number;
  tax_rate: number;
  tax: number;
  total: number;
  amount_paid: number;
  balance: number;
  notes: string | null;
  status: "Paid" | "Partially Paid" | "Pending" | "Overdue";
};

type LineItem = { description: string; quantity: string; unit_price: string };

type CustomerOption = { id: number; name: string; status: string };

const columns: Column<Invoice>[] = [
  { key: "invoice_number", label: "Invoice", render: (i) => <span className="font-bold text-[#0F2A3B]">{i.invoice_number}</span> },
  { key: "customer_name", label: "Customer", render: (i) => <span className="font-semibold text-slate-800">{i.customer_name}</span> },
  { key: "issued_date", label: "Issued" },
  { key: "due_date", label: "Due" },
  { key: "total", label: "Total", render: (i) => <span className="font-bold text-slate-800">{money(i.total)}</span> },
  { key: "amount_paid", label: "Paid", render: (i) => money(i.amount_paid) },
  { key: "balance", label: "Balance", render: (i) => <span className={i.balance > 0 ? "font-semibold text-amber-700" : ""}>{money(i.balance)}</span> },
  { key: "status", label: "Status", render: (i) => <StatusBadge status={i.status} /> },
];

const addDays = (date: string, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next.toISOString().slice(0, 10);
};

const emptyItem = (): LineItem => ({ description: "", quantity: "1", unit_price: "" });

function InvoiceEditor({ row, onClose, onSaved }: EditorProps<Invoice>) {
  const customers = useRecords<CustomerOption>("/api/customers");
  const [loading, setLoading] = useState(Boolean(row));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    customer_id: row?.customer_id ? String(row.customer_id) : "",
    customer_name: row?.customer_name ?? "",
    issued_date: row?.issued_date ?? today(),
    due_date: row?.due_date ?? addDays(today(), 30),
    tax_rate: row ? String(row.tax_rate) : "15",
    notes: row?.notes ?? "",
  });
  const [items, setItems] = useState<LineItem[]>([emptyItem()]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        if (row) {
          const invoice = await api<{ items: { description: string; quantity: number; unit_price: number }[] }>(
            `/api/invoices?id=${row.id}`
          );
          if (cancelled) return;
          setItems(invoice.items.map((item) => ({
            description: item.description,
            quantity: String(item.quantity),
            unit_price: String(item.unit_price),
          })));
        } else {
          const settings = await api<Settings>("/api/settings");
          if (cancelled) return;
          setForm((current) => ({ ...current, tax_rate: settings.taxRate }));
        }
      } catch (err) {
        if (!cancelled) setError(errorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [row]);

  const subtotal = items.reduce((sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.unit_price) || 0), 0);
  const tax = subtotal * ((Number(form.tax_rate) || 0) / 100);

  const updateItem = (index: number, patch: Partial<LineItem>) =>
    setItems((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");

    try {
      await api("/api/invoices", {
        method: row ? "PUT" : "POST",
        body: JSON.stringify({ ...form, id: row?.id, items }),
      });
      onSaved(`Invoice ${row ? "updated" : "created"}`);
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  };

  return (
    <Modal
      wide
      title={row ? `Edit ${row.invoice_number}` : "New Invoice"}
      onClose={onClose}
      footer={<ModalFooter saving={saving || loading} onClose={onClose} label="Save Invoice" />}
    >
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
          <Loader2 size={18} className="animate-spin" /> Loading…
        </div>
      ) : (
        <form id="module-form" onSubmit={submit} className="space-y-6">
          {error && <ErrorBanner message={error} />}

          <div className="grid gap-4 md:grid-cols-2">
            <FieldInput
              field={{
                key: "customer_id",
                label: "Customer",
                type: "select",
                options: [
                  { value: "", label: "— Walk-in / one-off customer —" },
                  ...customers.rows
                    .filter((c) => c.status !== "Inactive" || String(c.id) === form.customer_id)
                    .map((c) => ({ value: String(c.id), label: c.name })),
                ],
              }}
              value={form.customer_id}
              onChange={(value) =>
                setForm((current) => ({
                  ...current,
                  customer_id: value,
                  customer_name: customers.rows.find((c) => String(c.id) === value)?.name ?? current.customer_name,
                }))
              }
            />
            <FieldInput
              field={{ key: "customer_name", label: "Bill To (name)", required: true }}
              value={form.customer_name}
              onChange={(value) => setForm((current) => ({ ...current, customer_name: value }))}
            />
            <FieldInput
              field={{ key: "issued_date", label: "Issue Date", type: "date", required: true }}
              value={form.issued_date}
              onChange={(value) => setForm((current) => ({ ...current, issued_date: value }))}
            />
            <FieldInput
              field={{ key: "due_date", label: "Due Date", type: "date", required: true }}
              value={form.due_date}
              onChange={(value) => setForm((current) => ({ ...current, due_date: value }))}
            />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-bold text-[#0F2A3B]">Line Items</h3>
              <button
                type="button"
                onClick={() => setItems((current) => [...current, emptyItem()])}
                className="flex items-center gap-1 text-sm font-semibold text-[#1C9A9A] hover:underline"
              >
                <Plus size={15} /> Add line
              </button>
            </div>

            <div className="space-y-2">
              <div className="hidden grid-cols-[1fr_100px_130px_110px_40px] gap-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500 md:grid">
                <span>Description</span>
                <span>Qty</span>
                <span>Unit Price</span>
                <span className="text-right">Amount</span>
                <span />
              </div>

              {items.map((item, index) => (
                <div key={index} className="grid grid-cols-2 items-center gap-2 md:grid-cols-[1fr_100px_130px_110px_40px]">
                  <input
                    required
                    placeholder="Product or service"
                    value={item.description}
                    onChange={(event) => updateItem(index, { description: event.target.value })}
                    className={`${inputClass} col-span-2 md:col-span-1`}
                  />
                  <input
                    required
                    type="number"
                    min="0.01"
                    step="any"
                    value={item.quantity}
                    onChange={(event) => updateItem(index, { quantity: event.target.value })}
                    className={inputClass}
                  />
                  <input
                    required
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={item.unit_price}
                    onChange={(event) => updateItem(index, { unit_price: event.target.value })}
                    className={inputClass}
                  />
                  <span className="text-right text-sm font-semibold text-slate-700">
                    {money((Number(item.quantity) || 0) * (Number(item.unit_price) || 0))}
                  </span>
                  <button
                    type="button"
                    title="Remove line"
                    disabled={items.length === 1}
                    onClick={() => setItems((current) => current.filter((_, i) => i !== index))}
                    className="justify-self-end rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <FieldInput
              field={{ key: "notes", label: "Notes / Payment Terms", type: "textarea" }}
              value={form.notes}
              onChange={(value) => setForm((current) => ({ ...current, notes: value }))}
            />

            <div className="space-y-3 rounded-2xl bg-slate-50 p-4 text-sm md:col-span-2">
              <div className="flex justify-between">
                <span className="text-slate-500">Subtotal</span>
                <span className="font-semibold">{money(subtotal)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-500">Tax rate (%)</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.tax_rate}
                  onChange={(event) => setForm((current) => ({ ...current, tax_rate: event.target.value }))}
                  className="w-24 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-right text-sm outline-none focus:border-[#1C9A9A]"
                />
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Tax</span>
                <span className="font-semibold">{money(tax)}</span>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-3">
                <span className="font-bold">Total</span>
                <span className="text-lg font-bold text-[#0F2A3B]">{money(subtotal + tax)}</span>
              </div>
            </div>
          </div>
        </form>
      )}
    </Modal>
  );
}

export default function InvoicesPage() {
  return (
    <ModulePage<Invoice>
      title="Invoices"
      subtitle="Billing & Invoicing"
      icon={<FileText size={22} />}
      entityName="Invoice"
      endpoint="/api/invoices"
      searchPlaceholder="Search invoices or customers..."
      filterKey="status"
      columns={columns}
      Editor={InvoiceEditor}
      rowActions={(invoice) => (
        <a
          href={`/invoices/${invoice.id}/print`}
          target="_blank"
          rel="noopener"
          title="Print / Save as PDF"
          className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-[#0F2A3B]"
        >
          <Printer size={16} />
        </a>
      )}
      stats={(rows) => [
        { label: "Invoices", value: rows.length.toString(), subtitle: `${rows.filter((i) => i.status === "Paid").length} fully paid`, icon: <FileText size={21} /> },
        { label: "Total Billed", value: money(rows.reduce((s, i) => s + i.total, 0)), subtitle: "Invoice value", icon: <DollarSign size={21} /> },
        { label: "Outstanding", value: money(rows.reduce((s, i) => s + i.balance, 0)), subtitle: "Unpaid balance", icon: <CheckCircle2 size={21} /> },
        { label: "Overdue", value: rows.filter((i) => i.status === "Overdue").length.toString(), subtitle: "Past due date", icon: <AlertTriangle size={21} /> },
      ]}
    />
  );
}

"use client";

import { useMemo } from "react";
import { AlertTriangle, CheckCircle2, CreditCard, DollarSign } from "lucide-react";
import ModulePage, {
  money,
  StatusBadge,
  useRecords,
  type Column,
  type FormField,
  type FormValues,
} from "../components/ModulePage";
import { PAYMENT_METHODS } from "../lib/settings-defaults";

type Payment = {
  id: number;
  payment_number: string;
  invoice_id: number | null;
  invoice_number: string | null;
  reference: string | null;
  party: string;
  method: (typeof PAYMENT_METHODS)[number];
  amount: number;
  paid_at: string;
  status: "Completed" | "Pending" | "Failed" | "Refunded";
  notes: string | null;
};

type InvoiceOption = {
  id: number;
  invoice_number: string;
  customer_name: string;
  balance: number;
};

const columns: Column<Payment>[] = [
  { key: "payment_number", label: "Payment ID", render: (p) => <span className="font-bold text-[#0F2A3B]">{p.payment_number}</span> },
  { key: "invoice_number", label: "Invoice", render: (p) => p.invoice_number ?? "—" },
  { key: "reference", label: "Reference", render: (p) => p.reference || "—" },
  { key: "party", label: "Customer" },
  {
    key: "method",
    label: "Method",
    render: (p) => <span className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-600">{p.method}</span>,
  },
  { key: "amount", label: "Amount", render: (p) => <span className="font-bold text-slate-800">{money(p.amount)}</span> },
  { key: "paid_at", label: "Date", render: (p) => p.paid_at.slice(0, 16) },
  { key: "status", label: "Status", render: (p) => <StatusBadge status={p.status} /> },
];

const nowLocal = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

const options = (values: string[]) => values.map((value) => ({ value, label: value }));

export default function PaymentsPage() {
  const invoices = useRecords<InvoiceOption>("/api/invoices");

  const formFields = useMemo<FormField[]>(
    () => [
      {
        key: "invoice_id",
        label: "Invoice (optional)",
        type: "select",
        wide: true,
        options: [
          { value: "", label: "— Not linked to an invoice —" },
          ...invoices.rows.map((invoice) => ({
            value: String(invoice.id),
            label: `${invoice.invoice_number} • ${invoice.customer_name} • balance ${money(invoice.balance)}`,
          })),
        ],
      },
      { key: "party", label: "Customer / Payer", required: true },
      { key: "reference", label: "Reference" },
      { key: "method", label: "Method", type: "select", options: options([...PAYMENT_METHODS]) },
      { key: "amount", label: "Amount ($)", type: "number", required: true },
      { key: "paid_at", label: "Date & Time", type: "datetime-local", required: true, defaultValue: nowLocal },
      { key: "status", label: "Status", type: "select", options: options(["Completed", "Pending", "Failed", "Refunded"]) },
      { key: "notes", label: "Notes", type: "textarea" },
    ],
    [invoices.rows]
  );

  const onFormChange = (form: FormValues, key: string): FormValues => {
    if (key !== "invoice_id") return form;

    const invoice = invoices.rows.find((row) => String(row.id) === form.invoice_id);
    if (!invoice) return form;

    return {
      ...form,
      party: invoice.customer_name,
      reference: invoice.invoice_number,
      amount: invoice.balance > 0 ? invoice.balance.toFixed(2) : form.amount,
    };
  };

  const sum = (rows: Payment[], status: Payment["status"]) =>
    rows.filter((p) => p.status === status).reduce((s, p) => s + p.amount, 0);

  return (
    <ModulePage<Payment>
      title="Payments"
      subtitle="Payment Tracking"
      icon={<CreditCard size={22} />}
      entityName="Payment"
      endpoint="/api/payments"
      searchPlaceholder="Search payments, references or customers..."
      filterKey="method"
      columns={columns}
      formFields={formFields}
      onFormChange={onFormChange}
      onDataChange={invoices.reload}
      stats={(rows) => [
        { label: "Collected", value: money(sum(rows, "Completed")), subtitle: "Completed payments", icon: <CheckCircle2 size={21} /> },
        { label: "Pending", value: money(sum(rows, "Pending")), subtitle: "Awaiting clearance", icon: <DollarSign size={21} /> },
        { label: "Failed", value: rows.filter((p) => p.status === "Failed").length.toString(), subtitle: "Require follow-up", icon: <AlertTriangle size={21} /> },
        { label: "Refunded", value: money(sum(rows, "Refunded")), subtitle: "Returned to customers", icon: <CreditCard size={21} /> },
      ]}
    />
  );
}

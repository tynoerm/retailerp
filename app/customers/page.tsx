"use client";

import { DollarSign, FileText, Star, Users } from "lucide-react";
import ModulePage, { money, StatusBadge, type Column, type FormField } from "../components/ModulePage";

type Customer = {
  id: number;
  code: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  status: "Active" | "Inactive" | "VIP";
  price_tier: "Retail" | "Wholesale";
  invoice_count: number;
  total_billed: number;
  balance: number;
  last_invoice: string | null;
};

const columns: Column<Customer>[] = [
  { key: "code", label: "Customer ID", render: (c) => <span className="font-bold text-[#0F2A3B]">{c.code}</span> },
  { key: "name", label: "Name", render: (c) => <span className="font-semibold text-slate-800">{c.name}</span> },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "invoice_count", label: "Invoices" },
  { key: "total_billed", label: "Total Billed", render: (c) => <span className="font-bold text-slate-800">{money(c.total_billed)}</span> },
  {
    key: "balance",
    label: "Balance",
    render: (c) => <span className={c.balance > 0 ? "font-semibold text-amber-700" : ""}>{money(c.balance)}</span>,
  },
  { key: "price_tier", label: "Price Level" },
  { key: "status", label: "Status", render: (c) => <StatusBadge status={c.status} /> },
];

const formFields: FormField[] = [
  { key: "name", label: "Full Name / Company", required: true, wide: true },
  { key: "email", label: "Email", type: "email" },
  { key: "phone", label: "Phone" },
  { key: "address", label: "Address", wide: true },
  {
    key: "status",
    label: "Status",
    type: "select",
    options: ["Active", "VIP", "Inactive"].map((value) => ({ value, label: value })),
  },
  {
    key: "price_tier",
    label: "Price Level",
    type: "select",
    options: ["Retail", "Wholesale"].map((value) => ({ value, label: value })),
  },
];

export default function CustomersPage() {
  return (
    <ModulePage<Customer>
      title="Customers"
      subtitle="Customer Management"
      icon={<Users size={22} />}
      entityName="Customer"
      endpoint="/api/customers"
      searchPlaceholder="Search customers by name, email or phone..."
      filterKey="status"
      columns={columns}
      formFields={formFields}
      stats={(rows) => [
        { label: "Total Customers", value: rows.length.toString(), subtitle: "Registered accounts", icon: <Users size={21} /> },
        { label: "VIP Customers", value: rows.filter((c) => c.status === "VIP").length.toString(), subtitle: "High-value accounts", icon: <Star size={21} /> },
        { label: "Total Billed", value: money(rows.reduce((s, c) => s + c.total_billed, 0)), subtitle: `${rows.reduce((s, c) => s + c.invoice_count, 0)} invoices`, icon: <FileText size={21} /> },
        { label: "Receivables", value: money(rows.reduce((s, c) => s + c.balance, 0)), subtitle: "Outstanding balances", icon: <DollarSign size={21} /> },
      ]}
    />
  );
}

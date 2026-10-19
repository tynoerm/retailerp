"use client";

import { CheckCircle2, DollarSign, Truck, UserRound } from "lucide-react";
import ModulePage, { money, StatusBadge, type Column, type FormField } from "../components/ModulePage";

type Supplier = {
  id: number;
  code: string;
  name: string;
  contact: string | null;
  email: string | null;
  phone: string | null;
  category: string | null;
  balance: number;
  status: "Active" | "Inactive";
};

const columns: Column<Supplier>[] = [
  { key: "code", label: "Supplier ID", render: (s) => <span className="font-bold text-[#0F2A3B]">{s.code}</span> },
  { key: "name", label: "Supplier", render: (s) => <span className="font-semibold text-slate-800">{s.name}</span> },
  { key: "contact", label: "Contact" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "category", label: "Category" },
  { key: "balance", label: "Balance Owed", render: (s) => <span className="font-bold text-slate-800">{money(s.balance)}</span> },
  { key: "status", label: "Status", render: (s) => <StatusBadge status={s.status} /> },
];

const formFields: FormField[] = [
  { key: "name", label: "Supplier Name", required: true, wide: true },
  { key: "contact", label: "Contact Person" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email", type: "email" },
  { key: "category", label: "Category", placeholder: "e.g. Dairy, Bakery" },
  { key: "balance", label: "Balance Owed ($)", type: "number", defaultValue: "0" },
  {
    key: "status",
    label: "Status",
    type: "select",
    options: ["Active", "Inactive"].map((value) => ({ value, label: value })),
  },
];

export default function SuppliersPage() {
  return (
    <ModulePage<Supplier>
      title="Suppliers"
      subtitle="Supplier Management"
      icon={<UserRound size={22} />}
      entityName="Supplier"
      endpoint="/api/suppliers"
      searchPlaceholder="Search suppliers, contacts or categories..."
      filterKey="category"
      columns={columns}
      formFields={formFields}
      stats={(rows) => [
        { label: "Suppliers", value: rows.length.toString(), subtitle: "Registered vendors", icon: <UserRound size={21} /> },
        { label: "Active", value: rows.filter((s) => s.status === "Active").length.toString(), subtitle: "Currently trading", icon: <CheckCircle2 size={21} /> },
        { label: "Categories", value: new Set(rows.map((s) => s.category).filter(Boolean)).size.toString(), subtitle: "Product categories", icon: <Truck size={21} /> },
        { label: "Accounts Payable", value: money(rows.reduce((s, x) => s + x.balance, 0)), subtitle: "Outstanding balance", icon: <DollarSign size={21} /> },
      ]}
    />
  );
}

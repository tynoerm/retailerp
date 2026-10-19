"use client";

import { Clock, ShieldCheck, UserCheck, UserCog } from "lucide-react";
import ModulePage, { StatusBadge, type Column, type FormField } from "../components/ModulePage";
import { formatDate } from "../lib/format";
import { initials, ROLE_DESCRIPTIONS, ROLES, type Role } from "../lib/permissions";

type User = {
  id: number;
  name: string;
  email: string;
  role: Role;
  status: "Active" | "Inactive";
  last_login_at: string | null;
  created_at: string;
};

const roleStyles: Record<Role, string> = {
  Administrator: "border-purple-200 bg-purple-50 text-purple-700",
  Manager: "border-blue-200 bg-blue-50 text-blue-700",
  Cashier: "border-emerald-200 bg-emerald-50 text-emerald-700",
  Storekeeper: "border-amber-200 bg-amber-50 text-amber-700",
  "Warehouse Operator": "border-cyan-200 bg-cyan-50 text-cyan-700",
};

const columns: Column<User>[] = [
  {
    key: "name",
    label: "User",
    render: (u) => (
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#173B4F] text-xs font-bold text-white">
          {initials(u.name)}
        </span>
        <span className="font-semibold text-slate-800">{u.name}</span>
      </div>
    ),
  },
  { key: "email", label: "Email" },
  {
    key: "role",
    label: "Role",
    render: (u) => (
      <span title={ROLE_DESCRIPTIONS[u.role]} className={`whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold ${roleStyles[u.role] ?? ""}`}>
        {u.role}
      </span>
    ),
  },
  { key: "status", label: "Status", render: (u) => <StatusBadge status={u.status} /> },
  {
    key: "last_login_at",
    label: "Last Sign-in",
    render: (u) => (u.last_login_at ? `${formatDate(u.last_login_at)} ${u.last_login_at.slice(11, 16)}` : "Never"),
  },
];

const formFields: FormField[] = [
  { key: "name", label: "Full Name", required: true },
  { key: "email", label: "Email (used to sign in)", type: "email", required: true },
  {
    key: "role",
    label: "Role",
    type: "select",
    options: ROLES.map((role) => ({ value: role, label: `${role} — ${ROLE_DESCRIPTIONS[role]}` })),
    defaultValue: "Cashier",
    wide: true,
  },
  {
    key: "status",
    label: "Status",
    type: "select",
    options: ["Active", "Inactive"].map((value) => ({ value, label: value })),
  },
  {
    key: "password",
    label: "Password",
    type: "password",
    placeholder: "Min. 8 characters — leave blank to keep current",
  },
];

export default function UsersPage() {
  return (
    <ModulePage<User>
      title="Users & Roles"
      subtitle="Access Control"
      icon={<UserCog size={22} />}
      entityName="User"
      endpoint="/api/users"
      searchPlaceholder="Search users by name, email or role..."
      filterKey="role"
      columns={columns}
      formFields={formFields}
      stats={(rows) => [
        { label: "Total Users", value: rows.length.toString(), subtitle: "User accounts", icon: <UserCog size={21} /> },
        { label: "Active", value: rows.filter((u) => u.status === "Active").length.toString(), subtitle: "Can sign in", icon: <UserCheck size={21} /> },
        { label: "Administrators", value: rows.filter((u) => u.role === "Administrator").length.toString(), subtitle: "Full access", icon: <ShieldCheck size={21} /> },
        {
          label: "Signed in Today",
          value: rows.filter((u) => u.last_login_at && new Date(u.last_login_at.replace(" ", "T")).toDateString() === new Date().toDateString()).length.toString(),
          subtitle: "Distinct users",
          icon: <Clock size={21} />,
        },
      ]}
    />
  );
}

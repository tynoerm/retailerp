"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  Download,
  Edit3,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { api, downloadCsv, errorMessage } from "../lib/api-client";
import { money, today } from "../lib/format";
import { useAuth } from "./AuthProvider";
import UserMenu from "./UserMenu";

export type Stat = {
  label: string;
  value: string;
  subtitle: string;
  icon: React.ReactNode;
};

export type Column<T> = {
  key: keyof T & string;
  label: string;
  render?: (row: T) => React.ReactNode;
  csv?: (row: T) => string;
};

export type FormValues = Record<string, string>;

export type FormField = {
  key: string;
  label: string;
  type?: "text" | "email" | "password" | "number" | "date" | "datetime-local" | "select" | "textarea";
  options?: { value: string; label: string }[];
  required?: boolean;
  placeholder?: string;
  defaultValue?: string | (() => string);
  wide?: boolean;
};

export type EditorProps<T> = {
  row: T | null;
  onClose: () => void;
  onSaved: (message: string) => void;
};

const statusStyles: Record<string, string> = {
  Active: "border-emerald-200 bg-emerald-50 text-emerald-700",
  Paid: "border-emerald-200 bg-emerald-50 text-emerald-700",
  Completed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  Pending: "border-amber-200 bg-amber-50 text-amber-700",
  "Partially Paid": "border-amber-200 bg-amber-50 text-amber-700",
  Overdue: "border-red-200 bg-red-50 text-red-700",
  Failed: "border-red-200 bg-red-50 text-red-700",
  Inactive: "border-slate-200 bg-slate-100 text-slate-600",
  Refunded: "border-blue-200 bg-blue-50 text-blue-700",
  VIP: "border-purple-200 bg-purple-50 text-purple-700",
};

export const inputClass =
  "w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-[#1C9A9A] focus:bg-white focus:ring-2 focus:ring-[#1C9A9A]/10";

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold ${
        statusStyles[status] ?? "border-slate-200 bg-slate-100 text-slate-600"
      }`}
    >
      {status}
    </span>
  );
}

export { money, today };

export function PageShell({
  title,
  subtitle,
  icon,
  action,
  children,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#F6F7F9] text-slate-800">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="flex h-[76px] items-center justify-between gap-4 px-6">
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="rounded-xl border border-slate-200 p-2.5 text-slate-500 hover:bg-slate-50"
              aria-label="Back to dashboard"
            >
              <ArrowLeft size={18} />
            </Link>

            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#0F2A3B] text-white shadow-sm">
              {icon}
            </div>

            <div>
              <h1 className="text-xl font-bold text-[#0F2A3B]">{title}</h1>
              <p className="text-xs text-slate-500">RetailERP • {subtitle}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {action}
            <UserMenu />
          </div>
        </div>
      </header>

      <main className="space-y-6 p-6">{children}</main>
    </div>
  );
}

export function StatCards({ stats }: { stats: Stat[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
        >
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">{stat.label}</p>
              <p className="mt-2 text-2xl font-bold tracking-tight text-[#0F2A3B]">
                {stat.value}
              </p>
              <p className="mt-1 text-xs text-slate-400">{stat.subtitle}</p>
            </div>

            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#1C9A9A]/10 text-[#1C9A9A]">
              {stat.icon}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
      <div className={`flex max-h-[92vh] w-full flex-col rounded-3xl bg-white shadow-2xl ${wide ? "max-w-4xl" : "max-w-2xl"}`}>
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-bold text-[#0F2A3B]">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100">
            <X size={20} />
          </button>
        </div>

        <div className="overflow-y-auto p-6">{children}</div>

        <div className="flex justify-end gap-3 border-t border-slate-200 px-6 py-4">{footer}</div>
      </div>
    </div>
  );
}

export function ModalFooter({ saving, onClose, label = "Save" }: { saving: boolean; onClose: () => void; label?: string }) {
  return (
    <>
      <button
        type="button"
        onClick={onClose}
        className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
      >
        Cancel
      </button>
      <button
        type="submit"
        form="module-form"
        disabled={saving}
        className="flex items-center gap-2 rounded-xl bg-[#1C9A9A] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#178686] disabled:opacity-60"
      >
        {saving ? <Loader2 size={17} className="animate-spin" /> : <Save size={17} />}
        {label}
      </button>
    </>
  );
}

export function FieldInput({
  field,
  value,
  onChange,
}: {
  field: FormField;
  value: string;
  onChange: (value: string) => void;
}) {
  const common = {
    value,
    required: field.required,
    placeholder: field.placeholder,
    className: inputClass,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      onChange(event.target.value),
  };

  return (
    <label className={`block ${field.wide || field.type === "textarea" ? "md:col-span-2" : ""}`}>
      <span className="mb-1.5 block text-sm font-medium text-slate-700">
        {field.label}
        {field.required && <span className="text-red-500"> *</span>}
      </span>

      {field.type === "select" ? (
        <select {...common}>
          {field.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : field.type === "textarea" ? (
        <textarea {...common} rows={3} />
      ) : (
        <input
          {...common}
          type={field.type ?? "text"}
          step={field.type === "number" ? "any" : undefined}
          autoComplete={field.type === "password" ? "new-password" : undefined}
        />
      )}
    </label>
  );
}

function toFormValues(fields: FormField[], row: Record<string, unknown> | null): FormValues {
  return Object.fromEntries(
    fields.map((field) => {
      const raw = row?.[field.key];

      if (raw === undefined || raw === null) {
        const fallback = typeof field.defaultValue === "function" ? field.defaultValue() : field.defaultValue;
        return [field.key, fallback ?? field.options?.[0]?.value ?? ""];
      }

      const text = String(raw);
      if (field.type === "date") return [field.key, text.slice(0, 10)];
      if (field.type === "datetime-local") return [field.key, text.replace(" ", "T").slice(0, 16)];
      return [field.key, text];
    })
  );
}

function FormEditor<T extends { id: number }>({
  row,
  onClose,
  onSaved,
  endpoint,
  entityName,
  fields,
  onFormChange,
}: EditorProps<T> & {
  endpoint: string;
  entityName: string;
  fields: FormField[];
  onFormChange?: (form: FormValues, key: string) => FormValues;
}) {
  const [form, setForm] = useState(() => toFormValues(fields, row));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");

    try {
      await api(endpoint, {
        method: row ? "PUT" : "POST",
        body: JSON.stringify(row ? { ...form, id: row.id } : form),
      });
      onSaved(`${entityName} ${row ? "updated" : "created"}`);
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  };

  return (
    <Modal
      title={`${row ? "Edit" : "New"} ${entityName}`}
      onClose={onClose}
      footer={<ModalFooter saving={saving} onClose={onClose} />}
    >
      <form id="module-form" onSubmit={submit} className="grid gap-4 md:grid-cols-2">
        {error && <ErrorBanner message={error} className="md:col-span-2" />}

        {fields.map((field) => (
          <FieldInput
            key={field.key}
            field={field}
            value={form[field.key] ?? ""}
            onChange={(value) =>
              setForm((current) => {
                const next = { ...current, [field.key]: value };
                return onFormChange ? onFormChange(next, field.key) : next;
              })
            }
          />
        ))}
      </form>
    </Modal>
  );
}

export function ErrorBanner({
  message,
  onRetry,
  className = "",
}: {
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div className={`flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 ${className}`}>
      <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-600" />
      <p className="flex-1">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="flex items-center gap-1 font-semibold hover:underline">
          <RefreshCw size={14} /> Retry
        </button>
      )}
    </div>
  );
}

export function useRecords<T>(endpoint: string) {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await api<T[]>(endpoint);
      setRows(data);
      setError("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch
    void load();
  }, [load]);

  return { rows, loading, error, reload: load };
}

export default function ModulePage<T extends { id: number }>({
  title,
  subtitle,
  icon,
  entityName,
  endpoint,
  stats,
  columns,
  searchPlaceholder,
  filterKey,
  formFields = [],
  onFormChange,
  Editor,
  rowActions,
  onDataChange,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  entityName: string;
  endpoint: string;
  stats: (rows: T[]) => Stat[];
  columns: Column<T>[];
  searchPlaceholder: string;
  filterKey?: keyof T & string;
  formFields?: FormField[];
  onFormChange?: (form: FormValues, key: string) => FormValues;
  Editor?: React.ComponentType<EditorProps<T>>;
  rowActions?: (row: T) => React.ReactNode;
  onDataChange?: () => void;
}) {
  const { rows, loading, error, reload } = useRecords<T>(endpoint);
  const canDelete = useAuth().canCall(endpoint, "DELETE");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All");
  const [editing, setEditing] = useState<T | null | undefined>(undefined);
  const [toast, setToast] = useState("");

  const notify = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(""), 3000);
  };

  const filterOptions = useMemo(
    () =>
      filterKey
        ? ["All", ...Array.from(new Set(rows.map((row) => String(row[filterKey]))))]
        : [],
    [rows, filterKey]
  );

  const filteredRows = useMemo(() => {
    const term = search.toLowerCase();

    return rows.filter(
      (row) =>
        (!filterKey || filter === "All" || String(row[filterKey]) === filter) &&
        columns.some((column) =>
          String(row[column.key] ?? "").toLowerCase().includes(term)
        )
    );
  }, [rows, columns, search, filter, filterKey]);

  const afterChange = async (message: string) => {
    setEditing(undefined);
    notify(message);
    await reload();
    onDataChange?.();
  };

  const remove = async (row: T) => {
    if (!window.confirm(`Delete this ${entityName.toLowerCase()}? This cannot be undone.`)) return;

    try {
      await api(`${endpoint}?id=${row.id}`, { method: "DELETE" });
      await afterChange(`${entityName} deleted`);
    } catch (err) {
      alert(errorMessage(err));
    }
  };

  const exportCsv = () =>
    downloadCsv(
      `${title.toLowerCase().replace(/\s+/g, "-")}-${today()}.csv`,
      columns.map((column) => column.label),
      filteredRows.map((row) =>
        columns.map((column) => column.csv?.(row) ?? String(row[column.key] ?? ""))
      )
    );

  const editorProps: EditorProps<T> = {
    row: editing ?? null,
    onClose: () => setEditing(undefined),
    onSaved: afterChange,
  };

  return (
    <PageShell
      title={title}
      subtitle={subtitle}
      icon={icon}
      action={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={exportCsv}
            disabled={filteredRows.length === 0}
            className="hidden items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50 sm:flex"
          >
            <Download size={17} />
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => setEditing(null)}
            className="flex items-center gap-2 rounded-xl bg-[#1C9A9A] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#178686]"
          >
            <Plus size={18} />
            New {entityName}
          </button>
        </div>
      }
    >
      {error && <ErrorBanner message={error} onRetry={reload} />}

      <StatCards stats={stats(rows)} />

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-200 p-5 md:flex-row md:items-center md:justify-between">
          <div className="relative w-full md:max-w-md">
            <Search
              size={18}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={searchPlaceholder}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-4 text-sm outline-none transition focus:border-[#1C9A9A] focus:bg-white focus:ring-2 focus:ring-[#1C9A9A]/10"
            />
          </div>

          {filterKey && (
            <select
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 outline-none focus:border-[#1C9A9A]"
            >
              {filterOptions.map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left">
            <thead className="bg-slate-50">
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                {columns.map((column) => (
                  <th key={column.key} className="px-5 py-4 font-semibold">
                    {column.label}
                  </th>
                ))}
                <th className="px-5 py-4 text-right font-semibold">Actions</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {filteredRows.map((row) => (
                <tr key={row.id} className="transition hover:bg-slate-50">
                  {columns.map((column) => (
                    <td key={column.key} className="px-5 py-4 text-sm text-slate-600">
                      {column.render ? column.render(row) : String(row[column.key] ?? "—")}
                    </td>
                  ))}
                  <td className="px-5 py-4">
                    <div className="flex items-center justify-end gap-1">
                      {rowActions?.(row)}
                      <button
                        type="button"
                        title="Edit"
                        onClick={() => setEditing(row)}
                        className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-[#1C9A9A]"
                      >
                        <Edit3 size={16} />
                      </button>
                      {canDelete && (
                        <button
                          type="button"
                          title="Delete"
                          onClick={() => remove(row)}
                          className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
              <Loader2 size={18} className="animate-spin" /> Loading…
            </div>
          ) : (
            filteredRows.length === 0 && (
              <div className="py-12 text-center">
                <ClipboardList size={38} className="mx-auto text-slate-300" />
                <p className="mt-3 font-semibold text-slate-700">No records found</p>
                <p className="mt-1 text-sm text-slate-500">
                  {rows.length === 0 ? `Create your first ${entityName.toLowerCase()} to get started.` : "Try changing your search or filters."}
                </p>
              </div>
            )
          )}
        </div>
      </section>

      {editing !== undefined &&
        (Editor ? (
          <Editor {...editorProps} />
        ) : (
          <FormEditor
            {...editorProps}
            endpoint={endpoint}
            entityName={entityName}
            fields={formFields}
            onFormChange={onFormChange}
          />
        ))}

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-xl bg-[#0F2A3B] px-4 py-3 text-sm font-semibold text-white shadow-lg">
          <CheckCircle2 size={18} className="text-emerald-400" />
          {toast}
        </div>
      )}
    </PageShell>
  );
}

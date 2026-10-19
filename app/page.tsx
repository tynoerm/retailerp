"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, errorMessage } from "./lib/api-client";
import { money } from "./lib/format";
import { initials } from "./lib/permissions";
import { signOut, useAuth } from "./components/AuthProvider";
import UserMenu from "./components/UserMenu";
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Warehouse,
  Boxes,
  Truck,
  Users,
  UserRound,
  BarChart3,
  CreditCard,
  FileText,
  Settings,
  Search,
  Bell,
  ArrowUpRight,
  ArrowDownRight,
  AlertTriangle,
  ChevronRight,
  Plus,
  ShoppingBag,
  DollarSign,
  ClipboardList,
  Menu,
  X,
  UserCog,
  LogOut,
} from "lucide-react";

const menuItems = [
  {
    name: "Dashboard",
    href: "/",
    icon: LayoutDashboard,
  },
  {
    name: "Point of Sale",
    href: "/pos",
    icon: ShoppingCart,
  },
  {
    name: "Products",
    href: "/products",
    icon: Package,
  },
  {
    name: "Warehouses",
    href: "/warehouse",
    icon: Warehouse,
  },
  {
    name: "Stock Management",
    href: "/stockmanagement",
    icon: Boxes,
  },
  {
    name: "Procurement",
    href: "/procurement",
    icon: Truck,
  },
  {
    name: "Customers",
    href: "/customers",
    icon: Users,
  },
  {
    name: "Suppliers",
    href: "/suppliers",
    icon: UserRound,
  },
  {
    name: "Reports & Analytics",
    href: "/reports",
    icon: BarChart3,
  },
  {
    name: "Payments",
    href: "/payments",
    icon: CreditCard,
  },
  {
    name: "Invoices",
    href: "/invoices",
    icon: FileText,
  },
  {
    name: "Users & Roles",
    href: "/users",
    icon: UserCog,
  },
  {
    name: "Settings",
    href: "/settings",
    icon: Settings,
  },
];

const quickActions = [
  {
    name: "New Sale",
    href: "/pos",
    icon: ShoppingCart,
    description: "Open POS",
  },
  {
    name: "Add Product",
    href: "/products",
    icon: Package,
    description: "Create product",
  },
  {
    name: "Stock Transfer",
    href: "/stockmanagement",
    icon: Boxes,
    description: "Move stock",
  },
  {
    name: "Purchase Order",
    href: "/procurement",
    icon: Truck,
    description: "Create PO",
  },
];

type DashboardData = {
  salesToday: number;
  salesChange: number;
  ordersToday: number;
  ordersChange: number;
  inventoryValue: number;
  productCount: number;
  lowStockCount: number;
  outOfStockCount: number;
  warehouses: number;
  overdueInvoices: number;
  pendingOrders: number;
  lowStockItems: { product: string; sku: string; stock: number; reorder: number; warehouse: string }[];
  recentTransactions: {
    id: number;
    number: string;
    customer: string;
    items: number;
    amount: number;
    payment: string;
    status: string;
    createdAt: string;
  }[];
};

const percent = (value: number) => `${value > 0 ? "+" : ""}${value}%`;

function timeAgo(value: string) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value.replace(" ", "T")).getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export default function DashboardPage() {
  const { user, canView } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [data, setData] = useState<DashboardData | null>(null);
  const [loadError, setLoadError] = useState("");
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    api<DashboardData>("/api/dashboard")
      .then(setData)
      .catch((error) => setLoadError(errorMessage(error)))
      .finally(() => setNow(new Date()));
  }, []);

  const greeting = !now ? "Welcome" : now.getHours() < 12 ? "Good morning" : now.getHours() < 17 ? "Good afternoon" : "Good evening";

  const filteredTransactions = (data?.recentTransactions ?? []).filter(
    (transaction) =>
      transaction.number.toLowerCase().includes(search.toLowerCase()) ||
      transaction.customer.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-[#F6F7F9] text-slate-800">
      {/* MOBILE OVERLAY */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* SIDEBAR */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-[#0F2A3B] text-white transition-transform duration-300 lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* LOGO */}
        <div className="flex h-[78px] items-center justify-between border-b border-white/10 px-5">
          <Link href="/" className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1C9A9A]">
              <ShoppingBag size={21} />
            </div>

            <div>
              <p className="text-lg font-bold tracking-tight">
                RetailERP
              </p>

              <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400">
                Enterprise Retail
              </p>
            </div>
          </Link>

          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="rounded-lg p-2 text-slate-400 hover:bg-white/10 lg:hidden"
          >
            <X size={20} />
          </button>
        </div>

        {/* NAVIGATION */}
        <div className="flex-1 overflow-y-auto px-3 py-5">
          <p className="mb-3 px-3 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
            Main Menu
          </p>

          <nav className="space-y-1">
            {menuItems.filter((item) => canView(item.href)).map((item) => {
              const Icon = item.icon;
              const active = item.href === "/";

              return (
                <Link
                  key={item.name}
                  href={item.href}
                  onClick={() => setSidebarOpen(false)}
                  className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                    active
                      ? "bg-[#1C9A9A] text-white shadow-sm"
                      : "text-slate-300 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  <Icon
                    size={18}
                    className={
                      active
                        ? "text-white"
                        : "text-slate-400 group-hover:text-white"
                    }
                  />

                  <span className="flex-1">{item.name}</span>

                  {active && (
                    <ChevronRight size={15} className="opacity-80" />
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* SIDEBAR FOOTER */}
        <div className="border-t border-white/10 p-4">
          <div className="rounded-xl bg-white/5 p-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#1C9A9A] text-xs font-bold">
                {initials(user?.name ?? "")}
              </div>

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">
                  {user?.name}
                </p>

                <p className="truncate text-xs text-slate-400">
                  {user?.role}
                </p>
              </div>

              <button
                type="button"
                onClick={signOut}
                title="Sign out"
                className="rounded-lg p-2 text-slate-400 transition hover:bg-white/10 hover:text-white"
              >
                <LogOut size={17} />
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* MAIN */}
      <div className="lg:pl-64">
        {/* HEADER */}
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="flex h-[78px] items-center justify-between gap-4 px-5 lg:px-7">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                className="rounded-xl border border-slate-200 p-2.5 text-slate-600 lg:hidden"
              >
                <Menu size={20} />
              </button>

              <div>
                <p className="text-xs font-medium text-slate-400">
                  RetailERP
                </p>

                <h1 className="text-xl font-bold text-[#0F2A3B]">
                  Dashboard
                </h1>
              </div>
            </div>

            <div className="hidden flex-1 justify-center md:flex">
              <div className="relative w-full max-w-md">
                <Search
                  size={17}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />

                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search transactions..."
                  className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-4 text-sm outline-none transition focus:border-[#1C9A9A] focus:bg-white"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-3">
              <button
                type="button"
                className="relative rounded-xl border border-slate-200 p-2.5 text-slate-500 hover:bg-slate-50"
              >
                <Bell size={19} />

                <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white" />
              </button>

              {canView("/pos") && (
                <Link
                  href="/pos"
                  className="hidden items-center gap-2 rounded-xl bg-[#1C9A9A] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#168383] sm:flex"
                >
                  <Plus size={17} />
                  New Sale
                </Link>
              )}

              <UserMenu />
            </div>
          </div>
        </header>

        {/* CONTENT */}
        <main className="space-y-6 p-5 lg:p-7">
          {/* WELCOME */}
          <section className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
            <div>
              <p className="text-sm font-medium text-[#1C9A9A]">
                {now?.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) ?? "\u00a0"}
              </p>

              <h2 className="mt-1 text-2xl font-bold tracking-tight text-[#0F2A3B]">
                {greeting}, {user?.name.split(" ")[0] ?? "there"}
              </h2>

              <p className="mt-1 text-sm text-slate-500">
                Here&apos;s what&apos;s happening across your retail operation today.
              </p>

              {loadError && (
                <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
                  {loadError}
                </p>
              )}
            </div>

            {canView("/reports") && (
              <Link
                href="/reports"
                className="flex items-center gap-2 self-start rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
              >
                <BarChart3 size={17} />
                View Reports
              </Link>
            )}
          </section>

          {/* KPI CARDS */}
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <DashboardCard
              icon={<DollarSign size={21} />}
              label="Today's Sales"
              value={data ? money(data.salesToday) : "—"}
              change={data ? percent(data.salesChange) : ""}
              positive={(data?.salesChange ?? 0) >= 0}
              description="vs. yesterday"
              iconBg="bg-emerald-50"
              iconColor="text-emerald-600"
            />

            <DashboardCard
              icon={<ShoppingCart size={21} />}
              label="Orders Today"
              value={data ? data.ordersToday.toLocaleString() : "—"}
              change={data ? percent(data.ordersChange) : ""}
              positive={(data?.ordersChange ?? 0) >= 0}
              description="vs. yesterday"
              iconBg="bg-blue-50"
              iconColor="text-blue-600"
            />

            <DashboardCard
              icon={<Package size={21} />}
              label="Inventory Value"
              value={data ? money(data.inventoryValue) : "—"}
              change={data ? `${data.productCount} products` : ""}
              positive
              description="at cost"
              iconBg="bg-purple-50"
              iconColor="text-purple-600"
            />

            <DashboardCard
              icon={<AlertTriangle size={21} />}
              label="Low Stock Items"
              value={data ? String(data.lowStockCount) : "—"}
              change={data ? `${data.outOfStockCount} out of stock` : ""}
              positive={false}
              description="need attention"
              iconBg="bg-amber-50"
              iconColor="text-amber-600"
            />
          </section>

          {/* QUICK ACTIONS */}
          <section>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-[#0F2A3B]">
                  Quick Actions
                </h3>

                <p className="text-xs text-slate-500">
                  Frequently used retail operations
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {quickActions.filter((action) => canView(action.href)).map((action) => {
                const Icon = action.icon;

                return (
                  <Link
                    key={action.name}
                    href={action.href}
                    className="group rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-[#1C9A9A]/40 hover:shadow-md"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0F2A3B]/5 text-[#0F2A3B] transition group-hover:bg-[#1C9A9A]/10 group-hover:text-[#1C9A9A]">
                        <Icon size={19} />
                      </div>

                      <ArrowUpRight
                        size={17}
                        className="text-slate-300 transition group-hover:text-[#1C9A9A]"
                      />
                    </div>

                    <p className="mt-4 text-sm font-bold text-slate-800">
                      {action.name}
                    </p>

                    <p className="mt-1 text-xs text-slate-500">
                      {action.description}
                    </p>
                  </Link>
                );
              })}
            </div>
          </section>

          {/* LOW STOCK ALERTS */}
          <section>
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-200 p-5">
                <div>
                  <h3 className="font-bold text-[#0F2A3B]">
                    Low Stock Alerts
                  </h3>

                  <p className="mt-1 text-xs text-slate-500">
                    Items requiring replenishment
                  </p>
                </div>

                <Link
                  href="/stockmanagement"
                  className="text-xs font-semibold text-[#1C9A9A] hover:underline"
                >
                  View All
                </Link>
              </div>

              <div className="divide-y divide-slate-100">
                {data?.lowStockItems.length === 0 && (
                  <p className="p-6 text-center text-sm text-slate-500">
                    All stock is above reorder levels.
                  </p>
                )}

                {(data?.lowStockItems ?? []).map((item) => (
                  <div
                    key={`${item.sku}-${item.warehouse}`}
                    className="flex items-center justify-between gap-3 p-4"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
                        <AlertTriangle size={17} />
                      </div>

                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-800">
                          {item.product}
                        </p>

                        <p className="truncate text-[11px] text-slate-400">
                          {item.sku} • {item.warehouse}
                        </p>
                      </div>
                    </div>

                    <div className="shrink-0 text-right">
                      <p className="text-sm font-bold text-red-600">
                        {item.stock}
                      </p>

                      <p className="text-[10px] text-slate-400">
                        / {item.reorder} min
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="p-4">
                <Link
                  href="/procurement"
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#0F2A3B] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#173B4F]"
                >
                  <Truck size={16} />
                  Create Purchase Order
                </Link>
              </div>
            </div>
          </section>

          {/* TRANSACTIONS */}
          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col justify-between gap-3 border-b border-slate-200 p-5 sm:flex-row sm:items-center">
              <div>
                <h3 className="font-bold text-[#0F2A3B]">
                  Recent Transactions
                </h3>

                <p className="mt-1 text-xs text-slate-500">
                  Latest sales activity from your POS
                </p>
              </div>

              <Link
                href="/pos"
                className="flex items-center gap-1 text-sm font-semibold text-[#1C9A9A]"
              >
                Open POS
                <ChevronRight size={15} />
              </Link>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[800px] text-left">
                <thead className="bg-slate-50">
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-5 py-4 font-semibold">
                      Transaction
                    </th>

                    <th className="px-5 py-4 font-semibold">
                      Customer
                    </th>

                    <th className="px-5 py-4 font-semibold">
                      Items
                    </th>

                    <th className="px-5 py-4 font-semibold">
                      Payment
                    </th>

                    <th className="px-5 py-4 font-semibold">
                      Amount
                    </th>

                    <th className="px-5 py-4 font-semibold">
                      Status
                    </th>

                    <th className="px-5 py-4 font-semibold">
                      Time
                    </th>

                    <th className="px-5 py-4" />
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100">
                  {filteredTransactions.map((transaction) => (
                    <tr
                      key={transaction.id}
                      className="transition hover:bg-slate-50"
                    >
                      <td className="px-5 py-4">
                        <p className="text-sm font-bold text-[#0F2A3B]">
                          {transaction.number}
                        </p>
                      </td>

                      <td className="px-5 py-4 text-sm text-slate-600">
                        {transaction.customer}
                      </td>

                      <td className="px-5 py-4 text-sm text-slate-500">
                        {transaction.items}
                      </td>

                      <td className="px-5 py-4">
                        <span className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-600">
                          {transaction.payment}
                        </span>
                      </td>

                      <td className="px-5 py-4 text-sm font-bold text-slate-800">
                        {money(transaction.amount)}
                      </td>

                      <td className="px-5 py-4">
                        <span
                          className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                            transaction.status === "COMPLETED"
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : "border-amber-200 bg-amber-50 text-amber-700"
                          }`}
                        >
                          {transaction.status.charAt(0) + transaction.status.slice(1).toLowerCase()}
                        </span>
                      </td>

                      <td className="px-5 py-4 text-xs text-slate-400">
                        {timeAgo(transaction.createdAt)}
                      </td>

                      <td className="px-5 py-4 text-right">
                        <a
                          href={`/pos/receipt/${encodeURIComponent(transaction.number)}`}
                          target="_blank"
                          rel="noopener"
                          title="View receipt"
                          className="inline-flex rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        >
                          <FileText size={18} />
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {filteredTransactions.length === 0 && (
                <div className="py-12 text-center">
                  <ClipboardList
                    size={38}
                    className="mx-auto text-slate-300"
                  />

                  <p className="mt-3 font-semibold text-slate-700">
                    No transactions found
                  </p>

                  <p className="mt-1 text-sm text-slate-500">
                    Try another search.
                  </p>
                </div>
              )}
            </div>
          </section>

          {/* SYSTEM OVERVIEW */}
          <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <OverviewCard
              href="/products"
              icon={<Package size={20} />}
              title="Product Catalogue"
              value={data ? data.productCount.toLocaleString() : "—"}
              description="Products"
            />

            <OverviewCard
              href="/warehouse"
              icon={<Warehouse size={20} />}
              title="Warehouses"
              value={data ? String(data.warehouses) : "—"}
              description="Active locations"
            />

            <OverviewCard
              href="/stockmanagement"
              icon={<Boxes size={20} />}
              title="Stock Management"
              value={data ? String(data.lowStockCount) : "—"}
              description="Items requiring attention"
            />
          </section>
        </main>
      </div>
    </div>
  );
}

/* ============================
   COMPONENTS
============================ */

function DashboardCard({
  icon,
  label,
  value,
  change,
  positive,
  description,
  iconBg,
  iconColor,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  change: string;
  positive: boolean;
  description: string;
  iconBg: string;
  iconColor: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-slate-500">
            {label}
          </p>

          <p className="mt-2 text-2xl font-bold tracking-tight text-[#0F2A3B]">
            {value}
          </p>

          <div className="mt-2 flex items-center gap-2">
            <span
              className={`flex items-center gap-1 text-xs font-bold ${
                positive ? "text-emerald-600" : "text-amber-600"
              }`}
            >
              {positive ? (
                <ArrowUpRight size={13} />
              ) : (
                <ArrowDownRight size={13} />
              )}

              {change}
            </span>

            <span className="text-xs text-slate-400">
              {description}
            </span>
          </div>
        </div>

        <div
          className={`flex h-11 w-11 items-center justify-center rounded-xl ${iconBg} ${iconColor}`}
        >
          {icon}
        </div>
      </div>
    </div>
  );
}

function OverviewCard({
  href,
  icon,
  title,
  value,
  description,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  value: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-[#1C9A9A]/40 hover:shadow-md"
    >
      <div className="flex items-center justify-between">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0F2A3B]/5 text-[#0F2A3B] group-hover:bg-[#1C9A9A]/10 group-hover:text-[#1C9A9A]">
          {icon}
        </div>

        <ArrowUpRight
          size={17}
          className="text-slate-300 group-hover:text-[#1C9A9A]"
        />
      </div>

      <div className="mt-4">
        <p className="text-sm font-semibold text-slate-700">
          {title}
        </p>

        <div className="mt-1 flex items-end gap-2">
          <p className="text-2xl font-bold text-[#0F2A3B]">
            {value}
          </p>

          <p className="mb-1 text-xs text-slate-400">
            {description}
          </p>
        </div>
      </div>
    </Link>
  );
}

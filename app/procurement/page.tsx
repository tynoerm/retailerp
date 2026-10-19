"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, errorMessage } from "../lib/api-client";
import UserMenu from "../components/UserMenu";
import { money as currency } from "../lib/format";
import type { Settings } from "../lib/settings-defaults";
import {
  Search,
  Plus,
  MoreVertical,
  X,
  ShoppingCart,
  Truck,
  PackageCheck,
  Clock3,
  CheckCircle2,
  FileText,
  Eye,
  Trash2,
  CalendarDays,
  DollarSign,
  AlertCircle,
  ArrowDownToLine,
  User,
  Building2,
  Save,
} from "lucide-react";

type PurchaseOrderStatus =
  | "Draft"
  | "Pending Approval"
  | "Ordered"
  | "Partially Received"
  | "Received"
  | "Cancelled";

type PurchaseOrder = {
  id: number;
  number: string;
  supplierId: number;
  supplier: string;
  supplierCode: string;
  date: string;
  expectedDate: string;
  items: number;
  quantity: number;
  received: number;
  subtotal: number;
  taxRate: number;
  tax: number;
  total: number;
  status: PurchaseOrderStatus;
  warehouse: string;
  requestedBy: string;
  notes: string;
};

type Supplier = {
  id: number;
  name: string;
  code: string;
  contact: string;
  phone: string;
  email: string;
  outstanding: number;
  orders: number;
  status: "Active" | "Inactive";
};

type ProductOption = { id: number; name: string; sku: string; cost: number };
type WarehouseOption = { id: number; name: string; status: string };

type ProductLine = {
  id: number;
  productId: number;
  sku: string;
  quantity: number;
  unitCost: number;
};

type ReceiptLine = {
  id: number;
  product: string;
  sku: string;
  trackBatches: number;
  quantity: number;
  receivedQuantity: number;
  receiving: string;
  batchNumber: string;
  expiryDate: string;
};

const statusStyles: Record<PurchaseOrderStatus, string> = {
  Draft: "bg-slate-100 text-slate-700",
  "Pending Approval": "bg-amber-100 text-amber-700",
  Ordered: "bg-blue-100 text-blue-700",
  "Partially Received": "bg-purple-100 text-purple-700",
  Received: "bg-emerald-100 text-emerald-700",
  Cancelled: "bg-red-100 text-red-700",
};

let lineKey = 0;

const newLine = (product?: ProductOption): ProductLine => ({
  id: ++lineKey,
  productId: product?.id ?? 0,
  sku: product?.sku ?? "",
  quantity: 1,
  unitCost: product?.cost ?? 0,
});

const inDays = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
};

export default function ProcurementPage() {
  const [activeTab, setActiveTab] = useState<"orders" | "suppliers" | "receiving">(
    "orders"
  );

  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [taxRate, setTaxRate] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [supplierFilter, setSupplierFilter] = useState("All");

  const [showOrderModal, setShowOrderModal] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [showReceiveModal, setShowReceiveModal] = useState(false);
  const [showSupplierModal, setShowSupplierModal] = useState(false);

  const [selectedOrder, setSelectedOrder] =
    useState<PurchaseOrder | null>(null);

  const [selectedSupplier, setSelectedSupplier] =
    useState<Supplier | null>(null);

  const [orderMenu, setOrderMenu] = useState<number | null>(null);

  const [newOrder, setNewOrder] = useState({
    supplier: "",
    warehouse: "",
    expectedDate: "",
    notes: "",
  });

  const [newSupplier, setNewSupplier] = useState({
    name: "",
    contact: "",
    phone: "",
    email: "",
  });

  const [productLines, setProductLines] = useState<ProductLine[]>([]);
  const [receiptLines, setReceiptLines] = useState<ReceiptLine[]>([]);
  const [receiptNotes, setReceiptNotes] = useState("");

  const load = useCallback(async () => {
    try {
      const [orderRows, supplierRows, productRows, warehouseRows, settings] = await Promise.all([
        api<PurchaseOrder[]>("/api/procurement"),
        api<{ id: number; name: string; code: string; contact: string | null; phone: string | null; email: string | null; balance: number; order_count: number; status: Supplier["status"] }[]>("/api/suppliers"),
        api<ProductOption[]>("/api/products"),
        api<WarehouseOption[]>("/api/warehouses"),
        api<Settings>("/api/settings"),
      ]);

      setOrders(orderRows);
      setSuppliers(
        supplierRows.map((row) => ({
          id: row.id,
          name: row.name,
          code: row.code,
          contact: row.contact ?? "—",
          phone: row.phone ?? "—",
          email: row.email ?? "—",
          outstanding: row.balance,
          orders: row.order_count,
          status: row.status,
        }))
      );
      setProducts(productRows);
      setWarehouses(warehouseRows.filter((row) => row.status !== "Inactive"));
      setTaxRate(Number(settings.taxRate) || 0);
      setLoadError("");
    } catch (error) {
      setLoadError(errorMessage(error));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch
    void load();
  }, [load]);

  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      const matchesSearch =
        order.number.toLowerCase().includes(search.toLowerCase()) ||
        order.supplier.toLowerCase().includes(search.toLowerCase()) ||
        order.warehouse.toLowerCase().includes(search.toLowerCase());

      const matchesStatus =
        statusFilter === "All" || order.status === statusFilter;

      const matchesSupplier =
        supplierFilter === "All" || order.supplier === supplierFilter;

      return matchesSearch && matchesStatus && matchesSupplier;
    });
  }, [orders, search, statusFilter, supplierFilter]);

  const totals = useMemo(() => {
    const purchaseValue = orders
      .filter((order) => order.status !== "Cancelled")
      .reduce((sum, order) => sum + order.total, 0);

    const pending = orders.filter(
      (order) =>
        order.status === "Pending Approval" ||
        order.status === "Ordered" ||
        order.status === "Partially Received"
    ).length;

    const received = orders.filter(
      (order) => order.status === "Received"
    ).length;

    const awaitingApproval = orders.filter(
      (order) => order.status === "Pending Approval" || order.status === "Draft"
    ).length;

    return {
      purchaseValue,
      pending,
      received,
      awaitingApproval,
    };
  }, [orders]);

  const orderSubtotal = productLines.reduce(
    (sum, line) => sum + line.quantity * line.unitCost,
    0
  );

  const orderTax = orderSubtotal * (taxRate / 100);
  const orderTotal = orderSubtotal + orderTax;

  function openNewOrder(supplierName = "") {
    setNewOrder({
      supplier: supplierName,
      warehouse: String(warehouses[0]?.id ?? ""),
      expectedDate: inDays(3),
      notes: "",
    });
    setProductLines([newLine(products[0])]);
    setShowOrderModal(true);
  }

  function addProductLine() {
    setProductLines((current) => [...current, newLine(products[0])]);
  }

  function updateProductLine(
    id: number,
    field: "productId" | "quantity" | "unitCost",
    value: number
  ) {
    setProductLines((current) =>
      current.map((line) => {
        if (line.id !== id) return line;

        if (field === "productId") {
          const product = products.find((item) => item.id === value);

          return {
            ...line,
            productId: value,
            sku: product?.sku || "",
            unitCost: product?.cost || 0,
          };
        }

        return {
          ...line,
          [field]: value,
        };
      })
    );
  }

  function removeProductLine(id: number) {
    if (productLines.length === 1) return;

    setProductLines((current) =>
      current.filter((line) => line.id !== id)
    );
  }

  async function runOrderAction(body: Record<string, unknown>, method: "POST" | "PUT" = "PUT") {
    setSaving(true);

    try {
      await api("/api/procurement", { method, body: JSON.stringify(body) });
      await load();
      return true;
    } catch (error) {
      alert(errorMessage(error));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function createPurchaseOrder() {
    const supplier = suppliers.find((item) => item.name === newOrder.supplier);
    if (!supplier || productLines.length === 0) return;

    const ok = await runOrderAction(
      {
        supplierId: supplier.id,
        warehouseId: Number(newOrder.warehouse),
        expectedDate: newOrder.expectedDate,
        notes: newOrder.notes,
        items: productLines.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
          unitCost: line.unitCost,
        })),
      },
      "POST"
    );

    if (ok) setShowOrderModal(false);
  }

  async function approveOrder(orderId: number) {
    setOrderMenu(null);
    await runOrderAction({ id: orderId, action: "approve" });
  }

  async function cancelOrder(orderId: number) {
    setOrderMenu(null);
    if (!window.confirm("Cancel this purchase order?")) return;
    await runOrderAction({ id: orderId, action: "cancel" });
  }

  async function receiveOrder() {
    if (!selectedOrder) return;

    const missingBatch = receiptLines.find(
      (line) => line.trackBatches && Number(line.receiving) > 0 && !line.batchNumber.trim()
    );
    if (missingBatch && !window.confirm(`${missingBatch.product} tracks batches but no batch number was entered. Receive without a batch?`)) {
      return;
    }

    const ok = await runOrderAction({
      id: selectedOrder.id,
      action: "receive",
      notes: receiptNotes,
      lines: receiptLines.map((line) => ({
        itemId: line.id,
        quantity: Number(line.receiving) || 0,
        batchNumber: line.batchNumber,
        expiryDate: line.expiryDate,
      })),
    });

    if (ok) {
      setShowReceiveModal(false);
      setSelectedOrder(null);
    }
  }

  function openDetails(order: PurchaseOrder) {
    setSelectedOrder(order);
    setShowDetailsModal(true);
    setOrderMenu(null);
  }

  async function openReceive(order: PurchaseOrder) {
    setSelectedOrder(order);
    setOrderMenu(null);
    setReceiptNotes("");

    try {
      const { items } = await api<{ items: Omit<ReceiptLine, "receiving" | "batchNumber" | "expiryDate">[] }>(
        `/api/procurement?id=${order.id}`
      );
      setReceiptLines(
        items.map((item) => ({
          ...item,
          receiving: String(item.quantity - item.receivedQuantity),
          batchNumber: "",
          expiryDate: "",
        }))
      );
      setShowReceiveModal(true);
    } catch (error) {
      alert(errorMessage(error));
    }
  }

  async function saveSupplier() {
    if (!newSupplier.name) return;

    setSaving(true);

    try {
      await api("/api/suppliers", {
        method: "POST",
        body: JSON.stringify({ ...newSupplier, status: "Active" }),
      });
      setNewSupplier({ name: "", contact: "", phone: "", email: "" });
      setShowSupplierModal(false);
      await load();
    } catch (error) {
      alert(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#F6F7F9] text-slate-800">
      {/* HEADER */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="flex h-[76px] items-center justify-between px-6">
          <div className="flex items-center gap-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#0F2A3B] text-white">
              <ShoppingCart size={22} />
            </div>

            <div>
              <h1 className="text-xl font-bold text-[#0F2A3B]">
                Procurement
              </h1>
              <p className="text-xs text-slate-500">
                RetailERP • Purchasing & Supplier Management
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShowSupplierModal(true)}
              className="hidden items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 md:flex"
            >
              <Building2 size={17} />
              Add Supplier
            </button>

            <button
              type="button"
              onClick={() => openNewOrder()}
              className="flex items-center gap-2 rounded-xl bg-[#1C9A9A] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#168686]"
            >
              <Plus size={18} />
              New Purchase Order
            </button>

            <UserMenu />
          </div>
        </div>
      </header>

      <main className="p-6">
        {loadError && (
          <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {loadError}
          </div>
        )}

        {/* KPI CARDS */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            title="Purchase Value"
            value={currency(totals.purchaseValue)}
            subtitle="Active purchase orders"
            icon={DollarSign}
            iconClass="bg-emerald-50 text-emerald-600"
          />

          <KpiCard
            title="Pending Orders"
            value={String(totals.pending)}
            subtitle="Orders in progress"
            icon={Clock3}
            iconClass="bg-amber-50 text-amber-600"
          />

          <KpiCard
            title="Received Orders"
            value={String(totals.received)}
            subtitle="Completed purchases"
            icon={PackageCheck}
            iconClass="bg-blue-50 text-blue-600"
          />

          <KpiCard
            title="Awaiting Approval"
            value={String(totals.awaitingApproval)}
            subtitle="Require authorization"
            icon={AlertCircle}
            iconClass="bg-purple-50 text-purple-600"
          />
        </div>

        {/* ALERT */}
        {totals.awaitingApproval > 0 && (
          <div className="mt-5 flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-100 text-amber-700">
              <AlertCircle size={19} />
            </div>

            <div>
              <p className="text-sm font-bold text-amber-900">
                Purchase orders awaiting approval
              </p>
              <p className="text-xs text-amber-700">
                {totals.awaitingApproval} purchase order
                {totals.awaitingApproval !== 1 ? "s" : ""} require approval
                before they can be sent to suppliers.
              </p>
            </div>
          </div>
        )}

        {/* TABS */}
        <div className="mt-6 border-b border-slate-200">
          <div className="flex gap-7">
            {[
              {
                id: "orders",
                label: "Purchase Orders",
                icon: FileText,
              },
              {
                id: "suppliers",
                label: "Suppliers",
                icon: Building2,
              },
              {
                id: "receiving",
                label: "Goods Receiving",
                icon: ArrowDownToLine,
              },
            ].map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;

              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() =>
                    setActiveTab(
                      tab.id as "orders" | "suppliers" | "receiving"
                    )
                  }
                  className={`flex items-center gap-2 border-b-2 px-1 pb-3 text-sm font-semibold transition ${
                    active
                      ? "border-[#1C9A9A] text-[#1C9A9A]"
                      : "border-transparent text-slate-500 hover:text-slate-800"
                  }`}
                >
                  <Icon size={17} />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* PURCHASE ORDERS */}
        {activeTab === "orders" && (
          <section className="mt-6">
            {/* FILTER BAR */}
            <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 lg:flex-row lg:items-center">
              <div className="relative flex-1">
                <Search
                  size={18}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />

                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search purchase order, supplier or warehouse..."
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-4 text-sm outline-none transition focus:border-[#1C9A9A] focus:bg-white"
                />
              </div>

              <select
                value={supplierFilter}
                onChange={(e) => setSupplierFilter(e.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-[#1C9A9A]"
              >
                <option value="All">All Suppliers</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.name}>
                    {supplier.name}
                  </option>
                ))}
              </select>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-[#1C9A9A]"
              >
                <option value="All">All Statuses</option>
                <option value="Draft">Draft</option>
                <option value="Pending Approval">Pending Approval</option>
                <option value="Ordered">Ordered</option>
                <option value="Partially Received">
                  Partially Received
                </option>
                <option value="Received">Received</option>
                <option value="Cancelled">Cancelled</option>
              </select>
            </div>

            {/* TABLE */}
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <div className="overflow-x-auto">
                <table className="min-w-[1150px] w-full">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50">
                      <th className="px-5 py-4 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                        Purchase Order
                      </th>
                      <th className="px-5 py-4 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                        Supplier
                      </th>
                      <th className="px-5 py-4 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                        Date
                      </th>
                      <th className="px-5 py-4 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                        Expected
                      </th>
                      <th className="px-5 py-4 text-center text-xs font-bold uppercase tracking-wide text-slate-500">
                        Items
                      </th>
                      <th className="px-5 py-4 text-right text-xs font-bold uppercase tracking-wide text-slate-500">
                        Total
                      </th>
                      <th className="px-5 py-4 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                        Status
                      </th>
                      <th className="px-5 py-4 text-right text-xs font-bold uppercase tracking-wide text-slate-500">
                        Action
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {filteredOrders.map((order) => (
                      <tr
                        key={order.id}
                        className="border-b border-slate-100 last:border-0 hover:bg-slate-50"
                      >
                        <td className="px-5 py-4">
                          <button
                            type="button"
                            onClick={() => openDetails(order)}
                            className="font-bold text-[#0F2A3B] hover:text-[#1C9A9A]"
                          >
                            {order.number}
                          </button>

                          <p className="mt-1 text-xs text-slate-500">
                            {order.warehouse}
                          </p>
                        </td>

                        <td className="px-5 py-4">
                          <p className="text-sm font-semibold text-slate-800">
                            {order.supplier}
                          </p>
                          <p className="text-xs text-slate-500">
                            {order.supplierCode}
                          </p>
                        </td>

                        <td className="px-5 py-4 text-sm text-slate-600">
                          {order.date}
                        </td>

                        <td className="px-5 py-4 text-sm text-slate-600">
                          {order.expectedDate}
                        </td>

                        <td className="px-5 py-4 text-center">
                          <p className="text-sm font-semibold text-slate-800">
                            {order.items}
                          </p>
                          <p className="text-xs text-slate-500">
                            {order.quantity} units
                          </p>
                        </td>

                        <td className="px-5 py-4 text-right text-sm font-bold text-slate-800">
                          {currency(order.total)}
                        </td>

                        <td className="px-5 py-4">
                          <span
                            className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${statusStyles[order.status]}`}
                          >
                            {order.status}
                          </span>
                        </td>

                        <td className="relative px-5 py-4 text-right">
                          <button
                            type="button"
                            onClick={() =>
                              setOrderMenu(
                                orderMenu === order.id ? null : order.id
                              )
                            }
                            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                          >
                            <MoreVertical size={18} />
                          </button>

                          {orderMenu === order.id && (
                            <div className="absolute right-5 top-12 z-20 w-48 rounded-xl border border-slate-200 bg-white p-1.5 text-left shadow-xl">
                              <button
                                type="button"
                                onClick={() => openDetails(order)}
                                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-slate-50"
                              >
                                <Eye size={16} />
                                View Details
                              </button>

                              {(order.status === "Ordered" ||
                                order.status === "Partially Received") && (
                                <button
                                  type="button"
                                  onClick={() => openReceive(order)}
                                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-slate-50"
                                >
                                  <PackageCheck size={16} />
                                  Receive Goods
                                </button>
                              )}

                              {(order.status === "Pending Approval" || order.status === "Draft") && (
                                <button
                                  type="button"
                                  onClick={() => approveOrder(order.id)}
                                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-emerald-700 hover:bg-emerald-50"
                                >
                                  <CheckCircle2 size={16} />
                                  Approve Order
                                </button>
                              )}

                              {order.status !== "Cancelled" &&
                                order.status !== "Received" && (
                                  <button
                                    type="button"
                                    onClick={() => cancelOrder(order.id)}
                                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                                  >
                                    <Trash2 size={16} />
                                    Cancel Order
                                  </button>
                                )}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {filteredOrders.length === 0 && (
                <div className="py-16 text-center">
                  <FileText className="mx-auto text-slate-300" size={42} />
                  <p className="mt-3 font-semibold text-slate-700">
                    No purchase orders found
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    Try changing your search or filters.
                  </p>
                </div>
              )}
            </div>
          </section>
        )}

        {/* SUPPLIERS */}
        {activeTab === "suppliers" && (
          <section className="mt-6">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-[#0F2A3B]">
                  Supplier Directory
                </h2>
                <p className="text-sm text-slate-500">
                  Manage suppliers and purchasing relationships.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setShowSupplierModal(true)}
                className="flex items-center gap-2 rounded-xl bg-[#1C9A9A] px-4 py-2.5 text-sm font-semibold text-white"
              >
                <Plus size={17} />
                Add Supplier
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {suppliers.map((supplier) => (
                <div
                  key={supplier.id}
                  className="rounded-2xl border border-slate-200 bg-white p-5"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#0F2A3B] text-white">
                        <Building2 size={20} />
                      </div>

                      <div>
                        <h3 className="font-bold text-slate-800">
                          {supplier.name}
                        </h3>
                        <p className="text-xs text-slate-500">
                          {supplier.code}
                        </p>
                      </div>
                    </div>

                    <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                      {supplier.status}
                    </span>
                  </div>

                  <div className="mt-5 grid grid-cols-2 gap-3">
                    <div className="rounded-xl bg-slate-50 p-3">
                      <p className="text-xs text-slate-500">Contact</p>
                      <p className="mt-1 text-sm font-semibold">
                        {supplier.contact}
                      </p>
                    </div>

                    <div className="rounded-xl bg-slate-50 p-3">
                      <p className="text-xs text-slate-500">Orders</p>
                      <p className="mt-1 text-sm font-semibold">
                        {supplier.orders}
                      </p>
                    </div>

                    <div className="rounded-xl bg-slate-50 p-3">
                      <p className="text-xs text-slate-500">Phone</p>
                      <p className="mt-1 text-sm font-semibold">
                        {supplier.phone}
                      </p>
                    </div>

                    <div className="rounded-xl bg-slate-50 p-3">
                      <p className="text-xs text-slate-500">Outstanding</p>
                      <p className="mt-1 text-sm font-bold text-amber-600">
                        {currency(supplier.outstanding)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedSupplier(supplier);
                        setShowSupplierModal(true);
                      }}
                      className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-200 py-2.5 text-sm font-semibold hover:bg-slate-50"
                    >
                      <Eye size={16} />
                      View
                    </button>

                    <button
                      type="button"
                      onClick={() => openNewOrder(supplier.name)}
                      disabled={supplier.status === "Inactive"}
                      className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#0F2A3B] py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      <ShoppingCart size={16} />
                      New Order
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* RECEIVING */}
        {activeTab === "receiving" && (
          <section className="mt-6">
            <div className="mb-5">
              <h2 className="text-lg font-bold text-[#0F2A3B]">
                Goods Receiving
              </h2>
              <p className="text-sm text-slate-500">
                Receive supplier deliveries and update warehouse stock.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              {orders
                .filter(
                  (order) =>
                    order.status === "Ordered" ||
                    order.status === "Partially Received"
                )
                .map((order) => (
                  <div
                    key={order.id}
                    className="rounded-2xl border border-slate-200 bg-white p-5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700">
                        {order.number}
                      </span>

                      <Truck size={20} className="text-slate-400" />
                    </div>

                    <h3 className="mt-4 font-bold text-slate-800">
                      {order.supplier}
                    </h3>

                    <div className="mt-4 space-y-3 text-sm">
                      <div className="flex justify-between">
                        <span className="text-slate-500">Expected</span>
                        <span className="font-semibold">
                          {order.expectedDate}
                        </span>
                      </div>

                      <div className="flex justify-between">
                        <span className="text-slate-500">Items</span>
                        <span className="font-semibold">
                          {order.items}
                        </span>
                      </div>

                      <div className="flex justify-between">
                        <span className="text-slate-500">Quantity</span>
                        <span className="font-semibold">
                          {order.quantity}
                        </span>
                      </div>

                      <div className="flex justify-between">
                        <span className="text-slate-500">Warehouse</span>
                        <span className="font-semibold">
                          {order.warehouse}
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => openReceive(order)}
                      className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-[#1C9A9A] py-3 text-sm font-bold text-white hover:bg-[#168686]"
                    >
                      <PackageCheck size={17} />
                      Receive Goods
                    </button>
                  </div>
                ))}
            </div>

            {orders.filter(
              (order) =>
                order.status === "Ordered" ||
                order.status === "Partially Received"
            ).length === 0 && (
              <div className="rounded-2xl border border-slate-200 bg-white py-16 text-center">
                <PackageCheck
                  size={42}
                  className="mx-auto text-slate-300"
                />
                <p className="mt-3 font-semibold text-slate-700">
                  No deliveries awaiting receipt
                </p>
              </div>
            )}
          </section>
        )}
      </main>

      {/* NEW PURCHASE ORDER MODAL */}
      {showOrderModal && (
        <Modal
          title="Create Purchase Order"
          subtitle="Create a new supplier purchase request."
          onClose={() => setShowOrderModal(false)}
          wide
        >
          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <label className="mb-2 block text-sm font-semibold">
                  Supplier
                </label>

                <select
                  value={newOrder.supplier}
                  onChange={(e) =>
                    setNewOrder({
                      ...newOrder,
                      supplier: e.target.value,
                    })
                  }
                  className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-[#1C9A9A]"
                >
                  <option value="">Select supplier</option>
                  {suppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.name}>
                      {supplier.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold">
                  Receiving Warehouse
                </label>

                <select
                  value={newOrder.warehouse}
                  onChange={(e) =>
                    setNewOrder({
                      ...newOrder,
                      warehouse: e.target.value,
                    })
                  }
                  className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-[#1C9A9A]"
                >
                  {warehouses.map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold">
                  Expected Delivery
                </label>

                <input
                  type="date"
                  value={newOrder.expectedDate}
                  onChange={(e) =>
                    setNewOrder({
                      ...newOrder,
                      expectedDate: e.target.value,
                    })
                  }
                  className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-[#1C9A9A]"
                />
              </div>
            </div>

            {/* PRODUCTS */}
            <div className="overflow-hidden rounded-2xl border border-slate-200">
              <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
                <div>
                  <h3 className="text-sm font-bold text-[#0F2A3B]">
                    Order Items
                  </h3>
                  <p className="text-xs text-slate-500">
                    Add products and quantities to purchase.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={addProductLine}
                  className="flex items-center gap-2 rounded-lg bg-[#1C9A9A] px-3 py-2 text-xs font-bold text-white"
                >
                  <Plus size={15} />
                  Add Item
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[750px]">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="px-4 py-3 text-left text-xs uppercase text-slate-500">
                        Product
                      </th>
                      <th className="px-4 py-3 text-left text-xs uppercase text-slate-500">
                        SKU
                      </th>
                      <th className="px-4 py-3 text-right text-xs uppercase text-slate-500">
                        Quantity
                      </th>
                      <th className="px-4 py-3 text-right text-xs uppercase text-slate-500">
                        Unit Cost
                      </th>
                      <th className="px-4 py-3 text-right text-xs uppercase text-slate-500">
                        Total
                      </th>
                      <th />
                    </tr>
                  </thead>

                  <tbody>
                    {productLines.map((line) => (
                      <tr
                        key={line.id}
                        className="border-b border-slate-100"
                      >
                        <td className="px-4 py-3">
                          <select
                            value={line.productId}
                            onChange={(e) =>
                              updateProductLine(
                                line.id,
                                "productId",
                                Number(e.target.value)
                              )
                            }
                            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none"
                          >
                            {products.map((product) => (
                              <option key={product.id} value={product.id}>
                                {product.name}
                              </option>
                            ))}
                          </select>
                        </td>

                        <td className="px-4 py-3 text-sm text-slate-500">
                          {line.sku}
                        </td>

                        <td className="px-4 py-3">
                          <input
                            type="number"
                            min="1"
                            value={line.quantity}
                            onChange={(e) =>
                              updateProductLine(
                                line.id,
                                "quantity",
                                Math.max(1, Number(e.target.value))
                              )
                            }
                            className="w-24 rounded-lg border border-slate-200 px-3 py-2 text-right text-sm outline-none"
                          />
                        </td>

                        <td className="px-4 py-3">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={line.unitCost}
                            onChange={(e) =>
                              updateProductLine(
                                line.id,
                                "unitCost",
                                Number(e.target.value)
                              )
                            }
                            className="w-28 rounded-lg border border-slate-200 px-3 py-2 text-right text-sm outline-none"
                          />
                        </td>

                        <td className="px-4 py-3 text-right text-sm font-bold">
                          {currency(line.quantity * line.unitCost)}
                        </td>

                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => removeProductLine(line.id)}
                            className="rounded-lg p-2 text-red-500 hover:bg-red-50"
                          >
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-semibold">
                  Notes
                </label>

                <textarea
                  rows={5}
                  value={newOrder.notes}
                  onChange={(e) =>
                    setNewOrder({
                      ...newOrder,
                      notes: e.target.value,
                    })
                  }
                  placeholder="Add supplier instructions, delivery notes or other comments..."
                  className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-[#1C9A9A]"
                />
              </div>

              <div className="rounded-2xl bg-slate-50 p-5">
                <h3 className="font-bold text-[#0F2A3B]">
                  Order Summary
                </h3>

                <div className="mt-4 space-y-3">
                  <SummaryRow
                    label="Subtotal"
                    value={currency(orderSubtotal)}
                  />

                  <SummaryRow
                    label={`VAT (${taxRate}%)`}
                    value={currency(orderTax)}
                  />

                  <div className="border-t border-slate-200 pt-3">
                    <SummaryRow
                      label="Grand Total"
                      value={currency(orderTotal)}
                      bold
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-200 pt-5">
              <button
                type="button"
                onClick={() => setShowOrderModal(false)}
                className="rounded-xl border border-slate-200 px-5 py-3 text-sm font-semibold"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={createPurchaseOrder}
                disabled={!newOrder.supplier || saving}
                className="flex items-center gap-2 rounded-xl bg-[#1C9A9A] px-5 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Save size={17} />
                Create Purchase Order
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* DETAILS MODAL */}
      {showDetailsModal && selectedOrder && (
        <Modal
          title={selectedOrder.number}
          subtitle="Purchase order details"
          onClose={() => {
            setShowDetailsModal(false);
            setSelectedOrder(null);
          }}
        >
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <InfoBox
                label="Supplier"
                value={selectedOrder.supplier}
                icon={Building2}
              />

              <InfoBox
                label="Warehouse"
                value={selectedOrder.warehouse}
                icon={PackageCheck}
              />

              <InfoBox
                label="Order Date"
                value={selectedOrder.date}
                icon={CalendarDays}
              />

              <InfoBox
                label="Expected Date"
                value={selectedOrder.expectedDate}
                icon={Clock3}
              />
            </div>

            <div className="rounded-2xl bg-slate-50 p-5">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-500">Status</span>

                <span
                  className={`rounded-full px-3 py-1 text-xs font-bold ${statusStyles[selectedOrder.status]}`}
                >
                  {selectedOrder.status}
                </span>
              </div>

              <div className="mt-4 space-y-3">
                <SummaryRow
                  label={`${selectedOrder.items} product lines`}
                  value={`${selectedOrder.quantity} units`}
                />

                <SummaryRow
                  label="Subtotal"
                  value={currency(selectedOrder.subtotal)}
                />

                <SummaryRow
                  label="VAT"
                  value={currency(selectedOrder.tax)}
                />

                <div className="border-t border-slate-200 pt-3">
                  <SummaryRow
                    label="Total"
                    value={currency(selectedOrder.total)}
                    bold
                  />
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              {(selectedOrder.status === "Pending Approval" || selectedOrder.status === "Draft") && (
                <button
                  type="button"
                  onClick={() => {
                    approveOrder(selectedOrder.id);
                    setShowDetailsModal(false);
                  }}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#1C9A9A] py-3 text-sm font-bold text-white"
                >
                  <CheckCircle2 size={17} />
                  Approve
                </button>
              )}

              {(selectedOrder.status === "Ordered" ||
                selectedOrder.status === "Partially Received") && (
                <button
                  type="button"
                  onClick={() => {
                    setShowDetailsModal(false);
                    void openReceive(selectedOrder);
                  }}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#0F2A3B] py-3 text-sm font-bold text-white"
                >
                  <PackageCheck size={17} />
                  Receive Goods
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* RECEIVE GOODS MODAL */}
      {showReceiveModal && selectedOrder && (
        <Modal
          title="Receive Goods"
          subtitle={`${selectedOrder.number} • ${selectedOrder.supplier}`}
          onClose={() => {
            setShowReceiveModal(false);
            setSelectedOrder(null);
          }}
        >
          <div className="space-y-5">
            <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4">
              <div className="flex gap-3">
                <Truck className="mt-0.5 text-blue-600" size={20} />

                <div>
                  <p className="font-bold text-blue-900">
                    Goods receiving
                  </p>
                  <p className="mt-1 text-sm text-blue-700">
                    Confirm that the supplier delivery has arrived at{" "}
                    <strong>{selectedOrder.warehouse}</strong>.
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <InfoBox
                label="Purchase Order"
                value={selectedOrder.number}
                icon={FileText}
              />

              <InfoBox
                label="Outstanding Quantity"
                value={`${selectedOrder.quantity - selectedOrder.received} of ${selectedOrder.quantity} units`}
                icon={PackageCheck}
              />
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3 text-left">Product</th>
                    <th className="px-4 py-3 text-right">Ordered</th>
                    <th className="px-4 py-3 text-right">Received</th>
                    <th className="px-4 py-3 text-right">Receive now</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {receiptLines.map((line) => {
                    const remaining = line.quantity - line.receivedQuantity;

                    return (
                      <tr key={line.id}>
                        <td className="px-4 py-3">
                          <p className="font-semibold text-slate-800">{line.product}</p>
                          <p className="text-xs text-slate-400">{line.sku}</p>
                          {Boolean(line.trackBatches) && remaining > 0 && (
                            <div className="mt-2 flex gap-2">
                              <input
                                value={line.batchNumber}
                                placeholder="Batch no."
                                onChange={(e) =>
                                  setReceiptLines((current) =>
                                    current.map((item) => (item.id === line.id ? { ...item, batchNumber: e.target.value } : item))
                                  )
                                }
                                className="w-28 rounded-lg border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-[#1C9A9A]"
                              />
                              <input
                                type="date"
                                value={line.expiryDate}
                                title="Expiry date"
                                onChange={(e) =>
                                  setReceiptLines((current) =>
                                    current.map((item) => (item.id === line.id ? { ...item, expiryDate: e.target.value } : item))
                                  )
                                }
                                className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-[#1C9A9A]"
                              />
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">{line.quantity}</td>
                        <td className="px-4 py-3 text-right">{line.receivedQuantity}</td>
                        <td className="px-4 py-3 text-right">
                          <input
                            type="number"
                            min="0"
                            max={remaining}
                            disabled={remaining === 0}
                            value={line.receiving}
                            onChange={(e) =>
                              setReceiptLines((current) =>
                                current.map((item) =>
                                  item.id === line.id ? { ...item, receiving: e.target.value } : item
                                )
                              )
                            }
                            className="w-24 rounded-lg border border-slate-200 px-3 py-2 text-right text-sm outline-none focus:border-[#1C9A9A] disabled:bg-slate-50"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold">
                Delivery Notes
              </label>

              <textarea
                rows={3}
                value={receiptNotes}
                onChange={(e) => setReceiptNotes(e.target.value)}
                placeholder="Enter delivery notes, shortages, damages or other observations..."
                className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-[#1C9A9A]"
              />
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-200 pt-5">
              <button
                type="button"
                onClick={() => setShowReceiveModal(false)}
                className="rounded-xl border border-slate-200 px-5 py-3 text-sm font-semibold"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={receiveOrder}
                className="flex items-center gap-2 rounded-xl bg-[#1C9A9A] px-5 py-3 text-sm font-bold text-white"
              >
                <PackageCheck size={17} />
                Confirm Receipt
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* SUPPLIER MODAL */}
      {showSupplierModal && (
        <Modal
          title={selectedSupplier ? "Supplier Details" : "Add Supplier"}
          subtitle={
            selectedSupplier
              ? selectedSupplier.code
              : "Create a new supplier record."
          }
          onClose={() => {
            setShowSupplierModal(false);
            setSelectedSupplier(null);
          }}
        >
          {selectedSupplier ? (
            <div className="space-y-5">
              <div className="flex items-center gap-4 rounded-2xl bg-slate-50 p-5">
                <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-[#0F2A3B] text-white">
                  <Building2 size={25} />
                </div>

                <div>
                  <h3 className="font-bold text-[#0F2A3B]">
                    {selectedSupplier.name}
                  </h3>
                  <p className="text-sm text-slate-500">
                    {selectedSupplier.code}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <InfoBox
                  label="Contact Person"
                  value={selectedSupplier.contact}
                  icon={User}
                />

                <InfoBox
                  label="Phone"
                  value={selectedSupplier.phone}
                  icon={User}
                />

                <InfoBox
                  label="Email"
                  value={selectedSupplier.email}
                  icon={FileText}
                />

                <InfoBox
                  label="Outstanding"
                  value={currency(selectedSupplier.outstanding)}
                  icon={DollarSign}
                />
              </div>

              <button
                type="button"
                onClick={() => {
                  setSelectedSupplier(null);
                  setShowSupplierModal(false);
                  openNewOrder(selectedSupplier.name);
                }}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#1C9A9A] py-3 text-sm font-bold text-white"
              >
                <ShoppingCart size={17} />
                Create Purchase Order
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <Input
                label="Supplier Name"
                value={newSupplier.name}
                onChange={(value) =>
                  setNewSupplier({ ...newSupplier, name: value })
                }
                placeholder="e.g. ABC Distributors"
              />

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Input
                  label="Contact Person"
                  value={newSupplier.contact}
                  onChange={(value) =>
                    setNewSupplier({ ...newSupplier, contact: value })
                  }
                  placeholder="Contact name"
                />

                <Input
                  label="Phone"
                  value={newSupplier.phone}
                  onChange={(value) =>
                    setNewSupplier({ ...newSupplier, phone: value })
                  }
                  placeholder="+263..."
                />

                <Input
                  label="Email"
                  value={newSupplier.email}
                  onChange={(value) =>
                    setNewSupplier({ ...newSupplier, email: value })
                  }
                  placeholder="supplier@example.com"
                />
              </div>

              <div className="flex justify-end gap-3 border-t border-slate-200 pt-5">
                <button
                  type="button"
                  onClick={() => setShowSupplierModal(false)}
                  className="rounded-xl border border-slate-200 px-5 py-3 text-sm font-semibold"
                >
                  Cancel
                </button>

                <button
                  type="button"
                  onClick={saveSupplier}
                  className="flex items-center gap-2 rounded-xl bg-[#1C9A9A] px-5 py-3 text-sm font-bold text-white"
                >
                  <Save size={17} />
                  Save Supplier
                </button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

/* -------------------------------------------------------
   COMPONENTS
------------------------------------------------------- */

function KpiCard({
  title,
  value,
  subtitle,
  icon: Icon,
  iconClass,
}: {
  title: string;
  value: string;
  subtitle: string;
  icon: React.ElementType;
  iconClass: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-slate-500">{title}</p>
          <h3 className="mt-2 text-2xl font-bold text-[#0F2A3B]">
            {value}
          </h3>
          <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
        </div>

        <div
          className={`flex h-11 w-11 items-center justify-center rounded-xl ${iconClass}`}
        >
          <Icon size={21} />
        </div>
      </div>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  bold = false,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span
        className={`text-sm ${
          bold ? "font-bold text-[#0F2A3B]" : "text-slate-500"
        }`}
      >
        {label}
      </span>

      <span
        className={`text-sm ${
          bold ? "font-bold text-[#0F2A3B]" : "font-semibold text-slate-700"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function InfoBox({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: React.ElementType;
}) {
  return (
    <div className="rounded-xl bg-slate-50 p-4">
      <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
        <Icon size={15} />
        {label}
      </div>

      <p className="mt-2 text-sm font-bold text-slate-800">{value}</p>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="mb-2 block text-sm font-semibold">{label}</label>

      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-[#1C9A9A]"
      />
    </div>
  );
}

function Modal({
  title,
  subtitle,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
      <div
        className={`max-h-[92vh] w-full overflow-y-auto rounded-2xl bg-white shadow-2xl ${
          wide ? "max-w-6xl" : "max-w-2xl"
        }`}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-5">
          <div>
            <h2 className="text-lg font-bold text-[#0F2A3B]">{title}</h2>
            <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

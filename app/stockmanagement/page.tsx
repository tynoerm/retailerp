"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, errorMessage } from "../lib/api-client";
import { money as formatCurrency } from "../lib/format";
import UserMenu from "../components/UserMenu";
import {
  Boxes,
  Search,
  RefreshCw,
  Plus,
  ArrowRightLeft,
  SlidersHorizontal,
  Package,
  AlertTriangle,
  CircleAlert,
  CheckCircle2,
  XCircle,
  Eye,
  Edit3,
  Warehouse,
  ArrowDownToLine,
  ArrowUpFromLine,
  History,
  ClipboardCheck,
  X,
  Save,
  Minus,
} from "lucide-react";

type StockStatus = "In Stock" | "Low Stock" | "Out of Stock";

type StockItem = {
  id: number;
  productId: number;
  warehouseId: number;
  product: string;
  sku: string;
  category: string;
  warehouse: string;
  quantity: number;
  reserved: number;
  reorderLevel: number;
  cost: number;
  price: number;
  status: StockStatus;
};

type Movement = {
  id: number;
  number: string;
  date: string;
  type: string;
  product: string;
  sku: string;
  warehouse: string;
  quantity: number;
  reference: string;
  user: string;
  notes: string;
};

type Transfer = {
  id: number;
  reference: string;
  product: string;
  sku: string;
  quantity: number;
  from: string;
  to: string;
  status: "Pending" | "In Transit" | "Completed";
  date: string;
};

type WarehouseOption = { id: number; name: string; status: string };

type Batch = {
  id: number;
  product: string;
  sku: string;
  warehouse: string;
  batch: string;
  expiry: string | null;
  quantity: number;
  daysToExpiry: number | null;
  value: number;
  expiryStatus: "Expired" | "Expiring Soon" | "OK" | "No expiry";
};

const expiryStyles: Record<Batch["expiryStatus"], string> = {
  Expired: "bg-red-50 text-red-700 border-red-200",
  "Expiring Soon": "bg-amber-50 text-amber-700 border-amber-200",
  OK: "bg-emerald-50 text-emerald-700 border-emerald-200",
  "No expiry": "bg-slate-100 text-slate-600 border-slate-200",
};

export default function StockManagementPage() {
  const [stock, setStock] = useState<StockItem[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [warehouseOptions, setWarehouseOptions] = useState<WarehouseOption[]>([]);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [data, warehouseRows] = await Promise.all([
        api<{ stock: StockItem[]; movements: Movement[]; transfers: Transfer[]; batches: Batch[] }>("/api/stockmanagement"),
        api<WarehouseOption[]>("/api/warehouses"),
      ]);
      setStock(data.stock);
      setMovements(data.movements);
      setTransfers(data.transfers);
      setBatches(data.batches);
      setWarehouseOptions(warehouseRows.filter((row) => row.status !== "Inactive"));
      setLoadError("");
    } catch (error) {
      setLoadError(errorMessage(error));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch
    void load();
  }, [load]);

  const warehouses = useMemo(() => warehouseOptions.map((warehouse) => warehouse.name), [warehouseOptions]);
  const categories = useMemo(
    () => ["All", ...Array.from(new Set(stock.map((item) => item.category))).sort()],
    [stock]
  );
  const productOptions = useMemo(
    () => [...new Map(stock.map((item) => [item.productId, { id: item.productId, name: item.product, sku: item.sku }])).values()],
    [stock]
  );

  const runAction = async (body: Record<string, unknown>) => {
    setSaving(true);
    try {
      const result = await api<{ message: string }>("/api/stockmanagement", {
        method: "POST",
        body: JSON.stringify(body),
      });
      await load();
      return result.message;
    } finally {
      setSaving(false);
    }
  };

  const [activeTab, setActiveTab] = useState<
    "overview" | "movements" | "transfers" | "adjustments" | "batches"
  >("overview");

  const [search, setSearch] = useState("");
  const [warehouseFilter, setWarehouseFilter] = useState("All");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");

  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showAdjustmentModal, setShowAdjustmentModal] = useState(false);
  const [showCountModal, setShowCountModal] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);

  const [selectedStock, setSelectedStock] = useState<StockItem | null>(
    null
  );

  const [transferProduct, setTransferProduct] = useState("");
  const [transferFrom, setTransferFrom] = useState("");
  const [transferTo, setTransferTo] = useState("");
  const [transferQuantity, setTransferQuantity] = useState("");

  const [adjustmentType, setAdjustmentType] = useState<"increase" | "decrease">(
    "increase"
  );
  const [adjustmentQuantity, setAdjustmentQuantity] = useState("");
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [adjustmentBatch, setAdjustmentBatch] = useState("");
  const [adjustmentExpiry, setAdjustmentExpiry] = useState("");

  const [countedQuantity, setCountedQuantity] = useState("");

  const filteredStock = useMemo(() => {
    return stock.filter((item) => {
      const matchesSearch =
        item.product.toLowerCase().includes(search.toLowerCase()) ||
        item.sku.toLowerCase().includes(search.toLowerCase());

      const matchesWarehouse =
        warehouseFilter === "All" ||
        item.warehouse === warehouseFilter;

      const matchesCategory =
        categoryFilter === "All" ||
        item.category === categoryFilter;

      const matchesStatus =
        statusFilter === "All" ||
        item.status === statusFilter;

      return (
        matchesSearch &&
        matchesWarehouse &&
        matchesCategory &&
        matchesStatus
      );
    });
  }, [stock, search, warehouseFilter, categoryFilter, statusFilter]);

  const totalUnits = stock.reduce((sum, item) => sum + item.quantity, 0);

  const availableUnits = stock.reduce(
    (sum, item) => sum + Math.max(item.quantity - item.reserved, 0),
    0
  );

  const stockValue = stock.reduce(
    (sum, item) => sum + item.quantity * item.cost,
    0
  );

  const lowStock = stock.filter(
    (item) => item.status === "Low Stock"
  ).length;

  const outOfStock = stock.filter(
    (item) => item.status === "Out of Stock"
  ).length;

  const getStatusClass = (status: StockStatus) => {
    if (status === "In Stock") {
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    }

    if (status === "Low Stock") {
      return "bg-amber-50 text-amber-700 border-amber-200";
    }

    return "bg-red-50 text-red-700 border-red-200";
  };

  const getMovementIcon = (type: Movement["type"]) => {
    switch (type) {
      case "Sale":
        return <ArrowUpFromLine size={16} />;
      case "Purchase Receipt":
        return <ArrowDownToLine size={16} />;
      case "Transfer":
        return <ArrowRightLeft size={16} />;
      case "Return":
        return <RefreshCw size={16} />;
      default:
        return <SlidersHorizontal size={16} />;
    }
  };

  const openTransfer = (item?: StockItem) => {
    const from = item?.warehouseId ?? warehouseOptions[0]?.id ?? "";
    setTransferProduct(item ? String(item.productId) : "");
    setTransferFrom(String(from));
    setTransferTo(String(warehouseOptions.find((warehouse) => warehouse.id !== Number(from))?.id ?? ""));
    setTransferQuantity("");
    setShowTransferModal(true);
  };

  const createTransfer = async () => {
    if (!transferProduct || !transferQuantity) {
      alert("Please select a product and enter the transfer quantity.");
      return;
    }

    if (transferFrom === transferTo) {
      alert("Source and destination warehouses must be different.");
      return;
    }

    try {
      const message = await runAction({
        action: "transfer",
        productId: Number(transferProduct),
        fromWarehouseId: Number(transferFrom),
        toWarehouseId: Number(transferTo),
        quantity: Number(transferQuantity),
      });

      setShowTransferModal(false);
      setTransferProduct("");
      setTransferQuantity("");
      setActiveTab("transfers");
      alert(message);
    } catch (error) {
      alert(errorMessage(error));
    }
  };

  const createAdjustment = async () => {
    if (!selectedStock || !adjustmentQuantity) {
      alert("Select a stock item and enter a quantity.");
      return;
    }

    try {
      await runAction({
        action: "adjust",
        stockId: selectedStock.id,
        direction: adjustmentType,
        quantity: Number(adjustmentQuantity),
        reason: adjustmentReason,
        batchNumber: adjustmentBatch,
        expiryDate: adjustmentExpiry,
      });

      setShowAdjustmentModal(false);
      setAdjustmentQuantity("");
      setAdjustmentReason("");
      setAdjustmentBatch("");
      setAdjustmentExpiry("");
      setSelectedStock(null);
    } catch (error) {
      alert(errorMessage(error));
    }
  };

  const completeTransfer = async (transferId: number) => {
    try {
      await runAction({ action: "completeTransfer", transferId });
    } catch (error) {
      alert(errorMessage(error));
    }
  };

  const openAdjustment = (item: StockItem) => {
    setSelectedStock(item);
    setShowAdjustmentModal(true);
  };

  const openDetails = (item: StockItem) => {
    setSelectedStock(item);
    setShowDetailsModal(true);
  };

  const openCount = (item: StockItem) => {
    setSelectedStock(item);
    setCountedQuantity(String(item.quantity));
    setShowCountModal(true);
  };

  const saveStockCount = async () => {
    if (!selectedStock) return;

    try {
      const message = await runAction({
        action: "count",
        stockId: selectedStock.id,
        counted: Number(countedQuantity),
      });

      setShowCountModal(false);
      setSelectedStock(null);
      setCountedQuantity("");
      alert(message);
    } catch (error) {
      alert(errorMessage(error));
    }
  };

  return (
    <div className="min-h-screen bg-[#F6F7F9] text-slate-800">
      {/* HEADER */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="flex h-[78px] items-center justify-between px-6">
          <div className="flex items-center gap-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#0F2A3B] text-white shadow-sm">
              <Boxes size={22} />
            </div>

            <div>
              <h1 className="text-xl font-bold text-[#0F2A3B]">
                Stock Management
              </h1>
              <p className="text-sm text-slate-500">
                RetailERP • Stock Control & Movement
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShowCountModal(true)}
              className="hidden items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 md:flex"
            >
              <ClipboardCheck size={17} />
              Stock Count
            </button>

            <button
              type="button"
              onClick={() => openTransfer()}
              className="flex items-center gap-2 rounded-xl bg-[#1C9A9A] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#168383]"
            >
              <ArrowRightLeft size={17} />
              Transfer Stock
            </button>

            <div className="ml-2 hidden items-center gap-3 border-l border-slate-200 pl-4 sm:flex">
              <UserMenu showName />
            </div>
          </div>
        </div>
      </header>

      <main className="space-y-6 p-6">
        {loadError && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {loadError}
          </div>
        )}

        {/* KPI CARDS */}
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <KpiCard
            icon={<Package size={20} />}
            label="Total Stock Units"
            value={totalUnits.toLocaleString()}
            description="Across all warehouses"
            iconBg="bg-blue-50"
            iconColor="text-blue-600"
          />

          <KpiCard
            icon={<CheckCircle2 size={20} />}
            label="Available Stock"
            value={availableUnits.toLocaleString()}
            description="After reservations"
            iconBg="bg-emerald-50"
            iconColor="text-emerald-600"
          />

          <KpiCard
            icon={<Boxes size={20} />}
            label="Stock Value"
            value={formatCurrency(stockValue)}
            description="At cost value"
            iconBg="bg-purple-50"
            iconColor="text-purple-600"
          />

          <KpiCard
            icon={<AlertTriangle size={20} />}
            label="Low Stock"
            value={String(lowStock)}
            description="Needs replenishment"
            iconBg="bg-amber-50"
            iconColor="text-amber-600"
          />

          <KpiCard
            icon={<XCircle size={20} />}
            label="Out of Stock"
            value={String(outOfStock)}
            description="Requires action"
            iconBg="bg-red-50"
            iconColor="text-red-600"
          />
        </section>

        {/* ALERT */}
        {(lowStock > 0 || outOfStock > 0) && (
          <div className="flex items-center justify-between rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
                <CircleAlert size={20} />
              </div>

              <div>
                <p className="font-semibold text-amber-900">
                  Stock attention required
                </p>
                <p className="text-sm text-amber-800">
                  {lowStock} item{lowStock !== 1 ? "s are" : " is"} low
                  on stock and {outOfStock} item
                  {outOfStock !== 1 ? "s are" : " is"} out of stock.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setStatusFilter("Low Stock")}
              className="hidden rounded-lg bg-white px-4 py-2 text-sm font-semibold text-amber-800 shadow-sm md:block"
            >
              View Low Stock
            </button>
          </div>
        )}

        {/* TABS */}
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200">
          {[
            ["overview", "Stock Overview"],
            ["movements", "Stock Movements"],
            ["transfers", "Transfers"],
            ["adjustments", "Adjustments"],
            ["batches", `Batches & Expiry${batches.some((b) => b.expiryStatus === "Expired" || b.expiryStatus === "Expiring Soon") ? " ⚠" : ""}`],
          ].map(([id, label]) => (
            <button
              type="button"
              key={id}
              onClick={() => setActiveTab(id as typeof activeTab)}
              className={`border-b-2 px-4 py-3 text-sm font-semibold transition ${
                activeTab === id
                  ? "border-[#1C9A9A] text-[#1C9A9A]"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* STOCK OVERVIEW */}
        {activeTab === "overview" && (
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 p-5">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                <div>
                  <h2 className="font-bold text-[#0F2A3B]">
                    Current Stock
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Monitor stock quantities across your warehouses.
                  </p>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <div className="relative">
                    <Search
                      size={17}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                    />
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search product or SKU..."
                      className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-4 text-sm outline-none transition focus:border-[#1C9A9A] focus:bg-white sm:w-64"
                    />
                  </div>

                  <select
                    value={warehouseFilter}
                    onChange={(e) => setWarehouseFilter(e.target.value)}
                    className="h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-[#1C9A9A]"
                  >
                    <option>All</option>
                    {warehouses.map((warehouse) => (
                      <option key={warehouse}>{warehouse}</option>
                    ))}
                  </select>

                  <select
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                    className="h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-[#1C9A9A]"
                  >
                    {categories.map((category) => (
                      <option key={category}>{category}</option>
                    ))}
                  </select>

                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-[#1C9A9A]"
                  >
                    <option>All</option>
                    <option>In Stock</option>
                    <option>Low Stock</option>
                    <option>Out of Stock</option>
                  </select>

                  <button
                    type="button"
                    onClick={() => {
                      setSearch("");
                      setWarehouseFilter("All");
                      setCategoryFilter("All");
                      setStatusFilter("All");
                    }}
                    className="flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    <RefreshCw size={16} />
                    Reset
                  </button>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[1050px] text-left">
                <thead className="bg-slate-50">
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-5 py-4 font-semibold">Product</th>
                    <th className="px-5 py-4 font-semibold">Warehouse</th>
                    <th className="px-5 py-4 font-semibold">Quantity</th>
                    <th className="px-5 py-4 font-semibold">Reserved</th>
                    <th className="px-5 py-4 font-semibold">Available</th>
                    <th className="px-5 py-4 font-semibold">Reorder</th>
                    <th className="px-5 py-4 font-semibold">Stock Value</th>
                    <th className="px-5 py-4 font-semibold">Status</th>
                    <th className="px-5 py-4 text-right font-semibold">
                      Action
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100">
                  {filteredStock.map((item) => {
                    const available = Math.max(
                      item.quantity - item.reserved,
                      0
                    );

                    return (
                      <tr
                        key={item.id}
                        className="transition hover:bg-slate-50"
                      >
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0F2A3B]/5 text-[#0F2A3B]">
                              <Package size={18} />
                            </div>

                            <div>
                              <p className="font-semibold text-slate-800">
                                {item.product}
                              </p>
                              <p className="text-xs text-slate-500">
                                {item.sku} • {item.category}
                              </p>
                            </div>
                          </div>
                        </td>

                        <td className="px-5 py-4 text-sm text-slate-600">
                          <div className="flex items-center gap-2">
                            <Warehouse size={15} className="text-slate-400" />
                            {item.warehouse}
                          </div>
                        </td>

                        <td className="px-5 py-4 text-sm font-semibold text-slate-800">
                          {item.quantity.toLocaleString()}
                        </td>

                        <td className="px-5 py-4 text-sm text-slate-500">
                          {item.reserved.toLocaleString()}
                        </td>

                        <td className="px-5 py-4 text-sm font-semibold text-[#1C9A9A]">
                          {available.toLocaleString()}
                        </td>

                        <td className="px-5 py-4 text-sm text-slate-500">
                          {item.reorderLevel}
                        </td>

                        <td className="px-5 py-4 text-sm font-semibold text-slate-700">
                          {formatCurrency(item.quantity * item.cost)}
                        </td>

                        <td className="px-5 py-4">
                          <span
                            className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${getStatusClass(
                              item.status
                            )}`}
                          >
                            {item.status}
                          </span>
                        </td>

                        <td className="px-5 py-4 text-right">
                          <div className="flex justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => openDetails(item)}
                              title="View Stock"
                              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-[#0F2A3B]"
                            >
                              <Eye size={17} />
                            </button>

                            <button
                              type="button"
                              onClick={() => openAdjustment(item)}
                              title="Adjust Stock"
                              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-[#1C9A9A]"
                            >
                              <Edit3 size={17} />
                            </button>

                            <button
                              type="button"
                              onClick={() => openTransfer(item)}
                              title="Transfer Stock"
                              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-[#1C9A9A]"
                            >
                              <ArrowRightLeft size={17} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {filteredStock.length === 0 && (
                <div className="py-16 text-center">
                  <Package className="mx-auto text-slate-300" size={42} />
                  <p className="mt-3 font-semibold text-slate-700">
                    No stock records found
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    Try changing your filters or search term.
                  </p>
                </div>
              )}
            </div>

            <div className="border-t border-slate-200 px-5 py-4 text-sm text-slate-500">
              Showing {filteredStock.length} of {stock.length} stock
              records
            </div>
          </section>
        )}

        {/* MOVEMENTS */}
        {activeTab === "movements" && (
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 p-5">
              <div>
                <h2 className="font-bold text-[#0F2A3B]">
                  Stock Movement History
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Complete audit trail of stock coming in and going out.
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] text-left">
                <thead className="bg-slate-50">
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-5 py-4">Movement</th>
                    <th className="px-5 py-4">Date</th>
                    <th className="px-5 py-4">Product</th>
                    <th className="px-5 py-4">Warehouse</th>
                    <th className="px-5 py-4">Quantity</th>
                    <th className="px-5 py-4">Reference</th>
                    <th className="px-5 py-4">User</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100">
                  {movements.map((movement) => (
                    <tr
                      key={movement.id}
                      className="hover:bg-slate-50"
                    >
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                            {getMovementIcon(movement.type)}
                          </div>
                          <div>
                            <p className="text-sm font-semibold">
                              {movement.type}
                            </p>
                            <p className="text-xs text-slate-400">
                              {movement.number}
                            </p>
                          </div>
                        </div>
                      </td>

                      <td className="px-5 py-4 text-sm text-slate-500">
                        {movement.date}
                      </td>

                      <td className="px-5 py-4">
                        <p className="text-sm font-semibold">
                          {movement.product}
                        </p>
                        <p className="text-xs text-slate-400">
                          {movement.sku}
                        </p>
                      </td>

                      <td className="px-5 py-4 text-sm text-slate-600">
                        {movement.warehouse}
                      </td>

                      <td
                        className={`px-5 py-4 text-sm font-bold ${
                          movement.quantity > 0
                            ? "text-emerald-600"
                            : "text-red-600"
                        }`}
                      >
                        {movement.quantity > 0 ? "+" : ""}
                        {movement.quantity}
                      </td>

                      <td className="px-5 py-4 text-sm font-medium text-slate-600">
                        {movement.reference}
                        {movement.notes && (
                          <p className="mt-0.5 max-w-[220px] truncate text-xs font-normal text-slate-400" title={movement.notes}>
                            {movement.notes}
                          </p>
                        )}
                      </td>

                      <td className="px-5 py-4 text-sm text-slate-500">
                        {movement.user}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* TRANSFERS */}
        {activeTab === "transfers" && (
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col justify-between gap-4 border-b border-slate-200 p-5 sm:flex-row sm:items-center">
              <div>
                <h2 className="font-bold text-[#0F2A3B]">
                  Warehouse Transfers
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Move inventory between warehouses and track transfer
                  status.
                </p>
              </div>

              <button
                type="button"
                onClick={() => openTransfer()}
                className="flex items-center justify-center gap-2 rounded-xl bg-[#1C9A9A] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#168383]"
              >
                <Plus size={17} />
                New Transfer
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[950px] text-left">
                <thead className="bg-slate-50">
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-5 py-4">Transfer</th>
                    <th className="px-5 py-4">Product</th>
                    <th className="px-5 py-4">Quantity</th>
                    <th className="px-5 py-4">From</th>
                    <th className="px-5 py-4">To</th>
                    <th className="px-5 py-4">Date</th>
                    <th className="px-5 py-4">Status</th>
                    <th className="px-5 py-4 text-right">Action</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100">
                  {transfers.map((transfer) => (
                    <tr
                      key={transfer.id}
                      className="hover:bg-slate-50"
                    >
                      <td className="px-5 py-4 text-sm font-semibold text-[#0F2A3B]">
                        {transfer.reference}
                      </td>

                      <td className="px-5 py-4">
                        <p className="text-sm font-semibold">
                          {transfer.product}
                        </p>
                        <p className="text-xs text-slate-400">
                          {transfer.sku}
                        </p>
                      </td>

                      <td className="px-5 py-4 text-sm font-semibold">
                        {transfer.quantity}
                      </td>

                      <td className="px-5 py-4 text-sm text-slate-600">
                        {transfer.from}
                      </td>

                      <td className="px-5 py-4 text-sm text-slate-600">
                        {transfer.to}
                      </td>

                      <td className="px-5 py-4 text-sm text-slate-500">
                        {transfer.date}
                      </td>

                      <td className="px-5 py-4">
                        <TransferStatus status={transfer.status} />
                      </td>

                      <td className="px-5 py-4 text-right">
                        {transfer.status !== "Completed" && (
                          <button
                            type="button"
                            onClick={() =>
                              completeTransfer(transfer.id)
                            }
                            className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-[#1C9A9A] hover:bg-slate-50"
                          >
                            Complete
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* BATCHES & EXPIRY */}
        {activeTab === "batches" && (
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col justify-between gap-3 border-b border-slate-200 p-5 sm:flex-row sm:items-center">
              <div>
                <h2 className="font-bold text-[#0F2A3B]">Batches &amp; Expiry</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Sales and transfers use the earliest-expiring batch first (FEFO).
                </p>
              </div>
              <div className="flex gap-2 text-xs font-semibold">
                <span className="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-red-700">
                  {batches.filter((b) => b.expiryStatus === "Expired").length} expired
                </span>
                <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-amber-700">
                  {batches.filter((b) => b.expiryStatus === "Expiring Soon").length} expiring ≤ 30 days
                </span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[950px] text-left">
                <thead className="bg-slate-50">
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-5 py-4">Product</th>
                    <th className="px-5 py-4">Batch</th>
                    <th className="px-5 py-4">Warehouse</th>
                    <th className="px-5 py-4">Expiry</th>
                    <th className="px-5 py-4">Quantity</th>
                    <th className="px-5 py-4">Value</th>
                    <th className="px-5 py-4">Status</th>
                    <th className="px-5 py-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {batches.map((batch) => (
                    <tr key={batch.id} className="hover:bg-slate-50">
                      <td className="px-5 py-4">
                        <p className="text-sm font-semibold">{batch.product}</p>
                        <p className="text-xs text-slate-400">{batch.sku}</p>
                      </td>
                      <td className="px-5 py-4 text-sm font-medium text-slate-700">{batch.batch}</td>
                      <td className="px-5 py-4 text-sm text-slate-600">{batch.warehouse}</td>
                      <td className="px-5 py-4 text-sm text-slate-600">
                        {batch.expiry ?? "—"}
                        {batch.daysToExpiry !== null && (
                          <p className="text-xs text-slate-400">
                            {batch.daysToExpiry < 0 ? `${-batch.daysToExpiry} days ago` : `in ${batch.daysToExpiry} days`}
                          </p>
                        )}
                      </td>
                      <td className="px-5 py-4 text-sm font-semibold">{batch.quantity}</td>
                      <td className="px-5 py-4 text-sm text-slate-600">{formatCurrency(batch.value)}</td>
                      <td className="px-5 py-4">
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${expiryStyles[batch.expiryStatus]}`}>
                          {batch.expiryStatus}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-right">
                        {batch.expiryStatus === "Expired" && (
                          <button
                            type="button"
                            disabled={saving}
                            onClick={async () => {
                              if (!window.confirm(`Write off ${batch.quantity} units of ${batch.product} (batch ${batch.batch})?`)) return;
                              try {
                                alert(await runAction({ action: "writeOffBatch", batchId: batch.id }));
                              } catch (error) {
                                alert(errorMessage(error));
                              }
                            }}
                            className="rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                          >
                            Write off
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {batches.length === 0 && (
                <div className="py-16 text-center">
                  <Package className="mx-auto text-slate-300" size={42} />
                  <p className="mt-3 font-semibold text-slate-700">No batch-tracked stock</p>
                  <p className="mt-1 text-sm text-slate-500">
                    Turn on batch tracking for a product, then enter batch numbers when receiving goods.
                  </p>
                </div>
              )}
            </div>
          </section>
        )}

        {/* ADJUSTMENTS */}
        {activeTab === "adjustments" && (
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
              <div>
                <h2 className="font-bold text-[#0F2A3B]">
                  Stock Adjustments
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Correct stock levels for damaged goods, losses,
                  discoveries and physical counts.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setShowAdjustmentModal(true)}
                className="flex items-center justify-center gap-2 rounded-xl bg-[#1C9A9A] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#168383]"
              >
                <Plus size={17} />
                New Adjustment
              </button>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
              <AdjustmentCard
                icon={<ArrowDownToLine size={20} />}
                title="Stock Increase"
                description="Add stock from physical counts, returns or corrections."
              />

              <AdjustmentCard
                icon={<ArrowUpFromLine size={20} />}
                title="Stock Decrease"
                description="Remove damaged, expired, lost or incorrectly counted stock."
              />

              <AdjustmentCard
                icon={<ClipboardCheck size={20} />}
                title="Stock Count"
                description="Compare physical stock against system quantities."
              />
            </div>

            <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-5">
              <div className="flex items-center gap-3">
                <History size={20} className="text-[#1C9A9A]" />
                <div>
                  <p className="font-semibold text-slate-800">
                    Adjustment audit trail
                  </p>
                  <p className="text-sm text-slate-500">
                    Every adjustment is recorded against the user,
                    warehouse, product and reference number.
                  </p>
                </div>
              </div>
            </div>
          </section>
        )}
      </main>

      {/* TRANSFER MODAL */}
      {showTransferModal && (
        <Modal
          title="Transfer Stock"
          subtitle="Move inventory from one warehouse to another."
          onClose={() => {
            setShowTransferModal(false);
            setTransferQuantity("");
          }}
        >
          <div className="space-y-5">
            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">
                Product
              </label>

              <select
                value={transferProduct}
                onChange={(e) => setTransferProduct(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm outline-none focus:border-[#1C9A9A]"
              >
                <option value="">Select product</option>

                {productOptions.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name} — {product.sku}
                  </option>
                ))}
              </select>

              {transferProduct && transferFrom && (
                <p className="mt-2 text-xs text-slate-500">
                  Available in source:{" "}
                  <span className="font-semibold text-slate-700">
                    {(() => {
                      const source = stock.find(
                        (item) => item.productId === Number(transferProduct) && item.warehouseId === Number(transferFrom)
                      );
                      return source ? Math.max(source.quantity - source.reserved, 0) : 0;
                    })()}
                  </span>{" "}
                  units
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">
                  From Warehouse
                </label>

                <select
                  value={transferFrom}
                  onChange={(e) => setTransferFrom(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm outline-none focus:border-[#1C9A9A]"
                >
                  {warehouseOptions.map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">
                  To Warehouse
                </label>

                <select
                  value={transferTo}
                  onChange={(e) => setTransferTo(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm outline-none focus:border-[#1C9A9A]"
                >
                  {warehouseOptions.map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">
                Quantity
              </label>

              <input
                type="number"
                min="1"
                value={transferQuantity}
                onChange={(e) => setTransferQuantity(e.target.value)}
                placeholder="Enter quantity"
                className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-[#1C9A9A]"
              />
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-200 pt-5">
              <button
                type="button"
                onClick={() => setShowTransferModal(false)}
                className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={createTransfer}
                disabled={saving}
                className="flex items-center gap-2 rounded-xl bg-[#1C9A9A] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#168383] disabled:opacity-60"
              >
                <ArrowRightLeft size={17} />
                Create Transfer
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ADJUSTMENT MODAL */}
      {showAdjustmentModal && (
        <Modal
          title="Adjust Stock"
          subtitle="Increase or decrease the system stock quantity."
          onClose={() => {
            setShowAdjustmentModal(false);
            setSelectedStock(null);
          }}
        >
          <div className="space-y-5">
            {selectedStock && (
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="font-semibold text-slate-800">
                  {selectedStock.product}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {selectedStock.sku} • {selectedStock.warehouse}
                </p>

                <div className="mt-3 flex items-center justify-between">
                  <span className="text-sm text-slate-500">
                    Current Quantity
                  </span>
                  <span className="font-bold text-[#0F2A3B]">
                    {selectedStock.quantity}
                  </span>
                </div>
              </div>
            )}

            {!selectedStock && (
              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">
                  Stock Item
                </label>
                <select
                  value=""
                  onChange={(e) =>
                    setSelectedStock(stock.find((item) => item.id === Number(e.target.value)) ?? null)
                  }
                  className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-[#1C9A9A]"
                >
                  <option value="">Select stock item</option>
                  {stock.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.product} — {item.warehouse} ({item.quantity})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setAdjustmentType("increase")}
                className={`flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold ${
                  adjustmentType === "increase"
                    ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                    : "border-slate-200 text-slate-500"
                }`}
              >
                <Plus size={17} />
                Increase
              </button>

              <button
                type="button"
                onClick={() => setAdjustmentType("decrease")}
                className={`flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold ${
                  adjustmentType === "decrease"
                    ? "border-red-300 bg-red-50 text-red-700"
                    : "border-slate-200 text-slate-500"
                }`}
              >
                <Minus size={17} />
                Decrease
              </button>
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">
                Quantity
              </label>

              <input
                type="number"
                min="1"
                value={adjustmentQuantity}
                onChange={(e) => setAdjustmentQuantity(e.target.value)}
                placeholder="Enter quantity"
                className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-[#1C9A9A]"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">
                Reason
              </label>

              <textarea
                value={adjustmentReason}
                onChange={(e) => setAdjustmentReason(e.target.value)}
                rows={3}
                placeholder="Enter adjustment reason..."
                className="w-full resize-none rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-[#1C9A9A]"
              />
            </div>

            {adjustmentType === "increase" && (
              <div className="grid grid-cols-2 gap-3">
                <input
                  value={adjustmentBatch}
                  onChange={(e) => setAdjustmentBatch(e.target.value)}
                  placeholder="Batch number (optional)"
                  className="rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-[#1C9A9A]"
                />
                <input
                  type="date"
                  value={adjustmentExpiry}
                  onChange={(e) => setAdjustmentExpiry(e.target.value)}
                  title="Expiry date"
                  className="rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-[#1C9A9A]"
                />
              </div>
            )}

            <div className="flex justify-end gap-3 border-t border-slate-200 pt-5">
              <button
                type="button"
                onClick={() => setShowAdjustmentModal(false)}
                className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-600"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={createAdjustment}
                disabled={saving}
                className="flex items-center gap-2 rounded-xl bg-[#1C9A9A] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
              >
                <Save size={17} />
                Save Adjustment
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* STOCK COUNT MODAL */}
      {showCountModal && (
        <Modal
          title="Stock Count"
          subtitle="Reconcile physical stock with the system quantity."
          onClose={() => {
            setShowCountModal(false);
            setSelectedStock(null);
          }}
        >
          <div className="space-y-5">
            {!selectedStock ? (
              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">
                  Select Product
                </label>

                <select
                  onChange={(e) => {
                    const item = stock.find(
                      (stockItem) =>
                        stockItem.id === Number(e.target.value)
                    );

                    if (item) {
                      setSelectedStock(item);
                      setCountedQuantity(String(item.quantity));
                    }
                  }}
                  className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-[#1C9A9A]"
                >
                  <option value="">Select stock item</option>

                  {stock.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.product} — {item.warehouse}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <>
                <div className="rounded-xl bg-slate-50 p-4">
                  <p className="font-semibold">
                    {selectedStock.product}
                  </p>

                  <p className="mt-1 text-xs text-slate-500">
                    {selectedStock.warehouse} • {selectedStock.sku}
                  </p>

                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <div className="rounded-lg bg-white p-3">
                      <p className="text-xs text-slate-500">
                        System Quantity
                      </p>
                      <p className="mt-1 text-lg font-bold text-[#0F2A3B]">
                        {selectedStock.quantity}
                      </p>
                    </div>

                    <div className="rounded-lg bg-white p-3">
                      <p className="text-xs text-slate-500">
                        Variance
                      </p>
                      <p className="mt-1 text-lg font-bold text-[#1C9A9A]">
                        {Number(countedQuantity || 0) -
                          selectedStock.quantity}
                      </p>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-700">
                    Physical Count
                  </label>

                  <input
                    type="number"
                    min="0"
                    value={countedQuantity}
                    onChange={(e) =>
                      setCountedQuantity(e.target.value)
                    }
                    className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-[#1C9A9A]"
                  />
                </div>
              </>
            )}

            <div className="flex justify-end gap-3 border-t border-slate-200 pt-5">
              <button
                type="button"
                onClick={() => {
                  setShowCountModal(false);
                  setSelectedStock(null);
                }}
                className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-600"
              >
                Cancel
              </button>

              {selectedStock && (
                <button
                  type="button"
                  onClick={saveStockCount}
                  disabled={saving}
                  className="flex items-center gap-2 rounded-xl bg-[#1C9A9A] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                >
                  <ClipboardCheck size={17} />
                  Save Count
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* DETAILS MODAL */}
      {showDetailsModal && selectedStock && (
        <Modal
          title="Stock Details"
          subtitle="Detailed inventory information for this stock record."
          onClose={() => {
            setShowDetailsModal(false);
            setSelectedStock(null);
          }}
        >
          <div className="space-y-5">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#0F2A3B]/5 text-[#0F2A3B]">
                <Package size={25} />
              </div>

              <div>
                <h3 className="font-bold text-[#0F2A3B]">
                  {selectedStock.product}
                </h3>

                <p className="text-sm text-slate-500">
                  {selectedStock.sku}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <InfoCard
                label="Quantity"
                value={selectedStock.quantity.toLocaleString()}
              />

              <InfoCard
                label="Reserved"
                value={selectedStock.reserved.toLocaleString()}
              />

              <InfoCard
                label="Available"
                value={Math.max(
                  selectedStock.quantity - selectedStock.reserved,
                  0
                ).toLocaleString()}
              />

              <InfoCard
                label="Reorder Level"
                value={String(selectedStock.reorderLevel)}
              />

              <InfoCard
                label="Unit Cost"
                value={formatCurrency(selectedStock.cost)}
              />

              <InfoCard
                label="Stock Value"
                value={formatCurrency(
                  selectedStock.quantity * selectedStock.cost
                )}
              />
            </div>

            <div className="rounded-xl border border-slate-200 p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-500">
                  Warehouse
                </span>

                <span className="font-semibold">
                  {selectedStock.warehouse}
                </span>
              </div>

              <div className="mt-3 flex items-center justify-between">
                <span className="text-sm text-slate-500">
                  Category
                </span>

                <span className="font-semibold">
                  {selectedStock.category}
                </span>
              </div>

              <div className="mt-3 flex items-center justify-between">
                <span className="text-sm text-slate-500">
                  Status
                </span>

                <span
                  className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${getStatusClass(
                    selectedStock.status
                  )}`}
                >
                  {selectedStock.status}
                </span>
              </div>
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-200 pt-5">
              <button
                type="button"
                onClick={() => {
                  setShowDetailsModal(false);
                  openCount(selectedStock);
                }}
                className="flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600"
              >
                <ClipboardCheck size={17} />
                Stock Count
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowDetailsModal(false);
                  openAdjustment(selectedStock);
                }}
                className="flex items-center gap-2 rounded-xl bg-[#1C9A9A] px-4 py-2.5 text-sm font-semibold text-white"
              >
                <Edit3 size={17} />
                Adjust Stock
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* --------------------------------
   COMPONENTS
-------------------------------- */

function KpiCard({
  icon,
  label,
  value,
  description,
  iconBg,
  iconColor,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
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

          <p className="mt-1 text-xs text-slate-400">
            {description}
          </p>
        </div>

        <div
          className={`flex h-10 w-10 items-center justify-center rounded-xl ${iconBg} ${iconColor}`}
        >
          {icon}
        </div>
      </div>
    </div>
  );
}

function TransferStatus({
  status,
}: {
  status: Transfer["status"];
}) {
  const styles = {
    Pending: "bg-amber-50 text-amber-700 border-amber-200",
    "In Transit":
      "bg-blue-50 text-blue-700 border-blue-200",
    Completed:
      "bg-emerald-50 text-emerald-700 border-emerald-200",
  };

  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${styles[status]}`}
    >
      {status}
    </span>
  );
}

function AdjustmentCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 p-5 transition hover:border-[#1C9A9A]/30 hover:shadow-sm">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1C9A9A]/10 text-[#1C9A9A]">
        {icon}
      </div>

      <h3 className="mt-4 font-bold text-[#0F2A3B]">
        {title}
      </h3>

      <p className="mt-2 text-sm leading-6 text-slate-500">
        {description}
      </p>
    </div>
  );
}

function InfoCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 font-bold text-[#0F2A3B]">{value}</p>
    </div>
  );
}

function Modal({
  title,
  subtitle,
  children,
  onClose,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-slate-200 bg-white p-5">
          <div>
            <h2 className="text-lg font-bold text-[#0F2A3B]">
              {title}
            </h2>

            <p className="mt-1 text-sm text-slate-500">
              {subtitle}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

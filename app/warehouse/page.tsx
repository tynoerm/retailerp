"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, errorMessage } from "../lib/api-client";
import UserMenu from "../components/UserMenu";
import { money } from "../lib/format";
import {
  Warehouse,
  Plus,
  Search,
  MapPin,
  User,
  Package,
  Boxes,
  DollarSign,
  ArrowLeftRight,
  MoreVertical,
  Edit3,
  Trash2,
  Eye,
  X,
  Save,
  CheckCircle2,
  AlertTriangle,
  Archive,
  ChevronDown,
} from "lucide-react";

type WarehouseStatus = "Active" | "Inactive" | "At Capacity";

type WarehouseRecord = {
  id: number;
  name: string;
  code: string;
  location: string;
  manager: string;
  phone: string;
  capacity: number;
  occupied: number;
  products: number;
  units: number;
  stockValue: number;
  status: WarehouseStatus;
  type: "Main" | "Branch" | "Cold Storage" | "Distribution";
};

type Transfer = {
  id: number;
  reference: string;
  product: string;
  sku: string;
  quantity: number;
  from: string;
  to: string;
  status: "Completed" | "In Transit" | "Pending";
  date: string;
};

const warehouseTypes = [
  "Main",
  "Branch",
  "Cold Storage",
  "Distribution",
];

export default function WarehousesPage() {
  const router = useRouter();
  const [warehouses, setWarehouses] = useState<WarehouseRecord[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [warehouseRows, stock] = await Promise.all([
        api<WarehouseRecord[]>("/api/warehouses"),
        api<{ transfers: Transfer[] }>("/api/stockmanagement"),
      ]);
      setWarehouses(warehouseRows);
      setTransfers(stock.transfers);
      setLoadError("");
    } catch (error) {
      setLoadError(errorMessage(error));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch
    void load();
  }, [load]);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [typeFilter, setTypeFilter] = useState("All");

  const [activeTab, setActiveTab] = useState<
    "warehouses" | "transfers"
  >("warehouses");

  const [showModal, setShowModal] = useState(false);
  const [editingWarehouse, setEditingWarehouse] =
    useState<WarehouseRecord | null>(null);

  const [showDetails, setShowDetails] = useState<WarehouseRecord | null>(
    null
  );

  const [openMenu, setOpenMenu] = useState<number | null>(null);

  const [form, setForm] = useState({
    name: "",
    code: "",
    location: "",
    manager: "",
    phone: "",
    capacity: "",
    type: "Main",
    status: "Active",
  });

  const filteredWarehouses = useMemo(() => {
    return warehouses.filter((warehouse) => {
      const matchesSearch =
        warehouse.name
          .toLowerCase()
          .includes(search.toLowerCase()) ||
        warehouse.code
          .toLowerCase()
          .includes(search.toLowerCase()) ||
        warehouse.location
          .toLowerCase()
          .includes(search.toLowerCase()) ||
        warehouse.manager
          .toLowerCase()
          .includes(search.toLowerCase());

      const matchesStatus =
        statusFilter === "All" ||
        warehouse.status === statusFilter;

      const matchesType =
        typeFilter === "All" ||
        warehouse.type === typeFilter;

      return (
        matchesSearch &&
        matchesStatus &&
        matchesType
      );
    });
  }, [warehouses, search, statusFilter, typeFilter]);

  const totalWarehouses = warehouses.length;

  const activeWarehouses = warehouses.filter(
    (warehouse) => warehouse.status === "Active"
  ).length;

  const totalCapacity = warehouses.reduce(
    (sum, warehouse) => sum + warehouse.capacity,
    0
  );

  const totalUnits = warehouses.reduce(
    (sum, warehouse) => sum + warehouse.units,
    0
  );

  const totalStockValue = warehouses.reduce(
    (sum, warehouse) => sum + warehouse.stockValue,
    0
  );

  const averageOccupancy =
    warehouses.length > 0
      ? Math.round(
          warehouses.reduce(
            (sum, warehouse) => sum + warehouse.occupied,
            0
          ) / warehouses.length
        )
      : 0;

  const openAddModal = () => {
    setEditingWarehouse(null);

    setForm({
      name: "",
      code: "",
      location: "",
      manager: "",
      phone: "",
      capacity: "",
      type: "Main",
      status: "Active",
    });

    setShowModal(true);
  };

  const openEditModal = (warehouse: WarehouseRecord) => {
    setEditingWarehouse(warehouse);

    setForm({
      name: warehouse.name,
      code: warehouse.code,
      location: warehouse.location,
      manager: warehouse.manager,
      phone: warehouse.phone,
      capacity: warehouse.capacity.toString(),
      type: warehouse.type,
      status: warehouse.status === "Inactive" ? "Inactive" : "Active",
    });

    setShowDetails(null);
    setShowModal(true);
    setOpenMenu(null);
  };

  const saveWarehouse = async () => {
    if (
      !form.name ||
      !form.code ||
      !form.location ||
      !form.manager ||
      !form.capacity
    ) {
      alert("Please complete all required fields.");
      return;
    }

    const capacity = Number(form.capacity);

    if (capacity <= 0) {
      alert("Warehouse capacity must be greater than zero.");
      return;
    }

    setSaving(true);

    try {
      await api("/api/warehouses", {
        method: editingWarehouse ? "PUT" : "POST",
        body: JSON.stringify({ ...form, capacity, id: editingWarehouse?.id }),
      });
      setShowModal(false);
      await load();
    } catch (error) {
      alert(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const deleteWarehouse = async (id: number) => {
    const warehouse = warehouses.find(
      (item) => item.id === id
    );

    if (!warehouse) return;

    if (warehouse.units > 0) {
      alert(
        `${warehouse.name} still contains ${warehouse.units.toLocaleString()} units of stock. Transfer the stock before deleting this warehouse.`
      );
      return;
    }

    const confirmed = window.confirm(
      `Delete "${warehouse.name}"?`
    );

    if (!confirmed) return;

    setOpenMenu(null);

    try {
      await api(`/api/warehouses?id=${id}`, { method: "DELETE" });
      await load();
    } catch (error) {
      alert(errorMessage(error));
    }
  };

  return (
    <div className="min-h-screen bg-[#F6F7F9] text-slate-800">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="flex h-[76px] items-center justify-between px-6">
          <div className="flex items-center gap-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#0F2A3B] text-white shadow-sm">
              <Warehouse size={22} />
            </div>

            <div>
              <h1 className="text-xl font-bold text-[#0F2A3B]">
                Warehouses
              </h1>

              <p className="text-xs text-slate-500">
                RetailERP • Warehouse Management
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={openAddModal}
              className="flex items-center gap-2 rounded-xl bg-[#1C9A9A] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#178686]"
            >
              <Plus size={18} />
              Add Warehouse
            </button>

            <UserMenu />
          </div>
        </div>
      </header>

      <main className="p-6">
        {loadError && (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {loadError}
          </div>
        )}

        {/* KPI Cards */}
        <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <WarehouseCard
            title="Warehouses"
            value={totalWarehouses.toString()}
            subtitle={`${activeWarehouses} active locations`}
            icon={<Warehouse size={21} />}
          />

          <WarehouseCard
            title="Total Capacity"
            value={totalCapacity.toLocaleString()}
            subtitle="Storage units"
            icon={<Boxes size={21} />}
          />

          <WarehouseCard
            title="Stock Units"
            value={totalUnits.toLocaleString()}
            subtitle="Across all warehouses"
            icon={<Package size={21} />}
          />

          <WarehouseCard
            title="Stock Value"
            value={money(totalStockValue)}
            subtitle="Inventory at cost"
            icon={<DollarSign size={21} />}
          />

          <WarehouseCard
            title="Avg. Occupancy"
            value={`${averageOccupancy}%`}
            subtitle="Warehouse utilisation"
            icon={<TrendingOccupancy />}
          />
        </div>

        {/* Occupancy Alert */}
        {warehouses.some(
          (warehouse) => warehouse.occupied >= 80
        ) && (
          <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 text-amber-600">
                <AlertTriangle size={20} />
              </div>

              <div>
                <h3 className="font-semibold text-amber-900">
                  Warehouse capacity alert
                </h3>

                <p className="mt-1 text-sm text-amber-800">
                  One or more warehouses are approaching
                  capacity. Review stock levels and consider
                  transferring inventory.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="mb-5 flex w-fit items-center gap-1 rounded-xl border border-slate-200 bg-white p-1.5">
          <button
            type="button"
            onClick={() => setActiveTab("warehouses")}
            className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition ${
              activeTab === "warehouses"
                ? "bg-[#0F2A3B] text-white shadow-sm"
                : "text-slate-500 hover:bg-slate-50"
            }`}
          >
            <Warehouse size={16} />
            Warehouses
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("transfers")}
            className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition ${
              activeTab === "transfers"
                ? "bg-[#0F2A3B] text-white shadow-sm"
                : "text-slate-500 hover:bg-slate-50"
            }`}
          >
            <ArrowLeftRight size={16} />
            Transfers
          </button>
        </div>

        {/* Warehouse List */}
        {activeTab === "warehouses" && (
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            {/* Toolbar */}
            <div className="border-b border-slate-200 p-5">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                <div className="relative w-full xl:max-w-xl">
                  <Search
                    size={19}
                    className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
                  />

                  <input
                    value={search}
                    onChange={(event) =>
                      setSearch(event.target.value)
                    }
                    placeholder="Search warehouses, locations or managers..."
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-4 text-sm outline-none transition focus:border-[#1C9A9A] focus:bg-white focus:ring-2 focus:ring-[#1C9A9A]/10"
                  />
                </div>

                <div className="flex flex-wrap gap-3">
                  <SelectFilter
                    value={typeFilter}
                    onChange={setTypeFilter}
                    options={[
                      "All",
                      ...warehouseTypes,
                    ]}
                  />

                  <SelectFilter
                    value={statusFilter}
                    onChange={setStatusFilter}
                    options={[
                      "All",
                      "Active",
                      "Inactive",
                      "At Capacity",
                    ]}
                  />

                  <button
                    type="button"
                    onClick={() => {
                      setSearch("");
                      setTypeFilter("All");
                      setStatusFilter("All");
                    }}
                    className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-50"
                  >
                    Reset
                  </button>
                </div>
              </div>
            </div>

            {/* Warehouse Cards */}
            <div className="grid gap-5 p-5 lg:grid-cols-2 xl:grid-cols-3">
              {filteredWarehouses.map((warehouse) => (
                <WarehouseCardItem
                  key={warehouse.id}
                  warehouse={warehouse}
                  openMenu={openMenu}
                  setOpenMenu={setOpenMenu}
                  onView={() => {
                    setShowDetails(warehouse);
                    setOpenMenu(null);
                  }}
                  onEdit={() =>
                    openEditModal(warehouse)
                  }
                  onDelete={() =>
                    deleteWarehouse(warehouse.id)
                  }
                />
              ))}
            </div>

            {filteredWarehouses.length === 0 && (
              <div className="flex min-h-[300px] flex-col items-center justify-center px-6 text-center">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                  <Warehouse size={30} />
                </div>

                <h3 className="font-semibold text-slate-800">
                  No warehouses found
                </h3>

                <p className="mt-1 text-sm text-slate-500">
                  Try changing your search or filters.
                </p>
              </div>
            )}
          </section>
        )}

        {/* Transfers */}
        {activeTab === "transfers" && (
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col gap-4 border-b border-slate-200 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-bold text-[#0F2A3B]">
                  Warehouse Transfers
                </h2>

                <p className="mt-1 text-sm text-slate-500">
                  Monitor stock transfers between warehouse
                  locations.
                </p>
              </div>

              <button
                type="button"
                onClick={() => router.push("/stockmanagement")}
                title="Transfers are created in Stock Management"
                className="flex items-center gap-2 rounded-xl bg-[#1C9A9A] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#178686]"
              >
                <ArrowLeftRight size={17} />
                New Transfer
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[950px]">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70">
                    <TableHeader>Reference</TableHeader>
                    <TableHeader>Product</TableHeader>
                    <TableHeader>Quantity</TableHeader>
                    <TableHeader>From</TableHeader>
                    <TableHeader>To</TableHeader>
                    <TableHeader>Status</TableHeader>
                    <TableHeader>Date</TableHeader>
                  </tr>
                </thead>

                <tbody>
                  {transfers.map((transfer) => (
                    <tr
                      key={transfer.id}
                      className="border-b border-slate-100 hover:bg-slate-50/70"
                    >
                      <td className="px-5 py-4">
                        <span className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600">
                          {transfer.reference}
                        </span>
                      </td>

                      <td className="px-5 py-4">
                        <p className="font-semibold text-slate-800">
                          {transfer.product}
                        </p>

                        <p className="text-xs text-slate-400">
                          {transfer.sku}
                        </p>
                      </td>

                      <td className="px-5 py-4 text-sm font-bold text-slate-700">
                        {transfer.quantity}
                      </td>

                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2 text-sm text-slate-600">
                          <Warehouse size={15} />
                          {transfer.from}
                        </div>
                      </td>

                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2 text-sm text-slate-600">
                          <Warehouse size={15} />
                          {transfer.to}
                        </div>
                      </td>

                      <td className="px-5 py-4">
                        <TransferStatus
                          status={transfer.status}
                        />
                      </td>

                      <td className="px-5 py-4 text-sm text-slate-500">
                        {transfer.date}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>

      {/* Add / Edit Warehouse Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0F2A3B]/50 p-4 backdrop-blur-sm">
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5">
              <div>
                <h2 className="text-xl font-bold text-[#0F2A3B]">
                  {editingWarehouse
                    ? "Edit Warehouse"
                    : "Add Warehouse"}
                </h2>

                <p className="mt-1 text-sm text-slate-500">
                  Configure your warehouse and storage location.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="rounded-xl p-2 text-slate-400 hover:bg-slate-100"
              >
                <X size={21} />
              </button>
            </div>

            <div className="space-y-6 p-6">
              <div>
                <h3 className="mb-4 text-sm font-bold text-[#0F2A3B]">
                  Warehouse Information
                </h3>

                <div className="grid gap-4 md:grid-cols-2">
                  <FormInput
                    label="Warehouse Name"
                    required
                    value={form.name}
                    onChange={(value) =>
                      setForm({
                        ...form,
                        name: value,
                      })
                    }
                    placeholder="e.g. Main Warehouse"
                  />

                  <FormInput
                    label="Warehouse Code"
                    required
                    value={form.code}
                    onChange={(value) =>
                      setForm({
                        ...form,
                        code: value,
                      })
                    }
                    placeholder="e.g. WH-005"
                  />

                  <FormInput
                    label="Location"
                    required
                    value={form.location}
                    onChange={(value) =>
                      setForm({
                        ...form,
                        location: value,
                      })
                    }
                    placeholder="e.g. Harare Central"
                  />

                  <div>
                    <label className="mb-2 block text-sm font-semibold text-slate-700">
                      Warehouse Type
                    </label>

                    <select
                      value={form.type}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          type: event.target.value,
                        })
                      }
                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-[#1C9A9A]"
                    >
                      {warehouseTypes.map((type) => (
                        <option key={type}>{type}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-100 pt-6">
                <h3 className="mb-4 text-sm font-bold text-[#0F2A3B]">
                  Management
                </h3>

                <div className="grid gap-4 md:grid-cols-2">
                  <FormInput
                    label="Warehouse Manager"
                    required
                    value={form.manager}
                    onChange={(value) =>
                      setForm({
                        ...form,
                        manager: value,
                      })
                    }
                    placeholder="Manager name"
                  />

                  <FormInput
                    label="Contact Number"
                    value={form.phone}
                    onChange={(value) =>
                      setForm({
                        ...form,
                        phone: value,
                      })
                    }
                    placeholder="+263 7XX XXX XXX"
                  />
                </div>
              </div>

              <div className="border-t border-slate-100 pt-6">
                <h3 className="mb-4 text-sm font-bold text-[#0F2A3B]">
                  Capacity
                </h3>

                <FormInput
                  label="Maximum Capacity"
                  required
                  type="number"
                  value={form.capacity}
                  onChange={(value) =>
                    setForm({
                      ...form,
                      capacity: value,
                    })
                  }
                  placeholder="e.g. 10000"
                />

                <p className="mt-2 text-xs text-slate-400">
                  Define the maximum storage capacity for this
                  warehouse.
                </p>

                <div className="mt-4">
                  <label className="mb-2 block text-sm font-semibold text-slate-700">
                    Status
                  </label>
                  <select
                    value={form.status}
                    onChange={(event) =>
                      setForm({ ...form, status: event.target.value })
                    }
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-[#1C9A9A]"
                  >
                    <option>Active</option>
                    <option>Inactive</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={saveWarehouse}
                disabled={saving}
                className="flex items-center gap-2 rounded-xl bg-[#1C9A9A] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#178686] disabled:opacity-60"
              >
                <Save size={17} />
                {editingWarehouse
                  ? "Save Changes"
                  : "Create Warehouse"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Warehouse Details Modal */}
      {showDetails && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0F2A3B]/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between bg-[#0F2A3B] px-6 py-5 text-white">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10">
                  <Warehouse size={22} />
                </div>

                <div>
                  <h2 className="font-bold">
                    {showDetails.name}
                  </h2>

                  <p className="text-xs text-white/60">
                    {showDetails.code}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowDetails(null)}
                className="rounded-xl p-2 text-white/70 hover:bg-white/10 hover:text-white"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6">
              <div className="mb-6 grid gap-4 sm:grid-cols-2">
                <DetailBox
                  icon={<MapPin size={18} />}
                  label="Location"
                  value={showDetails.location}
                />

                <DetailBox
                  icon={<User size={18} />}
                  label="Manager"
                  value={showDetails.manager}
                />

                <DetailBox
                  icon={<Package size={18} />}
                  label="Stock Units"
                  value={showDetails.units.toLocaleString()}
                />

                <DetailBox
                  icon={<DollarSign size={18} />}
                  label="Stock Value"
                  value={money(showDetails.stockValue)}
                />
              </div>

              <div className="rounded-2xl border border-slate-200 p-5">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-bold text-[#0F2A3B]">
                      Storage Utilisation
                    </p>

                    <p className="text-xs text-slate-500">
                      {showDetails.occupied}% of warehouse
                      capacity used
                    </p>
                  </div>

                  <span
                    className={`text-lg font-bold ${
                      showDetails.occupied >= 80
                        ? "text-amber-600"
                        : "text-emerald-600"
                    }`}
                  >
                    {showDetails.occupied}%
                  </span>
                </div>

                <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full ${
                      showDetails.occupied >= 90
                        ? "bg-red-500"
                        : showDetails.occupied >= 80
                        ? "bg-amber-500"
                        : "bg-[#1C9A9A]"
                    }`}
                    style={{
                      width: `${showDetails.occupied}%`,
                    }}
                  />
                </div>

                <div className="mt-3 flex justify-between text-xs text-slate-400">
                  <span>
                    Capacity:{" "}
                    {showDetails.capacity.toLocaleString()}
                  </span>

                  <span>
                    Products:{" "}
                    {showDetails.products.toLocaleString()}
                  </span>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() =>
                    openEditModal(showDetails)
                  }
                  className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Edit3 size={17} />
                  Edit Warehouse
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowDetails(null);
                    setActiveTab("transfers");
                  }}
                  className="flex items-center justify-center gap-2 rounded-xl bg-[#1C9A9A] px-4 py-3 text-sm font-semibold text-white hover:bg-[#178686]"
                >
                  <ArrowLeftRight size={17} />
                  View Transfers
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* =========================
   COMPONENTS
========================= */

function WarehouseCardItem({
  warehouse,
  openMenu,
  setOpenMenu,
  onView,
  onEdit,
  onDelete,
}: {
  warehouse: WarehouseRecord;
  openMenu: number | null;
  setOpenMenu: (id: number | null) => void;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const occupancyColor =
    warehouse.occupied >= 90
      ? "bg-red-500"
      : warehouse.occupied >= 80
      ? "bg-amber-500"
      : "bg-[#1C9A9A]";

  return (
    <div className="relative rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-slate-300 hover:shadow-md">
      {/* Card Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#0F2A3B]/5 text-[#0F2A3B]">
            <Warehouse size={22} />
          </div>

          <div>
            <h3 className="font-bold text-[#0F2A3B]">
              {warehouse.name}
            </h3>

            <p className="mt-0.5 text-xs text-slate-400">
              {warehouse.code} • {warehouse.type}
            </p>
          </div>
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={() =>
              setOpenMenu(
                openMenu === warehouse.id
                  ? null
                  : warehouse.id
              )
            }
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <MoreVertical size={18} />
          </button>

          {openMenu === warehouse.id && (
            <div className="absolute right-0 top-10 z-20 w-44 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl">
              <button
                type="button"
                onClick={onView}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50"
              >
                <Eye size={16} />
                View Details
              </button>

              <button
                type="button"
                onClick={onEdit}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50"
              >
                <Edit3 size={16} />
                Edit Warehouse
              </button>

              <button
                type="button"
                onClick={onDelete}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50"
              >
                <Trash2 size={16} />
                Delete
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Location */}
      <div className="mt-5 flex items-center gap-2 text-sm text-slate-500">
        <MapPin size={16} className="text-slate-400" />
        {warehouse.location}
      </div>

      {/* Manager */}
      <div className="mt-2 flex items-center gap-2 text-sm text-slate-500">
        <User size={16} className="text-slate-400" />
        {warehouse.manager}
      </div>

      {/* Occupancy */}
      <div className="mt-5 rounded-xl bg-slate-50 p-4">
        <div className="mb-2 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-500">
              Storage Utilisation
            </p>

            <p className="mt-0.5 text-sm font-bold text-slate-800">
              {warehouse.occupied}%
            </p>
          </div>

          <span className="text-xs text-slate-400">
            {warehouse.capacity.toLocaleString()} units
          </span>
        </div>

        <div className="h-2.5 overflow-hidden rounded-full bg-slate-200">
          <div
            className={`h-full rounded-full ${occupancyColor}`}
            style={{
              width: `${Math.min(
                warehouse.occupied,
                100
              )}%`,
            }}
          />
        </div>
      </div>

      {/* Stats */}
      <div className="mt-4 grid grid-cols-3 divide-x divide-slate-200">
        <div className="pr-3">
          <p className="text-[11px] text-slate-400">
            Products
          </p>

          <p className="mt-1 font-bold text-slate-800">
            {warehouse.products.toLocaleString()}
          </p>
        </div>

        <div className="px-3">
          <p className="text-[11px] text-slate-400">
            Units
          </p>

          <p className="mt-1 font-bold text-slate-800">
            {warehouse.units.toLocaleString()}
          </p>
        </div>

        <div className="pl-3">
          <p className="text-[11px] text-slate-400">
            Value
          </p>

          <p className="mt-1 truncate font-bold text-slate-800">
            {money(warehouse.stockValue)}
          </p>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4">
        <WarehouseStatus status={warehouse.status} />

        <button
          type="button"
          onClick={onView}
          className="flex items-center gap-1.5 text-xs font-semibold text-[#1C9A9A] hover:text-[#178686]"
        >
          View Details
          <Eye size={14} />
        </button>
      </div>
    </div>
  );
}

function WarehouseCard({
  title,
  value,
  subtitle,
  icon,
}: {
  title: string;
  value: string;
  subtitle: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-slate-500">
            {title}
          </p>

          <h2 className="mt-2 text-2xl font-bold text-[#0F2A3B]">
            {value}
          </h2>

          <p className="mt-1 text-xs text-slate-400">
            {subtitle}
          </p>
        </div>

        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#1C9A9A]/10 text-[#1C9A9A]">
          {icon}
        </div>
      </div>
    </div>
  );
}

function WarehouseStatus({
  status,
}: {
  status: WarehouseStatus;
}) {
  const styles = {
    Active: "bg-emerald-50 text-emerald-700",
    Inactive: "bg-slate-100 text-slate-600",
    "At Capacity": "bg-amber-50 text-amber-700",
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ${styles[status]}`}
    >
      {status === "Active" && (
        <CheckCircle2 size={13} />
      )}

      {status === "At Capacity" && (
        <AlertTriangle size={13} />
      )}

      {status === "Inactive" && (
        <Archive size={13} />
      )}

      {status}
    </span>
  );
}

function TransferStatus({
  status,
}: {
  status: Transfer["status"];
}) {
  const styles = {
    Completed: "bg-emerald-50 text-emerald-700",
    "In Transit": "bg-blue-50 text-blue-700",
    Pending: "bg-amber-50 text-amber-700",
  };

  return (
    <span
      className={`inline-flex rounded-full px-3 py-1.5 text-xs font-semibold ${styles[status]}`}
    >
      {status}
    </span>
  );
}

function SelectFilter({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="appearance-none rounded-xl border border-slate-200 bg-white py-3 pl-4 pr-10 text-sm font-medium text-slate-700 outline-none focus:border-[#1C9A9A]"
      >
        {options.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>

      <ChevronDown
        size={16}
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
      />
    </div>
  );
}

function FormInput({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="mb-2 block text-sm font-semibold text-slate-700">
        {label}{" "}
        {required && (
          <span className="text-red-500">*</span>
        )}
      </label>

      <input
        type={type}
        value={value}
        onChange={(event) =>
          onChange(event.target.value)
        }
        placeholder={placeholder}
        className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-[#1C9A9A] focus:ring-2 focus:ring-[#1C9A9A]/10"
      />
    </div>
  );
}

function DetailBox({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-center gap-2 text-[#1C9A9A]">
        {icon}
        <span className="text-xs font-semibold text-slate-500">
          {label}
        </span>
      </div>

      <p className="mt-2 font-bold text-slate-800">
        {value}
      </p>
    </div>
  );
}

function TrendingOccupancy() {
  return <Boxes size={21} />;
}

function TableHeader({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-5 py-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
      {children}
    </th>
  );
}

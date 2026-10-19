"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, errorMessage, parseCsv } from "../lib/api-client";
import UserMenu from "../components/UserMenu";
import { money } from "../lib/format";
import {
  Search,
  Plus,
  Package,
  Edit3,
  Trash2,
  MoreVertical,
  Filter,
  Download,
  Upload,
  X,
  Save,
  Boxes,
  AlertTriangle,
  CheckCircle2,
  DollarSign,
  Tag,
  Barcode,
  ChevronDown,
} from "lucide-react";

type Product = {
  id: number;
  name: string;
  sku: string;
  barcode: string;
  category: string;
  brand: string;
  price: number;
  cost: number;
  stock: number;
  reorderLevel: number;
  wholesalePrice: number | null;
  trackBatches: boolean;
  units: { name: string; multiplier: number; price: number; wholesalePrice: number | null; barcode: string }[];
  status: "Active" | "Low Stock" | "Out of Stock";
};

type UnitForm = { name: string; multiplier: string; price: string; wholesalePrice: string; barcode: string };

type WarehouseOption = { id: number; name: string; status: string };

const emptyForm = {
  name: "",
  sku: "",
  barcode: "",
  category: "",
  brand: "",
  price: "",
  wholesalePrice: "",
  cost: "",
  stock: "",
  reorderLevel: "",
  warehouseId: "",
  trackBatches: false,
  batchNumber: "",
  expiryDate: "",
  units: [] as UnitForm[],
};

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [status, setStatus] = useState("All");
  const [showFilters, setShowFilters] = useState(false);
  const [showProductModal, setShowProductModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [openMenu, setOpenMenu] = useState<number | null>(null);

  const [form, setForm] = useState(emptyForm);

  const categories = useMemo(
    () => ["All", ...Array.from(new Set(products.map((product) => product.category))).sort()],
    [products]
  );

  const loadProducts = useCallback(async () => {
    try {
      setProducts(await api<Product[]>("/api/products"));
      setLoadError("");
    } catch (error) {
      setLoadError(errorMessage(error));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch
    void loadProducts();
    api<WarehouseOption[]>("/api/warehouses")
      .then((rows) => setWarehouses(rows.filter((row) => row.status !== "Inactive")))
      .catch((error) => setLoadError(errorMessage(error)));
  }, [loadProducts]);

  const filteredProducts = useMemo(() => {
    return products.filter((product) => {
      const matchesSearch =
        product.name.toLowerCase().includes(search.toLowerCase()) ||
        product.sku.toLowerCase().includes(search.toLowerCase()) ||
        product.barcode.includes(search) ||
        product.brand.toLowerCase().includes(search.toLowerCase());

      const matchesCategory =
        category === "All" || product.category === category;

      const matchesStatus =
        status === "All" || product.status === status;

      return matchesSearch && matchesCategory && matchesStatus;
    });
  }, [products, search, category, status]);

  const totalProducts = products.length;

  const activeProducts = products.filter(
    (product) => product.status === "Active"
  ).length;

  const lowStockProducts = products.filter(
    (product) => product.status === "Low Stock"
  ).length;

  const inventoryValue = products.reduce(
    (total, product) => total + product.cost * product.stock,
    0
  );

  const openAddModal = () => {
    setEditingProduct(null);
    setForm({ ...emptyForm, warehouseId: String(warehouses[0]?.id ?? "") });
    setShowProductModal(true);
  };

  const openEditModal = (product: Product) => {
    setEditingProduct(product);

    setForm({
      name: product.name,
      sku: product.sku,
      barcode: product.barcode,
      category: product.category,
      brand: product.brand,
      price: product.price.toString(),
      cost: product.cost.toString(),
      stock: product.stock.toString(),
      reorderLevel: product.reorderLevel.toString(),
      warehouseId: "",
      wholesalePrice: product.wholesalePrice?.toString() ?? "",
      trackBatches: product.trackBatches,
      batchNumber: "",
      expiryDate: "",
      units: product.units.map((unit) => ({
        name: unit.name,
        multiplier: String(unit.multiplier),
        price: String(unit.price),
        wholesalePrice: unit.wholesalePrice?.toString() ?? "",
        barcode: unit.barcode,
      })),
    });

    setShowProductModal(true);
    setOpenMenu(null);
  };

  const saveProduct = async () => {
    if (!form.name || !form.sku || !form.category || !form.price || !form.cost) {
      alert("Please complete all required product fields.");
      return;
    }

    setSaving(true);

    try {
      const payload = {
        name: form.name,
        sku: form.sku,
        barcode: form.barcode,
        category: form.category,
        brand: form.brand,
        price: form.price,
        cost: form.cost,
        reorderLevel: form.reorderLevel || 0,
        wholesalePrice: form.wholesalePrice,
        trackBatches: form.trackBatches,
        units: form.units,
      };

      await api("/api/products", {
        method: editingProduct ? "PUT" : "POST",
        body: JSON.stringify(
          editingProduct
            ? { ...payload, id: editingProduct.id }
            : {
                ...payload,
                openingStock: form.stock || 0,
                warehouseId: form.warehouseId,
                batchNumber: form.batchNumber,
                expiryDate: form.expiryDate,
              }
        ),
      });

      setShowProductModal(false);
      await loadProducts();
    } catch (error) {
      alert(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const deleteProduct = async (id: number) => {
    const product = products.find((item) => item.id === id);

    if (!product) return;

    const confirmed = window.confirm(
      `Delete "${product.name}" from the product catalogue?`
    );

    if (!confirmed) return;

    setOpenMenu(null);

    try {
      await api(`/api/products?id=${id}`, { method: "DELETE" });
      await loadProducts();
    } catch (error) {
      alert(errorMessage(error));
    }
  };

  const importProducts = async (file: File) => {
    const [header, ...rows] = parseCsv(await file.text());
    const column = (name: string) => header?.findIndex((cell) => cell.trim().toLowerCase() === name.toLowerCase()) ?? -1;
    const index = {
      name: column("Product"),
      sku: column("SKU"),
      barcode: column("Barcode"),
      category: column("Category"),
      brand: column("Brand"),
      price: column("Selling Price"),
      cost: column("Cost Price"),
      stock: column("Stock"),
      reorderLevel: column("Reorder Level"),
    };

    if (index.name < 0 || index.sku < 0 || index.price < 0 || index.cost < 0 || index.category < 0) {
      alert("CSV must include the columns: Product, SKU, Category, Selling Price, Cost Price (same as the Export file).");
      return;
    }

    const existing = new Map(products.map((product) => [product.sku.toLowerCase(), product]));
    const errors: string[] = [];
    let created = 0;
    let updated = 0;

    for (const [lineIndex, row] of rows.entries()) {
      const value = (key: keyof typeof index) => (index[key] >= 0 ? (row[index[key]] ?? "").trim() : "");
      if (!value("name") && !value("sku")) continue;

      const match = existing.get(value("sku").toLowerCase());
      const payload = {
        name: value("name"),
        sku: value("sku"),
        barcode: value("barcode"),
        category: value("category"),
        brand: value("brand"),
        price: value("price"),
        cost: value("cost"),
        reorderLevel: value("reorderLevel") || 0,
      };

      try {
        await api("/api/products", {
          method: match ? "PUT" : "POST",
          body: JSON.stringify(
            match
              ? { ...payload, id: match.id }
              : { ...payload, openingStock: value("stock") || 0, warehouseId: warehouses[0]?.id }
          ),
        });
        if (match) updated++;
        else created++;
      } catch (error) {
        errors.push(`Row ${lineIndex + 2}: ${errorMessage(error)}`);
      }
    }

    await loadProducts();
    alert(
      `Import finished: ${created} created, ${updated} updated${errors.length ? `, ${errors.length} failed.\n\n${errors.slice(0, 10).join("\n")}` : "."}` +
        (created && warehouses[0] ? `\n\nOpening stock for new products was added to ${warehouses[0].name}.` : "")
    );
  };

  const exportProducts = () => {
    const headers = [
      "Product",
      "SKU",
      "Barcode",
      "Category",
      "Brand",
      "Selling Price",
      "Cost Price",
      "Stock",
      "Reorder Level",
      "Status",
    ];

    const rows = products.map((product) => [
      product.name,
      product.sku,
      product.barcode,
      product.category,
      product.brand,
      product.price,
      product.cost,
      product.stock,
      product.reorderLevel,
      product.status,
    ]);

    const csv = [
      headers.join(","),
      ...rows.map((row) =>
        row
          .map((value) => `"${String(value).replace(/"/g, '""')}"`)
          .join(",")
      ),
    ].join("\n");

    const blob = new Blob([csv], {
      type: "text/csv;charset=utf-8;",
    });

    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = "retailerp-products.csv";
    link.click();

    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-[#F6F7F9] text-slate-800">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="flex h-[76px] items-center justify-between px-6">
          <div className="flex items-center gap-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#0F2A3B] text-white shadow-sm">
              <Package size={22} />
            </div>

            <div>
              <h1 className="text-xl font-bold text-[#0F2A3B]">
                Products
              </h1>
              <p className="text-xs text-slate-500">
                RetailERP • Product Catalogue
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={exportProducts}
              className="hidden items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 sm:flex"
            >
              <Download size={17} />
              Export
            </button>

            <input
              ref={importInput}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void importProducts(file);
              }}
            />

            <button
              type="button"
              onClick={() => importInput.current?.click()}
              title="Import a CSV in the same format as Export"
              className="hidden items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 lg:flex"
            >
              <Upload size={17} />
              Import
            </button>

            <button
              type="button"
              onClick={openAddModal}
              className="flex items-center gap-2 rounded-xl bg-[#1C9A9A] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#178686]"
            >
              <Plus size={18} />
              Add Product
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

        {/* Summary Cards */}
        <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <SummaryCard
            title="Total Products"
            value={totalProducts.toString()}
            subtitle="Products in catalogue"
            icon={<Package size={21} />}
          />

          <SummaryCard
            title="Active Products"
            value={activeProducts.toString()}
            subtitle="Currently available"
            icon={<CheckCircle2 size={21} />}
          />

          <SummaryCard
            title="Low Stock"
            value={lowStockProducts.toString()}
            subtitle="Need replenishment"
            icon={<AlertTriangle size={21} />}
          />

          <SummaryCard
            title="Inventory Value"
            value={money(inventoryValue)}
            subtitle="At cost price"
            icon={<DollarSign size={21} />}
          />
        </div>

        {/* Main Card */}
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
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search products, SKU, barcode or brand..."
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-4 text-sm outline-none transition focus:border-[#1C9A9A] focus:bg-white focus:ring-2 focus:ring-[#1C9A9A]/10"
                />
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="relative">
                  <select
                    value={category}
                    onChange={(event) => setCategory(event.target.value)}
                    className="appearance-none rounded-xl border border-slate-200 bg-white py-3 pl-4 pr-10 text-sm font-medium outline-none focus:border-[#1C9A9A]"
                  >
                    {categories.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>

                  <ChevronDown
                    size={16}
                    className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                </div>

                <div className="relative">
                  <select
                    value={status}
                    onChange={(event) => setStatus(event.target.value)}
                    className="appearance-none rounded-xl border border-slate-200 bg-white py-3 pl-4 pr-10 text-sm font-medium outline-none focus:border-[#1C9A9A]"
                  >
                    <option value="All">All Status</option>
                    <option value="Active">Active</option>
                    <option value="Low Stock">Low Stock</option>
                    <option value="Out of Stock">
                      Out of Stock
                    </option>
                  </select>

                  <ChevronDown
                    size={16}
                    className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => setShowFilters(!showFilters)}
                  className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium transition ${
                    showFilters
                      ? "border-[#1C9A9A] bg-[#1C9A9A]/5 text-[#1C9A9A]"
                      : "border-slate-200 text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <Filter size={17} />
                  Filters
                </button>
              </div>
            </div>

            {showFilters && (
              <div className="mt-4 rounded-xl bg-slate-50 p-4">
                <div className="grid gap-4 md:grid-cols-3">
                  <div>
                    <label className="mb-2 block text-xs font-semibold text-slate-600">
                      Category
                    </label>

                    <select
                      value={category}
                      onChange={(event) =>
                        setCategory(event.target.value)
                      }
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm"
                    >
                      {categories.map((item) => (
                        <option key={item}>{item}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-2 block text-xs font-semibold text-slate-600">
                      Stock Status
                    </label>

                    <select
                      value={status}
                      onChange={(event) =>
                        setStatus(event.target.value)
                      }
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm"
                    >
                      <option>All</option>
                      <option>Active</option>
                      <option>Low Stock</option>
                      <option>Out of Stock</option>
                    </select>
                  </div>

                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={() => {
                        setSearch("");
                        setCategory("All");
                        setStatus("All");
                      }}
                      className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
                    >
                      Reset Filters
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1050px]">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70">
                  <th className="px-5 py-4 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                    Product
                  </th>

                  <th className="px-5 py-4 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                    SKU / Barcode
                  </th>

                  <th className="px-5 py-4 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                    Category
                  </th>

                  <th className="px-5 py-4 text-right text-xs font-bold uppercase tracking-wide text-slate-500">
                    Cost
                  </th>

                  <th className="px-5 py-4 text-right text-xs font-bold uppercase tracking-wide text-slate-500">
                    Selling Price
                  </th>

                  <th className="px-5 py-4 text-center text-xs font-bold uppercase tracking-wide text-slate-500">
                    Stock
                  </th>

                  <th className="px-5 py-4 text-center text-xs font-bold uppercase tracking-wide text-slate-500">
                    Status
                  </th>

                  <th className="px-5 py-4 text-right text-xs font-bold uppercase tracking-wide text-slate-500">
                    Actions
                  </th>
                </tr>
              </thead>

              <tbody>
                {filteredProducts.map((product) => (
                  <tr
                    key={product.id}
                    className="border-b border-slate-100 transition hover:bg-slate-50/70"
                  >
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#0F2A3B]/5 text-[#0F2A3B]">
                          <Package size={20} />
                        </div>

                        <div>
                          <p className="font-semibold text-slate-800">
                            {product.name}
                          </p>

                          <p className="text-xs text-slate-500">
                            {product.brand}
                          </p>
                        </div>
                      </div>
                    </td>

                    <td className="px-5 py-4">
                      <p className="text-sm font-semibold text-slate-700">
                        {product.sku}
                      </p>

                      <div className="mt-1 flex items-center gap-1 text-xs text-slate-400">
                        <Barcode size={13} />
                        {product.barcode}
                      </div>
                    </td>

                    <td className="px-5 py-4">
                      <span className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600">
                        {product.category}
                      </span>
                    </td>

                    <td className="px-5 py-4 text-right text-sm text-slate-600">
                      {money(product.cost)}
                    </td>

                    <td className="px-5 py-4 text-right">
                      <span className="text-sm font-bold text-[#0F2A3B]">
                        {money(product.price)}
                      </span>
                    </td>

                    <td className="px-5 py-4 text-center">
                      <div>
                        <span
                          className={`text-sm font-bold ${
                            product.status === "Out of Stock"
                              ? "text-red-600"
                              : product.status === "Low Stock"
                              ? "text-amber-600"
                              : "text-slate-700"
                          }`}
                        >
                          {product.stock}
                        </span>

                        <p className="mt-0.5 text-[11px] text-slate-400">
                          Reorder: {product.reorderLevel}
                        </p>
                      </div>
                    </td>

                    <td className="px-5 py-4 text-center">
                      <StatusBadge status={product.status} />
                    </td>

                    <td className="relative px-5 py-4 text-right">
                      <button
                        type="button"
                        onClick={() =>
                          setOpenMenu(
                            openMenu === product.id
                              ? null
                              : product.id
                          )
                        }
                        className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      >
                        <MoreVertical size={18} />
                      </button>

                      {openMenu === product.id && (
                        <div className="absolute right-5 top-14 z-20 w-40 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 text-left shadow-xl">
                          <button
                            type="button"
                            onClick={() => openEditModal(product)}
                            className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
                          >
                            <Edit3 size={16} />
                            Edit Product
                          </button>

                          <button
                            type="button"
                            onClick={() => deleteProduct(product.id)}
                            className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50"
                          >
                            <Trash2 size={16} />
                            Delete
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {filteredProducts.length === 0 && (
              <div className="flex min-h-[300px] flex-col items-center justify-center px-6 text-center">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                  <Package size={30} />
                </div>

                <h3 className="font-semibold text-slate-800">
                  No products found
                </h3>

                <p className="mt-1 text-sm text-slate-500">
                  Try changing your search or filters.
                </p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex flex-col gap-3 border-t border-slate-200 bg-slate-50/50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-500">
              Showing{" "}
              <span className="font-semibold text-slate-700">
                {filteredProducts.length}
              </span>{" "}
              of{" "}
              <span className="font-semibold text-slate-700">
                {products.length}
              </span>{" "}
              products
            </p>

            <div className="flex items-center gap-2">
              <span className="flex items-center gap-2 text-xs text-slate-500">
                <Boxes size={15} />
                Catalogue management
              </span>
            </div>
          </div>
        </section>
      </main>

      {/* Product Modal */}
      {showProductModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0F2A3B]/50 p-4 backdrop-blur-sm">
          <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
            {/* Modal Header */}
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-5">
              <div>
                <h2 className="text-xl font-bold text-[#0F2A3B]">
                  {editingProduct
                    ? "Edit Product"
                    : "Add New Product"}
                </h2>

                <p className="mt-1 text-sm text-slate-500">
                  {editingProduct
                    ? "Update product information and inventory."
                    : "Create a new product in your catalogue."}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setShowProductModal(false)}
                className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X size={21} />
              </button>
            </div>

            {/* Form */}
            <div className="space-y-6 p-6">
              <div>
                <h3 className="mb-4 flex items-center gap-2 text-sm font-bold text-[#0F2A3B]">
                  <Tag size={17} />
                  Product Information
                </h3>

                <div className="grid gap-4 md:grid-cols-2">
                  <FormInput
                    label="Product Name"
                    required
                    value={form.name}
                    onChange={(value) =>
                      setForm({ ...form, name: value })
                    }
                    placeholder="e.g. Premium Rice 5kg"
                  />

                  <FormInput
                    label="Brand"
                    value={form.brand}
                    onChange={(value) =>
                      setForm({ ...form, brand: value })
                    }
                    placeholder="e.g. Golden Grain"
                  />

                  <FormInput
                    label="SKU"
                    required
                    value={form.sku}
                    onChange={(value) =>
                      setForm({ ...form, sku: value })
                    }
                    placeholder="e.g. RICE-005"
                  />

                  <FormInput
                    label="Barcode"
                    value={form.barcode}
                    onChange={(value) =>
                      setForm({ ...form, barcode: value })
                    }
                    placeholder="Scan or enter barcode"
                  />

                  <div>
                    <label className="mb-2 block text-sm font-semibold text-slate-700">
                      Category <span className="text-red-500">*</span>
                    </label>

                    <input
                      list="product-categories"
                      value={form.category}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          category: event.target.value,
                        })
                      }
                      placeholder="Choose or type a new category"
                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-[#1C9A9A] focus:ring-2 focus:ring-[#1C9A9A]/10"
                    />
                    <datalist id="product-categories">
                      {categories
                        .filter((item) => item !== "All")
                        .map((item) => (
                          <option key={item} value={item} />
                        ))}
                    </datalist>
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-100 pt-6">
                <h3 className="mb-4 flex items-center gap-2 text-sm font-bold text-[#0F2A3B]">
                  <DollarSign size={17} />
                  Pricing
                </h3>

                <div className="grid gap-4 md:grid-cols-2">
                  <FormInput
                    label="Cost Price"
                    required
                    type="number"
                    value={form.cost}
                    onChange={(value) =>
                      setForm({ ...form, cost: value })
                    }
                    placeholder="0.00"
                  />

                  <FormInput
                    label="Retail Price"
                    required
                    type="number"
                    value={form.price}
                    onChange={(value) =>
                      setForm({ ...form, price: value })
                    }
                    placeholder="0.00"
                  />

                  <FormInput
                    label="Wholesale Price"
                    type="number"
                    value={form.wholesalePrice}
                    onChange={(value) =>
                      setForm({ ...form, wholesalePrice: value })
                    }
                    placeholder="Same as retail if empty"
                  />

                  {Number(form.cost) > 0 && Number(form.price) > 0 && (
                    <div className="flex items-end">
                      <p
                        className={`w-full rounded-xl px-4 py-3 text-sm font-semibold ${
                          Number(form.price) <= Number(form.cost)
                            ? "bg-red-50 text-red-700"
                            : "bg-emerald-50 text-emerald-700"
                        }`}
                      >
                        Retail margin:{" "}
                        {(((Number(form.price) - Number(form.cost)) / Number(form.price)) * 100).toFixed(1)}%
                      </p>
                    </div>
                  )}
                </div>
              </div>

              <div className="border-t border-slate-100 pt-6">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-sm font-bold text-[#0F2A3B]">
                    <Boxes size={17} />
                    Pack Sizes
                  </h3>
                  <button
                    type="button"
                    onClick={() =>
                      setForm({
                        ...form,
                        units: [...form.units, { name: "", multiplier: "", price: "", wholesalePrice: "", barcode: "" }],
                      })
                    }
                    className="text-sm font-semibold text-[#1C9A9A] hover:underline"
                  >
                    + Add pack size
                  </button>
                </div>

                <p className="mb-3 text-xs text-slate-500">
                  The base unit is the single item priced above. Packs sell several base units at their own price (e.g. 6-Pack = 6 units).
                </p>

                {form.units.length > 0 && (
                  <div className="space-y-2">
                    <div className="grid grid-cols-[1fr_90px_100px_100px_1fr_36px] gap-2 px-1 text-[11px] font-semibold uppercase text-slate-500">
                      <span>Name</span>
                      <span>Units</span>
                      <span>Price</span>
                      <span>Wholesale</span>
                      <span>Barcode</span>
                      <span />
                    </div>
                    {form.units.map((unit, index) => {
                      const change = (patch: Partial<UnitForm>) =>
                        setForm({
                          ...form,
                          units: form.units.map((item, i) => (i === index ? { ...item, ...patch } : item)),
                        });
                      const cell = "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#1C9A9A]";

                      return (
                        <div key={index} className="grid grid-cols-[1fr_90px_100px_100px_1fr_36px] items-center gap-2">
                          <input value={unit.name} onChange={(e) => change({ name: e.target.value })} placeholder="6-Pack" className={cell} />
                          <input type="number" min="2" value={unit.multiplier} onChange={(e) => change({ multiplier: e.target.value })} placeholder="6" className={cell} />
                          <input type="number" min="0" step="0.01" value={unit.price} onChange={(e) => change({ price: e.target.value })} placeholder="0.00" className={cell} />
                          <input type="number" min="0" step="0.01" value={unit.wholesalePrice} onChange={(e) => change({ wholesalePrice: e.target.value })} placeholder="—" className={cell} />
                          <input value={unit.barcode} onChange={(e) => change({ barcode: e.target.value })} placeholder="Optional" className={cell} />
                          <button
                            type="button"
                            onClick={() => setForm({ ...form, units: form.units.filter((_, i) => i !== index) })}
                            className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="border-t border-slate-100 pt-6">
                <h3 className="mb-4 flex items-center gap-2 text-sm font-bold text-[#0F2A3B]">
                  <Boxes size={17} />
                  Inventory
                </h3>

                <div className="grid gap-4 md:grid-cols-2">
                  {editingProduct ? (
                    <div>
                      <label className="mb-2 block text-sm font-semibold text-slate-700">
                        Current Stock
                      </label>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                        {editingProduct.stock} units across all warehouses
                      </div>
                      <p className="mt-1.5 text-xs text-slate-400">
                        Change quantities from Stock Management (adjustments, counts, transfers).
                      </p>
                    </div>
                  ) : (
                    <>
                      <FormInput
                        label="Opening Stock"
                        type="number"
                        value={form.stock}
                        onChange={(value) =>
                          setForm({ ...form, stock: value })
                        }
                        placeholder="0"
                      />

                      <div>
                        <label className="mb-2 block text-sm font-semibold text-slate-700">
                          Stock Warehouse
                        </label>
                        <select
                          value={form.warehouseId}
                          onChange={(event) =>
                            setForm({ ...form, warehouseId: event.target.value })
                          }
                          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-[#1C9A9A] focus:ring-2 focus:ring-[#1C9A9A]/10"
                        >
                          {warehouses.map((warehouse) => (
                            <option key={warehouse.id} value={warehouse.id}>
                              {warehouse.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </>
                  )}

                  {!editingProduct && form.trackBatches && Number(form.stock) > 0 && (
                    <>
                      <FormInput
                        label="Opening Batch Number"
                        value={form.batchNumber}
                        onChange={(value) => setForm({ ...form, batchNumber: value })}
                        placeholder="e.g. LOT-2026-10"
                      />
                      <FormInput
                        label="Expiry Date"
                        type="date"
                        value={form.expiryDate}
                        onChange={(value) => setForm({ ...form, expiryDate: value })}
                      />
                    </>
                  )}

                  <label className="flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 md:col-span-2">
                    <input
                      type="checkbox"
                      checked={form.trackBatches}
                      onChange={(event) => setForm({ ...form, trackBatches: event.target.checked })}
                      className="h-4 w-4 accent-[#1C9A9A]"
                    />
                    <span className="text-sm">
                      <span className="font-semibold text-slate-700">Track batches &amp; expiry dates</span>
                      <span className="block text-xs text-slate-500">
                        Ask for batch/expiry on goods receiving; sales use the earliest-expiring batch first (FEFO).
                      </span>
                    </span>
                  </label>

                  <FormInput
                    label="Reorder Level"
                    type="number"
                    value={form.reorderLevel}
                    onChange={(value) =>
                      setForm({
                        ...form,
                        reorderLevel: value,
                      })
                    }
                    placeholder="10"
                  />
                </div>
              </div>

              <div className="rounded-xl bg-[#F6F7F9] p-4">
                <div className="flex gap-3">
                  <div className="mt-0.5 text-[#1C9A9A]">
                    <Package size={19} />
                  </div>

                  <div>
                    <p className="text-sm font-semibold text-slate-700">
                      Inventory status
                    </p>

                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      Products automatically become Low Stock when
                      current stock reaches or falls below the
                      reorder level. A zero quantity is marked Out
                      of Stock.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4">
              <button
                type="button"
                onClick={() => setShowProductModal(false)}
                className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={saveProduct}
                disabled={saving}
                className="flex items-center gap-2 rounded-xl bg-[#1C9A9A] px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#178686] disabled:opacity-60"
              >
                <Save size={17} />
                {editingProduct ? "Save Changes" : "Create Product"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({
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

function StatusBadge({
  status,
}: {
  status: Product["status"];
}) {
  const styles = {
    Active: "bg-emerald-50 text-emerald-700",
    "Low Stock": "bg-amber-50 text-amber-700",
    "Out of Stock": "bg-red-50 text-red-700",
  };

  return (
    <span
      className={`inline-flex rounded-full px-3 py-1.5 text-xs font-semibold ${styles[status]}`}
    >
      {status}
    </span>
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
        {required && <span className="text-red-500">*</span>}
      </label>

      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-[#1C9A9A] focus:ring-2 focus:ring-[#1C9A9A]/10"
      />
    </div>
  );
}

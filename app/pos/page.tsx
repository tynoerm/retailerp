"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, errorMessage } from "../lib/api-client";
import { money } from "../lib/format";
import type { Settings } from "../lib/settings-defaults";
import { useAuth } from "../components/AuthProvider";
import UserMenu from "../components/UserMenu";
import {
  Warehouse,
  Search,
  ScanBarcode,
  ShoppingCart,
  Plus,
  Minus,
  Trash2,
  User,
  CreditCard,
  Banknote,
  Smartphone,
  Pause,
  RotateCcw,
  Receipt,
  ChevronDown,
  Package,
  Percent,
  CheckCircle2,
} from "lucide-react";

type Product = {
  id: number;
  name: string;
  sku: string;
  barcode: string;
  category: string;
  price: number;
  stock: number;
  color: string;
};

type CartItem = Product & {
  quantity: number;
};

type WarehouseOption = { id: number; name: string; status: string };

export default function POSPage() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customer, setCustomer] = useState("Walk-in Customer");
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [amountPaid, setAmountPaid] = useState("");
  const [discount, setDiscount] = useState(0);
  const [taxRate, setTaxRate] = useState(0);
  const [showCustomerMenu, setShowCustomerMenu] = useState(false);
  const [saleComplete, setSaleComplete] = useState(false);
  const [saleNumber, setSaleNumber] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<string[]>(["Walk-in Customer"]);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [warehouseId, setWarehouseId] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const categories = useMemo(
    () => ["All", ...Array.from(new Set(products.map((product) => product.category))).sort()],
    [products]
  );

  const loadProducts = useCallback(async (selectedWarehouse: number) => {
    const rows = await api<(Omit<Product, "stock"> & { available: number })[]>(
      `/api/products?warehouseId=${selectedWarehouse}`
    );
    setProducts(rows.map((row) => ({ ...row, stock: row.available })));
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [warehouseRows, customerRows, settings] = await Promise.all([
          api<WarehouseOption[]>("/api/warehouses"),
          api<{ name: string; status: string }[]>("/api/customers"),
          api<Settings>("/api/settings"),
        ]);
        const active = warehouseRows.filter((warehouse) => warehouse.status !== "Inactive");
        const firstWarehouse = active[0]?.id ?? 0;

        setWarehouses(active);
        setWarehouseId(firstWarehouse);
        setCustomers([
          "Walk-in Customer",
          ...customerRows.filter((row) => row.status !== "Inactive").map((row) => row.name),
        ]);
        setTaxRate(Number(settings.taxRate) || 0);
        if (firstWarehouse) await loadProducts(firstWarehouse);
        else setLoadError("Create a warehouse before making sales.");
      } catch (error) {
        setLoadError(errorMessage(error));
      }
    })();
  }, [loadProducts]);

  function changeWarehouse(id: number) {
    if (cart.length > 0 && !window.confirm("Changing the warehouse clears the current cart. Continue?")) return;
    setWarehouseId(id);
    setCart([]);
    loadProducts(id).catch((error) => setLoadError(errorMessage(error)));
  }

  const filteredProducts = useMemo(() => {
    return products.filter((product) => {
      const matchesSearch =
        product.name.toLowerCase().includes(search.toLowerCase()) ||
        product.sku.toLowerCase().includes(search.toLowerCase()) ||
        product.barcode.includes(search.trim());

      const matchesCategory =
        category === "All" || product.category === category;

      return matchesSearch && matchesCategory;
    });
  }, [products, search, category]);

  const subtotal = useMemo(() => {
    return cart.reduce(
      (total, item) => total + item.price * item.quantity,
      0
    );
  }, [cart]);

  const discountAmount = Math.min(
    Math.max(discount, 0),
    subtotal
  );

  const taxableAmount = Math.max(
    subtotal - discountAmount,
    0
  );

  const tax = taxableAmount * (taxRate / 100);

  const total = taxableAmount + tax;

  const paid = Number(amountPaid) || 0;

  const change = Math.max(paid - total, 0);

  function addToCart(product: Product) {
    setCart((current) => {
      const existing = current.find(
        (item) => item.id === product.id
      );

      if (existing) {
        if (existing.quantity >= product.stock) {
          alert("You have reached the available stock quantity.");
          return current;
        }

        return current.map((item) =>
          item.id === product.id
            ? {
                ...item,
                quantity: item.quantity + 1,
              }
            : item
        );
      }

      if (product.stock <= 0) {
        alert(`${product.name} is out of stock in this warehouse.`);
        return current;
      }

      return [
        ...current,
        {
          ...product,
          quantity: 1,
        },
      ];
    });
  }

  function focusScanner() {
    setSearch("");
    document.getElementById("pos-search")?.focus();
  }

  function addByCode(code: string) {
    const value = code.trim().toLowerCase();
    const product = products.find(
      (item) => item.barcode.toLowerCase() === value || item.sku.toLowerCase() === value
    );

    if (!product) return;

    addToCart(product);
    setSearch("");
  }

  function updateQuantity(id: number, amount: number) {
    setCart((current) =>
      current
        .map((item) => {
          if (item.id !== id) return item;

          const newQuantity = item.quantity + amount;

          return {
            ...item,
            quantity: Math.min(
              Math.max(newQuantity, 0),
              item.stock
            ),
          };
        })
        .filter((item) => item.quantity > 0)
    );
  }

  function removeFromCart(id: number) {
    setCart((current) =>
      current.filter((item) => item.id !== id)
    );
  }

  function clearCart() {
    setCart([]);
    setAmountPaid("");
    setDiscount(0);
  }

  async function submitSale(status: "COMPLETED" | "HELD") {
    setSubmitting(true);

    try {
      const response = await fetch("/api/pos", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          customer,
          paymentMethod,
          warehouseId,
          items: cart.map((item) => ({
            id: item.id,
            quantity: item.quantity,
          })),
          discount,
          taxRate,
          amountPaid: paid,
          status,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(
          data.message || data.error || "Failed to save sale"
        );
      }

      return data.sale as { saleNumber: string };
    } finally {
      setSubmitting(false);
    }
  }

  async function holdSale() {
    if (cart.length === 0) {
      alert("There are no items to hold.");
      return;
    }

    try {
      const sale = await submitSale("HELD");
      alert(`Sale ${sale.saleNumber} has been placed on hold.`);
      newSale();
    } catch (error) {
      alert(errorMessage(error));
    }
  }

  async function completeSale() {
    if (cart.length === 0) {
      alert("Please add products to the cart.");
      return;
    }

    if (paymentMethod === "Cash" && paid < total) {
      alert("Amount paid is less than the total amount due.");
      return;
    }

    try {
      const sale = await submitSale("COMPLETED");

      setSaleNumber(sale.saleNumber);
      setSaleComplete(true);
      await loadProducts(warehouseId);
    } catch (error) {
      alert(errorMessage(error));
    }
  }

  function newSale() {
    setSaleComplete(false);
    clearCart();
    setCustomer("Walk-in Customer");
    setPaymentMethod("Cash");
  }

  function printReceipt() {
    window.open(`/pos/receipt/${encodeURIComponent(saleNumber)}?autoprint`, "_blank", "noopener");
  }

  return (
    <div className="min-h-screen bg-[#F6F7F9] text-slate-800">
      {/* HEADER */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="flex h-20 items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#0F2A3B] text-white">
              <ShoppingCart size={22} />
            </div>

            <div>
              <h1 className="text-xl font-bold text-[#0F2A3B]">
                Point of Sale
              </h1>

              <p className="text-xs text-slate-500">
                RetailERP • Sales Terminal
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
              <Warehouse size={17} className="text-slate-400" />
              <select
                value={warehouseId}
                onChange={(e) => changeWarehouse(Number(e.target.value))}
                className="bg-transparent text-sm font-semibold text-slate-700 outline-none"
                title="Sell from warehouse"
              >
                {warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="hidden rounded-xl bg-slate-50 px-4 py-2 text-right sm:block">
              <p className="text-[11px] text-slate-400">
                Cashier
              </p>

              <p className="text-sm font-semibold">
                {user?.name}
              </p>
            </div>

            <button
              type="button"
              onClick={clearCart}
              className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
            >
              <RotateCcw size={17} />
              New Sale
            </button>

            <UserMenu />
          </div>
        </div>
      </header>

      <main className="grid min-h-[calc(100vh-80px)] grid-cols-1 xl:grid-cols-[1fr_430px]">
        {/* LEFT SIDE */}
        <section className="border-r border-slate-200 p-5">
          {loadError && (
            <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {loadError}
            </div>
          )}

          {/* SEARCH */}
          <div className="mb-5 flex flex-col gap-3 lg:flex-row">
            <div className="relative flex-1">
              <Search
                size={19}
                className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
              />

              <input
                id="pos-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addByCode(search);
                }}
                placeholder="Search name, SKU or scan barcode + Enter..."
                className="h-12 w-full rounded-xl border border-slate-200 bg-white pl-11 pr-12 text-sm outline-none transition focus:border-[#1C9A9A] focus:ring-2 focus:ring-[#1C9A9A]/10"
              />

              <button
                type="button"
                className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200"
                title="Scan barcode"
                onClick={focusScanner}
              >
                <ScanBarcode size={18} />
              </button>
            </div>

            <button
              type="button"
              onClick={focusScanner}
              className="flex h-12 items-center justify-center gap-2 rounded-xl bg-[#0F2A3B] px-5 text-sm font-semibold text-white transition hover:bg-[#173B4F]"
            >
              <ScanBarcode size={18} />
              Scan Barcode
            </button>
          </div>

          {/* CATEGORIES */}
          <div className="mb-5 flex gap-2 overflow-x-auto pb-1">
            {categories.map((item) => (
              <button
                type="button"
                key={item}
                onClick={() => setCategory(item)}
                className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition ${
                  category === item
                    ? "bg-[#0F2A3B] text-white"
                    : "bg-white text-slate-600 hover:bg-slate-100"
                }`}
              >
                {item}
              </button>
            ))}
          </div>

          {/* PRODUCT HEADER */}
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-slate-800">
                Products
              </h2>

              <p className="text-xs text-slate-500">
                {filteredProducts.length} products available
              </p>
            </div>

            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Package size={15} />
              Live inventory
            </div>
          </div>

          {/* PRODUCT GRID */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {filteredProducts.map((product) => (
              <button
                type="button"
                key={product.id}
                onClick={() => addToCart(product)}
                className="group overflow-hidden rounded-2xl border border-slate-200 bg-white text-left transition hover:-translate-y-0.5 hover:border-[#1C9A9A] hover:shadow-lg"
              >
                <div
                  className={`relative flex h-32 items-center justify-center ${product.color}`}
                >
                  <Package
                    size={48}
                    strokeWidth={1.3}
                    className="text-slate-500 transition group-hover:scale-110"
                  />

                  <span className="absolute right-2 top-2 rounded-full bg-white/80 px-2 py-1 text-[10px] font-semibold text-slate-600">
                    {product.stock} in stock
                  </span>
                </div>

                <div className="p-3">
                  <p className="mb-1 truncate text-sm font-semibold text-slate-800">
                    {product.name}
                  </p>

                  <p className="mb-3 text-[11px] text-slate-400">
                    {product.sku}
                  </p>

                  <div className="flex items-center justify-between">
                    <span className="font-bold text-[#0F2A3B]">
                      {money(product.price)}
                    </span>

                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#0F2A3B] text-white">
                      <Plus size={15} />
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>

          {filteredProducts.length === 0 && (
            <div className="flex min-h-[300px] items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white">
              <div className="text-center">
                <Package
                  size={42}
                  className="mx-auto mb-3 text-slate-300"
                />

                <h3 className="font-semibold text-slate-700">
                  No products found
                </h3>

                <p className="mt-1 text-sm text-slate-400">
                  Try another search or category.
                </p>
              </div>
            </div>
          )}
        </section>

        {/* RIGHT SIDE */}
        <aside className="flex flex-col bg-white">
          {/* CART HEADER */}
          <div className="border-b border-slate-200 p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-[#0F2A3B]">
                  Current Sale
                </h2>

                <p className="text-xs text-slate-400">
                  {cart.length} item
                  {cart.length !== 1 ? "s" : ""}
                </p>
              </div>

              <button
                type="button"
                onClick={clearCart}
                className="text-xs font-medium text-red-500 hover:text-red-600"
              >
                Clear cart
              </button>
            </div>

            {/* CUSTOMER */}
            <div className="relative">
              <button
                type="button"
                onClick={() =>
                  setShowCustomerMenu(!showCustomerMenu)
                }
                className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-left"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white">
                    <User
                      size={17}
                      className="text-slate-500"
                    />
                  </div>

                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-slate-400">
                      Customer
                    </p>

                    <p className="text-sm font-semibold">
                      {customer}
                    </p>
                  </div>
                </div>

                <ChevronDown
                  size={17}
                  className="text-slate-400"
                />
              </button>

              {showCustomerMenu && (
                <div className="absolute left-0 right-0 top-full z-20 mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
                  {customers.map((name) => (
                    <button
                      type="button"
                      key={name}
                      onClick={() => {
                        setCustomer(name);
                        setShowCustomerMenu(false);
                      }}
                      className="w-full px-4 py-3 text-left text-sm hover:bg-slate-50"
                    >
                      {name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* CART ITEMS */}
          <div className="flex-1 overflow-y-auto p-5">
            {cart.length === 0 ? (
              <div className="flex min-h-[280px] items-center justify-center">
                <div className="text-center">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-100">
                    <ShoppingCart
                      size={28}
                      className="text-slate-400"
                    />
                  </div>

                  <h3 className="font-semibold text-slate-700">
                    Your cart is empty
                  </h3>

                  <p className="mt-1 text-xs text-slate-400">
                    Select products to start a sale.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {cart.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-xl border border-slate-100 bg-slate-50 p-3"
                  >
                    <div className="flex gap-3">
                      <div
                        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg ${item.color}`}
                      >
                        <Package
                          size={22}
                          className="text-slate-500"
                        />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="truncate text-sm font-semibold">
                              {item.name}
                            </p>

                            <p className="text-[10px] text-slate-400">
                              {money(item.price)} each
                            </p>
                          </div>

                          <button
                            type="button"
                            onClick={() =>
                              removeFromCart(item.id)
                            }
                            className="text-slate-400 hover:text-red-500"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>

                        <div className="mt-3 flex items-center justify-between">
                          <div className="flex items-center rounded-lg border border-slate-200 bg-white">
                            <button
                              type="button"
                              onClick={() =>
                                updateQuantity(item.id, -1)
                              }
                              className="flex h-8 w-8 items-center justify-center hover:bg-slate-100"
                            >
                              <Minus size={14} />
                            </button>

                            <span className="w-8 text-center text-sm font-semibold">
                              {item.quantity}
                            </span>

                            <button
                              type="button"
                              onClick={() =>
                                updateQuantity(item.id, 1)
                              }
                              className="flex h-8 w-8 items-center justify-center hover:bg-slate-100"
                            >
                              <Plus size={14} />
                            </button>
                          </div>

                          <span className="font-bold text-[#0F2A3B]">
                            {money(
                              item.price * item.quantity
                            )}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* TOTALS */}
          <div className="border-t border-slate-200 p-5">
            <div className="space-y-3 text-sm">
              <div className="flex justify-between text-slate-500">
                <span>Subtotal</span>

                <span className="font-medium text-slate-700">
                  {money(subtotal)}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-slate-500">
                  <Percent size={14} />
                  Discount
                </div>

                <div className="flex items-center">
                  <span className="mr-1 text-slate-400">
                    $
                  </span>

                  <input
                    type="number"
                    min="0"
                    value={discount || ""}
                    onChange={(e) =>
                      setDiscount(
                        Math.max(
                          0,
                          Number(e.target.value) || 0
                        )
                      )
                    }
                    className="w-20 rounded-lg border border-slate-200 px-2 py-1.5 text-right text-sm outline-none focus:border-[#1C9A9A]"
                    placeholder="0.00"
                  />
                </div>
              </div>

              <div className="flex justify-between text-slate-500">
                <span>Tax ({taxRate}%)</span>

                <span>{money(tax)}</span>
              </div>

              <div className="my-2 border-t border-dashed border-slate-200" />

              <div className="flex items-center justify-between">
                <span className="text-base font-bold text-slate-800">
                  Total
                </span>

                <span className="text-2xl font-bold text-[#0F2A3B]">
                  {money(total)}
                </span>
              </div>
            </div>

            {/* PAYMENT */}
            <div className="mt-5">
              <p className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">
                Payment Method
              </p>

              <div className="grid grid-cols-3 gap-2">
                {[
                  {
                    name: "Cash",
                    icon: Banknote,
                  },
                  {
                    name: "Card",
                    icon: CreditCard,
                  },
                  {
                    name: "Mobile",
                    icon: Smartphone,
                  },
                ].map(({ name, icon: Icon }) => (
                  <button
                    type="button"
                    key={name}
                    onClick={() =>
                      setPaymentMethod(name)
                    }
                    className={`flex flex-col items-center justify-center gap-1 rounded-xl border py-3 text-xs font-semibold transition ${
                      paymentMethod === name
                        ? "border-[#0F2A3B] bg-[#0F2A3B] text-white"
                        : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                    }`}
                  >
                    <Icon size={18} />
                    {name}
                  </button>
                ))}
              </div>
            </div>

            {/* CASH */}
            {paymentMethod === "Cash" && (
              <div className="mt-4">
                <label className="mb-2 block text-xs font-medium text-slate-500">
                  Amount Tendered
                </label>

                <div className="relative">
                  <Banknote
                    size={17}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                  />

                  <input
                    type="number"
                    min="0"
                    value={amountPaid}
                    onChange={(e) =>
                      setAmountPaid(e.target.value)
                    }
                    placeholder="0.00"
                    className="h-11 w-full rounded-xl border border-slate-200 pl-10 pr-4 text-sm font-semibold outline-none focus:border-[#1C9A9A] focus:ring-2 focus:ring-[#1C9A9A]/10"
                  />
                </div>

                <div className="mt-2 flex justify-between rounded-lg bg-emerald-50 px-3 py-2 text-sm">
                  <span className="text-emerald-700">
                    Change
                  </span>

                  <span className="font-bold text-emerald-700">
                    {money(change)}
                  </span>
                </div>
              </div>
            )}

            {/* ACTION BUTTONS */}
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={holdSale}
                disabled={cart.length === 0 || submitting}
                className="flex h-12 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Pause size={17} />
                Hold Sale
              </button>

              <button
                type="button"
                onClick={completeSale}
                disabled={cart.length === 0 || submitting}
                className="flex h-12 items-center justify-center gap-2 rounded-xl bg-[#0F2A3B] text-sm font-bold text-white transition hover:bg-[#173B4F] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Receipt size={18} />
                Complete Sale
              </button>
            </div>
          </div>
        </aside>
      </main>

      {/* SALE COMPLETE MODAL */}
      {saleComplete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl bg-white p-7 shadow-2xl">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
              <CheckCircle2
                size={34}
                className="text-emerald-600"
              />
            </div>

            <div className="text-center">
              <h2 className="text-2xl font-bold text-[#0F2A3B]">
                Sale Completed
              </h2>

              <p className="mt-2 text-sm text-slate-500">
                Transaction has been successfully recorded.
              </p>
            </div>

            <div className="mt-6 rounded-2xl bg-slate-50 p-4">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">
                  Customer
                </span>

                <span className="font-semibold">
                  {customer}
                </span>
              </div>

              <div className="mt-3 flex justify-between text-sm">
                <span className="text-slate-500">
                  Payment
                </span>

                <span className="font-semibold">
                  {paymentMethod}
                </span>
              </div>

              <div className="mt-3 flex justify-between border-t border-slate-200 pt-3">
                <span className="font-semibold">
                  Total
                </span>

                <span className="text-xl font-bold text-[#0F2A3B]">
                  {money(total)}
                </span>
              </div>

              {paymentMethod === "Cash" && (
                <div className="mt-3 flex justify-between text-sm">
                  <span className="text-slate-500">
                    Change
                  </span>

                  <span className="font-bold text-emerald-600">
                    {money(change)}
                  </span>
                </div>
              )}
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={printReceipt}
                className="flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50"
              >
                <Receipt size={17} />
                Print Receipt
              </button>

              <button
                type="button"
                onClick={newSale}
                className="flex h-11 items-center justify-center gap-2 rounded-xl bg-[#0F2A3B] text-sm font-semibold text-white hover:bg-[#173B4F]"
              >
                <Plus size={17} />
                New Sale
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

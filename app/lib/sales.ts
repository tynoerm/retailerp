import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { ApiError } from "./crud";
import { getSettings } from "./settings";
import { activeCurrencies, PAYMENT_METHODS, type Settings } from "./settings-defaults";
import { currentUserName } from "./auth";
import { assignNumber, changeStock, tempNumber, withTransaction } from "./stock";

export type SaleType = "COMPLETED" | "HELD" | "QUOTE" | "LAYBY";
export type PriceTier = "Retail" | "Wholesale";

type ItemInput = { productId?: unknown; unitId?: unknown; quantity?: unknown };
type PaymentInput = { method?: unknown; currency?: unknown; amount?: unknown; reference?: unknown };

export type SaleInput = {
  type?: unknown;
  customerId?: unknown;
  customer?: unknown;
  warehouseId?: unknown;
  currency?: unknown;
  priceTier?: unknown;
  discount?: unknown;
  items?: unknown;
  payments?: unknown;
  resumeId?: unknown;
  notes?: unknown;
};

type Payment = { method: string; currency: string; rate: number; tendered: number; amount: number; reference: string | null };

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const PREFIX: Record<SaleType, string> = { COMPLETED: "SALE", LAYBY: "SALE", QUOTE: "QT", HELD: "HOLD" };

function rateFor(settings: Settings, code: string) {
  const currency = activeCurrencies(settings).find((c) => c.code === code);
  if (!currency) throw new ApiError(`Currency ${code} is not enabled. Set its exchange rate in Settings.`);
  return currency.rate;
}

function parsePayments(settings: Settings, input: unknown): Payment[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw new ApiError("Payments must be a list");

  return (input as PaymentInput[])
    .filter((payment) => Number(payment.amount) !== 0)
    .map((payment) => {
      const method = String(payment.method ?? "");
      const currency = String(payment.currency ?? settings.currency).toUpperCase();
      const tendered = round2(Number(payment.amount));

      if (!(PAYMENT_METHODS as readonly string[]).includes(method)) throw new ApiError(`Unknown payment method "${method}"`);
      if (!(tendered > 0)) throw new ApiError("Payment amounts must be greater than zero");

      const rate = rateFor(settings, currency);
      return {
        method,
        currency,
        rate,
        tendered,
        amount: round2(tendered / rate),
        reference: String(payment.reference ?? "").trim() || null,
      };
    });
}

function settleChange(payments: Payment[], total: number, alreadyPaid = 0) {
  const paid = round2(alreadyPaid + payments.reduce((sum, p) => sum + p.amount, 0));
  const change = round2(Math.max(paid - total, 0));

  if (change > 0) {
    const cash = [...payments].reverse().find((p) => p.method === "Cash");
    if (!cash) throw new ApiError("Only cash can be over-tendered. Reduce the non-cash payment to the amount due.");
    if (cash.amount < change) throw new ApiError("Change due is more than the cash tendered");
    cash.amount = round2(cash.amount - change);
  }

  return { paid: round2(paid - change), change };
}

async function insertPayments(connection: PoolConnection, saleId: number, payments: Payment[]) {
  if (payments.length === 0) return;
  await connection.query(
    "INSERT INTO sale_payments (sale_id, method, currency, exchange_rate, amount_tendered, amount, reference) VALUES ?",
    [payments.map((p) => [saleId, p.method, p.currency, p.rate, p.tendered, p.amount, p.reference])]
  );
}

async function loadLines(connection: PoolConnection, items: ItemInput[], tier: PriceTier) {
  const productIds = [...new Set(items.map((item) => Number(item.productId)))];
  const unitIds = [...new Set(items.map((item) => Number(item.unitId)).filter(Boolean))];

  const [products] = await connection.query<RowDataPacket[]>(
    "SELECT id, name, sku, price, wholesale_price, cost FROM products WHERE id IN (?)",
    [productIds]
  );
  const [units] = unitIds.length
    ? await connection.query<RowDataPacket[]>("SELECT * FROM product_units WHERE id IN (?)", [unitIds])
    : [[] as RowDataPacket[]];

  return items.map((item) => {
    const product = products.find((p) => p.id === Number(item.productId));
    const quantity = Number(item.quantity);

    if (!product) throw new ApiError("One of the products no longer exists");
    if (!Number.isInteger(quantity) || quantity <= 0) throw new ApiError(`Invalid quantity for ${product.name}`);

    const unit = item.unitId ? units.find((u) => u.id === Number(item.unitId) && u.product_id === product.id) : null;
    if (item.unitId && !unit) throw new ApiError(`Pack size not found for ${product.name}`);

    const retail = Number(unit ? unit.price : product.price);
    const wholesale = Number((unit ? unit.wholesale_price : product.wholesale_price) ?? retail);
    const unitPrice = tier === "Wholesale" ? wholesale : retail;
    const multiplier = unit ? Number(unit.multiplier) : 1;

    return {
      productId: product.id as number,
      name: unit ? `${product.name} (${unit.name})` : (product.name as string),
      sku: product.sku as string,
      unitName: unit ? (unit.name as string) : "Each",
      multiplier,
      quantity,
      baseQuantity: quantity * multiplier,
      unitPrice,
      unitCost: round2(Number(product.cost) * multiplier),
      lineTotal: round2(unitPrice * quantity),
    };
  });
}

type Line = Awaited<ReturnType<typeof loadLines>>[number];

function baseQuantities(lines: { productId: number; baseQuantity: number }[]) {
  const totals = new Map<number, number>();
  for (const line of lines) totals.set(line.productId, (totals.get(line.productId) ?? 0) + line.baseQuantity);
  return totals;
}

async function reserveStock(connection: PoolConnection, warehouseId: number, lines: Line[], allowNegative: boolean) {
  for (const [productId, need] of baseQuantities(lines)) {
    const [[row]] = await connection.query<RowDataPacket[]>(
      `SELECT s.id, s.quantity, s.reserved, p.name FROM products p
       LEFT JOIN stock_levels s ON s.product_id = p.id AND s.warehouse_id = ?
       WHERE p.id = ? FOR UPDATE`,
      [warehouseId, productId]
    );
    const available = row.id ? row.quantity - row.reserved : 0;

    if (available < need && !allowNegative) {
      throw new ApiError(`Insufficient stock to reserve: ${row.name} has ${Math.max(available, 0)} available`, 409);
    }

    await connection.query(
      `INSERT INTO stock_levels (product_id, warehouse_id, quantity, reserved) VALUES (?, ?, 0, ?)
       ON DUPLICATE KEY UPDATE reserved = reserved + VALUES(reserved)`,
      [productId, warehouseId, need]
    );
  }
}

async function releaseReservation(connection: PoolConnection, saleId: number, warehouseId: number) {
  const [items] = await connection.query<RowDataPacket[]>(
    "SELECT product_id AS productId, quantity * unit_multiplier AS baseQuantity FROM sale_items WHERE sale_id = ?",
    [saleId]
  );

  for (const [productId, quantity] of baseQuantities(items as { productId: number; baseQuantity: number }[])) {
    await connection.query(
      "UPDATE stock_levels SET reserved = GREATEST(reserved - ?, 0) WHERE product_id = ? AND warehouse_id = ?",
      [quantity, productId, warehouseId]
    );
  }

  return items as { productId: number; baseQuantity: number }[];
}

async function deductStock(
  connection: PoolConnection,
  warehouseId: number,
  saleNumber: string,
  lines: { productId: number; baseQuantity: number }[],
  allowNegative: boolean
) {
  for (const [productId, quantity] of baseQuantities(lines)) {
    await changeStock(connection, {
      productId,
      warehouseId,
      delta: -quantity,
      type: "Sale",
      reference: saleNumber,
      allowNegative,
    });
  }
}

async function lockSale(connection: PoolConnection, id: number) {
  const [[sale]] = await connection.query<RowDataPacket[]>("SELECT * FROM sales WHERE id = ? FOR UPDATE", [id]);
  if (!sale) throw new ApiError("Sale not found", 404);
  return sale;
}

export async function createSale(input: SaleInput) {
  const settings = await getSettings();
  const type = String(input.type ?? "COMPLETED") as SaleType;

  if (!(type in PREFIX)) throw new ApiError("Sale type must be COMPLETED, HELD, QUOTE or LAYBY");

  const items = Array.isArray(input.items) ? (input.items as ItemInput[]) : [];
  if (items.length === 0) throw new ApiError("The sale must contain at least one product");

  const currency = String(input.currency ?? settings.currency).toUpperCase();
  const exchangeRate = rateFor(settings, currency);
  const warehouseId = Number(input.warehouseId) || null;
  const customerId = Number(input.customerId) || null;

  if ((type === "COMPLETED" || type === "LAYBY") && !warehouseId) {
    throw new ApiError("Select the warehouse the sale is fulfilled from");
  }

  return withTransaction(async (connection) => {
    let customerName = String(input.customer ?? "").trim() || "Walk-in Customer";
    let tier: PriceTier = input.priceTier === "Wholesale" ? "Wholesale" : "Retail";

    if (customerId) {
      const [[customer]] = await connection.query<RowDataPacket[]>(
        "SELECT name, status, price_tier FROM customers WHERE id = ?",
        [customerId]
      );
      if (!customer) throw new ApiError("Customer not found", 404);
      customerName = customer.name;
      if (input.priceTier === undefined) tier = customer.price_tier;
    }

    if (type === "LAYBY" && !customerId) throw new ApiError("Lay-by sales must be linked to a registered customer");

    const lines = await loadLines(connection, items, tier);
    const subtotal = round2(lines.reduce((sum, line) => sum + line.lineTotal, 0));
    const discount = round2(Math.min(Math.max(Number(input.discount) || 0, 0), subtotal));
    const taxRate = Math.max(Number(settings.taxRate) || 0, 0);
    const tax = round2((subtotal - discount) * (taxRate / 100));
    const total = round2(subtotal - discount + tax);

    const payments = type === "HELD" || type === "QUOTE" ? [] : parsePayments(settings, input.payments);
    let paid = 0;
    let change = 0;

    if (type === "COMPLETED") {
      const tendered = round2(payments.reduce((sum, p) => sum + p.amount, 0));
      if (tendered < total - 0.009) throw new ApiError(`Payment is short by ${round2(total - tendered).toFixed(2)} ${settings.currency}`);
      ({ paid, change } = settleChange(payments, total));
    }

    if (type === "LAYBY") {
      paid = round2(payments.reduce((sum, p) => sum + p.amount, 0));
      const minimum = round2(total * (Number(settings.laybyMinDepositPercent) || 0) / 100);
      if (paid >= total - 0.009) throw new ApiError("The deposit covers the full amount — complete the sale instead");
      if (paid <= 0 || paid < minimum - 0.009) throw new ApiError(`Lay-by deposit must be at least ${minimum.toFixed(2)} ${settings.currency}`);
    }

    const [result] = await connection.query<ResultSetHeader>(
      `INSERT INTO sales (sale_number, customer, customer_id, payment_method, warehouse_id, currency, exchange_rate, price_tier,
                          subtotal, discount, tax_rate, tax, total, amount_paid, change_amount, status, notes, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tempNumber(),
        customerName,
        customerId,
        payments.length > 1 ? "Split" : (payments[0]?.method ?? "—"),
        warehouseId,
        currency,
        exchangeRate,
        tier,
        subtotal,
        discount,
        taxRate,
        tax,
        total,
        paid,
        change,
        type,
        String(input.notes ?? "").trim().slice(0, 255) || null,
        type === "COMPLETED" ? new Date() : null,
      ]
    );
    const saleId = result.insertId;

    await assignNumber(connection, "sales", "sale_number", PREFIX[type], saleId, 6);
    const [[{ sale_number: saleNumber }]] = await connection.query<RowDataPacket[]>(
      "SELECT sale_number FROM sales WHERE id = ?",
      [saleId]
    );

    await connection.query(
      `INSERT INTO sale_items (sale_id, product_id, product_name, sku, quantity, unit_price, line_total, unit_name, unit_multiplier, unit_cost)
       VALUES ?`,
      [lines.map((l) => [saleId, l.productId, l.name, l.sku, l.quantity, l.unitPrice, l.lineTotal, l.unitName, l.multiplier, l.unitCost])]
    );
    await insertPayments(connection, saleId, payments);

    if (type === "COMPLETED") await deductStock(connection, warehouseId!, saleNumber, lines, settings.allowNegativeStock);
    if (type === "LAYBY") await reserveStock(connection, warehouseId!, lines, settings.allowNegativeStock);

    const resumeId = Number(input.resumeId) || null;
    if (resumeId) {
      const original = await lockSale(connection, resumeId);
      if (!["HELD", "QUOTE"].includes(original.status)) throw new ApiError("Only held sales and quotations can be resumed", 409);

      if (original.status === "QUOTE" && (type === "COMPLETED" || type === "LAYBY")) {
        await connection.query("UPDATE sales SET status = 'CONVERTED', converted_sale_id = ? WHERE id = ?", [saleId, resumeId]);
      } else {
        await connection.query("DELETE FROM sales WHERE id = ?", [resumeId]);
      }
    }

    return { id: saleId, saleNumber, status: type, customer: customerName, currency, exchangeRate, subtotal, discount, tax, total, paid, change, balance: round2(total - paid) };
  });
}

export async function addLaybyPayment(id: number, paymentsInput: unknown) {
  const settings = await getSettings();
  const payments = parsePayments(settings, paymentsInput);
  if (payments.length === 0) throw new ApiError("Enter a payment amount");

  return withTransaction(async (connection) => {
    const sale = await lockSale(connection, id);
    if (sale.status !== "LAYBY") throw new ApiError("Payments can only be added to open lay-bys", 409);

    const { paid, change } = settleChange(payments, Number(sale.total), Number(sale.amount_paid));
    await insertPayments(connection, id, payments);

    if (paid >= Number(sale.total) - 0.009) {
      const items = await releaseReservation(connection, id, sale.warehouse_id);
      await deductStock(connection, sale.warehouse_id, sale.sale_number, items, true);
      await connection.query(
        "UPDATE sales SET amount_paid = ?, change_amount = ?, status = 'COMPLETED', completed_at = NOW() WHERE id = ?",
        [paid, change, id]
      );
      return { completed: true, paid, change, balance: 0 };
    }

    await connection.query("UPDATE sales SET amount_paid = ? WHERE id = ?", [paid, id]);
    return { completed: false, paid, change: 0, balance: round2(Number(sale.total) - paid) };
  });
}

export async function cancelSale(id: number, refundMethod = "Cash") {
  return withTransaction(async (connection) => {
    const sale = await lockSale(connection, id);

    if (sale.status === "HELD" || sale.status === "QUOTE") {
      await connection.query("DELETE FROM sales WHERE id = ?", [id]);
      return { deleted: true, refunded: 0 };
    }

    if (sale.status !== "LAYBY") throw new ApiError("Only held sales, quotations and open lay-bys can be cancelled", 409);

    await releaseReservation(connection, id, sale.warehouse_id);
    await connection.query(
      "UPDATE sales SET status = 'CANCELLED', refunded_total = amount_paid, notes = CONCAT_WS(' • ', notes, ?) WHERE id = ?",
      [`Lay-by cancelled, ${Number(sale.amount_paid).toFixed(2)} refunded by ${refundMethod}`, id]
    );
    return { deleted: false, refunded: Number(sale.amount_paid) };
  });
}

type ReturnInput = { saleItemId?: unknown; quantity?: unknown };

export async function returnSale(
  id: number,
  { items, refundMethod, reason, restock = true, warehouseId }: { items?: unknown; refundMethod?: unknown; reason?: unknown; restock?: unknown; warehouseId?: unknown }
) {
  const method = String(refundMethod ?? "Cash");
  const why = String(reason ?? "").trim();
  const requested = (Array.isArray(items) ? (items as ReturnInput[]) : []).filter((item) => Number(item.quantity) > 0);

  if (!(PAYMENT_METHODS as readonly string[]).includes(method)) throw new ApiError(`Unknown refund method "${method}"`);
  if (!why) throw new ApiError("Enter a reason for the return");
  if (requested.length === 0) throw new ApiError("Select at least one item to return");

  return withTransaction(async (connection) => {
    const sale = await lockSale(connection, id);
    if (sale.status !== "COMPLETED") throw new ApiError("Only completed sales can be returned", 409);

    const returnWarehouse = Number(warehouseId) || sale.warehouse_id;
    if (!returnWarehouse) throw new ApiError("Select the warehouse to return the stock to");

    const [saleItems] = await connection.query<RowDataPacket[]>("SELECT * FROM sale_items WHERE sale_id = ? FOR UPDATE", [id]);
    const discountFactor = Number(sale.subtotal) > 0 ? 1 - Number(sale.discount) / Number(sale.subtotal) : 1;
    const taxFactor = 1 + Number(sale.tax_rate) / 100;

    const lines = requested.map((request) => {
      const item = saleItems.find((row) => row.id === Number(request.saleItemId));
      const quantity = Number(request.quantity);
      if (!item) throw new ApiError("Item does not belong to this sale");

      const remaining = item.quantity - item.returned_quantity;
      if (!Number.isInteger(quantity) || quantity > remaining) {
        throw new ApiError(`${item.product_name}: only ${remaining} can still be returned`, 409);
      }

      const amount = round2((Number(item.line_total) / item.quantity) * quantity * discountFactor * taxFactor);
      return { item, quantity, amount };
    });

    const refund = round2(lines.reduce((sum, line) => sum + line.amount, 0));
    const [result] = await connection.query<ResultSetHeader>(
      `INSERT INTO sale_returns (return_number, sale_id, warehouse_id, reason, refund_method, refund_amount, user_name)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [tempNumber(), id, returnWarehouse, why.slice(0, 255), method, refund, currentUserName()]
    );
    await assignNumber(connection, "sale_returns", "return_number", "RET", result.insertId, 5);
    const [[{ return_number: returnNumber }]] = await connection.query<RowDataPacket[]>(
      "SELECT return_number FROM sale_returns WHERE id = ?",
      [result.insertId]
    );

    for (const { item, quantity, amount } of lines) {
      await connection.query(
        "INSERT INTO sale_return_items (return_id, sale_item_id, quantity, amount, restocked) VALUES (?, ?, ?, ?, ?)",
        [result.insertId, item.id, quantity, amount, restock ? 1 : 0]
      );
      await connection.query("UPDATE sale_items SET returned_quantity = returned_quantity + ? WHERE id = ?", [quantity, item.id]);

      if (restock && item.product_id) {
        await changeStock(connection, {
          productId: item.product_id,
          warehouseId: returnWarehouse,
          delta: quantity * item.unit_multiplier,
          type: "Return",
          reference: returnNumber,
          notes: why.slice(0, 200),
        });
      }
    }

    await connection.query("UPDATE sales SET refunded_total = refunded_total + ? WHERE id = ?", [refund, id]);
    return { returnNumber, refund };
  });
}

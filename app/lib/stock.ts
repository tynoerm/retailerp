import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import db from "./db";
import { ApiError } from "./crud";
import { currentUserName } from "./auth";
import { applyLocationDelta, createPutawayTasks, type BinQuantity } from "./locations";
import { applySerials, SERIAL_OUT_STATUS } from "./serials";

export type StockStatus = "In Stock" | "Low Stock" | "Out of Stock";

export const stockStatus = (quantity: number, reorderLevel: number): StockStatus =>
  quantity <= 0 ? "Out of Stock" : quantity <= reorderLevel ? "Low Stock" : "In Stock";

export async function withTransaction<T>(fn: (connection: PoolConnection) => Promise<T>) {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();
    const result = await fn(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await safeRollback(connection);
    throw error;
  } finally {
    safeRelease(connection);
  }
}

const destroyed = new WeakSet<PoolConnection>();

export async function safeRollback(connection: PoolConnection) {
  try {
    await connection.rollback();
  } catch {
    destroyed.add(connection);
    connection.destroy();
  }
}

export function safeRelease(connection: PoolConnection) {
  if (!destroyed.has(connection)) connection.release();
}

export async function assignNumber(
  connection: PoolConnection,
  table: string,
  column: string,
  prefix: string,
  id: number,
  pad = 4
) {
  await connection.query(`UPDATE ${table} SET ${column} = CONCAT(?, '-', LPAD(id, ?, '0')) WHERE id = ?`, [prefix, pad, id]);
}

export const tempNumber = () => `TMP-${crypto.randomUUID()}`;

export async function changeStock(
  connection: PoolConnection,
  {
    productId,
    warehouseId,
    delta,
    type,
    reference,
    notes,
    allowNegative = false,
    batches,
    skipBatches = false,
    locationId,
    serials,
    serialStatus,
    autoPutaway = true,
  }: {
    productId: number;
    warehouseId: number;
    delta: number;
    type: string;
    reference?: string | null;
    notes?: string | null;
    allowNegative?: boolean;
    /** Inbound: batch split of the receipt. Outbound: the exact batches to take (otherwise FEFO). */
    batches?: BatchQuantity[];
    skipBatches?: boolean;
    /** Bin the stock enters or leaves. Inbound defaults to RECEIVING; outbound defaults to pick order across bins. */
    locationId?: number | null;
    /** Serial numbers for serial-tracked products (outbound without serials takes the oldest in stock). */
    serials?: string[];
    serialStatus?: string;
    /** Inbound into RECEIVING creates directed put-away tasks unless disabled (e.g. receiving handles cross-dock first). */
    autoPutaway?: boolean;
  }
): Promise<{ quantity: number; allocations: BatchQuantity[]; bins: BinQuantity[]; serials: string[] }> {
  if (!Number.isInteger(delta) || delta === 0) throw new ApiError("Quantity must be a whole number other than zero");

  await connection.query(
    "INSERT INTO stock_levels (product_id, warehouse_id, quantity) VALUES (?, ?, 0) ON DUPLICATE KEY UPDATE id = id",
    [productId, warehouseId]
  );

  const [[row]] = await connection.query<RowDataPacket[]>(
    `SELECT s.id, s.quantity, p.name AS product, p.track_serials AS trackSerials, w.name AS warehouse
     FROM stock_levels s
     JOIN products p ON p.id = s.product_id
     JOIN warehouses w ON w.id = s.warehouse_id
     WHERE s.product_id = ? AND s.warehouse_id = ?
     FOR UPDATE`,
    [productId, warehouseId]
  );

  const next = row.quantity + delta;

  if (next < 0 && !allowNegative) {
    throw new ApiError(`Insufficient stock: ${row.product} has ${row.quantity} units in ${row.warehouse}`, 409);
  }

  await connection.query("UPDATE stock_levels SET quantity = ? WHERE id = ?", [next, row.id]);

  const allocations = skipBatches
    ? (batches ?? [])
    : delta > 0
      ? await addToBatches(connection, productId, warehouseId, delta, batches ?? [])
      : batches?.some((batch) => batch.number)
        ? await consumeSpecificBatches(connection, productId, warehouseId, batches)
        : await consumeBatches(connection, productId, warehouseId, -delta);

  // Bins only hold physical stock: an inbound that merely repays a negative balance is not placed in a bin.
  const binDelta = delta > 0 ? Math.min(delta, Math.max(next, 0)) : delta;
  const bins = binDelta === 0
    ? []
    : await applyLocationDelta(connection, { warehouseId, productId, delta: binDelta, allocations, locationId });

  const serialList = row.trackSerials
    ? await applySerials(connection, {
        productId,
        warehouseId,
        delta,
        serials,
        locationId: bins[0]?.locationId,
        batch: allocations[0]?.number,
        status: serialStatus ?? SERIAL_OUT_STATUS[type] ?? "Removed",
        reference,
      })
    : [];

  if (delta > 0 && !locationId && autoPutaway && bins.length) {
    await createPutawayTasks(connection, {
      warehouseId,
      productId,
      fromLocationId: bins[0].locationId,
      entries: bins.map((bin) => ({ batch: bin.batch, quantity: bin.quantity })),
      reference,
    });
  }

  const batchNote = allocations.length
    ? `Batch ${allocations.map((a) => `${a.number}×${a.quantity}`).join(", ")}`
    : null;
  const serialNote = serialList.length ? `S/N ${serialList.join(", ")}` : null;
  const binIds = [...new Set(bins.map((bin) => bin.locationId))];

  const [result] = await connection.query<ResultSetHeader>(
    `INSERT INTO stock_movements (movement_number, product_id, warehouse_id, type, quantity, reference, user_name, notes, location_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      tempNumber(),
      productId,
      warehouseId,
      type,
      delta,
      reference ?? null,
      currentUserName(),
      [notes, batchNote, serialNote].filter(Boolean).join(" • ").slice(0, 255) || null,
      binIds.length === 1 ? binIds[0] : (locationId ?? null),
    ]
  );

  await connection.query(
    `UPDATE stock_movements
     SET movement_number = CONCAT('MOV-', LPAD(id, 5, '0')),
         reference = COALESCE(reference, CONCAT('MOV-', LPAD(id, 5, '0')))
     WHERE id = ?`,
    [result.insertId]
  );

  return { quantity: next, allocations, bins, serials: serialList };
}

async function consumeSpecificBatches(connection: PoolConnection, productId: number, warehouseId: number, batches: BatchQuantity[]) {
  const tagged = batches.filter((batch) => batch.number && batch.quantity > 0);

  for (const batch of tagged) {
    const [result] = await connection.query<ResultSetHeader>(
      `UPDATE product_batches SET quantity = quantity - ?
       WHERE product_id = ? AND warehouse_id = ? AND batch_number = ? AND quantity >= ?`,
      [batch.quantity, productId, warehouseId, batch.number, batch.quantity]
    );
    if (result.affectedRows === 0) throw new ApiError(`Batch ${batch.number} does not have ${batch.quantity} units in this warehouse`, 409);
  }

  return tagged;
}

export type BatchQuantity = { number: string; expiry: string | null; quantity: number };

async function addToBatches(
  connection: PoolConnection,
  productId: number,
  warehouseId: number,
  delta: number,
  batches: BatchQuantity[]
) {
  const tagged = batches.filter((batch) => batch.number && batch.quantity > 0);
  const total = tagged.reduce((sum, batch) => sum + batch.quantity, 0);

  if (total > delta) throw new ApiError("Batch quantities cannot exceed the quantity received");

  for (const batch of tagged) {
    if (batch.expiry && Number.isNaN(Date.parse(batch.expiry))) throw new ApiError(`Invalid expiry date for batch ${batch.number}`);

    await connection.query(
      `INSERT INTO product_batches (product_id, warehouse_id, batch_number, expiry_date, quantity)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity), expiry_date = COALESCE(VALUES(expiry_date), expiry_date)`,
      [productId, warehouseId, batch.number.slice(0, 50), batch.expiry || null, batch.quantity]
    );
  }

  return tagged;
}

async function consumeBatches(connection: PoolConnection, productId: number, warehouseId: number, quantity: number) {
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT id, batch_number, DATE_FORMAT(expiry_date, '%Y-%m-%d') AS expiry, quantity
     FROM product_batches
     WHERE product_id = ? AND warehouse_id = ? AND quantity > 0
     ORDER BY expiry_date IS NULL, expiry_date, id
     FOR UPDATE`,
    [productId, warehouseId]
  );

  const allocations: BatchQuantity[] = [];
  let remaining = quantity;

  for (const row of rows) {
    if (remaining <= 0) break;
    const take = Math.min(row.quantity, remaining);
    await connection.query("UPDATE product_batches SET quantity = quantity - ? WHERE id = ?", [take, row.id]);
    allocations.push({ number: row.batch_number, expiry: row.expiry, quantity: take });
    remaining -= take;
  }

  return allocations;
}

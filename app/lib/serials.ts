import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { ApiError } from "./crud";

export const SERIAL_OUT_STATUS: Record<string, string> = {
  Sale: "Sold",
  Dispatch: "Dispatched",
  Transfer: "In Transit",
};

/** Trimmed, de-duplicated serial list from user input (array or newline/comma separated text). */
export function parseSerials(input: unknown): string[] | undefined {
  if (input === undefined || input === null || input === "") return undefined;
  const list = (Array.isArray(input) ? input : String(input).split(/[\n,]+/)).map((s) => String(s).trim()).filter(Boolean);
  const seen = new Set<string>();

  for (const serial of list) {
    const key = serial.toUpperCase();
    if (seen.has(key)) throw new ApiError(`Serial number ${serial} was entered twice`);
    if (serial.length > 100) throw new ApiError("Serial numbers can be at most 100 characters");
    seen.add(key);
  }
  return list.length ? list : undefined;
}

/**
 * Keeps product_serials in step with a stock change of a serial-tracked product (called by `changeStock()`).
 * Inbound: registers the given serials as In Stock where the stock landed (serials are optional, e.g. returns).
 * Outbound: marks the given serials — or, when `serials` is undefined, the oldest in-stock serials — with `status`.
 * A list shorter than the quantity is allowed (units without registered serials); callers enforce exact counts.
 */
export async function applySerials(
  connection: PoolConnection,
  { productId, warehouseId, delta, serials, locationId, batch, status, reference }: {
    productId: number;
    warehouseId: number;
    delta: number;
    serials?: string[];
    locationId?: number | null;
    batch?: string | null;
    status: string;
    reference?: string | null;
  }
): Promise<string[]> {
  const quantity = Math.abs(delta);

  if (serials && serials.length > quantity) {
    throw new ApiError(`${serials.length} serial numbers entered for ${quantity} unit${quantity === 1 ? "" : "s"}`);
  }

  if (delta > 0) {
    if (!serials?.length) return [];

    const [existing] = await connection.query<RowDataPacket[]>(
      "SELECT serial_number FROM product_serials WHERE product_id = ? AND serial_number IN (?) AND status = 'In Stock' FOR UPDATE",
      [productId, serials]
    );
    if (existing.length) throw new ApiError(`Serial ${existing[0].serial_number} is already in stock`, 409);

    await connection.query(
      `INSERT INTO product_serials (product_id, serial_number, warehouse_id, location_id, batch_number, status, reference)
       VALUES ? ON DUPLICATE KEY UPDATE warehouse_id = VALUES(warehouse_id), location_id = VALUES(location_id),
         batch_number = VALUES(batch_number), status = 'In Stock', reference = VALUES(reference), dispatch_order_id = NULL`,
      [serials.map((serial) => [productId, serial, warehouseId, locationId ?? null, batch || null, "In Stock", reference ?? null])]
    );
    return serials;
  }

  let rows: RowDataPacket[];

  if (serials && !serials.length) return [];

  if (serials?.length) {
    [rows] = await connection.query<RowDataPacket[]>(
      "SELECT id, serial_number, status, warehouse_id FROM product_serials WHERE product_id = ? AND serial_number IN (?) FOR UPDATE",
      [productId, serials]
    );
    for (const serial of serials) {
      const row = rows.find((r) => r.serial_number.toUpperCase() === serial.toUpperCase());
      if (!row) throw new ApiError(`Serial ${serial} is not registered for this product`, 404);
      if (!["In Stock", "Picked"].includes(row.status) || row.warehouse_id !== warehouseId) {
        throw new ApiError(`Serial ${serial} is not in stock in this warehouse (status: ${row.status})`, 409);
      }
    }
  } else {
    [rows] = await connection.query<RowDataPacket[]>(
      `SELECT id, serial_number FROM product_serials
       WHERE product_id = ? AND warehouse_id = ? AND status = 'In Stock'
       ORDER BY location_id <=> ? DESC, received_at, id LIMIT ? FOR UPDATE`,
      [productId, warehouseId, locationId ?? null, quantity]
    );
  }

  if (rows.length) {
    await connection.query(
      "UPDATE product_serials SET status = ?, warehouse_id = IF(? = 'In Transit', warehouse_id, NULL), location_id = NULL, reference = ? WHERE id IN (?)",
      [status, status, reference ?? null, rows.map((row) => row.id)]
    );
  }
  return rows.map((row) => row.serial_number as string);
}

/** How many registered in-stock serials of a product sit in a bin (to decide how many must be scanned). */
export async function serialsInLocation(connection: PoolConnection, productId: number, locationId: number) {
  const [[row]] = await connection.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS count FROM product_serials WHERE product_id = ? AND location_id = ? AND status = 'In Stock'",
    [productId, locationId]
  );
  return Number(row.count);
}

/** Move serials between bins along with a stock move (scanned serials, or the oldest ones in the source bin). */
export async function moveSerials(
  connection: PoolConnection,
  { productId, fromLocationId, toLocationId, quantity, serials, status, orderId }: {
    productId: number;
    fromLocationId: number;
    toLocationId: number;
    quantity: number;
    serials?: string[];
    status?: "In Stock" | "Picked";
    orderId?: number | null;
  }
) {
  const newStatus = status ?? "In Stock";

  if (serials?.length) {
    if (serials.length > quantity) throw new ApiError(`${serials.length} serial numbers scanned for ${quantity} unit${quantity === 1 ? "" : "s"}`);
    const [rows] = await connection.query<RowDataPacket[]>(
      "SELECT id, serial_number, status FROM product_serials WHERE product_id = ? AND serial_number IN (?) FOR UPDATE",
      [productId, serials]
    );
    for (const serial of serials) {
      const row = rows.find((r) => r.serial_number.toUpperCase() === serial.toUpperCase());
      if (!row || row.status !== "In Stock") throw new ApiError(`Serial ${serial} is not in stock for this product`, 409);
    }
    await connection.query(
      "UPDATE product_serials SET location_id = ?, status = ?, dispatch_order_id = ? WHERE id IN (?)",
      [toLocationId, newStatus, orderId ?? null, rows.map((row) => row.id)]
    );
    return;
  }

  await connection.query(
    `UPDATE product_serials SET location_id = ?, status = ?, dispatch_order_id = ?
     WHERE product_id = ? AND location_id = ? AND status = 'In Stock' ORDER BY received_at, id LIMIT ?`,
    [toLocationId, newStatus, orderId ?? null, productId, fromLocationId, quantity]
  );
}

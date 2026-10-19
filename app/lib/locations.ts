import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { ApiError } from "./crud";
import { currentUserName } from "./auth";

/** Bin types users can create. RECEIVING and DISPATCH are system locations created per warehouse. */
export const LOCATION_TYPES = ["Storage", "Pick Face", "Bulk", "Staging", "Quarantine"] as const;

export type BinQuantity = { locationId: number; batch: string; quantity: number };
type BatchLike = { number: string; quantity: number };

/** Pick/consume order: pick faces first, receiving last. Dispatch (already picked) and quarantine are never auto-consumed. */
const PRIORITY = `CASE l.type WHEN 'Pick Face' THEN 1 WHEN 'Storage' THEN 2 WHEN 'Bulk' THEN 3 WHEN 'Staging' THEN 4 WHEN 'Receiving' THEN 5 ELSE 6 END`;
const PICKABLE = `l.status = 'Active' AND l.type NOT IN ('Dispatch', 'Quarantine')`;
const PUTAWAY_TYPES = `('Storage', 'Pick Face', 'Bulk')`;

export async function systemLocation(connection: PoolConnection, warehouseId: number, type: "Receiving" | "Dispatch") {
  const find = async () => {
    const [[row]] = await connection.query<RowDataPacket[]>(
      "SELECT id FROM warehouse_locations WHERE warehouse_id = ? AND is_system = 1 AND type = ? LIMIT 1",
      [warehouseId, type]
    );
    return row?.id as number | undefined;
  };

  const existing = await find();
  if (existing) return existing;

  const code = type === "Receiving" ? "RECEIVING" : "DISPATCH";
  await connection.query(
    `INSERT IGNORE INTO warehouse_locations (warehouse_id, code, zone, type, barcode, pick_sequence, is_system)
     SELECT id, ?, ?, ?, CONCAT(code, '-', ?), ?, 1 FROM warehouses WHERE id = ?`,
    [code, type === "Receiving" ? "Inbound" : "Outbound", type, code, type === "Receiving" ? 0 : 99999, warehouseId]
  );

  const id = await find();
  if (!id) throw new ApiError(`Could not create the ${code} location for this warehouse`, 500);
  return id;
}

/** Find an active location in a warehouse by its barcode or code (case-insensitive), e.g. from a scan. */
export async function resolveLocation(connection: PoolConnection, warehouseId: number, scanned: unknown) {
  const code = String(scanned ?? "").trim();
  if (!code) throw new ApiError("Scan or enter a location");

  const [[row]] = await connection.query<RowDataPacket[]>(
    `SELECT id, code, type, status, is_system AS isSystem FROM warehouse_locations
     WHERE warehouse_id = ? AND (UPPER(barcode) = UPPER(?) OR UPPER(code) = UPPER(?))`,
    [warehouseId, code, code]
  );

  if (!row) throw new ApiError(`Location "${code}" was not found in this warehouse`, 404);
  if (row.status !== "Active") throw new ApiError(`Location ${row.code} is inactive`, 409);
  return row as { id: number; code: string; type: string; isSystem: number };
}

async function adjustBin(connection: PoolConnection, locationId: number, productId: number, batch: string, delta: number) {
  if (delta > 0) {
    await connection.query(
      `INSERT INTO location_stock (location_id, product_id, batch_number, quantity) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)`,
      [locationId, productId, batch, delta]
    );
    return;
  }

  const [result] = await connection.query<ResultSetHeader>(
    `UPDATE location_stock SET quantity = quantity + ?
     WHERE location_id = ? AND product_id = ? AND batch_number = ? AND quantity >= ?`,
    [delta, locationId, productId, batch, -delta]
  );
  if (result.affectedRows === 0) throw new ApiError("There is not enough stock in that location", 409);

  await connection.query(
    "DELETE FROM location_stock WHERE location_id = ? AND product_id = ? AND batch_number = ? AND quantity = 0",
    [locationId, productId, batch]
  );
}

type BinRow = { locationId: number; code: string; batch: string; quantity: number };

async function binRows(connection: PoolConnection, warehouseId: number, productId: number, locationId?: number | null) {
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT ls.location_id AS locationId, l.code, ls.batch_number AS batch, ls.quantity
     FROM location_stock ls
     JOIN warehouse_locations l ON l.id = ls.location_id
     LEFT JOIN product_batches pb ON pb.product_id = ls.product_id AND pb.warehouse_id = l.warehouse_id AND pb.batch_number = ls.batch_number
     WHERE ls.product_id = ? AND l.warehouse_id = ? AND ls.quantity > 0 AND ${locationId ? "l.id = ?" : PICKABLE}
     ORDER BY pb.expiry_date IS NULL, pb.expiry_date, ${PRIORITY}, l.pick_sequence, l.code
     FOR UPDATE`,
    locationId ? [productId, warehouseId, locationId] : [productId, warehouseId]
  );
  return rows as BinRow[];
}

/**
 * Mirrors a warehouse-level stock change onto bins. Called by `changeStock()` only.
 * Inbound lands in `locationId` (default RECEIVING). Outbound takes from `locationId`, or — when none is
 * given — from pickable bins (matching batches first, then pick faces → storage → … → receiving).
 */
export async function applyLocationDelta(
  connection: PoolConnection,
  { warehouseId, productId, delta, allocations, locationId }: {
    warehouseId: number;
    productId: number;
    delta: number;
    allocations: BatchLike[];
    locationId?: number | null;
  }
): Promise<BinQuantity[]> {
  const tagged = allocations.filter((batch) => batch.number && batch.quantity > 0);
  const moves: BinQuantity[] = [];

  if (delta > 0) {
    const target = locationId ?? (await systemLocation(connection, warehouseId, "Receiving"));
    let rest = delta;

    for (const batch of [...tagged, { number: "", quantity: Infinity }]) {
      const quantity = Math.min(batch.quantity, rest);
      if (quantity <= 0) continue;
      await adjustBin(connection, target, productId, batch.number, quantity);
      moves.push({ locationId: target, batch: batch.number, quantity });
      rest -= quantity;
    }
    return moves;
  }

  const rows = await binRows(connection, warehouseId, productId, locationId);
  let need = -delta;

  const take = async (row: BinRow, wanted: number) => {
    const quantity = Math.min(row.quantity, wanted, need);
    if (quantity <= 0) return 0;
    await adjustBin(connection, row.locationId, productId, row.batch, -quantity);
    row.quantity -= quantity;
    need -= quantity;
    moves.push({ locationId: row.locationId, batch: row.batch, quantity });
    return quantity;
  };

  for (const batch of tagged) {
    let wanted = batch.quantity;
    for (const row of rows.filter((r) => r.batch === batch.number)) wanted -= await take(row, wanted);
  }
  for (const row of rows.filter((r) => r.batch === "")) await take(row, Infinity);
  for (const row of rows) await take(row, Infinity);

  if (need > 0 && locationId) {
    throw new ApiError(`Only ${-delta - need} units of this product are in that location`, 409);
  }
  return moves;
}

/** Move stock between two bins of the same warehouse (put-away, picking, replenishment). Warehouse totals are unchanged. */
export async function moveStock(
  connection: PoolConnection,
  move: { warehouseId: number; productId: number; batch: string; quantity: number; fromLocationId: number; toLocationId: number; type: string; reference?: string | null }
) {
  if (!Number.isInteger(move.quantity) || move.quantity <= 0) throw new ApiError("Quantity must be a whole number above zero");
  if (move.fromLocationId === move.toLocationId) throw new ApiError("Source and destination locations are the same");

  await adjustBin(connection, move.fromLocationId, move.productId, move.batch, -move.quantity);
  await adjustBin(connection, move.toLocationId, move.productId, move.batch, move.quantity);
  await connection.query(
    `INSERT INTO location_moves (warehouse_id, product_id, batch_number, from_location_id, to_location_id, quantity, type, reference, user_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [move.warehouseId, move.productId, move.batch, move.fromLocationId, move.toLocationId, move.quantity, move.type, move.reference ?? null, currentUserName()]
  );
}

/** Stock of one product in one bin, earliest expiry first — used to decide which batches leave a bin. */
export async function batchesInBin(connection: PoolConnection, locationId: number, productId: number, quantity: number) {
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT ls.batch_number AS batch, ls.quantity FROM location_stock ls
     JOIN warehouse_locations l ON l.id = ls.location_id
     LEFT JOIN product_batches pb ON pb.product_id = ls.product_id AND pb.warehouse_id = l.warehouse_id AND pb.batch_number = ls.batch_number
     WHERE ls.location_id = ? AND ls.product_id = ? AND ls.quantity > 0
     ORDER BY pb.expiry_date IS NULL, pb.expiry_date`,
    [locationId, productId]
  );

  const result: { number: string; expiry: null; quantity: number }[] = [];
  let rest = quantity;
  for (const row of rows) {
    const take = Math.min(row.quantity, rest);
    if (take <= 0) break;
    if (row.batch) result.push({ number: row.batch, expiry: null, quantity: take });
    rest -= take;
  }
  return result;
}

/**
 * Directed put-away: suggest bins for incoming stock. Prefers bins already holding the product (same batch first),
 * then empty bins, then other bins with free capacity — in walking (pick-sequence) order. Open put-away tasks count
 * against capacity so suggestions don't overfill a bin. A null location means "no suitable bin — choose manually".
 */
export async function suggestPutaway(connection: PoolConnection, warehouseId: number, productId: number, batch: string, quantity: number) {
  const [bins] = await connection.query<RowDataPacket[]>(
    `SELECT l.id, l.capacity,
            COALESCE(used.qty, 0) + COALESCE(pending.qty, 0) AS used,
            COALESCE(mine.qty, 0) AS mine, COALESCE(mine.batch_qty, 0) AS mineBatch
     FROM warehouse_locations l
     LEFT JOIN (SELECT location_id, SUM(quantity) AS qty FROM location_stock GROUP BY location_id) used ON used.location_id = l.id
     LEFT JOIN (
       SELECT to_location_id, SUM(quantity - done_quantity) AS qty FROM warehouse_tasks
       WHERE type = 'Put-away' AND status = 'Open' GROUP BY to_location_id
     ) pending ON pending.to_location_id = l.id
     LEFT JOIN (
       SELECT location_id, SUM(quantity) AS qty, SUM(CASE WHEN batch_number = ? THEN quantity ELSE 0 END) AS batch_qty
       FROM location_stock WHERE product_id = ? GROUP BY location_id
     ) mine ON mine.location_id = l.id
     WHERE l.warehouse_id = ? AND l.status = 'Active' AND l.is_system = 0 AND l.type IN ${PUTAWAY_TYPES}
     ORDER BY COALESCE(mine.qty, 0) > 0 DESC, COALESCE(mine.batch_qty, 0) > 0 DESC,
              COALESCE(used.qty, 0) + COALESCE(pending.qty, 0) = 0 DESC,
              l.type = 'Pick Face' DESC, l.pick_sequence, l.code`,
    [batch, productId, warehouseId]
  );

  const plan: { locationId: number | null; quantity: number }[] = [];
  let rest = quantity;

  for (const bin of bins) {
    if (rest <= 0) break;
    const free = bin.capacity === null ? Infinity : bin.capacity - Number(bin.used);
    if (free <= 0) continue;
    const take = Math.min(free, rest);
    plan.push({ locationId: bin.id, quantity: take });
    rest -= take;
  }

  if (rest > 0) plan.push({ locationId: null, quantity: rest });
  return plan;
}

/**
 * Directed picking: which bins to pick from. Earliest-expiring batch first (expired batches are skipped),
 * then pick faces before storage, then walking order. Quantities already promised to open pick tasks are excluded.
 */
export async function pickAllocation(connection: PoolConnection, warehouseId: number, productId: number, quantity: number) {
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT ls.location_id AS locationId, ls.batch_number AS batch, l.pick_sequence AS sequence,
            ls.quantity - COALESCE(t.qty, 0) AS available
     FROM location_stock ls
     JOIN warehouse_locations l ON l.id = ls.location_id
     LEFT JOIN product_batches pb ON pb.product_id = ls.product_id AND pb.warehouse_id = l.warehouse_id AND pb.batch_number = ls.batch_number
     LEFT JOIN (
       SELECT from_location_id, batch_number, SUM(quantity - done_quantity) AS qty FROM warehouse_tasks
       WHERE type = 'Pick' AND status = 'Open' AND product_id = ? GROUP BY from_location_id, batch_number
     ) t ON t.from_location_id = ls.location_id AND t.batch_number = ls.batch_number
     WHERE ls.product_id = ? AND l.warehouse_id = ? AND ${PICKABLE}
       AND (pb.expiry_date IS NULL OR pb.expiry_date >= CURDATE())
     ORDER BY pb.expiry_date IS NULL, pb.expiry_date, ${PRIORITY}, l.pick_sequence, l.code`,
    [productId, productId, warehouseId]
  );

  const picks: (BinQuantity & { sequence: number })[] = [];
  let rest = quantity;

  for (const row of rows) {
    if (rest <= 0) break;
    const take = Math.min(Number(row.available), rest);
    if (take <= 0) continue;
    picks.push({ locationId: row.locationId, batch: row.batch, quantity: take, sequence: row.sequence });
    rest -= take;
  }

  return { picks, shortfall: rest };
}

/** Insert a warehouse task and give it a TSK-xxxxx number. */
export async function createTask(
  connection: PoolConnection,
  task: {
    type: "Pick" | "Put-away" | "Cross-dock";
    warehouseId: number;
    productId: number;
    batch?: string;
    fromLocationId?: number | null;
    toLocationId?: number | null;
    quantity: number;
    doneQuantity?: number;
    status?: "Open" | "Done";
    orderId?: number | null;
    orderItemId?: number | null;
    waveId?: number | null;
    reference?: string | null;
    sequence?: number;
  }
) {
  const done = task.status === "Done";
  const [result] = await connection.query<ResultSetHeader>(
    `INSERT INTO warehouse_tasks (task_number, type, warehouse_id, product_id, batch_number, from_location_id, to_location_id,
       quantity, done_quantity, status, order_id, order_item_id, wave_id, reference, sequence, completed_by, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${done ? "NOW()" : "NULL"})`,
    [
      `TMP-${crypto.randomUUID()}`, task.type, task.warehouseId, task.productId, task.batch ?? "", task.fromLocationId ?? null,
      task.toLocationId ?? null, task.quantity, task.doneQuantity ?? 0, task.status ?? "Open", task.orderId ?? null,
      task.orderItemId ?? null, task.waveId ?? null, task.reference ?? null, task.sequence ?? 0, done ? currentUserName() : null,
    ]
  );
  await connection.query("UPDATE warehouse_tasks SET task_number = CONCAT('TSK-', LPAD(id, 5, '0')) WHERE id = ?", [result.insertId]);
  return result.insertId;
}

/** Create directed put-away tasks for stock sitting in `fromLocationId` (normally RECEIVING). */
export async function createPutawayTasks(
  connection: PoolConnection,
  { warehouseId, productId, fromLocationId, entries, reference }: {
    warehouseId: number;
    productId: number;
    fromLocationId: number;
    entries: { batch: string; quantity: number }[];
    reference?: string | null;
  }
) {
  let created = 0;
  for (const entry of entries) {
    if (entry.quantity <= 0) continue;
    for (const step of await suggestPutaway(connection, warehouseId, productId, entry.batch, entry.quantity)) {
      await createTask(connection, {
        type: "Put-away", warehouseId, productId, batch: entry.batch, fromLocationId,
        toLocationId: step.locationId, quantity: step.quantity, reference,
      });
      created++;
    }
  }
  return created;
}

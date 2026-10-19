import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { ApiError } from "./crud";
import { currentUserName } from "./auth";
import { createCount } from "./cycle-counts";
import { createPutawayTasks, createTask, moveStock, pickAllocation, resolveLocation, systemLocation } from "./locations";
import { moveSerials, parseSerials, serialsInLocation } from "./serials";
import { assignNumber, changeStock, tempNumber, type BatchQuantity } from "./stock";

export const PRIORITIES = ["Urgent", "High", "Normal"] as const;
export const RELEASABLE = ["Allocated", "Backordered", "Part Picked", "Picking"];
const CLOSED = ["Packed", "Dispatched", "Cancelled"];
const PRIORITY_ORDER = "FIELD(o.priority, 'Urgent', 'High', 'Normal')";

const positiveInt = (value: unknown, label: string) => {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new ApiError(`${label} must be a whole number greater than zero`);
  return number;
};

async function lockOrder(connection: PoolConnection, idOrNumber: unknown) {
  const key = String(idOrNumber ?? "").trim();
  if (!key) throw new ApiError("Select or scan a dispatch order");

  const [[order]] = await connection.query<RowDataPacket[]>(
    "SELECT * FROM dispatch_orders WHERE id = ? OR UPPER(order_number) = UPPER(?) FOR UPDATE",
    [/^\d+$/.test(key) ? Number(key) : 0, key]
  );
  if (!order) throw new ApiError(`Dispatch order ${key} not found`, 404);
  return order;
}

async function orderItems(connection: PoolConnection, orderId: number) {
  const [items] = await connection.query<RowDataPacket[]>("SELECT * FROM dispatch_order_items WHERE order_id = ? ORDER BY id FOR UPDATE", [orderId]);
  return items;
}

async function changeReserved(connection: PoolConnection, productId: number, warehouseId: number, delta: number) {
  if (delta === 0) return;
  await connection.query(
    `INSERT INTO stock_levels (product_id, warehouse_id, quantity, reserved) VALUES (?, ?, 0, GREATEST(?, 0))
     ON DUPLICATE KEY UPDATE reserved = GREATEST(reserved + ?, 0)`,
    [productId, warehouseId, delta, delta]
  );
}

/** Derive order status from its quantities and open pick tasks (closed orders keep their status). */
export async function refreshOrderStatus(connection: PoolConnection, orderId: number) {
  const [[row]] = await connection.query<RowDataPacket[]>(
    `SELECT o.status, SUM(i.quantity) AS q, SUM(i.allocated_quantity) AS a, SUM(i.picked_quantity) AS p,
            (SELECT COUNT(*) FROM warehouse_tasks t WHERE t.order_id = o.id AND t.type = 'Pick' AND t.status = 'Open') AS open
     FROM dispatch_orders o JOIN dispatch_order_items i ON i.order_id = o.id
     WHERE o.id = ? GROUP BY o.id`,
    [orderId]
  );
  if (!row || CLOSED.includes(row.status)) return row?.status as string | undefined;

  const [q, a, p] = [Number(row.q), Number(row.a), Number(row.p)];
  const status =
    Number(row.open) > 0 ? "Picking"
    : a > p ? (a >= q ? "Allocated" : "Backordered")
    : p > 0 ? (p >= q ? "Picked" : "Part Picked")
    : "Pending";

  await connection.query("UPDATE dispatch_orders SET status = ? WHERE id = ?", [status, orderId]);
  return status;
}

async function refreshWave(connection: PoolConnection, waveId: number | null) {
  if (!waveId) return;
  await connection.query(
    `UPDATE pick_waves SET status = 'Completed', completed_at = NOW()
     WHERE id = ? AND status = 'Released'
       AND NOT EXISTS (SELECT 1 FROM warehouse_tasks WHERE wave_id = ? AND type = 'Pick' AND status = 'Open')`,
    [waveId, waveId]
  );
}

/* ---------------------------------------------------------------- orders & allocation */

type OrderInput = {
  type?: "Customer" | "Transfer";
  warehouseId: unknown;
  customerId?: unknown;
  customerName?: unknown;
  shipTo?: unknown;
  destinationWarehouseId?: number | null;
  transferId?: number | null;
  priority?: unknown;
  requiredDate?: unknown;
  notes?: unknown;
  items: unknown;
};

export async function createDispatchOrder(connection: PoolConnection, input: OrderInput) {
  const warehouseId = positiveInt(input.warehouseId, "Warehouse");
  const customerId = Number(input.customerId) || null;
  const priority = String(input.priority || "Normal");
  const requiredDate = String(input.requiredDate ?? "").trim() || null;
  const lines = new Map<number, number>();

  if (!PRIORITIES.includes(priority as (typeof PRIORITIES)[number])) throw new ApiError("Priority must be Urgent, High or Normal");
  if (requiredDate && Number.isNaN(Date.parse(requiredDate))) throw new ApiError("Required date is not a valid date");

  for (const [index, item] of (Array.isArray(input.items) ? input.items : []).entries()) {
    const productId = positiveInt(item?.productId, `Line ${index + 1} product`);
    lines.set(productId, (lines.get(productId) ?? 0) + positiveInt(item?.quantity, `Line ${index + 1} quantity`));
  }
  if (lines.size === 0) throw new ApiError("Add at least one product to the order");

  let customerName = String(input.customerName ?? "").trim();
  if (customerId) {
    const [[customer]] = await connection.query<RowDataPacket[]>("SELECT name, address FROM customers WHERE id = ?", [customerId]);
    if (!customer) throw new ApiError("Customer not found", 404);
    customerName ||= customer.name;
    input.shipTo ||= customer.address;
  }
  if (!customerName) throw new ApiError("Enter the customer or recipient");

  const [result] = await connection.query<ResultSetHeader>(
    `INSERT INTO dispatch_orders (order_number, type, warehouse_id, customer_id, customer_name, ship_to, destination_warehouse_id,
       transfer_id, priority, required_date, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      tempNumber(), input.type ?? "Customer", warehouseId, customerId, customerName.slice(0, 150),
      String(input.shipTo ?? "").trim().slice(0, 255) || null, input.destinationWarehouseId ?? null, input.transferId ?? null,
      priority, requiredDate, String(input.notes ?? "").trim().slice(0, 255) || null, currentUserName(),
    ]
  );
  await assignNumber(connection, "dispatch_orders", "order_number", "DSP", result.insertId, 5);
  await connection.query(
    "INSERT INTO dispatch_order_items (order_id, product_id, quantity) VALUES ?",
    [[...lines].map(([productId, quantity]) => [result.insertId, productId, quantity])]
  );

  await allocateOrder(connection, result.insertId);

  const [[row]] = await connection.query<RowDataPacket[]>("SELECT order_number, status FROM dispatch_orders WHERE id = ?", [result.insertId]);
  return { id: result.insertId, number: row.order_number as string, status: row.status as string };
}

/** Reserve available (on hand − reserved) stock for unallocated order quantities. */
export async function allocateOrder(connection: PoolConnection, orderId: number) {
  const order = await lockOrder(connection, orderId);
  if (CLOSED.includes(order.status)) throw new ApiError(`A ${order.status.toLowerCase()} order cannot be allocated`, 409);

  let allocated = 0;
  for (const item of await orderItems(connection, order.id)) {
    const shortage = item.quantity - item.allocated_quantity;
    if (shortage <= 0) continue;

    await connection.query(
      "INSERT INTO stock_levels (product_id, warehouse_id, quantity) VALUES (?, ?, 0) ON DUPLICATE KEY UPDATE id = id",
      [item.product_id, order.warehouse_id]
    );
    const [[stock]] = await connection.query<RowDataPacket[]>(
      "SELECT quantity, reserved FROM stock_levels WHERE product_id = ? AND warehouse_id = ? FOR UPDATE",
      [item.product_id, order.warehouse_id]
    );
    const quantity = Math.min(shortage, Math.max(stock.quantity - stock.reserved, 0));
    if (quantity <= 0) continue;

    await changeReserved(connection, item.product_id, order.warehouse_id, quantity);
    await connection.query("UPDATE dispatch_order_items SET allocated_quantity = allocated_quantity + ? WHERE id = ?", [quantity, item.id]);
    allocated += quantity;
  }

  await refreshOrderStatus(connection, order.id);
  return allocated;
}

/** Generate directed pick tasks (FEFO bins in walking order) for allocated-but-unpicked quantities. */
export async function releaseOrders(connection: PoolConnection, orderIds: number[], waveId: number | null = null) {
  let tasks = 0;
  let shortfall = 0;

  for (const orderId of orderIds) {
    const order = await lockOrder(connection, orderId);
    if (!RELEASABLE.includes(order.status)) continue;

    const dispatchLocation = await systemLocation(connection, order.warehouse_id, "Dispatch");

    for (const item of await orderItems(connection, order.id)) {
      const [[open]] = await connection.query<RowDataPacket[]>(
        "SELECT COALESCE(SUM(quantity - done_quantity), 0) AS qty FROM warehouse_tasks WHERE order_item_id = ? AND type = 'Pick' AND status = 'Open'",
        [item.id]
      );
      const toPick = item.allocated_quantity - item.picked_quantity - Number(open.qty);
      if (toPick <= 0) continue;

      const plan = await pickAllocation(connection, order.warehouse_id, item.product_id, toPick);
      for (const pick of plan.picks) {
        await createTask(connection, {
          type: "Pick", warehouseId: order.warehouse_id, productId: item.product_id, batch: pick.batch,
          fromLocationId: pick.locationId, toLocationId: dispatchLocation, quantity: pick.quantity,
          orderId: order.id, orderItemId: item.id, waveId: waveId ?? order.wave_id, reference: order.order_number, sequence: pick.sequence,
        });
        tasks++;
      }
      shortfall += plan.shortfall;
    }

    if (waveId) await connection.query("UPDATE dispatch_orders SET wave_id = ? WHERE id = ?", [waveId, order.id]);
    await refreshOrderStatus(connection, order.id);
  }

  return { tasks, shortfall };
}

export async function createWave(connection: PoolConnection, orderIdsInput: unknown) {
  const orderIds = [...new Set((Array.isArray(orderIdsInput) ? orderIdsInput : []).map(Number).filter((id) => id > 0))];
  if (orderIds.length < 1) throw new ApiError("Select the orders to include in the wave");

  const [orders] = await connection.query<RowDataPacket[]>(
    `SELECT o.id, o.order_number, o.warehouse_id, o.status, w.status AS wave_status
     FROM dispatch_orders o LEFT JOIN pick_waves w ON w.id = o.wave_id WHERE o.id IN (?) FOR UPDATE`,
    [orderIds]
  );
  if (orders.length !== orderIds.length) throw new ApiError("One or more orders were not found", 404);
  if (new Set(orders.map((o) => o.warehouse_id)).size > 1) throw new ApiError("A wave can only contain orders from one warehouse");

  for (const order of orders) {
    if (!RELEASABLE.includes(order.status)) throw new ApiError(`${order.order_number} is ${order.status} and cannot be waved`, 409);
    if (order.wave_status && order.wave_status !== "Completed") throw new ApiError(`${order.order_number} is already in an open wave`, 409);
  }

  const [result] = await connection.query<ResultSetHeader>(
    "INSERT INTO pick_waves (wave_number, warehouse_id, created_by) VALUES (?, ?, ?)",
    [tempNumber(), orders[0].warehouse_id, currentUserName()]
  );
  await assignNumber(connection, "pick_waves", "wave_number", "WAV", result.insertId, 5);
  await connection.query("UPDATE dispatch_orders SET wave_id = ? WHERE id IN (?)", [result.insertId, orderIds]);

  const [[wave]] = await connection.query<RowDataPacket[]>("SELECT wave_number FROM pick_waves WHERE id = ?", [result.insertId]);
  return { id: result.insertId, number: wave.wave_number as string };
}

export async function releaseWave(connection: PoolConnection, waveId: number) {
  const [[wave]] = await connection.query<RowDataPacket[]>("SELECT * FROM pick_waves WHERE id = ? FOR UPDATE", [waveId]);
  if (!wave) throw new ApiError("Wave not found", 404);
  if (wave.status !== "Open") throw new ApiError(`${wave.wave_number} has already been released`, 409);

  const [orders] = await connection.query<RowDataPacket[]>("SELECT id FROM dispatch_orders WHERE wave_id = ?", [waveId]);
  const result = await releaseOrders(connection, orders.map((o) => o.id as number), waveId);
  if (result.tasks === 0) throw new ApiError("Nothing to pick: allocate stock to the wave's orders first", 409);

  await connection.query("UPDATE pick_waves SET status = 'Released', released_at = NOW() WHERE id = ?", [waveId]);
  return { number: wave.wave_number as string, ...result };
}

/* ---------------------------------------------------------------- picking & put-away */

async function productMatches(connection: PoolConnection, productId: number, scanned: unknown) {
  const code = String(scanned ?? "").trim();
  if (!code) return false;
  const [[row]] = await connection.query<RowDataPacket[]>(
    `SELECT 1 FROM products p LEFT JOIN product_units u ON u.product_id = p.id
     WHERE p.id = ? AND (UPPER(p.sku) = UPPER(?) OR p.barcode = ? OR u.barcode = ?) LIMIT 1`,
    [productId, code, code, code]
  );
  return Boolean(row);
}

/**
 * Confirm one stop of a pick route. `taskIds` may group several open pick tasks for the same product/bin/batch
 * (wave picking); the picked quantity is shared across them by order priority. Scanned location and product must
 * match the task. Picking less than requested is a short pick: the shortage is de-allocated and an urgent cycle
 * count is raised for the bin.
 */
export async function confirmPick(
  connection: PoolConnection,
  input: { taskIds: unknown; location: unknown; product: unknown; quantity?: unknown; serials?: unknown }
) {
  const ids = [...new Set((Array.isArray(input.taskIds) ? input.taskIds : [input.taskIds]).map(Number).filter((id) => id > 0))];
  if (ids.length === 0) throw new ApiError("Select the pick task");

  const [tasks] = await connection.query<RowDataPacket[]>(
    `SELECT t.*, l.code AS location_code, l.barcode AS location_barcode, p.name AS product_name, p.track_serials, o.priority
     FROM warehouse_tasks t
     JOIN products p ON p.id = t.product_id
     LEFT JOIN warehouse_locations l ON l.id = t.from_location_id
     LEFT JOIN dispatch_orders o ON o.id = t.order_id
     WHERE t.id IN (?) ORDER BY ${PRIORITY_ORDER}, t.id FOR UPDATE`,
    [ids]
  );

  if (tasks.length !== ids.length) throw new ApiError("Pick task not found", 404);
  const first = tasks[0];
  for (const task of tasks) {
    if (task.type !== "Pick" || task.status !== "Open") throw new ApiError(`${task.task_number} is not an open pick task`, 409);
    if (task.product_id !== first.product_id || task.from_location_id !== first.from_location_id || task.batch_number !== first.batch_number) {
      throw new ApiError("Grouped pick tasks must be for the same product, bin and batch");
    }
  }

  const scannedLocation = String(input.location ?? "").trim().toUpperCase();
  if (![String(first.location_code).toUpperCase(), String(first.location_barcode).toUpperCase()].includes(scannedLocation)) {
    throw new ApiError(`Wrong location — go to ${first.location_code}`, 409);
  }
  if (!(await productMatches(connection, first.product_id, input.product))) {
    throw new ApiError(`Scanned item is not ${first.product_name}`, 409);
  }

  const remaining = tasks.reduce((sum, task) => sum + task.quantity - task.done_quantity, 0);
  const quantity = input.quantity === undefined || input.quantity === "" ? remaining : Number(input.quantity);
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > remaining) {
    throw new ApiError(`Picked quantity must be between 0 and ${remaining}`);
  }

  const serials = parseSerials(input.serials) ?? [];
  if (first.track_serials && quantity > 0) {
    const required = Math.min(quantity, await serialsInLocation(connection, first.product_id, first.from_location_id));
    if (serials.length !== required) throw new ApiError(`Scan ${required} serial number${required === 1 ? "" : "s"} for the units picked`);
  }

  let rest = quantity;
  let shortage = 0;
  const orders = new Set<number>();
  const waves = new Set<number>();

  for (const task of tasks) {
    const open = task.quantity - task.done_quantity;
    const picked = Math.min(open, rest);
    const short = open - picked;

    if (picked > 0) {
      await moveStock(connection, {
        warehouseId: task.warehouse_id, productId: task.product_id, batch: task.batch_number, quantity: picked,
        fromLocationId: task.from_location_id, toLocationId: task.to_location_id, type: "Pick", reference: task.task_number,
      });
      const taskSerials = serials.splice(0, picked);
      if (taskSerials.length) {
        await moveSerials(connection, {
          productId: task.product_id, fromLocationId: task.from_location_id, toLocationId: task.to_location_id,
          quantity: picked, serials: taskSerials, status: "Picked", orderId: task.order_id,
        });
      }
      await connection.query("UPDATE dispatch_order_items SET picked_quantity = picked_quantity + ? WHERE id = ?", [picked, task.order_item_id]);
    }

    if (short > 0) {
      await connection.query("UPDATE dispatch_order_items SET allocated_quantity = GREATEST(allocated_quantity - ?, picked_quantity) WHERE id = ?", [short, task.order_item_id]);
      await changeReserved(connection, task.product_id, task.warehouse_id, -short);
      shortage += short;
    }

    await connection.query(
      "UPDATE warehouse_tasks SET done_quantity = done_quantity + ?, status = 'Done', completed_by = ?, completed_at = NOW() WHERE id = ?",
      [picked, currentUserName(), task.id]
    );
    rest -= picked;
    if (task.order_id) orders.add(task.order_id);
    if (task.wave_id) waves.add(task.wave_id);
  }

  if (shortage > 0) {
    const [[openCount]] = await connection.query<RowDataPacket[]>(
      "SELECT id FROM cycle_counts WHERE product_id = ? AND location_id = ? AND status = 'Open' LIMIT 1",
      [first.product_id, first.from_location_id]
    );
    if (!openCount) {
      await createCount(connection, {
        warehouseId: first.warehouse_id, productId: first.product_id, locationId: first.from_location_id, riskScore: 100,
        reason: `Short pick at ${first.location_code}: expected ${remaining}, picked ${quantity}`,
      });
    }
  }

  for (const orderId of orders) await refreshOrderStatus(connection, orderId);
  for (const waveId of waves) await refreshWave(connection, waveId);

  return shortage > 0
    ? `Picked ${quantity} of ${remaining}. Short pick recorded and a cycle count raised for ${first.location_code}.`
    : `Picked ${quantity} × ${first.product_name} from ${first.location_code}`;
}

/** Confirm a directed put-away by scanning the bin (a different bin than suggested is allowed). */
export async function confirmPutaway(
  connection: PoolConnection,
  input: { taskId: unknown; location: unknown; quantity?: unknown; serials?: unknown }
) {
  const [[task]] = await connection.query<RowDataPacket[]>(
    `SELECT t.*, p.name AS product_name, p.track_serials FROM warehouse_tasks t JOIN products p ON p.id = t.product_id
     WHERE t.id = ? FOR UPDATE`,
    [Number(input.taskId)]
  );
  if (!task || task.type !== "Put-away" || task.status !== "Open") throw new ApiError("Open put-away task not found", 404);

  const target = await resolveLocation(connection, task.warehouse_id, input.location);
  if (target.isSystem || target.id === task.from_location_id) throw new ApiError("Scan the storage location you are putting the stock into");

  const [[bin]] = await connection.query<RowDataPacket[]>(
    "SELECT quantity FROM location_stock WHERE location_id = ? AND product_id = ? AND batch_number = ? FOR UPDATE",
    [task.from_location_id, task.product_id, task.batch_number]
  );
  const available = Math.min(task.quantity - task.done_quantity, Number(bin?.quantity ?? 0));

  if (available <= 0) {
    await connection.query("UPDATE warehouse_tasks SET status = 'Cancelled', completed_by = ?, completed_at = NOW() WHERE id = ?", [currentUserName(), task.id]);
    return `${task.task_number} cancelled — the stock is no longer in the source location`;
  }

  const quantity = input.quantity === undefined || input.quantity === "" ? available : Number(input.quantity);
  if (!Number.isInteger(quantity) || quantity <= 0 || quantity > available) throw new ApiError(`Quantity must be between 1 and ${available}`);

  const [[capacity]] = await connection.query<RowDataPacket[]>(
    `SELECT l.capacity, COALESCE(SUM(ls.quantity), 0) AS used FROM warehouse_locations l
     LEFT JOIN location_stock ls ON ls.location_id = l.id WHERE l.id = ? GROUP BY l.id`,
    [target.id]
  );
  if (capacity.capacity !== null && Number(capacity.used) + quantity > capacity.capacity) {
    throw new ApiError(`${target.code} only has room for ${Math.max(capacity.capacity - Number(capacity.used), 0)} more units`, 409);
  }

  await moveStock(connection, {
    warehouseId: task.warehouse_id, productId: task.product_id, batch: task.batch_number, quantity,
    fromLocationId: task.from_location_id, toLocationId: target.id, type: "Put-away", reference: task.task_number,
  });
  if (task.track_serials) {
    await moveSerials(connection, {
      productId: task.product_id, fromLocationId: task.from_location_id, toLocationId: target.id, quantity, serials: parseSerials(input.serials),
    });
  }

  const done = task.done_quantity + quantity >= task.quantity;
  await connection.query(
    `UPDATE warehouse_tasks SET done_quantity = done_quantity + ?, to_location_id = ?, status = ?,
       completed_by = ?, completed_at = IF(? = 'Done', NOW(), NULL) WHERE id = ?`,
    [quantity, target.id, done ? "Done" : "Open", currentUserName(), done ? "Done" : "Open", task.id]
  );

  return `Put away ${quantity} × ${task.product_name} into ${target.code}`;
}

/** Ad-hoc bin-to-bin move (replenishment, consolidation). */
export async function moveBetweenBins(
  connection: PoolConnection,
  input: { warehouseId: unknown; productId: unknown; from: unknown; to: unknown; quantity: unknown; batch?: unknown; serials?: unknown }
) {
  const warehouseId = positiveInt(input.warehouseId, "Warehouse");
  const productId = positiveInt(input.productId, "Product");
  const quantity = positiveInt(input.quantity, "Quantity");
  const from = await resolveLocation(connection, warehouseId, input.from);
  const to = await resolveLocation(connection, warehouseId, input.to);
  if (to.type === "Dispatch") throw new ApiError("Stock is moved to DISPATCH by picking, not by a manual move");

  const batch = String(input.batch ?? "");
  await moveStock(connection, { warehouseId, productId, batch, quantity, fromLocationId: from.id, toLocationId: to.id, type: "Move" });

  const [[product]] = await connection.query<RowDataPacket[]>("SELECT name, track_serials FROM products WHERE id = ?", [productId]);
  if (product.track_serials) {
    await moveSerials(connection, { productId, fromLocationId: from.id, toLocationId: to.id, quantity, serials: parseSerials(input.serials) });
  }
  return `Moved ${quantity} × ${product.name} from ${from.code} to ${to.code}`;
}

/* ---------------------------------------------------------------- pack, dispatch, cancel */

export async function packOrder(connection: PoolConnection, orderKey: unknown, packagesInput: unknown) {
  const order = await lockOrder(connection, orderKey);
  if (!["Picked", "Part Picked"].includes(order.status)) throw new ApiError(`${order.order_number} is ${order.status}; only picked orders can be packed`, 409);
  const packages = packagesInput === undefined || packagesInput === "" ? 1 : positiveInt(packagesInput, "Packages");

  await connection.query("UPDATE dispatch_orders SET status = 'Packed', packages = ?, packed_at = NOW() WHERE id = ?", [packages, order.id]);
  return `${order.order_number} packed (${packages} package${packages === 1 ? "" : "s"})`;
}

/** Ship picked stock from DISPATCH: deducts stock (picked batches & serials), releases reservations. */
export async function dispatchOrder(connection: PoolConnection, input: { order: unknown; carrier?: unknown; trackingNumber?: unknown }) {
  const order = await lockOrder(connection, input.order);
  if (!["Picked", "Part Picked", "Packed"].includes(order.status)) {
    throw new ApiError(`${order.order_number} is ${order.status}; finish picking before dispatch`, 409);
  }

  const dispatchLocation = await systemLocation(connection, order.warehouse_id, "Dispatch");
  const [[transfer]] = order.transfer_id
    ? await connection.query<RowDataPacket[]>("SELECT * FROM stock_transfers WHERE id = ? FOR UPDATE", [order.transfer_id])
    : [[undefined]];
  const reference = transfer?.transfer_number ?? order.order_number;
  let units = 0;

  for (const item of await orderItems(connection, order.id)) {
    const quantity = item.picked_quantity - item.dispatched_quantity;

    if (quantity > 0) {
      const [batches] = await connection.query<RowDataPacket[]>(
        `SELECT batch_number AS number, SUM(done_quantity) AS quantity FROM warehouse_tasks
         WHERE order_item_id = ? AND type IN ('Pick', 'Cross-dock') AND status = 'Done' AND batch_number <> '' AND done_quantity > 0
         GROUP BY batch_number`,
        [item.id]
      );
      const [serials] = await connection.query<RowDataPacket[]>(
        "SELECT serial_number FROM product_serials WHERE dispatch_order_id = ? AND product_id = ? AND status = 'Picked'",
        [order.id, item.product_id]
      );

      await changeStock(connection, {
        productId: item.product_id,
        warehouseId: order.warehouse_id,
        delta: -quantity,
        type: transfer ? "Transfer" : "Dispatch",
        reference,
        notes: transfer ? `Dispatched by ${order.order_number}` : `${order.order_number} to ${order.customer_name}`,
        locationId: dispatchLocation,
        batches: batches.map((b) => ({ number: b.number as string, expiry: null, quantity: Number(b.quantity) })),
        serials: serials.map((s) => s.serial_number as string),
      });
      units += quantity;
    }

    await changeReserved(connection, item.product_id, order.warehouse_id, -item.allocated_quantity);
    await connection.query("UPDATE dispatch_order_items SET dispatched_quantity = picked_quantity WHERE id = ?", [item.id]);
  }

  await connection.query(
    "UPDATE dispatch_orders SET status = 'Dispatched', carrier = ?, tracking_number = ?, dispatched_at = NOW() WHERE id = ?",
    [String(input.carrier ?? "").trim().slice(0, 100) || null, String(input.trackingNumber ?? "").trim().slice(0, 100) || null, order.id]
  );
  if (transfer) await connection.query("UPDATE stock_transfers SET status = 'In Transit' WHERE id = ?", [transfer.id]);

  return `${order.order_number} dispatched (${units} units)${transfer ? ` — ${transfer.transfer_number} is in transit` : ""}`;
}

/** Cancel an order: open tasks are cancelled, picked stock goes back to RECEIVING for put-away, reservations are released. */
export async function cancelOrder(connection: PoolConnection, orderKey: unknown, { cancelTransfer = true } = {}) {
  const order = await lockOrder(connection, orderKey);
  if (["Dispatched", "Cancelled"].includes(order.status)) throw new ApiError(`${order.order_number} is already ${order.status.toLowerCase()}`, 409);

  await connection.query("UPDATE warehouse_tasks SET status = 'Cancelled' WHERE order_id = ? AND status = 'Open'", [order.id]);
  const dispatchLocation = await systemLocation(connection, order.warehouse_id, "Dispatch");
  const receiving = await systemLocation(connection, order.warehouse_id, "Receiving");

  for (const item of await orderItems(connection, order.id)) {
    const [batches] = await connection.query<RowDataPacket[]>(
      `SELECT batch_number AS batch, SUM(done_quantity) AS quantity FROM warehouse_tasks
       WHERE order_item_id = ? AND type IN ('Pick', 'Cross-dock') AND status = 'Done' AND done_quantity > 0 GROUP BY batch_number`,
      [item.id]
    );
    const entries = batches.map((b) => ({ batch: b.batch as string, quantity: Number(b.quantity) }));

    for (const entry of entries) {
      await moveStock(connection, {
        warehouseId: order.warehouse_id, productId: item.product_id, batch: entry.batch, quantity: entry.quantity,
        fromLocationId: dispatchLocation, toLocationId: receiving, type: "Unpick", reference: order.order_number,
      });
    }
    await createPutawayTasks(connection, { warehouseId: order.warehouse_id, productId: item.product_id, fromLocationId: receiving, entries, reference: order.order_number });
    await changeReserved(connection, item.product_id, order.warehouse_id, -item.allocated_quantity);
  }

  await connection.query(
    "UPDATE product_serials SET status = 'In Stock', location_id = ?, dispatch_order_id = NULL WHERE dispatch_order_id = ? AND status = 'Picked'",
    [receiving, order.id]
  );
  await connection.query("UPDATE dispatch_order_items SET allocated_quantity = 0, picked_quantity = 0 WHERE order_id = ?", [order.id]);
  await connection.query("UPDATE dispatch_orders SET status = 'Cancelled' WHERE id = ?", [order.id]);
  if (cancelTransfer && order.transfer_id) {
    await connection.query("UPDATE stock_transfers SET status = 'Cancelled' WHERE id = ? AND status <> 'Completed'", [order.transfer_id]);
  }
  await refreshWave(connection, order.wave_id);

  return `${order.order_number} cancelled`;
}

/* ---------------------------------------------------------------- inbound: cross-dock & put-away */

/**
 * Route stock that just landed in RECEIVING: cross-dock first (straight to DISPATCH for open orders that are short
 * of this product, highest priority / earliest required date first), then directed put-away tasks for the rest.
 */
export async function routeInbound(
  connection: PoolConnection,
  { warehouseId, productId, entries, serials, reference, crossDock }: {
    warehouseId: number;
    productId: number;
    entries: { batch: string; quantity: number }[];
    serials: string[];
    reference: string;
    crossDock: boolean;
  }
) {
  const receiving = await systemLocation(connection, warehouseId, "Receiving");
  const remaining = entries.map((entry) => ({ ...entry }));
  const pool = [...serials];
  const orders = new Set<string>();
  let docked = 0;

  if (crossDock) {
    const dispatchLocation = await systemLocation(connection, warehouseId, "Dispatch");
    const [lines] = await connection.query<RowDataPacket[]>(
      `SELECT i.id, i.order_id, i.quantity - i.allocated_quantity AS shortage, o.order_number
       FROM dispatch_order_items i JOIN dispatch_orders o ON o.id = i.order_id
       WHERE o.warehouse_id = ? AND i.product_id = ? AND o.status IN ('Pending', 'Backordered', 'Allocated', 'Picking', 'Part Picked')
         AND i.quantity > i.allocated_quantity
       ORDER BY ${PRIORITY_ORDER}, o.required_date IS NULL, o.required_date, o.id
       FOR UPDATE`,
      [warehouseId, productId]
    );

    for (const line of lines) {
      let need = Number(line.shortage);

      for (const entry of remaining) {
        const quantity = Math.min(entry.quantity, need);
        if (quantity <= 0) continue;

        await moveStock(connection, {
          warehouseId, productId, batch: entry.batch, quantity, fromLocationId: receiving, toLocationId: dispatchLocation,
          type: "Cross-dock", reference: line.order_number,
        });
        await createTask(connection, {
          type: "Cross-dock", warehouseId, productId, batch: entry.batch, fromLocationId: receiving, toLocationId: dispatchLocation,
          quantity, doneQuantity: quantity, status: "Done", orderId: line.order_id, orderItemId: line.id, reference,
        });
        const docketSerials = pool.splice(0, quantity);
        if (docketSerials.length) {
          await moveSerials(connection, {
            productId, fromLocationId: receiving, toLocationId: dispatchLocation, quantity, serials: docketSerials, status: "Picked", orderId: line.order_id,
          });
        }
        await connection.query(
          "UPDATE dispatch_order_items SET allocated_quantity = allocated_quantity + ?, picked_quantity = picked_quantity + ? WHERE id = ?",
          [quantity, quantity, line.id]
        );
        await changeReserved(connection, productId, warehouseId, quantity);

        entry.quantity -= quantity;
        need -= quantity;
        docked += quantity;
        orders.add(line.order_number);
      }

      await refreshOrderStatus(connection, line.order_id);
    }
  }

  const putaway = await createPutawayTasks(connection, { warehouseId, productId, fromLocationId: receiving, entries: remaining, reference });
  return { docked, orders: [...orders], putaway };
}

function summarize(units: number, docked: number, orders: Set<string>, putaway: number) {
  return [
    `${units} units received`,
    docked ? `${docked} cross-docked to ${[...orders].join(", ")}` : "",
    putaway ? `${putaway} put-away task${putaway === 1 ? "" : "s"} created` : "",
  ].filter(Boolean).join(" • ");
}

type ReceiptLine = { itemId: unknown; quantity: unknown; batchNumber?: unknown; expiryDate?: unknown; serials?: unknown };

/** Receive a purchase order into RECEIVING (batches, expiry, serials), then cross-dock / create put-away tasks. */
export async function receivePurchaseOrder(
  connection: PoolConnection,
  orderId: number,
  body: { lines?: unknown; notes?: unknown; crossDock?: unknown }
) {
  const [[order]] = await connection.query<RowDataPacket[]>("SELECT * FROM purchase_orders WHERE id = ? FOR UPDATE", [orderId]);
  if (!order) throw new ApiError("Purchase order not found", 404);
  if (!["Ordered", "Partially Received"].includes(order.status)) throw new ApiError("Only approved orders can be received", 409);

  const [items] = await connection.query<RowDataPacket[]>(
    `SELECT i.*, p.name, p.track_serials FROM purchase_order_items i JOIN products p ON p.id = i.product_id
     WHERE i.purchase_order_id = ? FOR UPDATE`,
    [orderId]
  );
  const lines = new Map((Array.isArray(body.lines) ? (body.lines as ReceiptLine[]) : []).map((line) => [Number(line.itemId), line]));
  const crossDock = body.crossDock !== false;
  const orders = new Set<string>();
  let receivedValue = 0;
  let units = 0;
  let docked = 0;
  let putaway = 0;

  for (const item of items) {
    const line = lines.get(item.id);
    const quantity = Number(line?.quantity ?? 0);
    const remaining = item.quantity - item.received_quantity;

    if (quantity === 0) continue;
    if (!Number.isInteger(quantity) || quantity < 0) throw new ApiError("Received quantities must be whole numbers");
    if (quantity > remaining) throw new ApiError(`Cannot receive more than the ${remaining} units outstanding for ${item.name}`, 409);

    const serials = parseSerials(line?.serials) ?? [];
    if (item.track_serials && serials.length !== quantity) {
      throw new ApiError(`${item.name} is serial-tracked: scan ${quantity} serial number${quantity === 1 ? "" : "s"} (${serials.length} entered)`);
    }

    const batchNumber = String(line?.batchNumber ?? "").trim();
    const result = await changeStock(connection, {
      productId: item.product_id,
      warehouseId: order.warehouse_id,
      delta: quantity,
      type: "Purchase Receipt",
      reference: order.po_number,
      notes: String(body.notes ?? "").trim() || null,
      batches: batchNumber ? [{ number: batchNumber, expiry: String(line?.expiryDate ?? "").trim() || null, quantity }] : undefined,
      serials,
      autoPutaway: false,
    });
    const routed = await routeInbound(connection, {
      warehouseId: order.warehouse_id, productId: item.product_id, entries: result.bins, serials: result.serials,
      reference: order.po_number, crossDock,
    });

    await connection.query("UPDATE purchase_order_items SET received_quantity = received_quantity + ? WHERE id = ?", [quantity, item.id]);
    receivedValue += quantity * Number(item.unit_cost);
    units += quantity;
    docked += routed.docked;
    putaway += routed.putaway;
    routed.orders.forEach((number) => orders.add(number));
  }

  if (units === 0) throw new ApiError("Enter the quantity received for at least one line");

  const [[{ outstanding }]] = await connection.query<RowDataPacket[]>(
    "SELECT COALESCE(SUM(quantity - received_quantity), 0) AS outstanding FROM purchase_order_items WHERE purchase_order_id = ?",
    [orderId]
  );
  const status = Number(outstanding) === 0 ? "Received" : "Partially Received";

  await connection.query("UPDATE purchase_orders SET status = ? WHERE id = ?", [status, orderId]);
  await connection.query("UPDATE suppliers SET balance = balance + ? WHERE id = ?", [
    Math.round(receivedValue * (1 + Number(order.tax_rate) / 100) * 100) / 100,
    order.supplier_id,
  ]);

  return `${order.po_number} ${status.toLowerCase()}: ${summarize(units, docked, orders, putaway)}`;
}

/* ---------------------------------------------------------------- transfers */

/** Every new transfer gets a Transfer dispatch order so it can be picked, packed and dispatched like a customer order. */
export async function createTransferOrder(connection: PoolConnection, transferId: number) {
  const [[transfer]] = await connection.query<RowDataPacket[]>(
    `SELECT t.*, w.name AS destination FROM stock_transfers t JOIN warehouses w ON w.id = t.to_warehouse_id WHERE t.id = ?`,
    [transferId]
  );
  return createDispatchOrder(connection, {
    type: "Transfer",
    warehouseId: transfer.from_warehouse_id,
    customerName: transfer.destination,
    destinationWarehouseId: transfer.to_warehouse_id,
    transferId,
    notes: `Stock transfer ${transfer.transfer_number}`,
    items: [{ productId: transfer.product_id, quantity: transfer.quantity }],
  });
}

/** Receive an in-transit transfer at the destination (dispatched batches & serials), then cross-dock / put away. */
export async function receiveTransfer(connection: PoolConnection, transferId: number, { crossDock = true } = {}) {
  const [[transfer]] = await connection.query<RowDataPacket[]>("SELECT * FROM stock_transfers WHERE id = ? FOR UPDATE", [transferId]);
  if (!transfer) throw new ApiError("Transfer not found", 404);
  if (transfer.status !== "In Transit") throw new ApiError(`${transfer.transfer_number} is ${transfer.status}, not in transit`, 409);

  const [[order]] = await connection.query<RowDataPacket[]>("SELECT id FROM dispatch_orders WHERE transfer_id = ? AND status = 'Dispatched'", [transferId]);
  if (!order) throw new ApiError("No dispatched order found for this transfer", 409);

  const [items] = await connection.query<RowDataPacket[]>("SELECT * FROM dispatch_order_items WHERE order_id = ?", [order.id]);
  const orders = new Set<string>();
  let units = 0;
  let docked = 0;
  let putaway = 0;

  for (const item of items) {
    if (item.dispatched_quantity <= 0) continue;

    const [batches] = await connection.query<RowDataPacket[]>(
      `SELECT t.batch_number AS number, SUM(t.done_quantity) AS quantity,
              (SELECT DATE_FORMAT(expiry_date, '%Y-%m-%d') FROM product_batches pb
               WHERE pb.product_id = t.product_id AND pb.warehouse_id = ? AND pb.batch_number = t.batch_number) AS expiry
       FROM warehouse_tasks t
       WHERE t.order_item_id = ? AND t.type IN ('Pick', 'Cross-dock') AND t.status = 'Done' AND t.batch_number <> '' AND t.done_quantity > 0
       GROUP BY t.batch_number`,
      [transfer.from_warehouse_id, item.id]
    );
    const [serials] = await connection.query<RowDataPacket[]>(
      "SELECT serial_number FROM product_serials WHERE dispatch_order_id = ? AND product_id = ? AND status = 'In Transit'",
      [order.id, item.product_id]
    );

    const result = await changeStock(connection, {
      productId: item.product_id,
      warehouseId: transfer.to_warehouse_id,
      delta: item.dispatched_quantity,
      type: "Transfer",
      reference: transfer.transfer_number,
      batches: batches.map((b) => ({ number: b.number as string, expiry: b.expiry as string | null, quantity: Number(b.quantity) })) as BatchQuantity[],
      serials: serials.map((s) => s.serial_number as string),
      autoPutaway: false,
    });
    const routed = await routeInbound(connection, {
      warehouseId: transfer.to_warehouse_id, productId: item.product_id, entries: result.bins, serials: result.serials,
      reference: transfer.transfer_number, crossDock,
    });

    units += item.dispatched_quantity;
    docked += routed.docked;
    putaway += routed.putaway;
    routed.orders.forEach((number) => orders.add(number));
  }

  await connection.query("UPDATE stock_transfers SET status = 'Completed', completed_at = NOW() WHERE id = ?", [transferId]);
  return `${transfer.transfer_number} completed: ${summarize(units, docked, orders, putaway)}`;
}

/**
 * "Complete" a transfer directly from Stock Management. In-transit transfers are received; pending transfers that
 * have not been picked skip the pick/dispatch flow and move instantly (their dispatch order is cancelled).
 */
export async function completeTransfer(connection: PoolConnection, transferId: number) {
  const [[transfer]] = await connection.query<RowDataPacket[]>("SELECT * FROM stock_transfers WHERE id = ? FOR UPDATE", [transferId]);
  if (!transfer) throw new ApiError("Transfer not found", 404);
  if (["Completed", "Cancelled"].includes(transfer.status)) throw new ApiError(`This transfer is already ${transfer.status.toLowerCase()}`, 409);
  if (transfer.status === "In Transit") return receiveTransfer(connection, transferId);

  const [[order]] = await connection.query<RowDataPacket[]>(
    `SELECT o.id, o.status, COALESCE(SUM(i.picked_quantity), 0) AS picked
     FROM dispatch_orders o JOIN dispatch_order_items i ON i.order_id = o.id
     WHERE o.transfer_id = ? AND o.status NOT IN ('Cancelled', 'Dispatched') GROUP BY o.id`,
    [transferId]
  );
  if (order && (Number(order.picked) > 0 || order.status === "Picking")) {
    throw new ApiError("This transfer is being picked. Finish picking and dispatch it from Picking & Dispatch.", 409);
  }
  if (order) await cancelOrder(connection, order.id, { cancelTransfer: false });

  const common = { productId: transfer.product_id, type: "Transfer", reference: transfer.transfer_number };
  const out = await changeStock(connection, { ...common, warehouseId: transfer.from_warehouse_id, delta: -transfer.quantity });
  await changeStock(connection, {
    ...common, warehouseId: transfer.to_warehouse_id, delta: transfer.quantity, batches: out.allocations, serials: out.serials,
  });
  await connection.query("UPDATE stock_transfers SET status = 'Completed', completed_at = NOW() WHERE id = ?", [transfer.id]);

  return `${transfer.transfer_number} completed`;
}

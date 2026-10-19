import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { ApiError, queryRows } from "./crud";
import { currentUserName } from "./auth";
import { batchesInBin } from "./locations";
import { changeStock } from "./stock";

/** Base count interval (days) by ABC class of 90-day usage value. */
export const CLASS_INTERVAL_DAYS = { A: 30, B: 60, C: 90 } as const;

type RiskClass = keyof typeof CLASS_INTERVAL_DAYS;

export type ScheduleRow = {
  productId: number;
  warehouseId: number;
  product: string;
  sku: string;
  warehouse: string;
  quantity: number;
  stockValue: number;
  usageValue: number;
  riskClass: RiskClass;
  riskScore: number;
  factors: string[];
  intervalDays: number;
  lastCounted: string | null;
  nextDue: string;
  overdue: boolean;
  openCounts: number;
};

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

/**
 * Risk-based cycle-count schedule per product per warehouse.
 * - ABC class from the last 90 days of outbound usage value (A = top 80%, B = next 15%, C = rest)
 * - Risk score 0-100 from count variances (180d), manual adjustments and short picks (30d), stock value on hand,
 *   expiring batches, negative stock and the ABC class
 * - Interval = class interval × (1, 0.75, 0.5 or 0.25 as the score rises), minimum 7 days; never counted = due now
 */
export async function computeSchedule(warehouseId?: number | null): Promise<ScheduleRow[]> {
  const rows = await queryRows<RowDataPacket>(
    `SELECT s.product_id AS productId, s.warehouse_id AS warehouseId, p.name AS product, p.sku, w.name AS warehouse,
            s.quantity, s.quantity * p.cost AS stockValue,
            COALESCE(u.usage_value, 0) AS usageValue,
            COALESCE(v.variances, 0) + COALESCE(sc.variances, 0) AS variances,
            COALESCE(a.adjustments, 0) AS adjustments,
            COALESCE(sp.short_picks, 0) AS shortPicks,
            COALESCE(e.expiring, 0) AS expiring,
            DATE_FORMAT(GREATEST(COALESCE(c.last_counted, '1000-01-01'), COALESCE(sc.last_counted, '1000-01-01')), '%Y-%m-%d') AS lastCounted,
            COALESCE(o.open_counts, 0) AS openCounts
     FROM stock_levels s
     JOIN products p ON p.id = s.product_id
     JOIN warehouses w ON w.id = s.warehouse_id AND w.status = 'Active'
     LEFT JOIN (
       SELECT m.product_id, m.warehouse_id, SUM(-m.quantity * p2.cost) AS usage_value
       FROM stock_movements m JOIN products p2 ON p2.id = m.product_id
       WHERE m.type IN ('Sale', 'Dispatch') AND m.quantity < 0 AND m.created_at >= NOW() - INTERVAL 90 DAY
       GROUP BY m.product_id, m.warehouse_id
     ) u ON u.product_id = s.product_id AND u.warehouse_id = s.warehouse_id
     LEFT JOIN (
       SELECT product_id, warehouse_id, MAX(counted_at) AS last_counted,
              SUM(variance <> 0 AND counted_at >= NOW() - INTERVAL 180 DAY) AS variances
       FROM cycle_counts WHERE status = 'Counted' GROUP BY product_id, warehouse_id
     ) c ON c.product_id = s.product_id AND c.warehouse_id = s.warehouse_id
     LEFT JOIN (
       SELECT product_id, warehouse_id, MAX(created_at) AS last_counted,
              SUM(created_at >= NOW() - INTERVAL 180 DAY) AS variances
       FROM stock_movements WHERE type = 'Stock Count' AND COALESCE(reference, '') NOT LIKE 'CC-%' GROUP BY product_id, warehouse_id
     ) sc ON sc.product_id = s.product_id AND sc.warehouse_id = s.warehouse_id
     LEFT JOIN (
       SELECT product_id, warehouse_id, COUNT(*) AS adjustments FROM stock_movements
       WHERE type = 'Adjustment' AND created_at >= NOW() - INTERVAL 30 DAY GROUP BY product_id, warehouse_id
     ) a ON a.product_id = s.product_id AND a.warehouse_id = s.warehouse_id
     LEFT JOIN (
       SELECT product_id, warehouse_id, COUNT(*) AS short_picks FROM warehouse_tasks
       WHERE type = 'Pick' AND status = 'Done' AND done_quantity < quantity AND completed_at >= NOW() - INTERVAL 30 DAY
       GROUP BY product_id, warehouse_id
     ) sp ON sp.product_id = s.product_id AND sp.warehouse_id = s.warehouse_id
     LEFT JOIN (
       SELECT product_id, warehouse_id, COUNT(*) AS expiring FROM product_batches
       WHERE quantity > 0 AND expiry_date IS NOT NULL AND expiry_date <= CURDATE() + INTERVAL 30 DAY
       GROUP BY product_id, warehouse_id
     ) e ON e.product_id = s.product_id AND e.warehouse_id = s.warehouse_id
     LEFT JOIN (
       SELECT product_id, warehouse_id, COUNT(*) AS open_counts FROM cycle_counts WHERE status = 'Open' GROUP BY product_id, warehouse_id
     ) o ON o.product_id = s.product_id AND o.warehouse_id = s.warehouse_id
     WHERE (? IS NULL OR s.warehouse_id = ?) AND (s.quantity <> 0 OR COALESCE(u.usage_value, 0) > 0)`,
    [warehouseId ?? null, warehouseId ?? null]
  );

  const totalUsage = rows.reduce((sum, row) => sum + Number(row.usageValue), 0);
  const valueThreshold = [...rows].map((row) => Number(row.stockValue)).sort((a, b) => b - a)[Math.floor(rows.length * 0.2)] ?? Infinity;
  const classes = new Map<RowDataPacket, RiskClass>();
  let cumulative = 0;

  for (const row of [...rows].sort((a, b) => Number(b.usageValue) - Number(a.usageValue))) {
    cumulative += Number(row.usageValue);
    const share = totalUsage > 0 ? cumulative / totalUsage : 1;
    classes.set(row, Number(row.usageValue) <= 0 ? "C" : share <= 0.8 ? "A" : share <= 0.95 ? "B" : "C");
  }

  const today = isoDate(new Date());

  return rows
    .map((row) => {
      const riskClass = classes.get(row) ?? "C";
      const factors: string[] = [];
      let score = 0;
      const add = (points: number, label: string) => {
        if (points <= 0) return;
        score += points;
        factors.push(label);
      };

      add(Math.min(Number(row.variances) * 15, 30), `${row.variances} count variance${row.variances === 1 ? "" : "s"} (180d)`);
      add(Math.min(Number(row.shortPicks) * 15, 30), `${row.shortPicks} short pick${row.shortPicks === 1 ? "" : "s"} (30d)`);
      add(Math.min(Number(row.adjustments) * 10, 20), `${row.adjustments} manual adjustment${row.adjustments === 1 ? "" : "s"} (30d)`);
      add(Number(row.stockValue) > 0 && Number(row.stockValue) >= valueThreshold ? 15 : 0, "High value on hand");
      add(Number(row.expiring) > 0 ? 10 : 0, "Batches expiring ≤ 30 days");
      add(Number(row.quantity) < 0 ? 25 : 0, "Negative stock");
      add(riskClass === "A" ? 10 : riskClass === "B" ? 5 : 0, `Class ${riskClass} usage`);
      score = Math.min(score, 100);

      const factor = score >= 60 ? 0.25 : score >= 40 ? 0.5 : score >= 20 ? 0.75 : 1;
      const intervalDays = Math.max(7, Math.round(CLASS_INTERVAL_DAYS[riskClass] * factor));
      const lastCounted = row.lastCounted === "1000-01-01" ? null : (row.lastCounted as string);
      const due = lastCounted ? new Date(`${lastCounted}T00:00:00Z`) : new Date(`${today}T00:00:00Z`);
      if (lastCounted) due.setUTCDate(due.getUTCDate() + intervalDays);
      const nextDue = isoDate(due);

      return {
        productId: row.productId,
        warehouseId: row.warehouseId,
        product: row.product,
        sku: row.sku,
        warehouse: row.warehouse,
        quantity: Number(row.quantity),
        stockValue: Number(row.stockValue),
        usageValue: Number(row.usageValue),
        riskClass,
        riskScore: score,
        factors,
        intervalDays,
        lastCounted,
        nextDue,
        overdue: nextDue <= today,
        openCounts: Number(row.openCounts),
      };
    })
    .sort((a, b) => a.nextDue.localeCompare(b.nextDue) || b.riskScore - a.riskScore);
}

/** Create one open count task (per bin when `locationId` is given). */
export async function createCount(
  connection: PoolConnection,
  count: { warehouseId: number; productId: number; locationId?: number | null; riskClass?: string | null; riskScore?: number | null; reason: string; dueDate?: string }
) {
  const [result] = await connection.query<ResultSetHeader>(
    `INSERT INTO cycle_counts (count_number, warehouse_id, location_id, product_id, risk_class, risk_score, reason, due_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURDATE()))`,
    [
      `TMP-${crypto.randomUUID()}`, count.warehouseId, count.locationId ?? null, count.productId,
      count.riskClass ?? null, count.riskScore ?? null, count.reason.slice(0, 255), count.dueDate ?? null,
    ]
  );
  await connection.query("UPDATE cycle_counts SET count_number = CONCAT('CC-', LPAD(id, 5, '0')) WHERE id = ?", [result.insertId]);
  return result.insertId;
}

/** Turn due schedule rows into open count tasks — one per bin holding the product (or warehouse-level if none). */
export async function generateCounts(connection: PoolConnection, { warehouseId, includeNotDue = false, limit = 50 }: { warehouseId?: number | null; includeNotDue?: boolean; limit?: number }) {
  const due = (await computeSchedule(warehouseId)).filter((row) => row.openCounts === 0 && (includeNotDue || row.overdue)).slice(0, limit);
  let created = 0;

  for (const row of due) {
    const [bins] = await connection.query<RowDataPacket[]>(
      `SELECT DISTINCT ls.location_id AS id FROM location_stock ls JOIN warehouse_locations l ON l.id = ls.location_id
       WHERE ls.product_id = ? AND l.warehouse_id = ? AND ls.quantity > 0 AND l.type <> 'Dispatch'`,
      [row.productId, row.warehouseId]
    );
    const reason = `Class ${row.riskClass}, risk ${row.riskScore}${row.factors.length ? `: ${row.factors.join("; ")}` : ""}`;

    for (const locationId of bins.length ? bins.map((bin) => bin.id as number) : [null]) {
      await createCount(connection, { warehouseId: row.warehouseId, productId: row.productId, locationId, riskClass: row.riskClass, riskScore: row.riskScore, reason, dueDate: row.nextDue < isoDate(new Date()) ? undefined : row.nextDue });
      created++;
    }
  }

  return created;
}

/** Record a blind count. Bin-level counts adjust that bin; warehouse-level counts adjust the warehouse total. */
export async function submitCount(connection: PoolConnection, countId: number, countedInput: unknown) {
  const counted = Number(countedInput);
  if (!Number.isInteger(counted) || counted < 0) throw new ApiError("Counted quantity must be a whole number of 0 or more");

  const [[count]] = await connection.query<RowDataPacket[]>("SELECT * FROM cycle_counts WHERE id = ? FOR UPDATE", [countId]);
  if (!count) throw new ApiError("Count not found", 404);
  if (count.status !== "Open") throw new ApiError(`${count.count_number} is already ${count.status.toLowerCase()}`, 409);

  const [[system]] = count.location_id
    ? await connection.query<RowDataPacket[]>(
        "SELECT COALESCE(SUM(quantity), 0) AS quantity FROM location_stock WHERE location_id = ? AND product_id = ? FOR UPDATE",
        [count.location_id, count.product_id]
      )
    : await connection.query<RowDataPacket[]>(
        "SELECT COALESCE(SUM(quantity), 0) AS quantity FROM stock_levels WHERE warehouse_id = ? AND product_id = ? FOR UPDATE",
        [count.warehouse_id, count.product_id]
      );

  const systemQuantity = Number(system.quantity);
  const variance = counted - systemQuantity;

  if (variance !== 0) {
    await changeStock(connection, {
      productId: count.product_id,
      warehouseId: count.warehouse_id,
      delta: variance,
      type: "Cycle Count",
      reference: count.count_number,
      notes: `Counted ${counted}, system had ${systemQuantity}`,
      locationId: count.location_id,
      allowNegative: true,
      batches: variance < 0 && count.location_id ? await batchesInBin(connection, count.location_id, count.product_id, -variance) : undefined,
    });
  }

  await connection.query(
    `UPDATE cycle_counts SET status = 'Counted', system_quantity = ?, counted_quantity = ?, variance = ?, counted_by = ?, counted_at = NOW()
     WHERE id = ?`,
    [systemQuantity, counted, variance, currentUserName(), countId]
  );

  return { number: count.count_number as string, variance };
}

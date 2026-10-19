import { readFile } from "node:fs/promises";
import path from "node:path";
import mysql from "mysql2/promise";
import { hashPassword } from "./password";

const DEFAULT_ADMIN_PASSWORD = "Retail@123";

const config = {
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  charset: "UTF8MB4_UNICODE_CI",
  connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT || 15000),
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== "false" } : undefined,
};

const database = process.env.DB_NAME || "retailerp";

const SCHEMA_VERSION = 4;
const SCHEMA_VERSION_KEY = "__schema_version";

const globalForDb = globalThis as unknown as { pool?: mysql.Pool; schemaReady?: Promise<void>; schemaVersion?: number };

// One pool per server instance (survives dev hot reloads). Serverless platforms such as Vercel run many small
// instances, so keep each pool small — shared hosts (cPanel) usually cap connections per database user.
const pool = (globalForDb.pool ??= mysql.createPool({
  ...config,
  database,

  waitForConnections: true,
  connectionLimit: Number(process.env.DB_POOL_LIMIT || (process.env.VERCEL ? 3 : 10)),
  maxIdle: Number(process.env.DB_POOL_LIMIT || (process.env.VERCEL ? 3 : 10)),
  idleTimeout: 60_000,
  enableKeepAlive: true,
  queueLimit: 0,
  decimalNumbers: true,
  dateStrings: true,
}));

const columnMigrations: [table: string, column: string, definition: string][] = [
  ["sales", "warehouse_id", "INT NULL"],
  ["sales", "customer_id", "INT NULL"],
  ["sales", "currency", "VARCHAR(3) NOT NULL DEFAULT 'USD'"],
  ["sales", "exchange_rate", "DECIMAL(14,6) NOT NULL DEFAULT 1"],
  ["sales", "price_tier", "VARCHAR(20) NOT NULL DEFAULT 'Retail'"],
  ["sales", "refunded_total", "DECIMAL(12,2) NOT NULL DEFAULT 0"],
  ["sales", "notes", "VARCHAR(255) NULL"],
  ["sales", "converted_sale_id", "BIGINT UNSIGNED NULL"],
  ["sales", "completed_at", "DATETIME NULL"],
  ["sale_items", "unit_name", "VARCHAR(50) NOT NULL DEFAULT 'Unit'"],
  ["sale_items", "unit_multiplier", "INT NOT NULL DEFAULT 1"],
  ["sale_items", "returned_quantity", "INT NOT NULL DEFAULT 0"],
  ["sale_items", "unit_cost", "DECIMAL(12,2) NOT NULL DEFAULT 0"],
  ["products", "wholesale_price", "DECIMAL(12,2) NULL"],
  ["products", "track_batches", "TINYINT(1) NOT NULL DEFAULT 0"],
  ["customers", "price_tier", "VARCHAR(20) NOT NULL DEFAULT 'Retail'"],
  ["products", "track_serials", "TINYINT(1) NOT NULL DEFAULT 0"],
  ["stock_movements", "location_id", "INT NULL"],
];

/**
 * Keeps the bin ledger complete: every warehouse gets system RECEIVING / DISPATCH locations, and any
 * stock not yet held in a bin (stock created before bin tracking, or seeded directly) is placed in RECEIVING.
 * Idempotent; only fills positive gaps.
 */
async function reconcileLocations(connection: mysql.Connection) {
  for (const [code, type, zone, sequence] of [["RECEIVING", "Receiving", "Inbound", 0], ["DISPATCH", "Dispatch", "Outbound", 99999]] as const) {
    await connection.query(
      `INSERT INTO warehouse_locations (warehouse_id, code, zone, type, barcode, pick_sequence, is_system)
       SELECT w.id, ?, ?, ?, CONCAT(w.code, '-', ?), ?, 1 FROM warehouses w
       WHERE NOT EXISTS (SELECT 1 FROM warehouse_locations l WHERE l.warehouse_id = w.id AND l.is_system = 1 AND l.type = ?)`,
      [code, zone, type, code, sequence, type]
    );
  }

  const located = (groupByBatch: boolean) => `
    LEFT JOIN (
      SELECT l.warehouse_id, ls.product_id, ${groupByBatch ? "ls.batch_number," : ""} SUM(ls.quantity) AS qty
      FROM location_stock ls JOIN warehouse_locations l ON l.id = ls.location_id
      GROUP BY l.warehouse_id, ls.product_id${groupByBatch ? ", ls.batch_number" : ""}
    ) located ON located.warehouse_id = src.warehouse_id AND located.product_id = src.product_id
      ${groupByBatch ? "AND located.batch_number = src.batch_number" : ""}`;

  await connection.query(`
    INSERT INTO location_stock (location_id, product_id, batch_number, quantity)
    SELECT r.id, src.product_id, src.batch_number, src.quantity - COALESCE(located.qty, 0)
    FROM product_batches src
    JOIN warehouse_locations r ON r.warehouse_id = src.warehouse_id AND r.is_system = 1 AND r.type = 'Receiving'
    ${located(true)}
    WHERE src.quantity > COALESCE(located.qty, 0)
    ON DUPLICATE KEY UPDATE quantity = location_stock.quantity + VALUES(quantity)`);

  await connection.query(`
    INSERT INTO location_stock (location_id, product_id, batch_number, quantity)
    SELECT r.id, src.product_id, '', src.quantity - COALESCE(located.qty, 0)
    FROM stock_levels src
    JOIN warehouse_locations r ON r.warehouse_id = src.warehouse_id AND r.is_system = 1 AND r.type = 'Receiving'
    ${located(false)}
    WHERE src.quantity > COALESCE(located.qty, 0)
    ON DUPLICATE KEY UPDATE quantity = location_stock.quantity + VALUES(quantity)`);
}

async function migrate(connection: mysql.Connection) {
  const [columns] = await connection.query<mysql.RowDataPacket[]>(
    "SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ?",
    [database]
  );
  const existing = new Map(columns.map((c) => [`${c.TABLE_NAME}.${c.COLUMN_NAME}`, c.DATA_TYPE as string]));

  for (const [table, column, definition] of columnMigrations) {
    if (!existing.has(`${table}.${column}`)) {
      await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
    }
  }

  if (existing.get("sales.status") === "enum") {
    await connection.query("ALTER TABLE sales MODIFY status VARCHAR(20) NOT NULL DEFAULT 'COMPLETED'");
  }
}

async function bootstrapAdministrator(connection: mysql.Connection) {
  const [[{ count }]] = await connection.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS count FROM users");
  if (count > 0) return;

  const email = (process.env.ADMIN_EMAIL || "admin@retailerp.local").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;

  if (!password && process.env.NODE_ENV === "production") {
    console.error("No users exist. Set ADMIN_EMAIL and ADMIN_PASSWORD to create the first administrator.");
    return;
  }

  await connection.query(
    "INSERT INTO users (name, email, role, status, password_hash) VALUES ('System Administrator', ?, 'Administrator', 'Active', ?)",
    [email, await hashPassword(password || DEFAULT_ADMIN_PASSWORD)]
  );
  console.warn(`Created first administrator ${email}${password ? "" : ` with the default password "${DEFAULT_ADMIN_PASSWORD}"`}. Change it under Users.`);
}

/**
 * Hosted databases (e.g. cPanel) are created in the control panel and the DB user normally has no
 * CREATE DATABASE privilege, so the database is only created when it does not exist yet (local XAMPP).
 */
async function connectForSchema() {
  try {
    return await mysql.createConnection({ ...config, database, multipleStatements: true });
  } catch (error) {
    if ((error as { code?: string }).code !== "ER_BAD_DB_ERROR") throw error;

    const connection = await mysql.createConnection({ ...config, multipleStatements: true });
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${database.replace(/`/g, "")}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    await connection.changeUser({ database });
    return connection;
  }
}

/** Tables created with the server default (often latin1 on shared hosting) cannot store characters such as •, × or —. */
async function convertToUtf8mb4(connection: mysql.Connection) {
  const [tables] = await connection.query<mysql.RowDataPacket[]>(
    `SELECT TABLE_NAME FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' AND TABLE_COLLATION NOT LIKE 'utf8mb4%'`,
    [database]
  );
  if (tables.length === 0) return;

  await connection.query("SET FOREIGN_KEY_CHECKS = 0");
  try {
    for (const { TABLE_NAME } of tables) {
      await connection.query(`ALTER TABLE \`${TABLE_NAME}\` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    }
  } finally {
    await connection.query("SET FOREIGN_KEY_CHECKS = 1");
  }

  await connection
    .query(`ALTER DATABASE \`${database.replace(/`/g, "")}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
    .catch(() => undefined);
}

/** One quick query per server start: skip the full schema run when this version was already applied. */
async function schemaIsCurrent() {
  try {
    const [[row]] = await pool.query<mysql.RowDataPacket[]>("SELECT setting_value FROM settings WHERE setting_key = ?", [SCHEMA_VERSION_KEY]);
    return row?.setting_value === String(SCHEMA_VERSION);
  } catch (error) {
    if (["ER_NO_SUCH_TABLE", "ER_BAD_DB_ERROR"].includes((error as { code?: string }).code ?? "")) return false;
    throw error;
  }
}

async function applySchema() {
  if (await schemaIsCurrent()) return;

  const connection = await connectForSchema();

  try {
    await connection.query(
      await readFile(path.join(process.cwd(), "db", "schema.sql"), "utf8")
    );
    await convertToUtf8mb4(connection);
    await migrate(connection);
    await bootstrapAdministrator(connection);
    await reconcileLocations(connection);
    await connection.query(
      "INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)",
      [SCHEMA_VERSION_KEY, String(SCHEMA_VERSION)]
    );
  } finally {
    await connection.end();
  }
}

export function ensureSchema() {
  if (globalForDb.schemaVersion !== SCHEMA_VERSION) {
    globalForDb.schemaVersion = SCHEMA_VERSION;
    globalForDb.schemaReady = undefined;
  }

  globalForDb.schemaReady ??= applySchema().catch((error) => {
    globalForDb.schemaReady = undefined;
    throw error;
  });

  return globalForDb.schemaReady;
}

export default pool;

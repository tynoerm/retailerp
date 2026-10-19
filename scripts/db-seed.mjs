import { randomBytes, scryptSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import mysql from "mysql2/promise";

try {
  process.loadEnvFile(".env.local");
} catch {}

const database = process.env.DB_NAME || "retailerp";
const config = {
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  charset: "UTF8MB4_UNICODE_CI",
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== "false" } : undefined,
  multipleStatements: true,
};

// Hosted databases (cPanel) already exist and the user usually cannot CREATE DATABASE; only create it locally.
let connection;
try {
  connection = await mysql.createConnection({ ...config, database });
} catch (error) {
  if (error.code !== "ER_BAD_DB_ERROR") throw error;
  connection = await mysql.createConnection(config);
  await connection.query(`CREATE DATABASE \`${database.replace(/`/g, "")}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await connection.changeUser({ database });
}
let seed = 42;
const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const pick = (items) => items[Math.floor(random() * items.length)];
const between = (min, max) => min + Math.floor(random() * (max - min + 1));

async function seedSalesHistory(days = 60) {
  const [[{ existing }]] = await connection.query("SELECT COUNT(*) AS existing FROM sales WHERE sale_number LIKE 'DEMO-%'");
  if (existing > 0) return console.log("Demo sales already present, skipping");

  const [products] = await connection.query("SELECT id, name, sku, price FROM products");
  const [customers] = await connection.query("SELECT name FROM customers WHERE status <> 'Inactive'");
  if (products.length === 0) return;

  const names = ["Walk-in Customer", "Walk-in Customer", "Walk-in Customer", ...customers.map((c) => c.name)];
  const methods = ["Cash", "Cash", "Card", "Mobile", "Bank"];
  let count = 0;

  await connection.beginTransaction();

  for (let day = days; day >= 1; day--) {
    for (let n = between(4, 10); n > 0; n--) {
      const date = new Date();
      date.setDate(date.getDate() - day);
      date.setHours(between(8, 19), between(0, 59), between(0, 59));

      const lines = [...new Map(Array.from({ length: between(1, 4) }, () => {
        const product = pick(products);
        return [product.id, { ...product, quantity: between(1, 5) }];
      })).values()];

      const subtotal = lines.reduce((sum, line) => sum + Number(line.price) * line.quantity, 0);
      const tax = Math.round(subtotal * 15) / 100;
      const total = subtotal + tax;
      const method = pick(methods);
      const paid = method === "Cash" ? Math.ceil(total / 5) * 5 : total;

      const [result] = await connection.query(
        `INSERT INTO sales (sale_number, customer, payment_method, subtotal, discount, tax_rate, tax, total, amount_paid, change_amount, status, created_at)
         VALUES (?, ?, ?, ?, 0, 15, ?, ?, ?, ?, 'COMPLETED', ?)`,
        [`DEMO-${String(++count).padStart(5, "0")}`, pick(names), method, subtotal.toFixed(2), tax.toFixed(2), total.toFixed(2), paid.toFixed(2), (paid - total).toFixed(2), date]
      );

      await connection.query(
        "INSERT INTO sale_items (sale_id, product_id, product_name, sku, quantity, unit_price, line_total) VALUES ?",
        [lines.map((line) => [result.insertId, line.id, line.name, line.sku, line.quantity, line.price, (Number(line.price) * line.quantity).toFixed(2)])]
      );
    }
  }

  await connection.commit();
  console.log(`Seeded ${count} demo sales`);
}

const DEMO_PASSWORD = "Retail@123";

function hashPassword(password) {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$${salt.toString("base64")}$${key.toString("base64")}`;
}

async function seedUsers() {
  const users = [
    ["System Administrator", "admin@retailerp.local", "Administrator"],
    ["Store Manager", "manager@retailerp.local", "Manager"],
    ["Front Cashier", "cashier@retailerp.local", "Cashier"],
    ["Warehouse Storekeeper", "storekeeper@retailerp.local", "Storekeeper"],
  ];

  const [result] = await connection.query(
    "INSERT IGNORE INTO users (name, email, role, status, password_hash) VALUES ?",
    [users.map(([name, email, role]) => [name, email, role, "Active", hashPassword(DEMO_PASSWORD)])]
  );
  console.log(`Seeded ${result.affectedRows} demo users (password: ${DEMO_PASSWORD})`);
}

try {
  for (const file of ["db/schema.sql", "db/seed.sql"]) {
    await connection.query(await readFile(file, "utf8"));
    console.log(`Applied ${file}`);
  }

  await seedUsers();
  await seedSalesHistory();

  // Make the app re-run its schema/migration step on next start (converts charsets, places seeded stock in bins).
  await connection.query("DELETE FROM settings WHERE setting_key = '__schema_version'");
} finally {
  await connection.end();
}

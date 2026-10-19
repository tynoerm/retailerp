import { NextResponse } from "next/server";
import { handle, queryRows } from "@/app/lib/crud";

const change = (current: number, previous: number) =>
  previous === 0 ? (current > 0 ? 100 : 0) : Math.round(((current - previous) / previous) * 1000) / 10;

export const GET = handle(async () => {
  const [[sales], [inventory], lowStock, recent, [counts]] = await Promise.all([
    queryRows<{ today: number; yesterday: number; ordersToday: number; ordersYesterday: number }>(`
      SELECT
        COALESCE(SUM(CASE WHEN DATE(created_at) = CURDATE() THEN total END), 0) AS today,
        COALESCE(SUM(CASE WHEN DATE(created_at) = CURDATE() - INTERVAL 1 DAY THEN total END), 0) AS yesterday,
        COUNT(CASE WHEN DATE(created_at) = CURDATE() THEN 1 END) AS ordersToday,
        COUNT(CASE WHEN DATE(created_at) = CURDATE() - INTERVAL 1 DAY THEN 1 END) AS ordersYesterday
      FROM sales
      WHERE status = 'COMPLETED' AND created_at >= CURDATE() - INTERVAL 1 DAY
    `),
    queryRows<{ value: number; products: number }>(`
      SELECT COALESCE(SUM(s.quantity * p.cost), 0) AS value, COUNT(DISTINCT p.id) AS products
      FROM products p LEFT JOIN stock_levels s ON s.product_id = p.id
    `),
    queryRows<{ product: string; sku: string; stock: number; reorder: number; warehouse: string }>(`
      SELECT p.name AS product, p.sku, s.quantity AS stock, p.reorder_level AS reorder, w.name AS warehouse
      FROM stock_levels s
      JOIN products p ON p.id = s.product_id
      JOIN warehouses w ON w.id = s.warehouse_id
      WHERE s.quantity <= p.reorder_level
      ORDER BY (s.quantity / GREATEST(p.reorder_level, 1)), p.name
    `),
    queryRows(`
      SELECT s.id, s.sale_number AS number, s.customer, s.payment_method AS payment, s.total AS amount,
             s.status, s.created_at AS createdAt,
             CAST(COALESCE(SUM(i.quantity), 0) AS SIGNED) AS items
      FROM sales s
      LEFT JOIN sale_items i ON i.sale_id = s.id
      GROUP BY s.id
      ORDER BY s.created_at DESC, s.id DESC
      LIMIT 8
    `),
    queryRows<{ warehouses: number; overdueInvoices: number; pendingOrders: number }>(`
      SELECT
        (SELECT COUNT(*) FROM warehouses WHERE status = 'Active') AS warehouses,
        (SELECT COUNT(*) FROM invoices WHERE amount_paid < total AND due_date < CURDATE()) AS overdueInvoices,
        (SELECT COUNT(*) FROM purchase_orders WHERE status IN ('Pending Approval', 'Ordered', 'Partially Received')) AS pendingOrders
    `),
  ]);

  return NextResponse.json({
    success: true,
    data: {
      salesToday: sales.today,
      salesChange: change(sales.today, sales.yesterday),
      ordersToday: sales.ordersToday,
      ordersChange: change(sales.ordersToday, sales.ordersYesterday),
      inventoryValue: inventory.value,
      productCount: inventory.products,
      lowStockCount: lowStock.length,
      outOfStockCount: lowStock.filter((item) => item.stock <= 0).length,
      lowStockItems: lowStock.slice(0, 5),
      recentTransactions: recent,
      ...counts,
    },
  });
});

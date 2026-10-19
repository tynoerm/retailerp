INSERT IGNORE INTO customers (code, name, email, phone, address, status) VALUES
  ('CUS-001', 'John Customer', 'john@example.com', '+263 771 000 111', 'Borrowdale, Harare', 'Active'),
  ('CUS-002', 'Business Customer', 'accounts@bizco.co.zw', '+263 772 000 222', 'Eastlea, Harare', 'VIP'),
  ('CUS-003', 'VIP Customer', 'vip@example.com', '+263 773 000 333', 'Mount Pleasant, Harare', 'VIP'),
  ('CUS-004', 'Grace Mutasa', 'grace.m@example.com', '+263 774 000 444', 'Avondale, Harare', 'Active'),
  ('CUS-005', 'Peter Banda', 'peter.b@example.com', '+263 775 000 555', 'Waterfalls, Harare', 'Inactive');

INSERT IGNORE INTO suppliers (code, name, contact, email, phone, category, balance, status) VALUES
  ('SUP-001', 'Dairibord Zimbabwe', 'Farai Gumbo', 'orders@dairibord.example', '+263 242 000 101', 'Dairy', 12450.00, 'Active'),
  ('SUP-002', 'Lobels Bakery', 'Chipo Ndlovu', 'sales@lobels.example', '+263 242 000 202', 'Bakery', 4820.50, 'Active'),
  ('SUP-003', 'Olivine Industries', 'Tafadzwa Sibanda', 'trade@olivine.example', '+263 242 000 303', 'Cooking Oil', 18300.00, 'Active'),
  ('SUP-004', 'Unilever Distributors', 'Kudzai Phiri', 'dist@unilever.example', '+263 242 000 404', 'Personal Care', 9675.25, 'Active'),
  ('SUP-005', 'Harare Fresh Produce', 'Nyasha Chari', 'hello@hfp.example', '+263 242 000 505', 'Fresh Produce', 0.00, 'Inactive');

INSERT IGNORE INTO invoices (invoice_number, customer_id, customer_name, issued_date, due_date, tax_rate) VALUES
  ('INV-3011', (SELECT id FROM customers WHERE code = 'CUS-002'), 'Business Customer', '2026-08-20', '2026-09-19', 15),
  ('INV-3012', (SELECT id FROM customers WHERE code = 'CUS-004'), 'Grace Mutasa', '2026-08-28', '2026-09-11', 15),
  ('INV-3013', (SELECT id FROM customers WHERE code = 'CUS-001'), 'John Customer', '2026-09-10', '2026-09-24', 15),
  ('INV-3014', (SELECT id FROM customers WHERE code = 'CUS-003'), 'VIP Customer', '2026-09-15', '2026-10-15', 15);

INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, line_total)
SELECT i.id, x.description, x.quantity, x.unit_price, x.quantity * x.unit_price
FROM invoices i
JOIN (
  SELECT 'INV-3011' AS inv, 'Cooking Oil 2L (case of 12)' AS description, 80 AS quantity, 58.80 AS unit_price
  UNION ALL SELECT 'INV-3011', 'Rice 5kg', 150, 11.20
  UNION ALL SELECT 'INV-3012', 'Fresh Milk 1L', 120, 1.40
  UNION ALL SELECT 'INV-3012', 'Bread Large', 130, 1.30
  UNION ALL SELECT 'INV-3013', 'Shampoo 400ml', 70, 8.50
  UNION ALL SELECT 'INV-3014', 'Assorted Groceries Hamper', 22, 85.00
) x ON x.inv = i.invoice_number
WHERE NOT EXISTS (SELECT 1 FROM invoice_items ii WHERE ii.invoice_id = i.id);

UPDATE invoices i
JOIN (SELECT invoice_id, SUM(line_total) AS subtotal FROM invoice_items GROUP BY invoice_id) s ON s.invoice_id = i.id
SET i.subtotal = s.subtotal,
    i.tax = ROUND(s.subtotal * i.tax_rate / 100, 2),
    i.total = s.subtotal + ROUND(s.subtotal * i.tax_rate / 100, 2);

INSERT IGNORE INTO payments (payment_number, invoice_id, reference, party, method, amount, paid_at, status) VALUES
  ('PAY-20001', (SELECT id FROM invoices WHERE invoice_number = 'INV-3011'), 'INV-3011', 'Business Customer', 'Bank', 7341.60, '2026-09-18 10:15:00', 'Completed'),
  ('PAY-20002', (SELECT id FROM invoices WHERE invoice_number = 'INV-3013'), 'INV-3013', 'John Customer', 'Card', 684.25, '2026-09-20 14:26:00', 'Completed'),
  ('PAY-20003', (SELECT id FROM invoices WHERE invoice_number = 'INV-3014'), 'INV-3014', 'VIP Customer', 'Mobile', 1000.00, '2026-09-20 14:10:00', 'Completed'),
  ('PAY-20004', (SELECT id FROM invoices WHERE invoice_number = 'INV-3012'), 'INV-3012', 'Grace Mutasa', 'Card', 92.40, '2026-09-19 16:45:00', 'Failed');

UPDATE invoices i
SET i.amount_paid = (
  SELECT COALESCE(SUM(p.amount), 0) FROM payments p
  WHERE p.invoice_id = i.id AND p.status = 'Completed'
);

INSERT IGNORE INTO warehouses (code, name, location, manager, phone, capacity, type, status) VALUES
  ('WH-001', 'Main Warehouse', 'Harare Central', 'Tendai Moyo', '+263 712 000 101', 10000, 'Main', 'Active'),
  ('WH-002', 'Branch Warehouse', 'Avondale, Harare', 'Brian Chikore', '+263 713 000 202', 5000, 'Branch', 'Active'),
  ('WH-003', 'Cold Storage', 'Southerton, Harare', 'Rumbidzai Dube', '+263 714 000 303', 3000, 'Cold Storage', 'Active'),
  ('WH-004', 'Distribution Centre', 'Graniteside, Harare', 'Michael Ncube', '+263 715 000 404', 7500, 'Distribution', 'Active');

INSERT IGNORE INTO products (name, sku, barcode, category, brand, price, cost, reorder_level, color) VALUES
  ('Premium Rice 5kg', 'RICE-005', '600100100001', 'Groceries', 'Golden Grain', 8.50, 6.20, 100, 'bg-amber-100'),
  ('Cooking Oil 2L', 'OIL-002', '600100100002', 'Groceries', 'PureLife', 6.75, 4.80, 80, 'bg-yellow-100'),
  ('Sugar 2kg', 'SUG-002', '600100100003', 'Groceries', 'SweetLife', 3.95, 2.70, 50, 'bg-blue-100'),
  ('Fresh Milk 1L', 'MIL-001', '600100100004', 'Dairy', 'Farm Fresh', 1.80, 1.25, 30, 'bg-sky-100'),
  ('Bread Large', 'BRD-001', '600100100005', 'Bakery', 'Bakers Choice', 1.50, 1.05, 25, 'bg-orange-100'),
  ('Soft Drink 500ml', 'DRK-500', '600100100006', 'Beverages', 'Refresh', 1.25, 0.85, 100, 'bg-red-100'),
  ('Mineral Water 500ml', 'WTR-500', '600100100007', 'Beverages', 'Pure Water', 0.80, 0.55, 60, 'bg-cyan-100'),
  ('Laundry Soap', 'SOAP-001', '600100100008', 'Household', 'CleanMax', 2.40, 1.65, 40, 'bg-purple-100'),
  ('Toilet Paper 4 Pack', 'TP-004', '600100100009', 'Household', 'SoftCare', 4.25, 3.00, 20, 'bg-pink-100'),
  ('Shampoo 400ml', 'SHP-400', '600100100010', 'Personal Care', 'CarePlus', 5.90, 4.10, 20, 'bg-violet-100'),
  ('Toothpaste', 'TPST-001', '600100100011', 'Personal Care', 'FreshDent', 3.20, 2.10, 15, 'bg-emerald-100'),
  ('Chocolate Bar', 'CHO-001', '600100100012', 'Snacks', 'ChocoDelight', 1.75, 1.10, 25, 'bg-stone-100');

INSERT IGNORE INTO stock_levels (product_id, warehouse_id, quantity, reserved)
SELECT p.id, w.id, x.quantity, x.reserved
FROM (
  SELECT 'RICE-005' AS sku, 'WH-001' AS wh, 420 AS quantity, 35 AS reserved
  UNION ALL SELECT 'OIL-002', 'WH-001', 82, 18
  UNION ALL SELECT 'SUG-002', 'WH-002', 155, 20
  UNION ALL SELECT 'MIL-001', 'WH-003', 24, 6
  UNION ALL SELECT 'BRD-001', 'WH-002', 18, 5
  UNION ALL SELECT 'DRK-500', 'WH-004', 540, 40
  UNION ALL SELECT 'WTR-500', 'WH-001', 90, 10
  UNION ALL SELECT 'SOAP-001', 'WH-001', 36, 8
  UNION ALL SELECT 'TP-004', 'WH-002', 27, 4
  UNION ALL SELECT 'SHP-400', 'WH-004', 15, 3
  UNION ALL SELECT 'TPST-001', 'WH-001', 22, 2
  UNION ALL SELECT 'CHO-001', 'WH-002', 0, 0
) x
JOIN products p ON p.sku = x.sku
JOIN warehouses w ON w.code = x.wh;

INSERT INTO stock_movements (movement_number, product_id, warehouse_id, type, quantity, reference, notes)
SELECT CONCAT('TMP-', s.id), s.product_id, s.warehouse_id, 'Opening Stock', s.quantity, 'OPENING', 'Opening balance'
FROM stock_levels s
WHERE s.quantity > 0
  AND NOT EXISTS (
    SELECT 1 FROM stock_movements m
    WHERE m.type = 'Opening Stock' AND m.product_id = s.product_id AND m.warehouse_id = s.warehouse_id
  );

UPDATE stock_movements SET movement_number = CONCAT('MOV-', LPAD(id, 5, '0')) WHERE movement_number LIKE 'TMP-%';

INSERT IGNORE INTO purchase_orders (po_number, supplier_id, warehouse_id, order_date, expected_date, status, tax_rate, notes) VALUES
  ('PO-0001', (SELECT id FROM suppliers WHERE code = 'SUP-003'), (SELECT id FROM warehouses WHERE code = 'WH-001'), '2026-09-18', '2026-09-23', 'Ordered', 15, 'Deliver to loading bay 2'),
  ('PO-0002', (SELECT id FROM suppliers WHERE code = 'SUP-001'), (SELECT id FROM warehouses WHERE code = 'WH-003'), '2026-09-19', '2026-09-22', 'Pending Approval', 15, NULL),
  ('PO-0003', (SELECT id FROM suppliers WHERE code = 'SUP-004'), (SELECT id FROM warehouses WHERE code = 'WH-004'), '2026-09-20', '2026-09-27', 'Draft', 15, NULL);

INSERT INTO purchase_order_items (purchase_order_id, product_id, quantity, unit_cost)
SELECT po.id, p.id, x.quantity, x.unit_cost
FROM (
  SELECT 'PO-0001' AS po, 'OIL-002' AS sku, 120 AS quantity, 4.80 AS unit_cost
  UNION ALL SELECT 'PO-0001', 'RICE-005', 60, 6.20
  UNION ALL SELECT 'PO-0002', 'MIL-001', 200, 1.25
  UNION ALL SELECT 'PO-0003', 'SHP-400', 48, 4.10
  UNION ALL SELECT 'PO-0003', 'TPST-001', 72, 2.10
) x
JOIN purchase_orders po ON po.po_number = x.po
JOIN products p ON p.sku = x.sku
WHERE NOT EXISTS (SELECT 1 FROM purchase_order_items i WHERE i.purchase_order_id = po.id);

UPDATE purchase_orders po
JOIN (
  SELECT purchase_order_id, SUM(quantity * unit_cost) AS subtotal
  FROM purchase_order_items GROUP BY purchase_order_id
) s ON s.purchase_order_id = po.id
SET po.subtotal = s.subtotal,
    po.tax = ROUND(s.subtotal * po.tax_rate / 100, 2),
    po.total = s.subtotal + ROUND(s.subtotal * po.tax_rate / 100, 2);

CREATE TABLE IF NOT EXISTS customers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(150) NOT NULL,
  email VARCHAR(150) NULL,
  phone VARCHAR(50) NULL,
  address VARCHAR(255) NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'Active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS suppliers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(150) NOT NULL,
  contact VARCHAR(150) NULL,
  email VARCHAR(150) NULL,
  phone VARCHAR(50) NULL,
  category VARCHAR(100) NULL,
  balance DECIMAL(12,2) NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'Active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS invoices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  invoice_number VARCHAR(30) NOT NULL UNIQUE,
  customer_id INT NULL,
  customer_name VARCHAR(150) NOT NULL,
  issued_date DATE NOT NULL,
  due_date DATE NOT NULL,
  subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
  tax_rate DECIMAL(5,2) NOT NULL DEFAULT 0,
  tax DECIMAL(12,2) NOT NULL DEFAULT 0,
  total DECIMAL(12,2) NOT NULL DEFAULT 0,
  amount_paid DECIMAL(12,2) NOT NULL DEFAULT 0,
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_invoices_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS invoice_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  invoice_id INT NOT NULL,
  description VARCHAR(255) NOT NULL,
  quantity DECIMAL(12,2) NOT NULL DEFAULT 1,
  unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  line_total DECIMAL(12,2) NOT NULL DEFAULT 0,
  CONSTRAINT fk_invoice_items_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  payment_number VARCHAR(30) NOT NULL UNIQUE,
  invoice_id INT NULL,
  reference VARCHAR(100) NULL,
  party VARCHAR(150) NOT NULL,
  method VARCHAR(20) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  paid_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status VARCHAR(20) NOT NULL DEFAULT 'Completed',
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_payments_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sales (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  sale_number VARCHAR(50) NOT NULL UNIQUE,
  customer VARCHAR(255) NOT NULL DEFAULT 'Walk-in Customer',
  payment_method VARCHAR(50) NOT NULL,
  subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
  discount DECIMAL(12,2) NOT NULL DEFAULT 0,
  tax_rate DECIMAL(5,2) NOT NULL DEFAULT 15,
  tax DECIMAL(12,2) NOT NULL DEFAULT 0,
  total DECIMAL(12,2) NOT NULL DEFAULT 0,
  amount_paid DECIMAL(12,2) NOT NULL DEFAULT 0,
  change_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  status ENUM('COMPLETED','HELD','CANCELLED') NOT NULL DEFAULT 'COMPLETED',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sale_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  sale_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  product_name VARCHAR(255) NOT NULL,
  sku VARCHAR(100) NOT NULL,
  quantity INT NOT NULL,
  unit_price DECIMAL(12,2) NOT NULL,
  line_total DECIMAL(12,2) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sale_items_sale FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS settings (
  setting_key VARCHAR(50) PRIMARY KEY,
  setting_value TEXT NOT NULL
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  sku VARCHAR(50) NOT NULL UNIQUE,
  barcode VARCHAR(50) NULL UNIQUE,
  category VARCHAR(100) NOT NULL,
  brand VARCHAR(100) NULL,
  price DECIMAL(12,2) NOT NULL DEFAULT 0,
  cost DECIMAL(12,2) NOT NULL DEFAULT 0,
  reorder_level INT NOT NULL DEFAULT 0,
  color VARCHAR(30) NOT NULL DEFAULT 'bg-slate-100',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS warehouses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(150) NOT NULL UNIQUE,
  location VARCHAR(255) NOT NULL,
  manager VARCHAR(150) NOT NULL,
  phone VARCHAR(50) NULL,
  capacity INT NOT NULL,
  type VARCHAR(30) NOT NULL DEFAULT 'Main',
  status VARCHAR(20) NOT NULL DEFAULT 'Active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS stock_levels (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  warehouse_id INT NOT NULL,
  quantity INT NOT NULL DEFAULT 0,
  reserved INT NOT NULL DEFAULT 0,
  UNIQUE KEY uq_stock_product_warehouse (product_id, warehouse_id),
  CONSTRAINT fk_stock_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  CONSTRAINT fk_stock_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS stock_movements (
  id INT AUTO_INCREMENT PRIMARY KEY,
  movement_number VARCHAR(30) NOT NULL UNIQUE,
  product_id INT NOT NULL,
  warehouse_id INT NOT NULL,
  type VARCHAR(30) NOT NULL,
  quantity INT NOT NULL,
  reference VARCHAR(50) NULL,
  user_name VARCHAR(100) NOT NULL DEFAULT 'Admin User',
  notes VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_movement_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  CONSTRAINT fk_movement_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS stock_transfers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  transfer_number VARCHAR(30) NOT NULL UNIQUE,
  product_id INT NOT NULL,
  from_warehouse_id INT NOT NULL,
  to_warehouse_id INT NOT NULL,
  quantity INT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'Pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  CONSTRAINT fk_transfer_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  CONSTRAINT fk_transfer_from FOREIGN KEY (from_warehouse_id) REFERENCES warehouses(id),
  CONSTRAINT fk_transfer_to FOREIGN KEY (to_warehouse_id) REFERENCES warehouses(id)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS purchase_orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  po_number VARCHAR(30) NOT NULL UNIQUE,
  supplier_id INT NOT NULL,
  warehouse_id INT NOT NULL,
  order_date DATE NOT NULL,
  expected_date DATE NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'Pending Approval',
  subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
  tax_rate DECIMAL(5,2) NOT NULL DEFAULT 0,
  tax DECIMAL(12,2) NOT NULL DEFAULT 0,
  total DECIMAL(12,2) NOT NULL DEFAULT 0,
  notes TEXT NULL,
  requested_by VARCHAR(100) NOT NULL DEFAULT 'Admin User',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_po_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  CONSTRAINT fk_po_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  purchase_order_id INT NOT NULL,
  product_id INT NOT NULL,
  quantity INT NOT NULL,
  received_quantity INT NOT NULL DEFAULT 0,
  unit_cost DECIMAL(12,2) NOT NULL,
  CONSTRAINT fk_po_item_order FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_po_item_product FOREIGN KEY (product_id) REFERENCES products(id)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS product_units (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  name VARCHAR(50) NOT NULL,
  multiplier INT NOT NULL,
  price DECIMAL(12,2) NOT NULL,
  wholesale_price DECIMAL(12,2) NULL,
  barcode VARCHAR(50) NULL UNIQUE,
  UNIQUE KEY uq_product_unit_name (product_id, name),
  CONSTRAINT fk_unit_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS product_batches (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  warehouse_id INT NOT NULL,
  batch_number VARCHAR(50) NOT NULL,
  expiry_date DATE NULL,
  quantity INT NOT NULL DEFAULT 0,
  received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_batch (product_id, warehouse_id, batch_number),
  CONSTRAINT fk_batch_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  CONSTRAINT fk_batch_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sale_payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  sale_id BIGINT UNSIGNED NOT NULL,
  method VARCHAR(20) NOT NULL,
  currency VARCHAR(3) NOT NULL,
  exchange_rate DECIMAL(14,6) NOT NULL DEFAULT 1,
  amount_tendered DECIMAL(14,2) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  reference VARCHAR(100) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_payment_sale FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sale_returns (
  id INT AUTO_INCREMENT PRIMARY KEY,
  return_number VARCHAR(30) NOT NULL UNIQUE,
  sale_id BIGINT UNSIGNED NOT NULL,
  warehouse_id INT NOT NULL,
  reason VARCHAR(255) NOT NULL,
  refund_method VARCHAR(20) NOT NULL,
  refund_amount DECIMAL(12,2) NOT NULL,
  user_name VARCHAR(100) NOT NULL DEFAULT 'Admin User',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_return_sale FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
  CONSTRAINT fk_return_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sale_return_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  return_id INT NOT NULL,
  sale_item_id BIGINT UNSIGNED NOT NULL,
  quantity INT NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  restocked TINYINT(1) NOT NULL DEFAULT 1,
  CONSTRAINT fk_return_item_return FOREIGN KEY (return_id) REFERENCES sale_returns(id) ON DELETE CASCADE,
  CONSTRAINT fk_return_item_sale_item FOREIGN KEY (sale_item_id) REFERENCES sale_items(id) ON DELETE CASCADE
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  role VARCHAR(30) NOT NULL DEFAULT 'Cashier',
  status VARCHAR(20) NOT NULL DEFAULT 'Active',
  password_hash VARCHAR(255) NOT NULL,
  last_login_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS warehouse_locations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  warehouse_id INT NOT NULL,
  code VARCHAR(40) NOT NULL,
  zone VARCHAR(30) NULL,
  aisle VARCHAR(20) NULL,
  shelf VARCHAR(20) NULL,
  bin VARCHAR(20) NULL,
  type VARCHAR(20) NOT NULL DEFAULT 'Storage',
  barcode VARCHAR(60) NOT NULL UNIQUE,
  pick_sequence INT NOT NULL DEFAULT 0,
  capacity INT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'Active',
  is_system TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_location_code (warehouse_id, code),
  CONSTRAINT fk_location_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE CASCADE
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS location_stock (
  id INT AUTO_INCREMENT PRIMARY KEY,
  location_id INT NOT NULL,
  product_id INT NOT NULL,
  batch_number VARCHAR(50) NOT NULL DEFAULT '',
  quantity INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_location_stock (location_id, product_id, batch_number),
  KEY idx_location_stock_product (product_id),
  CONSTRAINT fk_location_stock_location FOREIGN KEY (location_id) REFERENCES warehouse_locations(id) ON DELETE CASCADE,
  CONSTRAINT fk_location_stock_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS location_moves (
  id INT AUTO_INCREMENT PRIMARY KEY,
  warehouse_id INT NOT NULL,
  product_id INT NOT NULL,
  batch_number VARCHAR(50) NOT NULL DEFAULT '',
  from_location_id INT NULL,
  to_location_id INT NULL,
  quantity INT NOT NULL,
  type VARCHAR(30) NOT NULL,
  reference VARCHAR(50) NULL,
  user_name VARCHAR(100) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_move_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  CONSTRAINT fk_move_from FOREIGN KEY (from_location_id) REFERENCES warehouse_locations(id) ON DELETE SET NULL,
  CONSTRAINT fk_move_to FOREIGN KEY (to_location_id) REFERENCES warehouse_locations(id) ON DELETE SET NULL
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS product_serials (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  serial_number VARCHAR(100) NOT NULL,
  warehouse_id INT NULL,
  location_id INT NULL,
  batch_number VARCHAR(50) NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'In Stock',
  reference VARCHAR(50) NULL,
  dispatch_order_id INT NULL,
  received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_serial (product_id, serial_number),
  KEY idx_serial_number (serial_number),
  CONSTRAINT fk_serial_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  CONSTRAINT fk_serial_location FOREIGN KEY (location_id) REFERENCES warehouse_locations(id) ON DELETE SET NULL
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pick_waves (
  id INT AUTO_INCREMENT PRIMARY KEY,
  wave_number VARCHAR(30) NOT NULL UNIQUE,
  warehouse_id INT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'Open',
  created_by VARCHAR(100) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  released_at DATETIME NULL,
  completed_at DATETIME NULL,
  CONSTRAINT fk_wave_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS dispatch_orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_number VARCHAR(30) NOT NULL UNIQUE,
  type VARCHAR(20) NOT NULL DEFAULT 'Customer',
  warehouse_id INT NOT NULL,
  customer_id INT NULL,
  customer_name VARCHAR(150) NOT NULL,
  ship_to VARCHAR(255) NULL,
  destination_warehouse_id INT NULL,
  transfer_id INT NULL,
  priority VARCHAR(10) NOT NULL DEFAULT 'Normal',
  required_date DATE NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'Pending',
  wave_id INT NULL,
  carrier VARCHAR(100) NULL,
  tracking_number VARCHAR(100) NULL,
  packages INT NULL,
  notes VARCHAR(255) NULL,
  created_by VARCHAR(100) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  packed_at DATETIME NULL,
  dispatched_at DATETIME NULL,
  CONSTRAINT fk_dispatch_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
  CONSTRAINT fk_dispatch_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
  CONSTRAINT fk_dispatch_wave FOREIGN KEY (wave_id) REFERENCES pick_waves(id) ON DELETE SET NULL
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS dispatch_order_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  product_id INT NOT NULL,
  quantity INT NOT NULL,
  allocated_quantity INT NOT NULL DEFAULT 0,
  picked_quantity INT NOT NULL DEFAULT 0,
  dispatched_quantity INT NOT NULL DEFAULT 0,
  CONSTRAINT fk_dispatch_item_order FOREIGN KEY (order_id) REFERENCES dispatch_orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_dispatch_item_product FOREIGN KEY (product_id) REFERENCES products(id)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS warehouse_tasks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  task_number VARCHAR(30) NOT NULL UNIQUE,
  type VARCHAR(20) NOT NULL,
  warehouse_id INT NOT NULL,
  product_id INT NOT NULL,
  batch_number VARCHAR(50) NOT NULL DEFAULT '',
  from_location_id INT NULL,
  to_location_id INT NULL,
  quantity INT NOT NULL,
  done_quantity INT NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'Open',
  order_id INT NULL,
  order_item_id INT NULL,
  wave_id INT NULL,
  reference VARCHAR(50) NULL,
  sequence INT NOT NULL DEFAULT 0,
  completed_by VARCHAR(100) NULL,
  completed_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_task_open (warehouse_id, type, status),
  CONSTRAINT fk_task_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  CONSTRAINT fk_task_from FOREIGN KEY (from_location_id) REFERENCES warehouse_locations(id) ON DELETE SET NULL,
  CONSTRAINT fk_task_to FOREIGN KEY (to_location_id) REFERENCES warehouse_locations(id) ON DELETE SET NULL,
  CONSTRAINT fk_task_order FOREIGN KEY (order_id) REFERENCES dispatch_orders(id) ON DELETE CASCADE
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cycle_counts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  count_number VARCHAR(30) NOT NULL UNIQUE,
  warehouse_id INT NOT NULL,
  location_id INT NULL,
  product_id INT NOT NULL,
  risk_class CHAR(1) NULL,
  risk_score INT NULL,
  reason VARCHAR(255) NULL,
  due_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'Open',
  system_quantity INT NULL,
  counted_quantity INT NULL,
  variance INT NULL,
  counted_by VARCHAR(100) NULL,
  counted_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_count_product (product_id, warehouse_id, status),
  CONSTRAINT fk_count_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE CASCADE,
  CONSTRAINT fk_count_location FOREIGN KEY (location_id) REFERENCES warehouse_locations(id) ON DELETE SET NULL,
  CONSTRAINT fk_count_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  ip_address VARCHAR(64) NULL,
  user_agent VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_session_user (user_id),
  CONSTRAINT fk_session_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

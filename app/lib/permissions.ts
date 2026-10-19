export const SESSION_COOKIE = "retailerp_session";

export const ROLES = ["Administrator", "Manager", "Cashier", "Storekeeper", "Warehouse Operator"] as const;

export type Role = (typeof ROLES)[number];

export type SessionUser = { id: number; name: string; email: string; role: Role };

const ALL: readonly Role[] = ROLES;
const ADMIN: readonly Role[] = ["Administrator"];
const MANAGEMENT: readonly Role[] = ["Administrator", "Manager"];
const SALES: readonly Role[] = [...MANAGEMENT, "Cashier"];
const STOCK: readonly Role[] = [...MANAGEMENT, "Storekeeper"];
/** Warehouse floor work: receiving, put-away, picking, packing, dispatch and counts. */
const FLOOR: readonly Role[] = [...STOCK, "Warehouse Operator"];

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  Administrator: "Full access, including settings and user accounts",
  Manager: "All operations and reports; no settings or user accounts",
  Cashier: "POS, customers, invoices and payments",
  Storekeeper: "Products, warehouses, stock, procurement and suppliers",
  "Warehouse Operator": "Receiving, put-away, picking, dispatch and cycle counts only",
};

/** Page access by first path segment. Pages not listed are open to any signed-in user. */
const PAGE_ACCESS: Record<string, readonly Role[]> = {
  "/": ALL,
  "/pos": SALES,
  "/customers": SALES,
  "/invoices": SALES,
  "/payments": SALES,
  "/products": STOCK,
  "/warehouse": FLOOR,
  "/stockmanagement": FLOOR,
  "/procurement": FLOOR,
  "/fulfillment": FLOOR,
  "/suppliers": STOCK,
  "/reports": MANAGEMENT,
  "/settings": ADMIN,
  "/users": ADMIN,
};

/**
 * API access by first segment after /api. `read` covers GET (lookups shared by several pages),
 * `write` covers POST/PUT/PATCH. DELETE additionally requires a management role.
 * APIs not listed are denied.
 */
const API_ACCESS: Record<string, { read: readonly Role[]; write: readonly Role[] }> = {
  dashboard: { read: ALL, write: [] },
  pos: { read: SALES, write: SALES },
  customers: { read: SALES, write: SALES },
  invoices: { read: SALES, write: SALES },
  payments: { read: SALES, write: SALES },
  products: { read: ALL, write: STOCK },
  warehouses: { read: ALL, write: STOCK },
  stockmanagement: { read: FLOOR, write: STOCK },
  procurement: { read: FLOOR, write: STOCK },
  suppliers: { read: FLOOR, write: STOCK },
  locations: { read: FLOOR, write: STOCK },
  receiving: { read: FLOOR, write: FLOOR },
  dispatch: { read: FLOOR, write: STOCK },
  wms: { read: FLOOR, write: FLOOR },
  cyclecounts: { read: FLOOR, write: FLOOR },
  serials: { read: [...FLOOR, "Cashier"], write: [] },
  reports: { read: MANAGEMENT, write: [] },
  settings: { read: ALL, write: ADMIN },
  users: { read: ADMIN, write: ADMIN },
};

const firstSegment = (pathname: string) => pathname.split("/").filter(Boolean)[0] ?? "";

export function canAccessPage(role: Role | undefined, pathname: string) {
  if (!role) return false;
  const roles = PAGE_ACCESS[`/${firstSegment(pathname)}`];
  return !roles || roles.includes(role);
}

export function canCallApi(role: Role | undefined, pathname: string, method: string) {
  const access = API_ACCESS[firstSegment(pathname.replace(/^\/api/, ""))];
  if (!role || !access) return false;

  const verb = method.toUpperCase();
  if (verb === "GET" || verb === "HEAD") return access.read.includes(role);
  if (verb === "DELETE") return access.write.includes(role) && MANAGEMENT.includes(role);
  return access.write.includes(role);
}

/** Only allow same-site relative redirect targets after login. */
export function safeRedirect(target: unknown) {
  return typeof target === "string" && /^\/(?![/\\])/.test(target) && !target.startsWith("/login") ? target : "/";
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase() || "?";

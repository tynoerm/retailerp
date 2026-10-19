export const money = (value: number, currency = "USD") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value);

export const today = () => new Date().toISOString().slice(0, 10);

export const formatDate = (value: string) =>
  new Date(value.replace(" ", "T")).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

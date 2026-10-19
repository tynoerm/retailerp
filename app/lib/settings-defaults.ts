export type CurrencyRate = { code: string; rate: number };

export const PAYMENT_METHODS = ["Cash", "Card", "Bank", "Mobile", "EcoCash", "InnBucks"] as const;

export const defaultSettings = {
  businessName: "RetailERP Store",
  email: "admin@retailerp.local",
  phone: "+263 242 000 000",
  address: "Harare Central, Zimbabwe",
  currency: "USD",
  taxRate: "15",
  receiptFooter: "Thank you for shopping with us!",
  laybyMinDepositPercent: "10",
  currencies: [
    { code: "USD", rate: 1 },
    { code: "ZWG", rate: 0 },
  ] as CurrencyRate[],
  lowStockAlerts: true,
  emailReceipts: false,
  allowNegativeStock: false,
};

export type Settings = typeof defaultSettings;

export function activeCurrencies(settings: Pick<Settings, "currency" | "currencies">): CurrencyRate[] {
  const others = settings.currencies.filter((c) => c.code !== settings.currency && c.rate > 0);
  return [{ code: settings.currency, rate: 1 }, ...others];
}

// Indicative demo FX rates to USD. Not live rates — for illustrative math only.
export const CURRENCIES = {
  USD: { symbol: "$", name: "US Dollar", toUSD: 1 },
  GBP: { symbol: "£", name: "British Pound", toUSD: 1.27 },
  EUR: { symbol: "€", name: "Euro", toUSD: 1.08 },
  INR: { symbol: "₹", name: "Indian Rupee", toUSD: 0.012 },
  MYR: { symbol: "RM", name: "Malaysian Ringgit", toUSD: 0.226 },
  SGD: { symbol: "S$", name: "Singapore Dollar", toUSD: 0.744 },
  AUD: { symbol: "A$", name: "Australian Dollar", toUSD: 0.658 },
  CAD: { symbol: "C$", name: "Canadian Dollar", toUSD: 0.732 },
};
export const DEFAULT_CURRENCY = "USD";

export function convert(amount, from, to) {
  if (from === to) return amount;
  const f = CURRENCIES[from] || CURRENCIES.USD;
  const t = CURRENCIES[to] || CURRENCIES.USD;
  return (amount * f.toUSD) / t.toUSD;
}

export function fmtMoney(amount, currency, decimals = 0) {
  const c = CURRENCIES[currency] || CURRENCIES.USD;
  const n = Number(amount) || 0;
  return `${c.symbol}${n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

export function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

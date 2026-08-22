// Illustrative payroll math. Real withholding rates are jurisdiction-specific —
// this is a simplified flat/banded model for demo purposes, always labeled as such.

// Simple 3-band illustrative income tax + flat FICA-style social contribution.
// Bands operate on MONTHLY gross in the given currency (no cross-currency banding).
export function calculateTaxes(grossMonthly, currency) {
  const g = Number(grossMonthly) || 0;
  const federal_tax = round2(g * 0.10);
  const state_tax = round2(g * 0.04);
  const fica = round2(g * 0.0765);
  const total_taxes = round2(federal_tax + state_tax + fica);
  return { currency, gross_monthly: g, federal_tax, state_tax, fica, total_taxes };
}

export function calculateNetPay({ gross, taxes, insuranceDeduction = 0, otherDeductions = 0 }) {
  const g = Number(gross) || 0;
  const totalTaxes = Number(taxes && taxes.total_taxes) || 0;
  const ins = Number(insuranceDeduction) || 0;
  const other = Number(otherDeductions) || 0;
  const net = round2(g - totalTaxes - ins - other);
  return { gross: g, total_taxes: totalTaxes, insurance_deduction: ins, other_deductions: other, net_pay: net };
}

export function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

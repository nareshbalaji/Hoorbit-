import { z } from "zod";
import { read, update, findById } from "../db.js";
import { defineTool, notFound } from "../lib/toolkit.js";
import { uid, todayISO } from "../lib/ids.js";
import { fmtMoney, convert } from "../lib/currency.js";
import { calculateTaxes as calcTaxes, calculateNetPay, round2 } from "../lib/payroll.js";
import { NOT_LEGAL_ADVICE } from "../lib/constants.js";

export function registerPayrollTools(server, user) {
  defineTool(
    server,
    user,
    "calculate_gross_salary",
    {
      title: "Calculate gross salary",
      description: "Return a developer's monthly gross salary from their current contracted rate.",
      inputSchema: { developer_id: z.string() },
    },
    async (a) => {
      const developer = findById("developers", a.developer_id) || notFound("developer", a.developer_id);
      return {
        success: true, developer_id: a.developer_id, developer: developer.name,
        monthly_gross: developer.current_rate_monthly, currency: developer.current_rate_currency,
        formatted: fmtMoney(developer.current_rate_monthly, developer.current_rate_currency, 2),
      };
    }
  );

  defineTool(
    server,
    user,
    "calculate_taxes",
    {
      title: "Calculate taxes",
      description: "Calculate illustrative federal/state/FICA-style withholding on a monthly gross amount. Simplified flat-rate model — not real jurisdiction-specific tax law.",
      inputSchema: { monthly_gross: z.number().positive(), currency: z.string().default("USD") },
    },
    async (a) => {
      const taxes = calcTaxes(a.monthly_gross, a.currency);
      return {
        success: true, ...taxes,
        formatted: {
          federal_income_tax: fmtMoney(taxes.federal_tax, a.currency, 2),
          state_income_tax: fmtMoney(taxes.state_tax, a.currency, 2),
          fica_social_security: fmtMoney(taxes.fica, a.currency, 2),
          total_taxes: fmtMoney(taxes.total_taxes, a.currency, 2),
        },
        disclaimer: NOT_LEGAL_ADVICE,
      };
    }
  );

  defineTool(
    server,
    user,
    "calculate_insurance_deductions",
    {
      title: "Calculate insurance deductions",
      description: "Return the monthly insurance premium deduction for a developer's active policy, if any.",
      inputSchema: { developer_id: z.string() },
    },
    async (a) => {
      const policy = read("insurance").find((i) => i.developer_id === a.developer_id && i.status === "active");
      if (!policy) return { success: true, developer_id: a.developer_id, monthly_premium: 0, currency: "USD", note: "No active insurance policy — deduction is $0." };
      return { success: true, developer_id: a.developer_id, plan: policy.plan, monthly_premium: policy.monthly_premium, currency: policy.currency, formatted: fmtMoney(policy.monthly_premium, policy.currency, 2) };
    }
  );

  defineTool(
    server,
    user,
    "calculate_net_pay",
    {
      title: "Calculate net pay",
      description: "Calculate a developer's net take-home pay for a month: gross minus taxes minus insurance minus any other deductions.",
      inputSchema: { developer_id: z.string(), other_deductions: z.number().default(0) },
    },
    async (a) => {
      const developer = findById("developers", a.developer_id) || notFound("developer", a.developer_id);
      const taxes = calcTaxes(developer.current_rate_monthly, developer.current_rate_currency);
      const policy = read("insurance").find((i) => i.developer_id === a.developer_id && i.status === "active");
      const insuranceDeduction = policy ? convert(policy.monthly_premium, policy.currency, developer.current_rate_currency) : 0;
      const net = calculateNetPay({ gross: developer.current_rate_monthly, taxes, insuranceDeduction, otherDeductions: a.other_deductions });
      return { success: true, developer_id: a.developer_id, currency: developer.current_rate_currency, ...net, formatted_net_pay: fmtMoney(net.net_pay, developer.current_rate_currency, 2) };
    }
  );

  defineTool(
    server,
    user,
    "generate_pay_stub",
    {
      title: "Generate pay stub",
      description: "Generate (and persist) a detailed pay stub for a developer for a given month.",
      inputSchema: { developer_id: z.string(), month: z.string().describe("YYYY-MM"), other_deductions: z.number().default(0) },
      mutating: { entityType: "payroll", idParam: "developer_id" },
    },
    async (a) => {
      const developer = findById("developers", a.developer_id) || notFound("developer", a.developer_id);
      const taxes = calcTaxes(developer.current_rate_monthly, developer.current_rate_currency);
      const policy = read("insurance").find((i) => i.developer_id === a.developer_id && i.status === "active");
      const insuranceDeduction = policy ? convert(policy.monthly_premium, policy.currency, developer.current_rate_currency) : 0;
      const net = calculateNetPay({ gross: developer.current_rate_monthly, taxes, insuranceDeduction, otherDeductions: a.other_deductions });

      const stub = {
        id: uid("pay"), developer_id: a.developer_id, month: a.month, gross_salary: developer.current_rate_monthly, currency: developer.current_rate_currency,
        federal_tax: taxes.federal_tax, state_tax: taxes.state_tax, fica: taxes.fica, insurance_deduction: round2(insuranceDeduction),
        other_deductions: a.other_deductions, net_pay: net.net_pay, payment_date: todayISO(), status: "paid",
      };
      update("payroll", (rows) => { rows.push(stub); return rows; });
      update("developers", (rows) => rows.map((d) => (d.id === a.developer_id ? { ...d, total_earned_usd: round2(d.total_earned_usd + convert(net.net_pay, d.current_rate_currency, "USD")) } : d)));
      update("onboarding", (rows) => rows.map((o) => (o.developer_id === a.developer_id ? { ...o, checklist: { ...o.checklist, first_payslip_generated: true } } : o)));

      return { success: true, pay_stub_id: stub.id, ...stub, formatted_net_pay: fmtMoney(stub.net_pay, stub.currency, 2), note: `Simulated payslip email sent to ${developer.email}.` };
    }
  );

  defineTool(
    server,
    user,
    "process_payroll",
    {
      title: "Process payroll for all active developers",
      description: "Batch-generate pay stubs for every active developer with a signed contract, for the given month. Returns per-currency payroll totals.",
      inputSchema: { month: z.string().describe("YYYY-MM") },
      mutating: { entityType: "payroll", idParam: null, summary: (a, r) => `Processed payroll for ${r.processed_employees} developer(s), ${a.month}` },
    },
    async (a) => {
      const developers = read("developers").filter((d) => d.status === "active");
      const results = [];
      const totalsByCurrency = {};
      update("payroll", (rows) => {
        for (const developer of developers) {
          if (rows.some((p) => p.developer_id === developer.id && p.month === a.month)) continue;
          const taxes = calcTaxes(developer.current_rate_monthly, developer.current_rate_currency);
          const policy = read("insurance").find((i) => i.developer_id === developer.id && i.status === "active");
          const insuranceDeduction = policy ? convert(policy.monthly_premium, policy.currency, developer.current_rate_currency) : 0;
          const net = calculateNetPay({ gross: developer.current_rate_monthly, taxes, insuranceDeduction, otherDeductions: 0 });
          const stub = { id: uid("pay"), developer_id: developer.id, month: a.month, gross_salary: developer.current_rate_monthly, currency: developer.current_rate_currency, federal_tax: taxes.federal_tax, state_tax: taxes.state_tax, fica: taxes.fica, insurance_deduction: round2(insuranceDeduction), other_deductions: 0, net_pay: net.net_pay, payment_date: todayISO(), status: "paid" };
          rows.push(stub);
          results.push({ developer_id: developer.id, name: developer.name, net_pay: stub.net_pay, currency: stub.currency });
          totalsByCurrency[stub.currency] = round2((totalsByCurrency[stub.currency] || 0) + stub.gross_salary);
        }
        return rows;
      });
      const totalPayrollUsd = round2(Object.entries(totalsByCurrency).reduce((sum, [ccy, amt]) => sum + convert(amt, ccy, "USD"), 0));
      return { success: true, month: a.month, processed_employees: results.length, results, totals_by_currency: totalsByCurrency, total_payroll_usd_equivalent: fmtMoney(totalPayrollUsd, "USD"), status: "All pay stubs generated." };
    }
  );

  defineTool(
    server,
    user,
    "generate_w2_at_year_end",
    {
      title: "Generate year-end pay summary",
      description: "Aggregate a developer's pay stubs for a calendar year into a year-end summary. Illustrative only — not an actual tax form (W-2/1099/etc are jurisdiction-specific and issued by qualified payroll providers).",
      inputSchema: { developer_id: z.string(), year: z.string().describe("YYYY") },
    },
    async (a) => {
      const developer = findById("developers", a.developer_id) || notFound("developer", a.developer_id);
      const records = read("payroll").filter((p) => p.developer_id === a.developer_id && p.month.startsWith(a.year));
      if (!records.length) return { success: true, developer_id: a.developer_id, year: a.year, message: "No pay records found for this year.", records: [] };
      const currency = records[0].currency;
      const totals = records.reduce((acc, r) => ({
        gross: round2(acc.gross + r.gross_salary), federal_tax: round2(acc.federal_tax + r.federal_tax), state_tax: round2(acc.state_tax + r.state_tax),
        fica: round2(acc.fica + r.fica), insurance: round2(acc.insurance + r.insurance_deduction), net: round2(acc.net + r.net_pay),
      }), { gross: 0, federal_tax: 0, state_tax: 0, fica: 0, insurance: 0, net: 0 });
      return { success: true, developer_id: a.developer_id, developer: developer.name, year: a.year, currency, months_paid: records.length, ...totals, disclaimer: NOT_LEGAL_ADVICE + " This is a demo year-end summary, not a real W-2/1099/local tax certificate." };
    }
  );
}

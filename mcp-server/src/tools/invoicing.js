import { z } from "zod";
import { read, update, findById } from "../db.js";
import { defineTool, notFound } from "../lib/toolkit.js";
import { uid, todayISO, nowISO } from "../lib/ids.js";
import { fmtMoney, convert, round2 } from "../lib/currency.js";
import { COMPANY, NO_REAL_MONEY_MOVES } from "../lib/constants.js";

function computeTeamCosts(project) {
  return round2(project.team_assigned.filter((t) => t.status === "active").reduce((sum, t) => sum + convert(t.rate_monthly, t.currency, project.budget_currency), 0));
}

export function registerInvoicingTools(server) {
  defineTool(
    server,
    "generate_invoice_to_company",
    {
      title: "Generate client invoice",
      description: "Generate the monthly invoice from Hoorbit LLC to a client for a project: team costs plus the Hoorbit commission.",
      inputSchema: { project_id: z.string(), month: z.string().describe("YYYY-MM") },
      mutating: { entityType: "invoice", idParam: "project_id" },
    },
    async (a) => {
      const project = findById("projects", a.project_id) || notFound("project", a.project_id);
      if (read("invoices").some((i) => i.project_id === a.project_id && i.month === a.month)) {
        return { success: false, message: `An invoice for ${a.month} already exists for this project.` };
      }
      const teamCosts = computeTeamCosts(project);
      const commission = round2(teamCosts * project.commission_rate);
      const invoice = {
        id: uid("invoice"), project_id: project.id, client_id: project.client_id, client_name: project.client_name, month: a.month,
        team_costs: teamCosts, commission_rate: project.commission_rate, commission_amount: commission, total_invoice: round2(teamCosts + commission),
        currency: project.budget_currency, sent_date: todayISO(), due_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
        payment_status: "pending", payment_received_date: null, notes: `Monthly billing — ${project.title}, ${a.month}.`,
      };
      update("invoices", (rows) => { rows.push(invoice); });
      return { success: true, invoice_id: invoice.id, ...invoice, formatted_total: fmtMoney(invoice.total_invoice, invoice.currency, 2) };
    }
  );

  defineTool(
    server,
    "itemize_invoice_costs",
    {
      title: "Itemize invoice costs",
      description: "Break an invoice down into per-developer line items plus the commission line.",
      inputSchema: { invoice_id: z.string() },
    },
    async (a) => {
      const invoice = findById("invoices", a.invoice_id) || notFound("invoice", a.invoice_id);
      const project = findById("projects", invoice.project_id);
      const lineItems = (project ? project.team_assigned.filter((t) => t.status === "active") : []).map((t) => ({
        developer_id: t.developer_id, name: t.name, role: t.role, amount: round2(convert(t.rate_monthly, t.currency, invoice.currency)), currency: invoice.currency,
      }));
      lineItems.push({ line: "Hoorbit delivery commission", rate: `${Math.round(invoice.commission_rate * 100)}%`, amount: invoice.commission_amount, currency: invoice.currency });
      return { success: true, invoice_id: a.invoice_id, currency: invoice.currency, line_items: lineItems, total: invoice.total_invoice, formatted_total: fmtMoney(invoice.total_invoice, invoice.currency, 2) };
    }
  );

  defineTool(
    server,
    "send_invoice_to_company",
    {
      title: "Send invoice to client",
      description: "Send (simulated) an invoice to the client's accounts-payable contact.",
      inputSchema: { invoice_id: z.string() },
      mutating: { entityType: "invoice", idParam: "invoice_id" },
    },
    async (a) => {
      const invoice = findById("invoices", a.invoice_id) || notFound("invoice", a.invoice_id);
      const client = findById("clients", invoice.client_id);
      return { success: true, invoice_id: a.invoice_id, sent_to: client ? client.contact_email : invoice.client_name, from: COMPANY.sender_email, subject: `Your ${invoice.month} invoice from ${COMPANY.legal_name}`, total: fmtMoney(invoice.total_invoice, invoice.currency, 2), due_date: invoice.due_date, note: NO_REAL_MONEY_MOVES };
    }
  );

  defineTool(
    server,
    "track_payment_status",
    {
      title: "Track invoice payment status",
      description: "Check whether an invoice is pending, paid, or overdue.",
      inputSchema: { invoice_id: z.string() },
    },
    async (a) => {
      const invoice = findById("invoices", a.invoice_id) || notFound("invoice", a.invoice_id);
      const overdue = invoice.payment_status === "pending" && new Date(invoice.due_date) < new Date();
      return { success: true, invoice_id: a.invoice_id, status: overdue ? "overdue" : invoice.payment_status, due_date: invoice.due_date, payment_received_date: invoice.payment_received_date, total: fmtMoney(invoice.total_invoice, invoice.currency, 2) };
    }
  );

  defineTool(
    server,
    "record_payment_received",
    {
      title: "Record payment received",
      description: "Mark an invoice as paid and record the receipt date/amount.",
      inputSchema: { invoice_id: z.string(), amount_received: z.number().optional(), received_date: z.string().optional() },
      mutating: { entityType: "invoice", idParam: "invoice_id" },
    },
    async (a) => {
      const invoice = findById("invoices", a.invoice_id) || notFound("invoice", a.invoice_id);
      const receivedDate = a.received_date || todayISO();
      update("invoices", (rows) => rows.map((i) => (i.id === a.invoice_id ? { ...i, payment_status: "paid", payment_received_date: receivedDate } : i)));
      const shortfall = a.amount_received != null ? round2(invoice.total_invoice - a.amount_received) : 0;
      return { success: true, invoice_id: a.invoice_id, payment_status: "paid", payment_received_date: receivedDate, amount_received: a.amount_received ?? invoice.total_invoice, shortfall: shortfall > 0 ? shortfall : 0 };
    }
  );

  defineTool(
    server,
    "calculate_commission_breakdown",
    {
      title: "Calculate commission breakdown",
      description: "Calculate Hoorbit's commission for a project — a single month, or lifetime across all invoices.",
      inputSchema: { project_id: z.string(), month: z.string().optional() },
    },
    async (a) => {
      const project = findById("projects", a.project_id) || notFound("project", a.project_id);
      const invoices = read("invoices").filter((i) => i.project_id === a.project_id && (!a.month || i.month === a.month));
      const teamCosts = computeTeamCosts(project);
      const currentMonthCommission = round2(teamCosts * project.commission_rate);
      const lifetimeCommission = round2(invoices.reduce((sum, i) => sum + i.commission_amount, 0));
      return {
        success: true, project_id: a.project_id, commission_rate: project.commission_rate, currency: project.budget_currency,
        current_monthly_team_costs: teamCosts, current_monthly_commission: currentMonthCommission,
        lifetime_commission_across_invoices: lifetimeCommission, invoices_counted: invoices.length,
        formatted_current: fmtMoney(currentMonthCommission, project.budget_currency, 2), formatted_lifetime: fmtMoney(lifetimeCommission, project.budget_currency, 2),
      };
    }
  );

  defineTool(
    server,
    "process_bank_transfer",
    {
      title: "Process a bank transfer",
      description: "Simulate a bank transfer (payroll payout to a developer, or invoice collection from a client). No real banking integration — this only logs a transaction record.",
      inputSchema: { direction: z.enum(["payout_to_developer", "collection_from_client"]), reference_id: z.string().describe("payroll id or invoice id"), amount: z.number().positive(), currency: z.string() },
      mutating: { entityType: "transaction", idParam: "reference_id" },
    },
    async (a) => {
      const txn = { id: uid("txn"), direction: a.direction, reference_id: a.reference_id, amount: a.amount, currency: a.currency, status: "simulated_success", processed_at: nowISO() };
      return { success: true, transaction: txn, formatted_amount: fmtMoney(a.amount, a.currency, 2), note: "Simulated bank transfer only — no real banking rails are connected in this demo." };
    }
  );

  defineTool(
    server,
    "generate_financial_reports",
    {
      title: "Generate financial reports",
      description: "Aggregate billings, collections, payables (payroll run-rate), and Hoorbit commission revenue, converted to a target currency.",
      inputSchema: { currency: z.string().default("USD"), month: z.string().optional() },
    },
    async (a) => {
      const invoices = read("invoices").filter((i) => !a.month || i.month === a.month);
      const projects = read("projects");
      const billings = round2(invoices.reduce((s, i) => s + convert(i.total_invoice, i.currency, a.currency), 0));
      const collections = round2(invoices.filter((i) => i.payment_status === "paid").reduce((s, i) => s + convert(i.total_invoice, i.currency, a.currency), 0));
      const commission = round2(invoices.reduce((s, i) => s + convert(i.commission_amount, i.currency, a.currency), 0));
      const payroll = round2(projects.reduce((s, p) => s + p.team_assigned.filter((t) => t.status === "active").reduce((s2, t) => s2 + convert(t.rate_monthly, t.currency, a.currency), 0), 0));
      const operatingCosts = round2(commission * 0.28);
      const profit = round2(commission - operatingCosts);
      return {
        success: true, currency: a.currency, period: a.month || "lifetime", billings, collections, pending_collections: round2(billings - collections),
        payroll_run_rate: payroll, commission_revenue: commission, estimated_operating_costs: operatingCosts, estimated_profit: profit,
        formatted: { billings: fmtMoney(billings, a.currency), collections: fmtMoney(collections, a.currency), commission_revenue: fmtMoney(commission, a.currency), estimated_profit: fmtMoney(profit, a.currency) },
      };
    }
  );
}

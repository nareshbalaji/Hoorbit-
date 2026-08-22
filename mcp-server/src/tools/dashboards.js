import { z } from "zod";
import { read, findById } from "../db.js";
import { defineTool, notFound } from "../lib/toolkit.js";
import { fmtMoney, convert, round2 } from "../lib/currency.js";

function toCsv(rows) {
  if (!rows.length) return "";
  const cols = Array.from(rows.reduce((set, r) => { Object.keys(r).forEach((k) => set.add(k)); return set; }, new Set()));
  const esc = (v) => {
    if (v == null) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

export function registerDashboardTools(server) {
  defineTool(
    server,
    "get_company_dashboard",
    {
      title: "Get company (client) dashboard",
      description: "Aggregate a client's active projects, spend, and assigned team.",
      inputSchema: { client_id: z.string(), currency: z.string().default("USD") },
    },
    async (a) => {
      const client = findById("clients", a.client_id) || notFound("client", a.client_id);
      const projects = read("projects").filter((p) => p.client_id === a.client_id);
      const invoices = read("invoices").filter((i) => i.client_id === a.client_id);
      const teamSize = projects.reduce((s, p) => s + p.team_assigned.filter((t) => t.status === "active").length, 0);
      const monthlySpend = round2(projects.reduce((s, p) => s + p.team_assigned.filter((t) => t.status === "active").reduce((s2, t) => s2 + convert(t.rate_monthly, t.currency, a.currency), 0), 0));
      const outstanding = round2(invoices.filter((i) => i.payment_status !== "paid").reduce((s, i) => s + convert(i.total_invoice, i.currency, a.currency), 0));
      return {
        success: true, client: client.company_name, active_projects: projects.filter((p) => p.timeline.status !== "closed").length,
        total_projects: projects.length, team_size: teamSize, monthly_spend: monthlySpend, formatted_monthly_spend: fmtMoney(monthlySpend, a.currency),
        outstanding_invoices: outstanding, formatted_outstanding: fmtMoney(outstanding, a.currency),
        projects: projects.map((p) => ({ id: p.id, title: p.title, status: p.timeline.status, timeline_status: p.timeline_status, team: `${p.team_assigned.length}/${p.team_size_needed}` })),
      };
    }
  );

  defineTool(
    server,
    "get_developer_dashboard",
    {
      title: "Get developer dashboard",
      description: "Aggregate a developer's applications, active contract, and recent pay history.",
      inputSchema: { developer_id: z.string() },
    },
    async (a) => {
      const developer = findById("developers", a.developer_id) || notFound("developer", a.developer_id);
      const applications = read("candidates").filter((c) => c.developer_id === a.developer_id);
      const activeContract = read("contracts").find((c) => c.developer_id === a.developer_id && c.status === "signed");
      const payroll = read("payroll").filter((p) => p.developer_id === a.developer_id).sort((x, y) => y.month.localeCompare(x.month));
      return {
        success: true, developer: developer.name, status: developer.status, applications_total: applications.length,
        applications_by_stage: applications.reduce((acc, c) => { acc[c.stage] = (acc[c.stage] || 0) + 1; return acc; }, {}),
        active_contract: activeContract ? { project_id: activeContract.project_id, position: activeContract.position, salary_monthly: activeContract.salary_monthly, currency: activeContract.currency } : null,
        recent_payslips: payroll.slice(0, 3).map((p) => ({ month: p.month, net_pay: p.net_pay, currency: p.currency })),
        lifetime_earned_usd: developer.total_earned_usd,
      };
    }
  );

  defineTool(
    server,
    "get_admin_dashboard",
    {
      title: "Get admin/owner dashboard",
      description: "Platform-wide metrics for Hoorbit LLC: active projects, commission revenue, payroll run-rate, and portfolio value, converted to a target currency.",
      inputSchema: { currency: z.string().default("USD") },
    },
    async (a) => {
      const projects = read("projects");
      const active = projects.filter((p) => p.timeline.status !== "closed");
      const invoices = read("invoices");
      const developers = read("developers");
      const totalValue = round2(active.reduce((s, p) => s + convert(p.budget, p.budget_currency, a.currency), 0));
      const lifetimeCommission = round2(invoices.reduce((s, i) => s + convert(i.commission_amount, i.currency, a.currency), 0));
      const collected = round2(invoices.filter((i) => i.payment_status === "paid").reduce((s, i) => s + convert(i.total_invoice, i.currency, a.currency), 0));
      const payroll = round2(active.reduce((s, p) => s + p.team_assigned.filter((t) => t.status === "active").reduce((s2, t) => s2 + convert(t.rate_monthly, t.currency, a.currency), 0), 0));
      return {
        success: true, currency: a.currency,
        platform_metrics: {
          total_developers: developers.length, active_developers: developers.filter((d) => d.status === "active").length,
          total_projects_lifetime: projects.length, active_projects: active.length,
          total_active_portfolio_value: totalValue, formatted_portfolio_value: fmtMoney(totalValue, a.currency),
          lifetime_commission: lifetimeCommission, formatted_lifetime_commission: fmtMoney(lifetimeCommission, a.currency),
          cash_collected: collected, formatted_cash_collected: fmtMoney(collected, a.currency),
          payroll_run_rate_monthly: payroll, formatted_payroll_run_rate: fmtMoney(payroll, a.currency),
        },
        business_health: {
          avg_commission_rate: `${round2((projects.reduce((s, p) => s + p.commission_rate, 0) / (projects.length || 1)) * 100)}%`,
          open_seats: active.reduce((s, p) => s + Math.max(0, p.team_size_needed - p.team_assigned.length), 0),
        },
      };
    }
  );

  defineTool(
    server,
    "generate_analytics_report",
    {
      title: "Generate an analytics report",
      description: "Return structured series data for a metric: revenue_by_project, commission_trend (by billing month), or team_utilization.",
      inputSchema: { metric: z.enum(["revenue_by_project", "commission_trend", "team_utilization"]), currency: z.string().default("USD") },
    },
    async (a) => {
      if (a.metric === "revenue_by_project") {
        const projects = read("projects");
        const invoices = read("invoices");
        const series = projects.map((p) => ({ project: p.title, client: p.client_name, commission: round2(invoices.filter((i) => i.project_id === p.id).reduce((s, i) => s + convert(i.commission_amount, i.currency, a.currency), 0)) })).filter((r) => r.commission > 0).sort((x, y) => y.commission - x.commission);
        return { success: true, metric: a.metric, currency: a.currency, series };
      }
      if (a.metric === "commission_trend") {
        const invoices = read("invoices");
        const months = Array.from(new Set(invoices.map((i) => i.month))).sort();
        const series = months.map((m) => ({ month: m, commission: round2(invoices.filter((i) => i.month === m).reduce((s, i) => s + convert(i.commission_amount, i.currency, a.currency), 0)) }));
        return { success: true, metric: a.metric, currency: a.currency, series };
      }
      const active = read("projects").filter((p) => p.timeline.status !== "closed");
      const filled = active.reduce((s, p) => s + p.team_assigned.filter((t) => t.status === "active").length, 0);
      const openSeats = active.reduce((s, p) => s + Math.max(0, p.team_size_needed - p.team_assigned.length), 0);
      return { success: true, metric: a.metric, filled_seats: filled, open_seats: openSeats, utilization_pct: round2((filled / (filled + openSeats || 1)) * 100) };
    }
  );

  defineTool(
    server,
    "export_data_csv",
    {
      title: "Export data as CSV",
      description: "Export a collection (developers, projects, invoices, candidates, or tickets) as CSV text.",
      inputSchema: { entity: z.enum(["developers", "projects", "invoices", "candidates", "tickets"]) },
    },
    async (a) => {
      const rows = read(a.entity);
      return { success: true, entity: a.entity, row_count: rows.length, csv: toCsv(rows) };
    }
  );

  defineTool(
    server,
    "generate_business_intelligence",
    {
      title: "Generate business-intelligence insights",
      description: "Synthesize a few headline insights from real platform data: top project by revenue, highest-margin client, utilization, and pipeline health.",
      inputSchema: { currency: z.string().default("USD") },
    },
    async (a) => {
      const projects = read("projects");
      const invoices = read("invoices");
      const candidates = read("candidates");

      const byProject = projects.map((p) => ({ project: p.title, client: p.client_name, commission: round2(invoices.filter((i) => i.project_id === p.id).reduce((s, i) => s + convert(i.commission_amount, i.currency, a.currency), 0)) })).sort((x, y) => y.commission - x.commission);
      const topProject = byProject[0] || null;

      const active = projects.filter((p) => p.timeline.status !== "closed");
      const filled = active.reduce((s, p) => s + p.team_assigned.filter((t) => t.status === "active").length, 0);
      const openSeats = active.reduce((s, p) => s + Math.max(0, p.team_size_needed - p.team_assigned.length), 0);
      const utilization = round2((filled / (filled + openSeats || 1)) * 100);

      const pipelineByStage = candidates.reduce((acc, c) => { acc[c.stage] = (acc[c.stage] || 0) + 1; return acc; }, {});
      const overdueInvoices = invoices.filter((i) => i.payment_status !== "paid" && new Date(i.due_date) < new Date());

      const insights = [
        topProject ? `Highest-revenue engagement: "${topProject.project}" (${topProject.client}) — ${fmtMoney(topProject.commission, a.currency)} commission to date.` : "No commission data yet.",
        `Team utilization is ${utilization}% (${filled} filled seats, ${openSeats} open) across ${active.length} active projects.`,
        `Recruiting pipeline: ${JSON.stringify(pipelineByStage)}.`,
        overdueInvoices.length ? `${overdueInvoices.length} invoice(s) are overdue — collections follow-up recommended.` : "No overdue invoices right now.",
      ];

      return { success: true, currency: a.currency, top_project: topProject, utilization_pct: utilization, pipeline_by_stage: pipelineByStage, overdue_invoice_count: overdueInvoices.length, insights };
    }
  );
}

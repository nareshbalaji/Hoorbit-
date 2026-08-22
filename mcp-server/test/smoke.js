// End-to-end smoke test: spawns the real stdio MCP server as a child process
// (exactly how Claude Code / Claude Desktop would run it via .mcp.json) and
// drives it with the official SDK Client — tools/list plus one representative
// tools/call per module.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

// Fresh seed for a deterministic test run.
const dbDir = path.join(ROOT, "database");
if (fs.existsSync(dbDir)) fs.rmSync(dbDir, { recursive: true, force: true });

let pass = 0;
let fail = 0;
function check(label, cond, extra) {
  if (cond) {
    pass++;
    console.log(`  ok  ${label}`);
  } else {
    fail++;
    console.log(`FAIL  ${label}${extra ? " — " + JSON.stringify(extra) : ""}`);
  }
}

function parse(result) {
  const text = result.content && result.content[0] && result.content[0].text;
  return { raw: result, json: text ? JSON.parse(text) : null, isError: !!result.isError };
}

async function main() {
  const transport = new StdioClientTransport({ command: "node", args: ["bin/stdio.js"], cwd: ROOT, stderr: "inherit" });
  const client = new Client({ name: "hoorbit-smoke-test", version: "1.0.0" });
  await client.connect(transport);

  console.log("\n=== tools/list ===");
  const list = await client.listTools();
  console.log(`Tool count: ${list.tools.length}`);
  check("registers 56 tools", list.tools.length === 56, list.tools.map((t) => t.name));
  const names = list.tools.map((t) => t.name);
  const EXPECTED = [
    "post_job", "search_developers", "apply_for_job", "enable_auto_apply", "get_match_score", "get_developer_profile", "bulk_import_developers", "create_candidate_pipeline",
    "generate_contract", "add_contract_conditions", "sign_contract", "verify_contract_signatures", "store_contract_archive", "generate_amendments", "calculate_severance",
    "create_onboarding_checklist", "send_welcome_packet", "verify_background_check", "setup_tax_withholding", "create_employee_record", "generate_offer_letter",
    "verify_insurance_eligibility", "generate_insurance_quotes", "enroll_in_insurance", "manage_benefits_package", "generate_insurance_coverage_letter", "track_insurance_claims",
    "calculate_gross_salary", "calculate_taxes", "calculate_insurance_deductions", "calculate_net_pay", "generate_pay_stub", "process_payroll", "generate_w2_at_year_end",
    "generate_invoice_to_company", "itemize_invoice_costs", "send_invoice_to_company", "track_payment_status", "record_payment_received", "calculate_commission_breakdown", "process_bank_transfer", "generate_financial_reports",
    "verify_labor_law_compliance", "generate_compliance_report", "store_compliance_records", "audit_trail", "data_security_encryption",
    "get_company_dashboard", "get_developer_dashboard", "get_admin_dashboard", "generate_analytics_report", "export_data_csv", "generate_business_intelligence",
    "send_notification", "create_support_ticket", "generate_dispute_resolution",
  ];
  for (const name of EXPECTED) check(`tool present: ${name}`, names.includes(name));

  console.log("\n=== recruitment ===");
  {
    const r = parse(await client.callTool({ name: "search_developers", arguments: { skills: ["RPG"] } }));
    check("search_developers finds RPG devs", r.json.success && r.json.count > 0, r.json);

    const match = parse(await client.callTool({ name: "get_match_score", arguments: { developer_id: "dev_001", job_id: "project_001" } }));
    check("get_match_score returns a score", match.json.success && typeof match.json.match_score === "number", match.json);

    const apply = parse(await client.callTool({ name: "apply_for_job", arguments: { developer_id: "dev_008", job_id: "project_003" } }));
    check("apply_for_job creates a candidate", apply.json.success && !!apply.json.candidate_id, apply.json);

    const posted = parse(await client.callTool({ name: "post_job", arguments: { company: "Test Bank Corp", job_title: "COBOL Modernization Lead", required_skills: ["COBOL"], location: "Remote", salary_min: 5000, salary_max: 7000, currency: "USD", team_size: 1 } }));
    check("post_job creates a project + returns matches array", posted.json.success && !!posted.json.job_id && Array.isArray(posted.json.top_matches), posted.json);
  }

  console.log("\n=== contracts ===");
  let contractId;
  {
    const gen = parse(await client.callTool({ name: "generate_contract", arguments: { developer_id: "dev_008", project_id: "project_003", position: "SAP APO Consultant", salary_monthly: 5600, currency: "USD", start_date: "2025-09-01", end_date: "2026-03-01" } }));
    check("generate_contract creates a draft", gen.json.success && !!gen.json.contract_id, gen.json);
    contractId = gen.json.contract_id;

    const sign1 = parse(await client.callTool({ name: "sign_contract", arguments: { contract_id: contractId, party: "developer", signer_name: "Anjali Deshmukh" } }));
    check("sign_contract (developer) -> pending_signature", sign1.json.success && sign1.json.status === "pending_signature", sign1.json);

    const sign2 = parse(await client.callTool({ name: "sign_contract", arguments: { contract_id: contractId, party: "hoorbit", signer_name: "Hoorbit Talent Ops" } }));
    check("sign_contract (hoorbit) -> signed", sign2.json.success && sign2.json.status === "signed", sign2.json);

    const verify = parse(await client.callTool({ name: "verify_contract_signatures", arguments: { contract_id: contractId } }));
    check("verify_contract_signatures -> fully_executed", verify.json.fully_executed === true, verify.json);

    const severance = parse(await client.callTool({ name: "calculate_severance", arguments: { contract_id: contractId, notice_days_owed: 14 } }));
    check("calculate_severance returns an amount", severance.json.success && severance.json.severance_amount > 0, severance.json);
  }

  console.log("\n=== onboarding ===");
  {
    const checklist = parse(await client.callTool({ name: "create_onboarding_checklist", arguments: { developer_id: "dev_008", project_id: "project_003" } }));
    check("create_onboarding_checklist has 10 items", checklist.json.success && Object.keys(checklist.json.checklist).length === 10, checklist.json);

    const bg = parse(await client.callTool({ name: "verify_background_check", arguments: { developer_id: "dev_008", status: "cleared" } }));
    check("verify_background_check", bg.json.success && bg.json.background_check === "cleared", bg.json);

    const offerLetter = parse(await client.callTool({ name: "generate_offer_letter", arguments: { contract_id: contractId } }));
    check("generate_offer_letter returns letter text", offerLetter.json.success && offerLetter.json.letter_text.includes("Hoorbit LLC"), offerLetter.json);
  }

  console.log("\n=== insurance ===");
  {
    const quotes = parse(await client.callTool({ name: "generate_insurance_quotes", arguments: { developer_id: "dev_008", coverage_amount: 50000, currency: "USD" } }));
    check("generate_insurance_quotes returns 3 tiers", quotes.json.success && quotes.json.quotes.length === 3, quotes.json);

    const enroll = parse(await client.callTool({ name: "enroll_in_insurance", arguments: { developer_id: "dev_008", plan: "Standard", coverage_amount: 50000, currency: "USD" } }));
    check("enroll_in_insurance", enroll.json.success && enroll.json.status === "active", enroll.json);

    const claim = parse(await client.callTool({ name: "track_insurance_claims", arguments: { developer_id: "dev_008", action: "file", description: "Eye exam", amount: 60 } }));
    check("track_insurance_claims file", claim.json.success && !!claim.json.claim.id, claim.json);
  }

  console.log("\n=== payroll (bug check) ===");
  {
    const gross = parse(await client.callTool({ name: "calculate_gross_salary", arguments: { developer_id: "dev_001" } }));
    check("calculate_gross_salary matches seed rate exactly (no /100 bug)", gross.json.monthly_gross === 3200, gross.json);

    const stub = parse(await client.callTool({ name: "generate_pay_stub", arguments: { developer_id: "dev_001", month: "2025-09" } }));
    check("generate_pay_stub net < gross", stub.json.success && stub.json.net_pay < stub.json.gross_salary && stub.json.net_pay > 0, stub.json);

    const batch = parse(await client.callTool({ name: "process_payroll", arguments: { month: "2025-09" } }));
    check("process_payroll processes active devs", batch.json.success && batch.json.processed_employees >= 1, batch.json);
  }

  console.log("\n=== invoicing ===");
  {
    const inv = parse(await client.callTool({ name: "generate_invoice_to_company", arguments: { project_id: "project_001", month: "2025-09" } }));
    check("generate_invoice_to_company", inv.json.success && inv.json.total_invoice > inv.json.team_costs, inv.json);
    const invoiceId = inv.json.invoice_id;

    const itemized = parse(await client.callTool({ name: "itemize_invoice_costs", arguments: { invoice_id: invoiceId } }));
    check("itemize_invoice_costs has line items", itemized.json.success && itemized.json.line_items.length >= 2, itemized.json);

    const paid = parse(await client.callTool({ name: "record_payment_received", arguments: { invoice_id: invoiceId } }));
    check("record_payment_received -> paid", paid.json.success && paid.json.payment_status === "paid", paid.json);

    const reports = parse(await client.callTool({ name: "generate_financial_reports", arguments: { currency: "USD" } }));
    check("generate_financial_reports has commission_revenue", reports.json.success && typeof reports.json.commission_revenue === "number", reports.json);
  }

  console.log("\n=== compliance ===");
  {
    const audit = parse(await client.callTool({ name: "audit_trail", arguments: { limit: 5 } }));
    check("audit_trail recorded prior mutations", audit.json.success && audit.json.entries.length > 0, audit.json);

    const compliance = parse(await client.callTool({ name: "generate_compliance_report", arguments: { scope: "company" } }));
    check("generate_compliance_report (company)", compliance.json.success && typeof compliance.json.status === "string", compliance.json);
  }

  console.log("\n=== dashboards ===");
  {
    const admin = parse(await client.callTool({ name: "get_admin_dashboard", arguments: { currency: "USD" } }));
    check("get_admin_dashboard has platform_metrics", admin.json.success && !!admin.json.platform_metrics, admin.json);

    const csv = parse(await client.callTool({ name: "export_data_csv", arguments: { entity: "developers" } }));
    check("export_data_csv returns CSV with header row", csv.json.success && csv.json.csv.split("\n")[0].includes("id"), { preview: csv.json.csv?.slice(0, 80) });

    const bi = parse(await client.callTool({ name: "generate_business_intelligence", arguments: {} }));
    check("generate_business_intelligence returns insights", bi.json.success && bi.json.insights.length > 0, bi.json);
  }

  console.log("\n=== support ===");
  {
    const ticket = parse(await client.callTool({ name: "create_support_ticket", arguments: { from_type: "developer", from_id: "dev_001", category: "payslip_issue", subject: "Test ticket" } }));
    check("create_support_ticket routes correctly", ticket.json.success && ticket.json.assigned_to === "HR — Payroll", ticket.json);

    const dispute = parse(await client.callTool({ name: "generate_dispute_resolution", arguments: { parties: ["Hoorbit", "dev_001"], issue: "Late payslip" } }));
    check("generate_dispute_resolution returns steps", dispute.json.success && dispute.json.dispute.steps.length > 0, dispute.json);
  }

  console.log("\n=== error handling ===");
  {
    const bad = parse(await client.callTool({ name: "get_developer_profile", arguments: { developer_id: "does_not_exist" } }));
    check("unknown developer_id returns isError", bad.isError === true, bad.json);
  }

  await client.close();

  console.log(`\n${pass} passed, ${fail} failed.`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("SMOKE TEST FATAL:", err);
  process.exit(1);
});

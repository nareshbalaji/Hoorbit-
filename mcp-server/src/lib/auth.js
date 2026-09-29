// Real authn/authz for the MCP protocol layer itself — not just a UI concern.
//
// Auth model: static bearer tokens mapped to a demo user directory (role +,
// for scoped roles, the single client/developer record they're allowed to
// touch). This mirrors the Hoorbit Console artifact's login/role system, but
// enforced here on every tool call, server-side, regardless of what any
// client UI shows or hides.
//
// This is intentionally simple (static tokens, no expiry, no rotation) —
// it's a demo. A real deployment should replace resolveToken()'s lookup with
// real OAuth/JWT validation; the authorize() capability + scoping logic below
// is the part worth keeping.

import { read } from "../db.js";

export class AuthError extends Error {
  constructor(message) {
    super(message);
    this.name = "AuthError";
    this.code = "UNAUTHORIZED";
  }
}

export const ROLE_META = {
  pm: { label: "Project Manager", scope: "Full access — every tool, every record." },
  employer: { label: "Employer / Client", scope: "Scoped to your own company's projects, team, and invoices." },
  developer: { label: "Developer", scope: "Scoped to your own applications, contract, payroll, and insurance." },
  recruiter: { label: "Recruiter", scope: "Candidate pipeline, interviews, offers, contracts — no financial/billing tools." },
  onboarding: { label: "Onboarding Coordinator", scope: "New-hire checklists, background checks, insurance enrollment — no financial/billing tools." },
  support: { label: "Support Agent", scope: "Tickets, notifications, and read-only lookups needed to resolve them — no financial/billing tools." },
  buyer: { label: "Trade Buyer", scope: "Cross-border trade: your own company's verification, RFQs, matches, NDAs, negotiations, escrow and deal sheets." },
  supplier: { label: "Trade Supplier", scope: "Cross-border trade: your own company's verification and only the RFQ matches routed to you — no RFQ browsing." },
};

const STAFF_USERS = [
  { id: "staff_pm", token: "hoorbit_pm_naresh", name: "Naresh Balaji", role: "pm", linkedId: null },
  { id: "staff_recruiter", token: "hoorbit_recruiter_aisha", name: "Aisha Rahman", role: "recruiter", linkedId: null },
  { id: "staff_onboarding", token: "hoorbit_onboarding_tom", name: "Tom Becker", role: "onboarding", linkedId: null },
  { id: "staff_support", token: "hoorbit_support_priya", name: "Priya Iyer", role: "support", linkedId: null },
];

function loadDirectory() {
  const clients = read("clients");
  const developers = read("developers");
  const employerUsers = clients.map((c) => ({ id: `user_${c.id}`, token: `hoorbit_employer_${c.id}`, name: c.contact_name, role: "employer", linkedId: c.id, company: c.company_name }));
  const developerUsers = developers.map((d) => ({ id: `user_${d.id}`, token: `hoorbit_developer_${d.id}`, name: d.name, role: "developer", linkedId: d.id }));
  const tradeUsers = read("trade_companies").map((c) => ({ id: `user_${c.id}`, token: `hoorbit_${c.type}_${c.id}`, name: c.contact.name, role: c.type, linkedId: c.id, company: c.company_name }));
  return [...STAFF_USERS, ...employerUsers, ...developerUsers, ...tradeUsers];
}

export function listDemoAccounts() {
  return loadDirectory().map((u) => ({ name: u.name, role: u.role, token: u.token, company_or_id: u.company || u.linkedId || null }));
}

export function resolveToken(token) {
  if (!token) return null;
  const user = loadDirectory().find((u) => u.token === token);
  return user || null;
}

// Tool allow-lists, deny by default. "pm" is granted everything via "*" and
// is checked separately — it never needs to appear in these lists.
const PERMISSIONS = {
  employer: [
    "post_job", "search_developers", "get_match_score",
    "get_company_dashboard", "track_payment_status", "itemize_invoice_costs",
    "send_notification", "create_support_ticket", "whoami",
  ],
  developer: [
    "apply_for_job", "enable_auto_apply", "get_match_score", "get_developer_profile", "get_developer_dashboard",
    "sign_contract", "calculate_gross_salary", "calculate_taxes", "calculate_net_pay", "calculate_insurance_deductions",
    "verify_insurance_eligibility", "generate_insurance_quotes", "track_insurance_claims",
    "create_support_ticket", "send_notification", "whoami",
  ],
  recruiter: [
    "post_job", "search_developers", "apply_for_job", "enable_auto_apply", "get_match_score", "get_developer_profile",
    "bulk_import_developers", "create_candidate_pipeline",
    "generate_contract", "add_contract_conditions", "sign_contract", "verify_contract_signatures", "generate_amendments", "generate_offer_letter",
    "verify_labor_law_compliance", "send_notification", "create_support_ticket", "whoami",
  ],
  onboarding: [
    "get_developer_profile", "create_onboarding_checklist", "send_welcome_packet", "verify_background_check",
    "setup_tax_withholding", "create_employee_record",
    "verify_insurance_eligibility", "generate_insurance_quotes", "enroll_in_insurance", "manage_benefits_package", "generate_insurance_coverage_letter",
    "store_compliance_records", "verify_labor_law_compliance",
    "send_notification", "create_support_ticket", "whoami",
  ],
  support: [
    "get_developer_profile", "get_company_dashboard", "get_developer_dashboard",
    "track_insurance_claims", "create_support_ticket", "send_notification", "generate_dispute_resolution", "whoami",
  ],
  buyer: [
    "verify_trade_business", "suggest_hs_code", "screen_trade_compliance", "get_trade_documents",
    "build_rfq", "match_suppliers", "list_trade_matches", "sign_platform_nda", "get_match_contact",
    "normalize_trade_message", "submit_counter_offer", "recommend_inspection", "create_escrow_milestones", "generate_deal_sheet", "whoami",
  ],
  supplier: [
    "verify_trade_business", "suggest_hs_code", "screen_trade_compliance", "get_trade_documents",
    "list_trade_matches", "sign_platform_nda", "get_match_contact",
    "normalize_trade_message", "submit_counter_offer", "recommend_inspection", "generate_deal_sheet", "whoami",
  ],
};

export function allowedTools(role) {
  if (role === "pm") return ["*"];
  return PERMISSIONS[role] || [];
}

function ownsProject(user, projectId) {
  const project = read("projects").find((p) => p.id === projectId);
  return !!project && project.client_id === user.linkedId;
}
function ownsInvoice(user, invoiceId) {
  const invoice = read("invoices").find((i) => i.id === invoiceId);
  return !!invoice && invoice.client_id === user.linkedId;
}
function ownsRfq(user, rfqId) {
  const rfq = read("trade_rfqs").find((r) => r.id === rfqId);
  return !!rfq && rfq.buyer_id === user.linkedId;
}
function partyToMatch(user, matchId) {
  const match = read("trade_matches").find((m) => m.id === matchId);
  if (!match) return false;
  return user.role === "buyer" ? match.buyer_id === user.linkedId : match.supplier_id === user.linkedId;
}
function ownsContract(user, contractId) {
  const contract = read("contracts").find((c) => c.id === contractId);
  return !!contract && contract.developer_id === user.linkedId;
}

// Row-level scoping on top of the tool-level allow-list: even a tool you're
// allowed to call can only be called against records you own, if you're not pm.
function checkScope(user, toolName, args) {
  if (user.role === "employer") {
    if (toolName === "post_job" && args.company && user.company && args.company.toLowerCase() !== user.company.toLowerCase()) {
      throw new AuthError(`You can only post jobs for your own company ("${user.company}").`);
    }
    if (toolName === "get_company_dashboard" && args.client_id !== user.linkedId) throw new AuthError("You can only view your own company's dashboard.");
    if ((toolName === "track_payment_status") && args.invoice_id && !ownsInvoice(user, args.invoice_id)) throw new AuthError("That invoice does not belong to your company.");
    if (toolName === "itemize_invoice_costs" && args.invoice_id && !ownsInvoice(user, args.invoice_id)) throw new AuthError("That invoice does not belong to your company.");
  }

  if (user.role === "developer") {
    const selfScopedParam = ["developer_id"].find((p) => p in args);
    if (selfScopedParam && args[selfScopedParam] !== user.linkedId) {
      throw new AuthError(`You can only act on your own developer record (${user.linkedId}), not ${args[selfScopedParam]}.`);
    }
    if (toolName === "sign_contract") {
      if (args.party !== "developer") throw new AuthError("Developers can only sign as the 'developer' party.");
      if (args.contract_id && !ownsContract(user, args.contract_id)) throw new AuthError("That contract is not yours to sign.");
    }
    if (toolName === "get_match_score" && args.job_id && args.developer_id !== user.linkedId) throw new AuthError("You can only check your own match score.");
    if ((toolName === "create_support_ticket" || toolName === "send_notification")) {
      const idField = toolName === "create_support_ticket" ? "from_id" : "to_id";
      if (args[idField] && args[idField] !== user.linkedId) throw new AuthError("You can only file/notify on your own behalf.");
    }
  }

  // Trade roles: a company can only act as itself, on its own RFQs, and on
  // matches it is a party to. A supplier never sees an RFQ that wasn't routed
  // to it (no lead browsing), and nobody can sign or negotiate as the other side.
  if (user.role === "buyer" || user.role === "supplier") {
    for (const p of ["company_id", "buyer_id"]) {
      if (p in args && args[p] !== user.linkedId) throw new AuthError(`You can only act for your own company (${user.linkedId}), not ${args[p]}.`);
    }
    if (args.rfq_id) {
      if (user.role === "buyer" && !ownsRfq(user, args.rfq_id)) throw new AuthError("That RFQ does not belong to your company.");
      if (user.role === "supplier" && !read("trade_matches").some((m) => m.rfq_id === args.rfq_id && m.supplier_id === user.linkedId)) throw new AuthError("That RFQ has not been routed to your company.");
    }
    if (args.match_id && !partyToMatch(user, args.match_id)) throw new AuthError("You are not a party to that match.");
    if (args.party && args.party !== user.role) throw new AuthError(`You can only act as the '${user.role}' party.`);
  }

  if (user.role === "support") {
    if (toolName === "get_company_dashboard" || toolName === "get_developer_dashboard" || toolName === "get_developer_profile" || toolName === "track_insurance_claims") {
      // read-only lookups, allowed for any record — support needs this to resolve tickets.
    }
  }
}

export function authorize(user, toolName) {
  if (toolName === "whoami") return; // always allowed, even without full permission list checks below (still requires a resolved user — enforced by the caller)
  if (!user) throw new AuthError(`No valid Hoorbit auth token provided. Every tool call requires a bearer token — see mcp-server/README.md for demo tokens (one per role).`);
  if (user.role === "pm") return;
  const allowed = allowedTools(user.role);
  if (!allowed.includes(toolName)) {
    throw new AuthError(`${ROLE_META[user.role].label} accounts cannot call '${toolName}'. Allowed tools for this role: ${allowed.join(", ")}.`);
  }
}

export function enforce(user, toolName, args) {
  authorize(user, toolName);
  if (user && user.role !== "pm") checkScope(user, toolName, args || {});
}

// Field-level redaction for get_developer_profile: full detail for pm and for
// the developer viewing their own record; masked for everyone else who's
// allowed to look the record up at all (recruiter/onboarding/support).
export function redactDeveloperProfileIfNeeded(user, developer) {
  const isSelf = user && user.role === "developer" && user.linkedId === developer.id;
  if (!user || user.role === "pm" || isSelf) return developer;
  const { bank_account, tax_id, tax_withholding, ...safe } = developer;
  return { ...safe, bank_account: "[redacted — not visible to your role]", tax_id: "[redacted — not visible to your role]" };
}

import { z } from "zod";
import { read, update, findById } from "../db.js";
import { defineTool, notFound } from "../lib/toolkit.js";
import { uid, nowISO } from "../lib/ids.js";
import { fmtMoney } from "../lib/currency.js";
import { ONBOARD_ITEMS, COMPANY, NOT_LEGAL_ADVICE, NO_REAL_MONEY_MOVES, COPYRIGHT_LINE, FACILITATOR_MODEL } from "../lib/constants.js";

export function registerOnboardingTools(server, user) {
  defineTool(
    server,
    user,
    "create_onboarding_checklist",
    {
      title: "Create onboarding checklist",
      description: "Generate the standard 10-item new-hire onboarding checklist for a developer starting a project.",
      inputSchema: { developer_id: z.string(), project_id: z.string() },
      mutating: { entityType: "onboarding", idParam: "developer_id" },
    },
    async (a) => {
      findById("developers", a.developer_id) || notFound("developer", a.developer_id);
      findById("projects", a.project_id) || notFound("project", a.project_id);
      const existing = read("onboarding").find((o) => o.developer_id === a.developer_id && o.project_id === a.project_id);
      if (existing) return { success: true, onboarding_id: existing.id, message: "Checklist already exists", checklist: existing.checklist };

      const checklist = Object.fromEntries(ONBOARD_ITEMS.map((k) => [k, false]));
      const record = { id: uid("onb"), developer_id: a.developer_id, project_id: a.project_id, checklist, welcome_packet_sent: false, created_at: nowISO() };
      update("onboarding", (rows) => { rows.push(record); });
      return { success: true, onboarding_id: record.id, items: ONBOARD_ITEMS, checklist };
    }
  );

  defineTool(
    server,
    user,
    "send_welcome_packet",
    {
      title: "Send welcome packet",
      description: "Send (simulated) the welcome email + document packet to a newly onboarded developer.",
      inputSchema: { developer_id: z.string() },
      mutating: { entityType: "developer", idParam: "developer_id" },
    },
    async (a) => {
      const developer = findById("developers", a.developer_id) || notFound("developer", a.developer_id);
      update("onboarding", (rows) => rows.map((o) => (o.developer_id === a.developer_id ? { ...o, welcome_packet_sent: true } : o)));
      return {
        success: true, developer_id: a.developer_id, sent_to: developer.email, from: COMPANY.sender_email,
        subject: "Welcome to your Hoorbit-staffed engagement",
        contents: ["Onboarding checklist", "Team & client point-of-contact introduction", "Knowledge-transfer plan", "First-week task list"],
        note: NO_REAL_MONEY_MOVES,
      };
    }
  );

  defineTool(
    server,
    user,
    "verify_background_check",
    {
      title: "Verify background check",
      description: "Record the outcome of a background check for a developer.",
      inputSchema: { developer_id: z.string(), status: z.enum(["cleared", "pending", "failed", "in_review"]) },
      mutating: { entityType: "developer", idParam: "developer_id" },
    },
    async (a) => {
      findById("developers", a.developer_id) || notFound("developer", a.developer_id);
      update("developers", (rows) => rows.map((d) => (d.id === a.developer_id ? { ...d, background_check: a.status } : d)));
      if (a.status === "cleared") {
        update("onboarding", (rows) => rows.map((o) => (o.developer_id === a.developer_id ? { ...o, checklist: { ...o.checklist, background_check_cleared: true } } : o)));
      }
      return { success: true, developer_id: a.developer_id, background_check: a.status };
    }
  );

  defineTool(
    server,
    user,
    "setup_tax_withholding",
    {
      title: "Set up tax withholding",
      description: "Record tax-withholding paperwork (e.g. W-4/W-9 for US, or local equivalent) submitted for a developer.",
      inputSchema: { developer_id: z.string(), form_type: z.string().describe("e.g. W-4, W-9, TD1, local equivalent"), filing_status: z.string().optional(), allowances: z.number().optional() },
      mutating: { entityType: "developer", idParam: "developer_id" },
    },
    async (a) => {
      findById("developers", a.developer_id) || notFound("developer", a.developer_id);
      const record = { form_type: a.form_type, filing_status: a.filing_status || null, allowances: a.allowances ?? null, submitted_at: nowISO() };
      update("developers", (rows) => rows.map((d) => (d.id === a.developer_id ? { ...d, tax_withholding: record } : d)));
      update("onboarding", (rows) => rows.map((o) => (o.developer_id === a.developer_id ? { ...o, checklist: { ...o.checklist, tax_docs_submitted: true } } : o)));
      return { success: true, developer_id: a.developer_id, tax_withholding: record, disclaimer: NOT_LEGAL_ADVICE };
    }
  );

  defineTool(
    server,
    user,
    "create_employee_record",
    {
      title: "Create HR employee record",
      description: "Formally create the canonical HR record for a developer once contracted (bank details verified, employee record flagged as created).",
      inputSchema: { developer_id: z.string(), bank_account_last4: z.string().optional() },
      mutating: { entityType: "developer", idParam: "developer_id" },
    },
    async (a) => {
      const developer = findById("developers", a.developer_id) || notFound("developer", a.developer_id);
      const bank_account = a.bank_account_last4 ? `XXXXXX••${a.bank_account_last4}` : developer.bank_account;
      update("developers", (rows) => rows.map((d) => (d.id === a.developer_id ? { ...d, bank_account, employee_record_created: true } : d)));
      update("onboarding", (rows) => rows.map((o) => (o.developer_id === a.developer_id ? { ...o, checklist: { ...o.checklist, bank_details_verified: true } } : o)));
      return { success: true, developer_id: a.developer_id, employee_record_created: true, bank_account };
    }
  );

  defineTool(
    server,
    user,
    "generate_offer_letter",
    {
      title: "Generate offer letter",
      description: "Generate the text of a formal offer letter from a draft or signed contract. The offer is issued for the client company's project and facilitated by Hoorbit — not an offer of employment by Hoorbit itself.",
      inputSchema: { contract_id: z.string() },
      mutating: { entityType: "contract", idParam: "contract_id" },
    },
    async (a) => {
      const contract = findById("contracts", a.contract_id) || notFound("contract", a.contract_id);
      const developer = findById("developers", contract.developer_id) || notFound("developer", contract.developer_id);
      const project = findById("projects", contract.project_id) || notFound("project", contract.project_id);
      update("contracts", (rows) => rows.map((c) => (c.id === a.contract_id ? { ...c, offer_letter_generated: true } : c)));

      const letter =
        `${COMPANY.legal_name}\n${COMPANY.address}\n${COMPANY.website}\n\n` +
        `Dear ${developer.name},\n\n` +
        `${COMPANY.legal_name} is pleased to confirm your placement as ${contract.position} on the "${project.title}" project ` +
        `for ${project.client_name}. Hoorbit facilitated this match and administers the paperwork/invoicing around it; ` +
        `${project.client_name} (or its designated Employer-of-Record) is the party you are actually engaged by.\n\n` +
        `Rate: ${fmtMoney(contract.salary_monthly, contract.currency)} / month\n` +
        `Start date: ${contract.start_date}\nEnd date (est.): ${contract.end_date}\n\n` +
        `This placement is contingent on execution of the Hoorbit Placement Facilitation Agreement, a satisfactory background check, and submission of tax/banking documentation. ` +
        `Hoorbit LLC is a staffing facilitator, not an employer of record — see the attached disclaimer for what that does and doesn't mean.\n\n` +
        `We look forward to having you on the team.\n\nHoorbit LLC — Talent Operations\n\n${COPYRIGHT_LINE}`;

      return { success: true, contract_id: a.contract_id, developer: developer.name, position: contract.position, letter_text: letter, disclaimer: NOT_LEGAL_ADVICE, facilitator_model: FACILITATOR_MODEL };
    }
  );
}

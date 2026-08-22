import { z } from "zod";
import { read, update, findById } from "../db.js";
import { defineTool, notFound } from "../lib/toolkit.js";
import { uid, todayISO, nowISO } from "../lib/ids.js";
import { fmtMoney, round2 } from "../lib/currency.js";
import { NOT_LEGAL_ADVICE, COMPANY } from "../lib/constants.js";

export function registerContractTools(server, user) {
  defineTool(
    server,
    user,
    "generate_contract",
    {
      title: "Generate a placement facilitation agreement",
      description: "Generate a draft agreement covering Hoorbit's placement/facilitation service for a developer joining a client project. This is NOT an employment contract issued by Hoorbit — the working relationship is between the developer and the hiring company (or that company's own EOR); this document covers the facilitation terms (match, rate, commission) Hoorbit administers.",
      inputSchema: {
        developer_id: z.string(),
        project_id: z.string(),
        position: z.string(),
        salary_monthly: z.number().positive(),
        currency: z.string(),
        start_date: z.string(),
        end_date: z.string(),
        conditions: z.array(z.string()).default([]),
      },
      mutating: { entityType: "contract", idParam: "developer_id" },
    },
    async (a) => {
      const developer = findById("developers", a.developer_id) || notFound("developer", a.developer_id);
      const project = findById("projects", a.project_id) || notFound("project", a.project_id);

      const contract = {
        id: uid("contract"), developer_id: developer.id, project_id: project.id, position: a.position,
        salary_monthly: a.salary_monthly, currency: a.currency, start_date: a.start_date, end_date: a.end_date,
        status: "draft", conditions: a.conditions, signatures: [], amendments: [], severance: null,
        offer_letter_generated: false, signed_date: null, archived: false, archived_at: null,
      };
      update("contracts", (rows) => { rows.push(contract); });

      return {
        success: true,
        contract_id: contract.id,
        parties: { developer: developer.name, hiring_company: project.client_name, facilitated_by: `${COMPANY.legal_name} (placement facilitator — not the employer)` },
        terms_summary: `${a.position} on "${project.title}" for ${project.client_name}, facilitated by Hoorbit — ${fmtMoney(a.salary_monthly, a.currency)}/month, ${a.start_date} through ${a.end_date}.`,
        status: "draft — awaiting conditions/signatures",
        disclaimer: NOT_LEGAL_ADVICE,
      };
    }
  );

  defineTool(
    server,
    user,
    "add_contract_conditions",
    {
      title: "Add contract conditions",
      description: "Append one or more custom clauses/conditions to a draft or signed contract (e.g. hours, on-site requirements, notice period).",
      inputSchema: { contract_id: z.string(), conditions: z.array(z.string()).min(1) },
      mutating: { entityType: "contract", idParam: "contract_id" },
    },
    async (a) => {
      findById("contracts", a.contract_id) || notFound("contract", a.contract_id);
      let updated;
      update("contracts", (rows) => rows.map((c) => {
        if (c.id !== a.contract_id) return c;
        updated = { ...c, conditions: [...c.conditions, ...a.conditions] };
        return updated;
      }));
      return { success: true, contract_id: a.contract_id, conditions: updated.conditions };
    }
  );

  defineTool(
    server,
    user,
    "sign_contract",
    {
      title: "Sign a contract (e-signature)",
      description: "Record an e-signature from either party. 'hoorbit' signs as the facilitator (not as employer) confirming the placement terms; once both the developer and Hoorbit have signed, the contract status flips to 'signed'.",
      inputSchema: { contract_id: z.string(), party: z.enum(["developer", "hoorbit"]), signer_name: z.string() },
      mutating: { entityType: "contract", idParam: "contract_id" },
    },
    async (a) => {
      const contract = findById("contracts", a.contract_id) || notFound("contract", a.contract_id);
      if (contract.signatures.some((s) => s.party === a.party)) {
        return { success: false, contract_id: a.contract_id, message: `${a.party} has already signed this contract.` };
      }
      let updated;
      update("contracts", (rows) => rows.map((c) => {
        if (c.id !== a.contract_id) return c;
        const signatures = [...c.signatures, { party: a.party, name: a.signer_name, signed_at: nowISO() }];
        const bothSigned = ["developer", "hoorbit"].every((p) => signatures.some((s) => s.party === p));
        updated = { ...c, signatures, status: bothSigned ? "signed" : "pending_signature", signed_date: bothSigned ? todayISO() : c.signed_date };
        return updated;
      }));
      return { success: true, contract_id: a.contract_id, status: updated.status, signatures: updated.signatures };
    }
  );

  defineTool(
    server,
    user,
    "verify_contract_signatures",
    {
      title: "Verify contract signatures",
      description: "Check which parties have signed a contract and whether it is fully executed.",
      inputSchema: { contract_id: z.string() },
    },
    async (a) => {
      const contract = findById("contracts", a.contract_id) || notFound("contract", a.contract_id);
      const developerSigned = contract.signatures.some((s) => s.party === "developer");
      const hoorbitSigned = contract.signatures.some((s) => s.party === "hoorbit");
      return { success: true, contract_id: a.contract_id, developer_signed: developerSigned, hoorbit_signed: hoorbitSigned, fully_executed: developerSigned && hoorbitSigned, status: contract.status };
    }
  );

  defineTool(
    server,
    user,
    "store_contract_archive",
    {
      title: "Archive a signed contract",
      description: "Move a fully signed contract into the compliance archive for record-keeping.",
      inputSchema: { contract_id: z.string() },
      mutating: { entityType: "contract", idParam: "contract_id" },
    },
    async (a) => {
      const contract = findById("contracts", a.contract_id) || notFound("contract", a.contract_id);
      if (contract.status !== "signed") return { success: false, message: "Only fully signed contracts can be archived.", status: contract.status };
      update("contracts", (rows) => rows.map((c) => (c.id === a.contract_id ? { ...c, archived: true, archived_at: nowISO() } : c)));
      return { success: true, contract_id: a.contract_id, archived: true, archived_at: nowISO() };
    }
  );

  defineTool(
    server,
    user,
    "generate_amendments",
    {
      title: "Generate a contract amendment",
      description: "Record a formal amendment to an existing contract (e.g. rate change, extension).",
      inputSchema: { contract_id: z.string(), amendment_text: z.string(), new_salary_monthly: z.number().optional(), new_end_date: z.string().optional() },
      mutating: { entityType: "contract", idParam: "contract_id" },
    },
    async (a) => {
      findById("contracts", a.contract_id) || notFound("contract", a.contract_id);
      const amendment = { id: uid("amend"), text: a.amendment_text, new_salary_monthly: a.new_salary_monthly || null, new_end_date: a.new_end_date || null, created_at: nowISO() };
      let updated;
      update("contracts", (rows) => rows.map((c) => {
        if (c.id !== a.contract_id) return c;
        updated = { ...c, amendments: [...c.amendments, amendment], salary_monthly: a.new_salary_monthly || c.salary_monthly, end_date: a.new_end_date || c.end_date };
        return updated;
      }));
      return { success: true, contract_id: a.contract_id, amendment, amendments_total: updated.amendments.length, disclaimer: NOT_LEGAL_ADVICE };
    }
  );

  defineTool(
    server,
    user,
    "calculate_severance",
    {
      title: "Calculate severance",
      description: "Estimate a severance payment for early contract termination, using a simple notice-period formula. Illustrative only — real severance is jurisdiction- and cause-dependent.",
      inputSchema: { contract_id: z.string(), reason: z.enum(["client_ended_engagement", "performance", "mutual", "other"]).default("client_ended_engagement"), notice_days_owed: z.number().int().min(0).default(14) },
      mutating: { entityType: "contract", idParam: "contract_id" },
    },
    async (a) => {
      const contract = findById("contracts", a.contract_id) || notFound("contract", a.contract_id);
      const dailyRate = contract.salary_monthly / 30;
      const severanceAmount = round2(dailyRate * a.notice_days_owed);
      const payable = a.reason === "performance" ? 0 : severanceAmount;
      update("contracts", (rows) => rows.map((c) => (c.id === a.contract_id ? { ...c, severance: { reason: a.reason, notice_days_owed: a.notice_days_owed, amount: payable, currency: c.currency, calculated_at: nowISO() } } : c)));
      return {
        success: true, contract_id: a.contract_id, reason: a.reason, daily_rate: round2(dailyRate),
        notice_days_owed: a.notice_days_owed, severance_amount: payable, currency: contract.currency,
        formatted: fmtMoney(payable, contract.currency, 2),
        disclaimer: NOT_LEGAL_ADVICE + " Severance entitlement, if any, is typically owed by the hiring company (or its EOR), not by Hoorbit, and depends on the contractor's actual jurisdiction and the cause for termination — this is a simplified facilitation estimate, not a payable Hoorbit is issuing.",
      };
    }
  );
}

import { z } from "zod";
import { read, update, findById } from "../db.js";
import { defineTool, notFound } from "../lib/toolkit.js";
import { uid, nowISO } from "../lib/ids.js";
import { NOT_LEGAL_ADVICE } from "../lib/constants.js";

export function registerComplianceTools(server, user) {
  defineTool(
    server,
    user,
    "verify_labor_law_compliance",
    {
      title: "Verify labor-law compliance",
      description: "Run an illustrative compliance checklist for a developer's engagement (contract signed, tax docs on file, background check cleared, onboarding complete).",
      inputSchema: { developer_id: z.string() },
    },
    async (a) => {
      const developer = findById("developers", a.developer_id) || notFound("developer", a.developer_id);
      const contract = read("contracts").find((c) => c.developer_id === a.developer_id && c.status === "signed");
      const onboarding = read("onboarding").find((o) => o.developer_id === a.developer_id);
      const checks = {
        contract_signed: !!contract,
        background_check_cleared: developer.background_check === "cleared",
        tax_docs_submitted: !!developer.tax_withholding,
        onboarding_checklist_complete: onboarding ? Object.values(onboarding.checklist).every(Boolean) : false,
      };
      const gaps = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
      return { success: true, developer_id: a.developer_id, compliant: gaps.length === 0, checks, gaps, disclaimer: NOT_LEGAL_ADVICE + " This checklist does not constitute a legal compliance certification for any specific jurisdiction." };
    }
  );

  defineTool(
    server,
    user,
    "generate_compliance_report",
    {
      title: "Generate compliance report",
      description: "Generate a compliance report scoped to a single developer, a single project, or the whole company.",
      inputSchema: { scope: z.enum(["developer", "project", "company"]), id: z.string().optional() },
    },
    async (a) => {
      if (a.scope === "developer") {
        const developer = findById("developers", a.id) || notFound("developer", a.id);
        const records = read("compliance").filter((c) => c.entity_type === "developer" && c.entity_id === a.id);
        return { success: true, scope: "developer", developer_id: a.id, developer: developer.name, background_check: developer.background_check, records, disclaimer: NOT_LEGAL_ADVICE };
      }
      if (a.scope === "project") {
        const project = findById("projects", a.id) || notFound("project", a.id);
        const contracts = read("contracts").filter((c) => c.project_id === a.id);
        const signedCount = contracts.filter((c) => c.status === "signed").length;
        return { success: true, scope: "project", project_id: a.id, project: project.title, contracts_total: contracts.length, contracts_signed: signedCount, fully_contracted: signedCount === project.team_assigned.length, disclaimer: NOT_LEGAL_ADVICE };
      }
      const developers = read("developers");
      const cleared = developers.filter((d) => d.background_check === "cleared").length;
      const contracts = read("contracts");
      const signed = contracts.filter((c) => c.status === "signed").length;
      return {
        success: true, scope: "company", developers_total: developers.length, background_checks_cleared: cleared,
        contracts_total: contracts.length, contracts_signed: signed, compliance_records_on_file: read("compliance").length,
        status: cleared === developers.length && signed === contracts.length ? "COMPLIANT" : "GAPS PRESENT",
        disclaimer: NOT_LEGAL_ADVICE,
      };
    }
  );

  defineTool(
    server,
    user,
    "store_compliance_records",
    {
      title: "Store a compliance record",
      description: "Append a compliance record (e.g. a classification review, a regulatory note) to the compliance archive.",
      inputSchema: { entity_type: z.enum(["developer", "project", "client", "contract"]), entity_id: z.string(), record_type: z.string(), status: z.enum(["on_file", "action_required", "resolved"]).default("on_file"), details: z.string() },
      mutating: { entityType: "compliance", idParam: "entity_id" },
    },
    async (a) => {
      const record = { id: uid("cmp"), entity_type: a.entity_type, entity_id: a.entity_id, record_type: a.record_type, status: a.status, details: a.details, created_at: nowISO() };
      update("compliance", (rows) => { rows.push(record); });
      return { success: true, compliance_record_id: record.id, ...record };
    }
  );

  defineTool(
    server,
    user,
    "audit_trail",
    {
      title: "Read the audit trail",
      description: "Read the audit log of mutating tool calls, optionally filtered by entity type/id.",
      inputSchema: { entity_type: z.string().optional(), entity_id: z.string().optional(), limit: z.number().int().positive().max(200).default(50) },
    },
    async (a) => {
      let rows = read("audit_trail");
      if (a.entity_type) rows = rows.filter((r) => r.entity_type === a.entity_type);
      if (a.entity_id) rows = rows.filter((r) => r.entity_id === a.entity_id);
      return { success: true, count: rows.length, entries: rows.slice(0, a.limit) };
    }
  );

  defineTool(
    server,
    user,
    "data_security_encryption",
    {
      title: "Data security & encryption status",
      description: "Report what's masked/protected in this demo database (bank accounts and tax IDs are stored pre-masked; this is a demo status report, not a real security audit).",
      inputSchema: {},
    },
    async (_a, user) => ({
      success: true,
      status: "demo environment — illustrative only",
      you_are: user ? `${user.name} (${user.role})` : "unauthenticated",
      protections_in_this_demo: [
        "Every tool call is authorized server-side against a bearer token (see whoami) — role-based allow-lists, row-level ownership checks (e.g. an employer can only see their own client_id), and field-level redaction (e.g. bank_account/tax_id hidden from non-owners) are enforced in src/lib/auth.js, not left to a UI to hide.",
        "Bank account numbers are stored pre-masked (last 4 digits only) — no full account numbers exist in this database.",
        "Tax ID fields are partially masked in seed data, and further redacted per-viewer by role.",
        "No real payment credentials, OAuth tokens, or banking rails are present or reachable from this server.",
      ],
      not_implemented_in_this_demo: [
        "At-rest encryption of the JSON database files (they are plain JSON on disk).",
        "Field-level encryption / KMS integration.",
        "Real identity provider: auth here is a static demo token directory (src/lib/auth.js), not OAuth/JWT with expiry, rotation, or a real user-management system. A production deployment should replace resolveToken() with real IdP-backed verification; the allow-list + scoping logic is the part worth keeping.",
      ],
      disclaimer: NOT_LEGAL_ADVICE,
    })
  );
}

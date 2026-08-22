import { z } from "zod";
import { read, update, findById } from "../db.js";
import { defineTool, notFound } from "../lib/toolkit.js";
import { uid, todayISO, nowISO } from "../lib/ids.js";
import { fmtMoney, round2 } from "../lib/currency.js";
import { COMPANY, NOT_LEGAL_ADVICE, COPYRIGHT_LINE, FACILITATOR_MODEL } from "../lib/constants.js";

const PLAN_MULTIPLIER = { Basic: 0.0012, Standard: 0.0017, Premium: 0.0026 };

export function registerInsuranceTools(server, user) {
  defineTool(
    server,
    user,
    "verify_insurance_eligibility",
    {
      title: "Verify insurance eligibility",
      description: "Check whether a developer is eligible to enroll in Hoorbit-facilitated insurance (requires an active or onboarding status and a contract on file).",
      inputSchema: { developer_id: z.string() },
    },
    async (a) => {
      const developer = findById("developers", a.developer_id) || notFound("developer", a.developer_id);
      const hasContract = read("contracts").some((c) => c.developer_id === a.developer_id && ["signed", "offered", "pending_signature"].includes(c.status));
      const eligible = ["active", "onboarding"].includes(developer.status) && hasContract;
      return {
        success: true, developer_id: a.developer_id, eligible,
        reason: eligible ? "Active engagement with a contract on file." : !hasContract ? "No contract on file yet." : `Developer status is '${developer.status}', not active/onboarding.`,
      };
    }
  );

  defineTool(
    server,
    user,
    "generate_insurance_quotes",
    {
      title: "Generate insurance quotes",
      description: "Return Basic / Standard / Premium coverage quotes from Hoorbit's licensed insurance partner, scaled to the requested coverage amount. Hoorbit relays these quotes and facilitates enrollment — it does not underwrite or price the policies itself.",
      inputSchema: { developer_id: z.string(), coverage_amount: z.number().positive().default(50000), currency: z.string().default("USD") },
    },
    async (a) => {
      findById("developers", a.developer_id) || notFound("developer", a.developer_id);
      const quotes = Object.entries(PLAN_MULTIPLIER).map(([plan, rate]) => ({
        plan, provider: "Evermark Insurance Group (Hoorbit's licensed insurance partner)", coverage_amount: a.coverage_amount, currency: a.currency,
        monthly_premium: round2(a.coverage_amount * rate),
        benefits: plan === "Basic" ? ["health"] : plan === "Standard" ? ["health", "dental"] : ["health", "dental", "vision"],
      }));
      return { success: true, developer_id: a.developer_id, quotes: quotes.map((q) => ({ ...q, formatted_premium: fmtMoney(q.monthly_premium, q.currency, 2) + "/mo" })) };
    }
  );

  defineTool(
    server,
    user,
    "enroll_in_insurance",
    {
      title: "Facilitate insurance enrollment",
      description: "Facilitate a developer's enrollment in an insurance plan issued by Hoorbit's licensed insurance partner. Hoorbit administers the enrollment and premium billing; it is not the insurer.",
      inputSchema: { developer_id: z.string(), plan: z.enum(["Basic", "Standard", "Premium"]), coverage_amount: z.number().positive().default(50000), currency: z.string().default("USD") },
      mutating: { entityType: "insurance", idParam: "developer_id" },
    },
    async (a) => {
      findById("developers", a.developer_id) || notFound("developer", a.developer_id);
      const monthly_premium = round2(a.coverage_amount * PLAN_MULTIPLIER[a.plan]);
      const record = {
        id: uid("ins"), developer_id: a.developer_id, plan: a.plan, provider: "Evermark Insurance Group (Hoorbit's licensed insurance partner)",
        coverage_amount: a.coverage_amount, currency: a.currency, monthly_premium, status: "active",
        enrolled_date: todayISO(), benefits: a.plan === "Basic" ? ["health"] : a.plan === "Standard" ? ["health", "dental"] : ["health", "dental", "vision"], claims: [],
      };
      update("insurance", (rows) => { rows.push(record); });
      return { success: true, insurance_id: record.id, plan: a.plan, monthly_premium, formatted_premium: fmtMoney(monthly_premium, a.currency, 2) + "/mo", status: "active" };
    }
  );

  defineTool(
    server,
    user,
    "manage_benefits_package",
    {
      title: "Manage benefits package",
      description: "Add, remove, or list benefits (health/dental/vision/etc) on a developer's active insurance policy.",
      inputSchema: { developer_id: z.string(), action: z.enum(["add", "remove", "list"]), benefit: z.string().optional() },
      mutating: { entityType: "insurance", idParam: "developer_id" },
    },
    async (a) => {
      const policy = read("insurance").find((i) => i.developer_id === a.developer_id && i.status === "active");
      if (!policy) return { success: false, message: "No active insurance policy for this developer." };
      if (a.action === "list") return { success: true, developer_id: a.developer_id, benefits: policy.benefits };
      if (!a.benefit) return { success: false, message: "'benefit' is required for add/remove." };
      let benefits;
      if (a.action === "add") benefits = policy.benefits.includes(a.benefit) ? policy.benefits : [...policy.benefits, a.benefit];
      else benefits = policy.benefits.filter((b) => b !== a.benefit);
      update("insurance", (rows) => rows.map((i) => (i.id === policy.id ? { ...i, benefits } : i)));
      return { success: true, developer_id: a.developer_id, action: a.action, benefit: a.benefit, benefits };
    }
  );

  defineTool(
    server,
    user,
    "generate_insurance_coverage_letter",
    {
      title: "Generate proof-of-coverage letter",
      description: "Generate a proof-of-insurance-coverage letter for a developer's active policy.",
      inputSchema: { developer_id: z.string() },
    },
    async (a) => {
      const developer = findById("developers", a.developer_id) || notFound("developer", a.developer_id);
      const policy = read("insurance").find((i) => i.developer_id === a.developer_id && i.status === "active");
      if (!policy) return { success: false, message: "No active insurance policy for this developer." };
      const letter =
        `${COMPANY.legal_name}\n\nTo Whom It May Concern,\n\n` +
        `This letter confirms that ${developer.name} is enrolled in a ${policy.plan} insurance plan underwritten by ${policy.provider}, ` +
        `effective ${policy.enrolled_date}, with coverage of ${fmtMoney(policy.coverage_amount, policy.currency)} (${policy.benefits.join(", ")}). ` +
        `${COMPANY.legal_name} facilitated this enrollment and administers premium billing on the policyholder's behalf; ` +
        `${policy.provider} is the issuing/underwriting carrier of record.\n\n` +
        `Hoorbit LLC — HR & Compliance\n${COMPANY.website}\n\n${COPYRIGHT_LINE}`;
      return { success: true, developer_id: a.developer_id, letter_text: letter, disclaimer: NOT_LEGAL_ADVICE, facilitator_model: FACILITATOR_MODEL };
    }
  );

  defineTool(
    server,
    user,
    "track_insurance_claims",
    {
      title: "Track insurance claims",
      description: "File a new claim, list existing claims, or update a claim's status on a developer's policy.",
      inputSchema: {
        developer_id: z.string(),
        action: z.enum(["file", "list", "update"]),
        description: z.string().optional(),
        amount: z.number().optional(),
        claim_id: z.string().optional(),
        status: z.enum(["submitted", "approved", "denied", "paid"]).optional(),
      },
      mutating: { entityType: "insurance", idParam: "developer_id" },
    },
    async (a) => {
      const policy = read("insurance").find((i) => i.developer_id === a.developer_id && i.status === "active");
      if (!policy) return { success: false, message: "No active insurance policy for this developer." };

      if (a.action === "list") return { success: true, developer_id: a.developer_id, claims: policy.claims };

      if (a.action === "file") {
        const claim = { id: uid("claim"), filed_at: nowISO(), description: a.description || "", amount: a.amount || 0, currency: policy.currency, status: "submitted" };
        update("insurance", (rows) => rows.map((i) => (i.id === policy.id ? { ...i, claims: [...i.claims, claim] } : i)));
        return { success: true, developer_id: a.developer_id, claim };
      }

      if (a.action === "update") {
        if (!a.claim_id || !a.status) return { success: false, message: "'claim_id' and 'status' are required for update." };
        let updatedClaim = null;
        update("insurance", (rows) => rows.map((i) => {
          if (i.id !== policy.id) return i;
          const claims = i.claims.map((c) => { if (c.id === a.claim_id) { updatedClaim = { ...c, status: a.status }; return updatedClaim; } return c; });
          return { ...i, claims };
        }));
        if (!updatedClaim) return { success: false, message: "Claim not found." };
        return { success: true, developer_id: a.developer_id, claim: updatedClaim };
      }
    }
  );
}

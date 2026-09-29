import { z } from "zod";
import { read, update, findById } from "../db.js";
import { defineTool, notFound } from "../lib/toolkit.js";
import { uid, nowISO, todayISO } from "../lib/ids.js";
import { CURRENCIES, convert, round2 } from "../lib/currency.js";
import { NO_REAL_MONEY_MOVES } from "../lib/constants.js";
import {
  TRADE_DISCLAIMER, EVASION_REFUSAL, INCOTERMS_2020, INCOTERM_CODES, INSPECTION_PROVIDERS,
  countryName, suggestHsCodes, lookupHs, normalizeHs, screenCompliance, destinationRequirements, detectEvasion,
  verifyBusiness, scoreSupplier, analyzeMessage, inspectionPlan, requiredDocuments, homeCurrency, normalizeQuantity,
} from "../lib/trade.js";

const WITHHELD = "[withheld until AI-vetted match + mutual platform NDA]";
const MAX_COHORT = 5;
const ESCROW_REMINDER =
  "Keep negotiation, documents and payment inside Hoorbit. Payments go only to platform escrow (Trade Assurance) — never to a bank " +
  "account sent by chat or email, and never via off-platform messaging apps, which are the most common route for invoice-redirection fraud.";

// ISO code + amount ("EUR 118,000.00") — unambiguous across currencies that share a symbol.
const money = (amount, ccy) => `${ccy} ${Number(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const cc = (s) => (s ? String(s).trim().toUpperCase() : s);
const incotermEnum = z.enum(INCOTERM_CODES);
const currencyEnum = z.enum(Object.keys(CURRENCIES));

function company(id) {
  return findById("trade_companies", id) || notFound("trade company", id);
}
function requireVerified(c, action) {
  if (!c.verification || c.verification.status !== "verified") {
    const err = new Error(`${c.company_name} (${c.id}) is not verified (status: ${c.verification ? c.verification.status : "unverified"}). Zero-trust policy: run verify_trade_business and clear all outstanding items before you can ${action}.`);
    err.code = "UNVERIFIED";
    throw err;
  }
}
function publicProfile(c) {
  return {
    id: c.id, company_name: c.company_name, type: c.type, country: c.country, country_name: countryName(c.country), city: c.city,
    nearest_port: c.nearest_port, verification_status: c.verification ? c.verification.status : "unverified",
    verification_score: c.verification ? c.verification.score : null, contact: WITHHELD,
  };
}
function saveMatch(match) {
  update("trade_matches", (rows) => {
    const i = rows.findIndex((r) => r.id === match.id);
    if (i >= 0) rows[i] = match;
    else rows.push(match);
  });
  return match;
}
function getMatch(id) {
  return findById("trade_matches", id) || notFound("trade match", id);
}
function mutuallyUnderNda(m) {
  return !!(m.nda && m.nda.buyer_signed_at && m.nda.supplier_signed_at);
}
function flagsFor(hsCode, description) {
  const hs = hsCode ? lookupHs(hsCode) : null;
  if (hs) return hs.flags;
  const s = description ? suggestHsCodes(description, 1)[0] : null;
  return s ? s.flags : [];
}

// ---------------------------------------------------------------------------
// RFQ interview
// ---------------------------------------------------------------------------

const RFQ_QUESTIONS = {
  product_name: "What exactly are you buying? Give the trade name and application (e.g. 'ASTM A312 TP316L welded stainless steel pipe for process piping').",
  specifications: "State measurable specifications: material/grade, dimensions with tolerances, the standard(s) it must conform to, finish, and packaging. Terms like 'good quality' cannot be quoted or inspected against.",
  hs_code: "Confirm the 6-digit HS code (see hs_code_suggestions). Your customs broker's classification governs; pass hs_code to confirm.",
  quantity: "Total order quantity and unit (e.g. 40000 kg, 2000000 pieces).",
  target_price: "Target price per unit and currency. It is shared only with the vetted supplier cohort, never published.",
  required_certifications: "Which certifications must the goods or factory hold (e.g. CE, FDA 510(k), ISO 9001, ISO 13485)? Pass an empty list only if none apply — destination-mandated ones are added automatically.",
  incoterm: "Which Incoterms® 2020 rule? FOB/CFR/CIF/FAS are for sea and inland-waterway cargo only; containerised cargo is usually better on FCA/CIP. DDP makes the supplier your importer of record — choose it only if they can legally act as one in your country.",
  named_place: "Named place/port for the Incoterm (e.g. 'Mundra' for FOB, 'Hamburg' for CIF, 'Duisburg warehouse' for DDP).",
  destination_country: "Destination country (ISO 3166 alpha-2, e.g. DE, US, AE).",
  destination_port: "Port or airport of discharge in the destination country.",
  delivery_deadline: "Latest acceptable cargo-ready or arrival date (YYYY-MM-DD).",
};

function rfqMissing(r) {
  const missing = [];
  if (!r.product_name) missing.push("product_name");
  if (!r.specifications || r.specifications.length < 20 || !/\d/.test(r.specifications)) missing.push("specifications");
  if (!r.hs_code) missing.push("hs_code");
  if (!r.quantity || !r.unit) missing.push("quantity");
  if (!r.target_price || !r.currency) missing.push("target_price");
  if (!Array.isArray(r.required_certifications)) missing.push("required_certifications");
  if (!r.incoterm) missing.push("incoterm");
  if (!r.named_place) missing.push("named_place");
  if (!r.destination_country) missing.push("destination_country");
  if (!r.destination_port) missing.push("destination_port");
  if (!r.delivery_deadline) missing.push("delivery_deadline");
  return missing;
}

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------

function cohortTable(rows) {
  const head = "| Rank | Supplier | Origin | Port (km) | Capacity | Export history | Port | Certs | Price | **Score** | Flags |\n|---|---|---|---|---|---|---|---|---|---|---|";
  const body = rows.map((r, i) => `| ${i + 1} | ${r.supplier.company_name} | ${r.supplier.country} | ${r.supplier.nearest_port} (${r.port_distance_km}) | ${r.breakdown.operational_capacity} | ${r.breakdown.export_history} | ${r.breakdown.port_proximity.split(" ")[0]} | ${r.breakdown.certification_fit} | ${r.breakdown.price_fit} | **${r.score}** | ${r.flags.length ? r.flags.join("; ") : "—"} |`);
  return [head, ...body].join("\n");
}

function counterOfferMarkdown(round, rfq) {
  return [
    `### [Standardized B2B Counter-Offer — Round ${round.round}]`,
    `* **From:** ${round.party}`,
    `* **Action:** ${round.action}`,
    `* **Unit Price:** ${round.unit_price} ${round.currency} per ${rfq.unit}`,
    `* **Quantity:** ${Number(round.quantity).toLocaleString("en-US")} ${rfq.unit}`,
    `* **Incoterm & Place:** ${round.incoterm} ${round.named_place} (Incoterms® 2020)`,
    `* **Lead Time:** ${round.lead_time_days} days from deposit receipt in escrow`,
    `* **Payment Terms:** ${round.payment_terms}`,
    `* **Offer Valid Until:** ${round.valid_until}`,
    `* **Conditions:** ${round.conditions || "None"}`,
  ].join("\n");
}

export function registerTradeTools(server, user) {
  // -------------------------------------------------------------------------
  defineTool(
    server,
    user,
    "verify_trade_business",
    {
      title: "Zero-trust business verification",
      description: "Run AI business verification on a buyer or supplier: company-registry format checks, sanctions + restricted-party screening, trade-history analysis, fulfilment performance, and bank-account ownership. Only 'verified' companies can post RFQs, be matched, sign NDAs or negotiate.",
      inputSchema: { company_id: z.string() },
      mutating: { entityType: "trade_company", idParam: "company_id", summary: (_a, r) => `verification → ${r.verification.status}` },
    },
    async (a) => {
      const c = company(a.company_id);
      const result = verifyBusiness(c);
      const verification = { status: result.status, score: result.score, checked_at: nowISO(), checks: result.checks };
      update("trade_companies", (rows) => {
        const row = rows.find((r) => r.id === c.id);
        row.verification = verification;
      });
      return {
        success: true,
        company: { id: c.id, company_name: c.company_name, type: c.type, country: countryName(c.country) },
        verification,
        outstanding_items: result.outstanding_items,
        needs_manual_review: result.needs_manual_review,
        next_step: result.status === "verified" ? (c.type === "buyer" ? "Verified — build an RFQ with build_rfq." : "Verified — eligible for AI matchmaking.") : result.status === "rejected" ? "Rejected — the platform cannot onboard this company." : "Resolve the outstanding items, then re-run verification.",
        disclaimer: TRADE_DISCLAIMER,
      };
    }
  );

  // -------------------------------------------------------------------------
  defineTool(
    server,
    user,
    "suggest_hs_code",
    {
      title: "Suggest HS codes",
      description: "Suggest 6-digit Harmonized System (HS 2022) codes for a product description, ranked by confidence, with the regulatory flags each code carries (food, dual-use, hazardous, CBAM …).",
      inputSchema: { product_description: z.string().min(3) },
    },
    async (a) => {
      if (detectEvasion(a.product_description)) return { success: false, refused: true, message: EVASION_REFUSAL };
      const suggestions = suggestHsCodes(a.product_description, 3);
      return {
        success: true,
        product_description: a.product_description,
        suggestions,
        message: suggestions.length ? `Best match: ${suggestions[0].hs_code} — ${suggestions[0].description}.` : "No confident match in the curated table. Provide material, function and form (e.g. 'welded stainless steel pipe', 'nitrile examination gloves') or consult a licensed customs broker.",
        disclaimer: TRADE_DISCLAIMER,
      };
    }
  );

  // -------------------------------------------------------------------------
  defineTool(
    server,
    user,
    "screen_trade_compliance",
    {
      title: "Screen trade compliance",
      description: "Screen a product + trade lane for sanctions (OFAC/EU/UK), dual-use export controls, end-use red flags, dangerous-goods classification, diversion risk, UFLPA, and destination-market certification requirements (FDA, CE, UKCA, BIS, CBAM …). Refuses any request describing duty or sanctions evasion.",
      inputSchema: {
        product_description: z.string().min(3),
        hs_code: z.string().optional(),
        origin_country: z.string().length(2).optional(),
        destination_country: z.string().length(2),
        end_use: z.string().optional(),
      },
    },
    async (a) => {
      const res = screenCompliance({ ...a, origin_country: cc(a.origin_country), destination_country: cc(a.destination_country) });
      if (res.verdict === "refused") return { success: false, refused: true, verdict: "refused", message: res.refusal };
      return { success: true, lane: `${a.origin_country ? countryName(cc(a.origin_country)) : "Any origin"} → ${countryName(cc(a.destination_country))}`, ...res, disclaimer: TRADE_DISCLAIMER };
    }
  );

  // -------------------------------------------------------------------------
  defineTool(
    server,
    user,
    "get_trade_documents",
    {
      title: "Required shipping documents",
      description: "List the documents a shipment needs (Commercial Invoice, Packing List, B/L or AWB, Certificate of Origin, phytosanitary/health certificates, DG declarations, destination conformity certificates …) and who carries which obligation under the chosen Incoterms® 2020 rule.",
      inputSchema: {
        origin_country: z.string().length(2),
        destination_country: z.string().length(2),
        incoterm: incotermEnum,
        mode: z.enum(["sea", "air", "road", "rail"]).default("sea"),
        hs_code: z.string().optional(),
        product_description: z.string().optional(),
      },
    },
    async (a) => {
      const flags = flagsFor(a.hs_code, a.product_description);
      const warnings = [];
      if (INCOTERMS_2020[a.incoterm].sea_only && a.mode !== "sea") warnings.push(`${a.incoterm} is only for sea and inland-waterway transport — use ${a.incoterm === "CIF" ? "CIP" : a.incoterm === "CFR" ? "CPT" : "FCA"} for ${a.mode} freight.`);
      if (a.incoterm === "EXW") warnings.push("EXW leaves export clearance with the buyer, which most buyers cannot legally perform in the seller's country — FCA is usually the correct choice.");
      return { success: true, lane: `${countryName(cc(a.origin_country))} → ${countryName(cc(a.destination_country))}`, mode: a.mode, product_flags: flags, ...requiredDocuments({ ...a, origin_country: cc(a.origin_country), destination_country: cc(a.destination_country), flags }), warnings, disclaimer: TRADE_DISCLAIMER };
    }
  );

  // -------------------------------------------------------------------------
  defineTool(
    server,
    user,
    "build_rfq",
    {
      title: "Build a high-intent RFQ (interview)",
      description: "Interview-style RFQ builder. Call with whatever the buyer has provided; it returns the missing mandatory fields as follow-up questions and saves a draft. Call again with rfq_id plus the answers until status is 'open'. Mandatory: product, measurable specs, HS code, quantity, target price, certifications, Incoterm + named place, destination, deadline. Runs compliance screening and adds destination-mandated certifications automatically. Buyer must be verified.",
      inputSchema: {
        buyer_id: z.string(),
        rfq_id: z.string().optional(),
        product_name: z.string().optional(),
        specifications: z.string().optional(),
        hs_code: z.string().optional(),
        quantity: z.number().positive().optional(),
        unit: z.string().optional(),
        target_price: z.number().positive().optional(),
        currency: currencyEnum.optional(),
        required_certifications: z.array(z.string()).optional(),
        incoterm: incotermEnum.optional(),
        named_place: z.string().optional(),
        destination_country: z.string().length(2).optional(),
        destination_port: z.string().optional(),
        delivery_deadline: z.string().optional(),
        origin_preference: z.array(z.string().length(2)).optional(),
        packaging: z.string().optional(),
      },
      mutating: { entityType: "trade_rfq", idParam: "buyer_id", summary: (_a, r) => (r.rfq ? `${r.rfq.id} → ${r.rfq.status}` : "refused") },
    },
    async (a) => {
      const buyer = company(a.buyer_id);
      if (buyer.type !== "buyer") throw new Error(`${buyer.id} is a ${buyer.type}, not a buyer.`);
      requireVerified(buyer, "post an RFQ");
      if (detectEvasion(a.product_name, a.specifications, a.packaging)) return { success: false, refused: true, message: EVASION_REFUSAL };

      let rfq;
      if (a.rfq_id) {
        rfq = findById("trade_rfqs", a.rfq_id) || notFound("RFQ", a.rfq_id);
        if (rfq.buyer_id !== buyer.id) throw new Error("That RFQ belongs to another buyer.");
        if (!["draft", "blocked_compliance"].includes(rfq.status)) throw new Error(`RFQ ${rfq.id} is '${rfq.status}' and can no longer be edited — create a new RFQ.`);
      } else {
        rfq = { id: uid("rfq"), buyer_id: buyer.id, created_at: nowISO(), status: "draft", destination_country: buyer.country };
      }
      const fields = ["product_name", "specifications", "quantity", "unit", "target_price", "currency", "required_certifications", "incoterm", "named_place", "destination_port", "delivery_deadline", "packaging"];
      for (const f of fields) if (a[f] !== undefined) rfq[f] = a[f];
      if (a.destination_country) rfq.destination_country = cc(a.destination_country);
      if (a.origin_preference) rfq.origin_preference = a.origin_preference.map(cc);
      const warnings = [];
      if (a.hs_code !== undefined) {
        const n = normalizeHs(a.hs_code);
        if (!n) warnings.push(`'${a.hs_code}' is not a valid HS code (need at least 6 digits).`);
        else rfq.hs_code = n;
      }
      if (rfq.delivery_deadline && Number.isNaN(Date.parse(rfq.delivery_deadline))) {
        warnings.push(`delivery_deadline '${rfq.delivery_deadline}' is not a valid date.`);
        delete rfq.delivery_deadline;
      }

      const hsSuggestions = !rfq.hs_code && rfq.product_name ? suggestHsCodes(`${rfq.product_name} ${rfq.specifications || ""}`, 3) : [];
      if (rfq.incoterm && INCOTERMS_2020[rfq.incoterm].sea_only) warnings.push(`${rfq.incoterm} is sea/inland-waterway only. For containerised cargo, FCA/CIP give cleaner risk transfer.`);
      if (rfq.incoterm === "DDP") warnings.push("DDP: the supplier becomes importer of record in your country and pays import duty/VAT — confirm they have a legal presence to do so.");

      let screening = null;
      if (rfq.product_name && rfq.destination_country) {
        screening = screenCompliance({ product_description: `${rfq.product_name} ${rfq.specifications || ""}`, hs_code: rfq.hs_code, destination_country: rfq.destination_country });
        rfq.compliance = { verdict: screening.verdict, checked_at: nowISO(), findings: screening.findings };
        const mandated = destinationRequirements(rfq.destination_country, screening.hs ? screening.hs.flags : []).filter((r) => r.mandatory && r.certification_any_of);
        rfq.destination_mandated_certifications = mandated.map((r) => ({ any_of: r.certification_any_of, requirement: r.requirement }));
      }

      const missing = rfqMissing(rfq);
      if (screening && screening.verdict === "blocked") rfq.status = "blocked_compliance";
      else if (screening && screening.verdict === "license_required") rfq.status = missing.length ? "draft" : "pending_compliance_review";
      else rfq.status = missing.length ? "draft" : "open";
      rfq.updated_at = nowISO();

      update("trade_rfqs", (rows) => {
        const i = rows.findIndex((r) => r.id === rfq.id);
        if (i >= 0) rows[i] = rfq;
        else rows.push(rfq);
      });

      const questions = missing.map((f) => ({ field: f, question: RFQ_QUESTIONS[f] }));
      const certQ = questions.find((q) => q.field === "required_certifications");
      if (certQ && rfq.destination_mandated_certifications && rfq.destination_mandated_certifications.length) {
        certQ.question += ` ${countryName(rfq.destination_country)} already requires: ${rfq.destination_mandated_certifications.map((m) => m.any_of.join(" or ")).join("; ")}.`;
      }
      return {
        success: true,
        rfq,
        status: rfq.status,
        missing_fields: missing,
        follow_up_questions: questions,
        hs_code_suggestions: hsSuggestions,
        compliance_verdict: screening ? screening.verdict : "not_yet_screened",
        warnings,
        next_step:
          rfq.status === "open" ? "RFQ complete — run match_suppliers to route it to a curated supplier cohort."
          : rfq.status === "blocked_compliance" ? "This RFQ cannot proceed: see compliance findings."
          : rfq.status === "pending_compliance_review" ? "Complete, but held for manual export-control/sanctions review before matching."
          : "Ask the buyer the follow_up_questions, then call build_rfq again with rfq_id and the answers.",
        disclaimer: TRADE_DISCLAIMER,
      };
    }
  );

  // -------------------------------------------------------------------------
  defineTool(
    server,
    user,
    "match_suppliers",
    {
      title: "AI matchmaking — curated supplier cohort",
      description: "Route an open RFQ to a small curated cohort (default 3, max 5) of verified suppliers. Hard gates: verification, sanctions, HS capability, destination-mandated certifications, MOQ. Ranking: operational capacity 30, export history 30, port proximity 15, certification fit 15, price fit 10 — a supplier's paid subscription tier has zero weight. No lead is ever broadcast; contacts stay withheld until mutual NDA.",
      inputSchema: { rfq_id: z.string(), cohort_size: z.number().int().min(1).max(MAX_COHORT).default(3) },
      mutating: { entityType: "trade_rfq", idParam: "rfq_id", summary: (_a, r) => `${(r.cohort || []).length} suppliers matched` },
    },
    async (a) => {
      const rfq = findById("trade_rfqs", a.rfq_id) || notFound("RFQ", a.rfq_id);
      if (rfq.status !== "open" && rfq.status !== "matched") throw new Error(`RFQ ${rfq.id} is '${rfq.status}' — only complete, compliance-cleared RFQs can be matched.`);
      const existing = read("trade_matches").filter((m) => m.rfq_id === rfq.id);
      const slots = MAX_COHORT - existing.length;
      if (slots <= 0) throw new Error(`RFQ ${rfq.id} already has ${existing.length} matched suppliers — the anti-lead-dumping cap is ${MAX_COHORT}.`);

      const buyer = company(rfq.buyer_id);
      const flags = flagsFor(rfq.hs_code, rfq.product_name);
      const destReqs = destinationRequirements(rfq.destination_country, flags);
      const suppliers = read("trade_companies").filter((c) => c.type === "supplier" && !existing.some((m) => m.supplier_id === c.id));
      const evaluated = suppliers.map((s) => ({ supplier: s, ...scoreSupplier(s, rfq, destReqs) }));
      const eligible = evaluated.filter((e) => e.eligible).sort((x, y) => y.score - x.score);
      const cohort = eligible.slice(0, Math.min(a.cohort_size, slots));

      const created = cohort.map((e) => saveMatch({
        id: uid("match"), rfq_id: rfq.id, buyer_id: buyer.id, supplier_id: e.supplier.id, score: e.score, breakdown: e.breakdown, flags: e.flags,
        status: "vetted", nda: { buyer_signed_at: null, supplier_signed_at: null }, negotiation: [], agreed_terms: null, escrow: null, created_at: nowISO(),
      }));
      if (created.length) update("trade_rfqs", (rows) => { rows.find((r) => r.id === rfq.id).status = "matched"; });

      const rows = cohort.map((e, i) => ({ match_id: created[i].id, supplier: publicProfile(e.supplier), port_distance_km: e.supplier.port_distance_km, score: e.score, breakdown: e.breakdown, flags: e.flags }));
      return {
        success: true,
        rfq_id: rfq.id,
        lane: `→ ${countryName(rfq.destination_country)} (${rfq.incoterm} ${rfq.named_place})`,
        cohort: rows,
        comparison_table_markdown: rows.length ? cohortTable(rows) : null,
        excluded: evaluated.filter((e) => !e.eligible).map((e) => ({ supplier: e.supplier.company_name, country: e.supplier.country, reasons: e.gate_failures })),
        eligible_not_routed: Math.max(0, eligible.length - cohort.length),
        policy: `Anti-lead-dumping: this RFQ is shared only with the ${created.length} supplier(s) above (lifetime cap ${MAX_COHORT}). Contacts are withheld until both sides sign the platform NDA (sign_platform_nda).`,
        message: rows.length ? null : "No verified supplier passed every compliance and capability gate. Consider widening origin_preference or reviewing certification requirements — Hoorbit will not route this RFQ to non-compliant suppliers.",
      };
    }
  );

  // -------------------------------------------------------------------------
  defineTool(
    server,
    user,
    "list_trade_matches",
    {
      title: "List trade matches",
      description: "List the AI-vetted matches visible to the caller (a buyer sees matches on their RFQs, a supplier sees RFQs routed to them — never anyone else's). Contacts stay withheld until mutual NDA.",
      inputSchema: { rfq_id: z.string().optional() },
    },
    async (a, u) => {
      let rows = read("trade_matches");
      if (a.rfq_id) rows = rows.filter((m) => m.rfq_id === a.rfq_id);
      if (u.role === "buyer") rows = rows.filter((m) => m.buyer_id === u.linkedId);
      if (u.role === "supplier") rows = rows.filter((m) => m.supplier_id === u.linkedId);
      const rfqs = read("trade_rfqs");
      const companies = read("trade_companies");
      const byId = (id) => companies.find((c) => c.id === id);
      return {
        success: true,
        count: rows.length,
        matches: rows.map((m) => {
          const rfq = rfqs.find((r) => r.id === m.rfq_id) || {};
          return {
            match_id: m.id, status: m.status, score: m.score, nda_executed: mutuallyUnderNda(m),
            rfq: { id: rfq.id, product_name: rfq.product_name, hs_code: rfq.hs_code, quantity: rfq.quantity, unit: rfq.unit, target_price: rfq.target_price, currency: rfq.currency, incoterm: rfq.incoterm, named_place: rfq.named_place, destination_country: rfq.destination_country, delivery_deadline: rfq.delivery_deadline, required_certifications: rfq.required_certifications },
            buyer: publicProfile(byId(m.buyer_id)),
            supplier: publicProfile(byId(m.supplier_id)),
            negotiation_rounds: m.negotiation.length,
          };
        }),
      };
    }
  );

  // -------------------------------------------------------------------------
  defineTool(
    server,
    user,
    "sign_platform_nda",
    {
      title: "Sign the platform NDA",
      description: "Record a party's signature on the mutual Hoorbit platform NDA + non-circumvention agreement for a vetted match. Contact details are released only once both buyer and supplier have signed.",
      inputSchema: { match_id: z.string(), party: z.enum(["buyer", "supplier"]), signatory_name: z.string().min(2) },
      mutating: { entityType: "trade_match", idParam: "match_id", summary: (a) => `NDA signed by ${a.party}` },
    },
    async (a) => {
      const m = getMatch(a.match_id);
      const c = company(a.party === "buyer" ? m.buyer_id : m.supplier_id);
      requireVerified(c, "sign an NDA");
      const key = `${a.party}_signed_at`;
      if (m.nda[key]) return { success: true, already_signed: true, nda_executed: mutuallyUnderNda(m) };
      m.nda[key] = nowISO();
      m.nda[`${a.party}_signatory`] = a.signatory_name;
      if (mutuallyUnderNda(m) && m.status === "vetted") m.status = "nda_executed";
      saveMatch(m);
      return {
        success: true,
        match_id: m.id,
        signed_by: `${a.signatory_name} for ${c.company_name}`,
        nda_executed: mutuallyUnderNda(m),
        terms: ["Confidentiality of specifications, pricing and counterparty identity for 3 years.", "Non-circumvention: no direct transaction with the introduced counterparty outside Hoorbit for 24 months.", "All payments for introduced business run through platform escrow."],
        next_step: mutuallyUnderNda(m) ? "Both parties have signed — get_match_contact now releases contact details." : `Waiting for the ${a.party === "buyer" ? "supplier" : "buyer"} to sign.`,
      };
    }
  );

  // -------------------------------------------------------------------------
  defineTool(
    server,
    user,
    "get_match_contact",
    {
      title: "Release counterparty contact",
      description: "Release the counterparty's contact details for a match — only after the AI-vetted match exists AND both parties have signed the platform NDA. Every release is written to the audit trail.",
      inputSchema: { match_id: z.string() },
      mutating: { entityType: "trade_match", idParam: "match_id", summary: () => "contact details released" },
    },
    async (a, u) => {
      const m = getMatch(a.match_id);
      if (!mutuallyUnderNda(m)) {
        const err = new Error(`Contact details are withheld: the mutual platform NDA for ${m.id} is not fully signed (buyer: ${m.nda.buyer_signed_at ? "signed" : "pending"}, supplier: ${m.nda.supplier_signed_at ? "signed" : "pending"}).`);
        err.code = "NDA_REQUIRED";
        throw err;
      }
      const buyer = company(m.buyer_id);
      const supplier = company(m.supplier_id);
      const out = { success: true, match_id: m.id, reminder: ESCROW_REMINDER };
      if (u.role !== "supplier") out.supplier_contact = { company_name: supplier.company_name, ...supplier.contact };
      if (u.role !== "buyer") out.buyer_contact = { company_name: buyer.company_name, ...buyer.contact };
      return out;
    }
  );

  // -------------------------------------------------------------------------
  defineTool(
    server,
    user,
    "normalize_trade_message",
    {
      title: "Normalize & localize a trade message",
      description: "Prepare a buyer↔supplier message for cross-border delivery: strips contact details and off-platform channels (WhatsApp, WeChat, direct payment …), flags vague commitments and aggressive bargaining with the concrete clarification required, and extracts protected technical terms (Incoterms, HS codes, standards, grades, units, tolerances, amounts) that any translation MUST keep verbatim. Refuses customs-evasion requests.",
      inputSchema: { message: z.string().min(1), source_language: z.string().optional(), target_language: z.string().optional() },
    },
    async (a) => {
      const r = analyzeMessage(a.message);
      if (r.evasion) return { success: false, refused: true, message: EVASION_REFUSAL };
      return {
        success: true,
        sanitized_message: r.sanitized,
        redactions: r.redactions.map((x) => x.type),
        off_platform_signals: r.off_platform_signals,
        vague_commitments: r.vague_commitments,
        aggressive_bargaining: r.aggressive_bargaining,
        protected_terms: r.protected_terms,
        translation_instructions: a.target_language
          ? `Translate sanitized_message from ${a.source_language || "the source language"} into ${a.target_language}. Keep every protected_terms entry byte-for-byte identical (do not convert units, grades, standards or Incoterms). Keep a neutral, formal register. Where vague_commitments are flagged, do not smooth them over — ask the sender for the required clarification.`
          : "No target_language given — message normalized only.",
        recommendation: r.aggressive_bargaining.length || r.vague_commitments.length ? "Move price/quantity/terms changes into submit_counter_offer so they become a structured, dated, comparable offer." : null,
        escrow_reminder: r.off_platform_signals.length || r.redactions.length ? ESCROW_REMINDER : null,
      };
    }
  );

  // -------------------------------------------------------------------------
  defineTool(
    server,
    user,
    "submit_counter_offer",
    {
      title: "Submit a structured counter-offer",
      description: "Record a negotiation round in the Standardized B2B Counter-Offer Template (unit price, quantity, Incoterm + place, lead time, payment terms, validity). action='accept' accepts the counterparty's latest round and locks the agreed terms. Free-text conditions are sanitized and checked for vague or aggressive language.",
      inputSchema: {
        match_id: z.string(),
        party: z.enum(["buyer", "supplier"]),
        action: z.enum(["offer", "accept"]).default("offer"),
        unit_price: z.number().positive().optional(),
        currency: currencyEnum.optional(),
        quantity: z.number().positive().optional(),
        incoterm: incotermEnum.optional(),
        named_place: z.string().optional(),
        lead_time_days: z.number().int().positive().optional(),
        payment_terms: z.string().optional(),
        validity_days: z.number().int().min(1).max(60).default(7),
        conditions: z.string().optional(),
      },
      mutating: { entityType: "trade_match", idParam: "match_id", summary: (a) => `${a.party} ${a.action}` },
    },
    async (a) => {
      const m = getMatch(a.match_id);
      if (!mutuallyUnderNda(m)) throw new Error("Negotiation opens after both parties sign the platform NDA (sign_platform_nda).");
      if (m.agreed_terms) throw new Error(`Terms for ${m.id} are already agreed (round ${m.agreed_terms.round}). Use generate_deal_sheet.`);
      const rfq = findById("trade_rfqs", m.rfq_id);
      const last = m.negotiation[m.negotiation.length - 1] || null;

      if (a.action === "accept") {
        if (!last) throw new Error("There is no offer to accept yet.");
        if (last.party === a.party) throw new Error("You cannot accept your own offer — wait for the counterparty's round.");
        if (last.valid_until < todayISO()) throw new Error(`Round ${last.round} expired on ${last.valid_until}. Submit a new offer instead.`);
        const round = { ...last, round: last.round + 1, party: a.party, action: "accept", accepts_round: last.round, at: nowISO() };
        m.negotiation.push(round);
        m.agreed_terms = { ...last, accepted_by: a.party, accepted_at: nowISO() };
        m.status = "terms_agreed";
        saveMatch(m);
        return { success: true, match_id: m.id, status: m.status, agreed_terms: m.agreed_terms, counter_offer_markdown: counterOfferMarkdown(round, rfq), next_step: "Configure escrow milestones with create_escrow_milestones, then generate_deal_sheet." };
      }

      if (detectEvasion(a.conditions, a.payment_terms)) return { success: false, refused: true, message: EVASION_REFUSAL };
      const base = last || { unit_price: rfq.target_price, currency: rfq.currency, quantity: rfq.quantity, incoterm: rfq.incoterm, named_place: rfq.named_place, lead_time_days: null, payment_terms: "30% deposit / 70% on PSI pass, via Hoorbit escrow" };
      const round = {
        round: (last ? last.round : 0) + 1,
        party: a.party,
        action: "offer",
        unit_price: a.unit_price ?? base.unit_price,
        currency: a.currency ?? base.currency,
        quantity: a.quantity ?? base.quantity,
        incoterm: a.incoterm ?? base.incoterm,
        named_place: a.named_place ?? base.named_place,
        lead_time_days: a.lead_time_days ?? base.lead_time_days,
        payment_terms: a.payment_terms ?? base.payment_terms,
        valid_until: new Date(Date.now() + a.validity_days * 86400000).toISOString().slice(0, 10),
        conditions: null,
        at: nowISO(),
      };
      const missing = ["unit_price", "currency", "quantity", "incoterm", "named_place", "lead_time_days"].filter((k) => round[k] == null);
      if (missing.length) throw new Error(`A structured counter-offer needs: ${missing.join(", ")}.`);

      const issues = { vague_commitments: [], aggressive_bargaining: [], off_platform_signals: [], redactions: [] };
      if (a.conditions) {
        const r = analyzeMessage(a.conditions);
        round.conditions = r.sanitized;
        Object.assign(issues, { vague_commitments: r.vague_commitments, aggressive_bargaining: r.aggressive_bargaining, off_platform_signals: r.off_platform_signals, redactions: r.redactions.map((x) => x.type) });
      }
      const payment = analyzeMessage(round.payment_terms);
      if (payment.off_platform_signals.length || !/escrow/i.test(round.payment_terms)) {
        issues.off_platform_signals.push("payment terms outside platform escrow");
        round.payment_terms = `${payment.sanitized} — NOTE: Hoorbit only supports settlement through platform escrow; terms will be converted to an escrow milestone plan.`;
      }

      const supplier = company(m.supplier_id);
      const warnings = [];
      const orderQty = normalizeQuantity(round.quantity, rfq.unit);
      if (supplier.moq && orderQty.unit === normalizeQuantity(1, supplier.capacity_unit).unit && orderQty.qty < supplier.moq) warnings.push(`Quantity is below the supplier's MOQ (${supplier.moq.toLocaleString("en-US")} ${supplier.capacity_unit}).`);
      if (INCOTERMS_2020[round.incoterm].sea_only) warnings.push(`${round.incoterm} is sea/inland-waterway only.`);
      const priceInRfqCcy = convert(round.unit_price, round.currency, rfq.currency);
      const vsTarget = round2(((priceInRfqCcy - rfq.target_price) / rfq.target_price) * 100);
      const vsPrev = last ? round2(((convert(round.unit_price, round.currency, last.currency) - last.unit_price) / last.unit_price) * 100) : null;

      m.negotiation.push(round);
      if (m.status === "nda_executed") m.status = "negotiating";
      saveMatch(m);
      return {
        success: true,
        match_id: m.id,
        round: round.round,
        counter_offer_markdown: counterOfferMarkdown(round, rfq),
        analysis: {
          price_vs_buyer_target_pct: vsTarget,
          price_vs_previous_round_pct: vsPrev,
          order_value: money(round.unit_price * round.quantity, round.currency),
        },
        language_issues: issues,
        warnings,
        next_step: `The ${a.party === "buyer" ? "supplier" : "buyer"} may counter (action='offer') or accept (action='accept') before ${round.valid_until}.`,
      };
    }
  );

  // -------------------------------------------------------------------------
  defineTool(
    server,
    user,
    "recommend_inspection",
    {
      title: "Recommend a third-party inspection protocol",
      description: "Build a pre-shipment verification protocol: ISO 2859-1 / ANSI Z1.4 AQL sampling (critical 0 / major 2.5 / minor 4.0), inspection stages (PPI, DUPRO, PSI, CLS), product-specific lab tests, and independent providers (SGS, Intertek, Bureau Veritas, TÜV SÜD, QIMA).",
      inputSchema: {
        order_quantity: z.number().int().positive().describe("Lot size in inspectable units (pieces or cartons)"),
        hs_code: z.string().optional(),
        product_description: z.string().optional(),
        first_order: z.boolean().default(true),
        risk: z.enum(["standard", "high"]).default("standard"),
      },
    },
    async (a) => {
      const flags = flagsFor(a.hs_code, a.product_description);
      return { success: true, product_flags: flags, ...inspectionPlan({ lot_size: a.order_quantity, flags, first_order: a.first_order, risk: a.risk }), disclaimer: "The inspection company confirms the final sampling plan and defect classification against the agreed specification." };
    }
  );

  // -------------------------------------------------------------------------
  defineTool(
    server,
    user,
    "create_escrow_milestones",
    {
      title: "Configure escrow / Trade Assurance milestones",
      description: "Turn agreed terms into a platform-escrow payment plan (default 30% deposit / 70% released on a third-party PSI pass before port dispatch), with FX-exposure analysis and failure/dispute rules. Simulated — no real funds move.",
      inputSchema: {
        match_id: z.string(),
        deposit_pct: z.number().int().min(10).max(50).default(30),
        inspection_provider: z.enum(INSPECTION_PROVIDERS).default("SGS"),
      },
      mutating: { entityType: "trade_match", idParam: "match_id", summary: (a) => `escrow ${a.deposit_pct}/${100 - a.deposit_pct}` },
    },
    async (a) => {
      const m = getMatch(a.match_id);
      if (!m.agreed_terms) throw new Error("Escrow can only be configured on agreed terms — accept a counter-offer first (submit_counter_offer action='accept').");
      const t = m.agreed_terms;
      const buyer = company(m.buyer_id);
      const supplier = company(m.supplier_id);
      const total = round2(t.unit_price * t.quantity);
      const deposit = round2((total * a.deposit_pct) / 100);
      const balance = round2(total - deposit);
      const milestones = [
        { milestone: 1, name: "Deposit", pct: a.deposit_pct, amount: deposit, currency: t.currency, buyer_funds: "Within 5 business days of contract signature", released_to_supplier_when: "Supplier confirms production start and uploads the proforma invoice + approved golden-sample reference." },
        { milestone: 2, name: "Balance", pct: 100 - a.deposit_pct, amount: balance, currency: t.currency, buyer_funds: `Before the ${a.inspection_provider} pre-shipment inspection is booked, so the supplier has payment certainty`, released_to_supplier_when: `${a.inspection_provider} uploads a PSI 'PASS' report directly to Hoorbit (AQL major 2.5 / minor 4.0, critical 0), before dispatch to port.` },
      ];
      const buyerCcy = homeCurrency(buyer.country);
      const supplierCcy = homeCurrency(supplier.country);
      const fx = [];
      if (buyerCcy !== t.currency) fx.push({ party: "buyer", exposure: `${money(total, t.currency)} ≈ ${money(convert(total, t.currency, buyerCcy), buyerCcy)} at indicative rates`, mitigation: `Buyer pays in ${t.currency}; consider a forward contract for the balance date or funding escrow up front.` });
      if (supplierCcy !== t.currency) fx.push({ party: "supplier", exposure: `Receives ${t.currency}, costs in ${supplierCcy}`, mitigation: `Supplier may hedge the ${t.currency}→${supplierCcy} conversion; a ±5% move equals ${money(total * 0.05, t.currency)}.` });
      const escrow = {
        structure: `${a.deposit_pct}/${100 - a.deposit_pct} via Hoorbit Platform Escrow`,
        contract_value: total, currency: t.currency, milestones, inspection_provider: a.inspection_provider,
        failure_rules: [
          "PSI FAIL: balance stays in escrow; the supplier reworks and pays for one re-inspection.",
          "Second PSI FAIL or cargo not ready 15 days after the agreed lead time: the buyer may cancel; deposit refund follows the signed contract (default: refund less documented, inspector-verified raw-material cost).",
          "Disputes: 10 business-day evidence window, then platform mediation; unresolved disputes go to the arbitration seat named in the sales contract (default: ICC Rules).",
        ],
        configured_at: nowISO(),
      };
      m.escrow = escrow;
      m.status = "escrow_configured";
      saveMatch(m);
      return { success: true, match_id: m.id, escrow, fx_risk: fx, note: NO_REAL_MONEY_MOVES, next_step: "generate_deal_sheet" };
    }
  );

  // -------------------------------------------------------------------------
  defineTool(
    server,
    user,
    "generate_deal_sheet",
    {
      title: "Generate the Standardized B2B Deal Sheet",
      description: "Produce the Standardized B2B Deal Sheet (product & spec, HS code & compliance, order volume & MOQ status, Incoterm & port, price, payment terms, inspection protocol) from the agreed terms of a match.",
      inputSchema: {
        match_id: z.string(),
        inspection_lot_size: z.number().int().positive().optional().describe("Inspectable units (pieces, bags, cartons). Defaults to the order quantity for piece goods, or order quantity ÷ 25 (25 kg bags) for goods sold by weight."),
      },
      mutating: { entityType: "trade_deal", idParam: "match_id" },
    },
    async (a) => {
      const m = getMatch(a.match_id);
      if (!m.agreed_terms) throw new Error("No agreed terms yet — a deal sheet documents accepted terms only.");
      const t = m.agreed_terms;
      const rfq = findById("trade_rfqs", m.rfq_id);
      const supplier = company(m.supplier_id);
      const buyer = company(m.buyer_id);
      const hs = lookupHs(rfq.hs_code);
      const flags = hs ? hs.flags : [];
      const destReqs = destinationRequirements(rfq.destination_country, flags);
      const certs = [...new Set([...(rfq.required_certifications || []), ...destReqs.filter((r) => r.mandatory && r.certification_any_of).map((r) => r.certification_any_of.join(" or "))])];
      const order = normalizeQuantity(t.quantity, rfq.unit);
      const moqOk = !supplier.moq || order.unit !== normalizeQuantity(1, supplier.capacity_unit).unit || order.qty >= supplier.moq;
      const lot = a.inspection_lot_size || (order.unit === "pieces" ? order.qty : Math.max(1, Math.round(order.qty / 25)));
      const insp = inspectionPlan({ lot_size: Math.min(lot, 10_000_000), flags, first_order: true });
      const escrow = m.escrow || null;
      const payment = escrow ? escrow.structure : "30/70 via Platform Escrow (not yet configured — run create_escrow_milestones)";
      const inspText = `${escrow ? escrow.inspection_provider : "Independent inspector (SGS / Intertek / BV)"} — ${insp.stages.map((s) => s.code).join(" → ")}; ISO 2859-1 Level II, AQL 0 / 2.5 / 4.0 (sample ${insp.aql.major.sample_size}, major Ac ${insp.aql.major.accept}); PSI PASS report uploaded by the inspector releases the escrow balance.`;

      const markdown = [
        "### [Standardized B2B Deal Sheet]",
        `* **Product Name & Spec:** ${rfq.product_name} — ${rfq.specifications}${rfq.packaging ? `; packaging: ${rfq.packaging}` : ""}`,
        `* **HS Code & Compliance:** ${rfq.hs_code}${hs ? ` (${hs.description})` : ""}; required certifications: ${certs.length ? certs.join(", ") : "none"}; compliance screen: ${rfq.compliance ? rfq.compliance.verdict : "n/a"}`,
        `* **Order Volume:** ${Number(t.quantity).toLocaleString("en-US")} ${rfq.unit} (MOQ ${supplier.moq ? `${supplier.moq.toLocaleString("en-US")} ${supplier.capacity_unit}` : "n/a"} — ${moqOk ? "met" : "NOT met"})`,
        `* **Incoterm & Port:** ${t.incoterm} ${t.named_place} (Incoterms® 2020); origin ${supplier.nearest_port}, ${countryName(supplier.country)} → ${rfq.destination_port}, ${countryName(rfq.destination_country)}`,
        `* **Target Price:** ${t.unit_price} ${t.currency} per ${rfq.unit} (agreed, round ${t.round}; buyer target was ${rfq.target_price} ${rfq.currency}) — contract value ${money(t.unit_price * t.quantity, t.currency)}`,
        `* **Payment Terms:** ${payment}`,
        `* **Inspection Protocol:** ${inspText}`,
      ].join("\n");

      const deal = {
        id: uid("deal"), match_id: m.id, rfq_id: rfq.id, buyer_id: buyer.id, supplier_id: supplier.id, status: escrow ? "ready_for_contract" : "draft_escrow_pending",
        deal_sheet_markdown: markdown, documents_required: requiredDocuments({ origin_country: supplier.country, destination_country: rfq.destination_country, incoterm: t.incoterm, flags }).documents.map((d) => d.document),
        created_at: nowISO(),
      };
      update("trade_deals", (rows) => { rows.push(deal); });
      if (escrow) { m.status = "deal_sheet_issued"; saveMatch(m); }
      return { success: true, deal_id: deal.id, status: deal.status, deal_sheet_markdown: markdown, parties: { buyer: buyer.company_name, supplier: supplier.company_name }, documents_required: deal.documents_required, disclaimer: TRADE_DISCLAIMER };
    }
  );
}

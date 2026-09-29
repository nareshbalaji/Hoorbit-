// End-to-end test of the cross-border trade module over the real stdio
// transport: zero-trust verification, the RFQ interview, compliance screening,
// curated matchmaking, NDA-gated contact release, structured negotiation,
// escrow, the deal sheet — and the buyer/supplier auth boundaries around them.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { scoreSupplier, destinationRequirements } from "../src/lib/trade.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
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
    console.log(`FAIL  ${label}${extra ? " — " + JSON.stringify(extra).slice(0, 800) : ""}`);
  }
}
function parse(result) {
  const text = result.content && result.content[0] && result.content[0].text;
  return { json: text ? JSON.parse(text) : null, isError: !!result.isError };
}
async function connectAs(token) {
  const transport = new StdioClientTransport({ command: "node", args: ["bin/stdio.js"], cwd: ROOT, stderr: "ignore", env: { ...process.env, HOORBIT_TOKEN: token || "" } });
  const client = new Client({ name: "hoorbit-trade-test", version: "1.0.0" });
  await client.connect(transport);
  return client;
}
const call = async (client, name, args) => parse(await client.callTool({ name, arguments: args }));

async function main() {
  const pm = await connectAs("hoorbit_pm_naresh");
  const buyer = await connectAs("hoorbit_buyer_buy_001"); // Rheinwerk Anlagenbau, DE
  const supplier = await connectAs("hoorbit_supplier_sup_001"); // Gujarat Precision Steel Tubes, IN
  const outsider = await connectAs("hoorbit_supplier_sup_004"); // coffee exporter — never routed this RFQ
  const newBuyer = await connectAs("hoorbit_buyer_buy_003"); // unverified first-time importer

  console.log("\n=== catalog ===");
  {
    const names = (await pm.listTools()).tools.map((t) => t.name);
    for (const n of ["verify_trade_business", "suggest_hs_code", "screen_trade_compliance", "get_trade_documents", "build_rfq", "match_suppliers", "list_trade_matches", "sign_platform_nda", "get_match_contact", "normalize_trade_message", "submit_counter_offer", "recommend_inspection", "create_escrow_milestones", "generate_deal_sheet"]) check(`tool present: ${n}`, names.includes(n));
    const prompts = await pm.listPrompts();
    check("b2b_trade_engine prompt is registered", prompts.prompts.some((p) => p.name === "b2b_trade_engine"));
    const prompt = await pm.getPrompt({ name: "b2b_trade_engine", arguments: { user_request: "I need 40 t of stainless pipe" } });
    const text = prompt.messages[0].content.text;
    check("prompt carries the brief, tool mapping and the request", text.includes("ANTI-INDIAMART") && text.includes("TOOL MAPPING") && text.includes("40 t of stainless pipe"));
    const who = await call(buyer, "whoami", {});
    check("buyer token resolves to the trade buyer role", who.json.role === "buyer" && who.json.linked_id === "buy_001", who.json);
  }

  console.log("\n=== zero-trust verification ===");
  {
    const rfq = await call(newBuyer, "build_rfq", { buyer_id: "buy_003", product_name: "nitrile examination gloves" });
    check("unverified buyer cannot post an RFQ", rfq.isError && /not verified/.test(rfq.json.error), rfq.json);
    const self = await call(newBuyer, "verify_trade_business", { company_id: "buy_003" });
    check("first-time importer without verified bank account stays unverified", self.json.success && self.json.verification.status !== "verified" && self.json.outstanding_items.length > 0, self.json);
    const other = await call(newBuyer, "verify_trade_business", { company_id: "buy_001" });
    check("buyer cannot run verification on another company", other.isError && other.json.unauthorized, other.json);
    const sanctioned = await call(pm, "verify_trade_business", { company_id: "sup_007" });
    check("supplier in an embargoed country is rejected", sanctioned.json.verification.status === "rejected", sanctioned.json);
    const weak = await call(pm, "verify_trade_business", { company_id: "sup_006" });
    check("supplier with thin history + unverified bank is not verified", weak.json.verification.status !== "verified", weak.json);
  }

  console.log("\n=== HS codes, compliance, documents ===");
  {
    const hs = await call(buyer, "suggest_hs_code", { product_description: "ASTM A312 TP316L welded stainless steel pipe" });
    check("suggests HS 7306.40 for welded stainless pipe", hs.json.suggestions[0].hs_code === "7306.40", hs.json);
    const drone = await call(buyer, "screen_trade_compliance", { product_description: "quadcopter drone with thermal imaging camera", origin_country: "CN", destination_country: "AE" });
    check("dual-use drone → license_required", drone.json.verdict === "license_required", drone.json);
    check("drone to AE flags Russia-diversion (no-Russia clause) risk", drone.json.findings.some((f) => /12g/.test(f.regime)), drone.json);
    const iran = await call(buyer, "screen_trade_compliance", { product_description: "centrifugal pump", destination_country: "IR" });
    check("any trade to Iran → blocked", iran.json.verdict === "blocked", iran.json);
    const ammo = await call(buyer, "screen_trade_compliance", { product_description: "ammunition cartridges", destination_country: "DE" });
    check("ammunition → blocked", ammo.json.verdict === "blocked", ammo.json);
    const battery = await call(buyer, "screen_trade_compliance", { product_description: "lithium ion battery pack 48V", origin_country: "CN", destination_country: "DE" });
    check("Li-ion battery → UN3480 class 9 dangerous goods", battery.json.un_dangerous_goods && battery.json.un_dangerous_goods.number === "UN3480", battery.json);
    const evade = await call(buyer, "screen_trade_compliance", { product_description: "steel pipe, please under-invoice so we avoid customs duty", destination_country: "DE" });
    check("duty-evasion request is refused", evade.json.refused === true && /refused/i.test(evade.json.message), evade.json);
    const docs = await call(buyer, "get_trade_documents", { origin_country: "VN", destination_country: "US", incoterm: "FOB", product_description: "green coffee beans robusta" });
    const docNames = docs.json.documents.map((d) => d.document).join(" | ");
    check("coffee VN→US needs B/L, CoO, phytosanitary and FDA prior notice", /Bill of Lading/.test(docNames) && /Certificate of Origin/.test(docNames) && /Phytosanitary/.test(docNames) && /Prior Notice/.test(docNames), docNames);
    const air = await call(buyer, "get_trade_documents", { origin_country: "IN", destination_country: "DE", incoterm: "CIF", mode: "air", hs_code: "7306.40" });
    check("CIF by air is flagged as a sea-only Incoterm misuse", air.json.warnings.some((w) => /CIP/.test(w)), air.json);
    const insp = await call(buyer, "recommend_inspection", { order_quantity: 1600, hs_code: "7306.40" });
    check("AQL plan for a 1,600-unit lot: code K, n=125, major Ac 7", insp.json.aql.major.code_letter === "K" && insp.json.aql.major.sample_size === 125 && insp.json.aql.major.accept === 7, insp.json.aql);
  }

  console.log("\n=== RFQ interview ===");
  let rfqId;
  {
    const draft = await call(buyer, "build_rfq", { buyer_id: "buy_001", product_name: "Welded stainless steel pipe", specifications: "good quality" });
    rfqId = draft.json.rfq && draft.json.rfq.id;
    check("partial RFQ is saved as a draft", draft.json.success && draft.json.status === "draft", draft.json);
    check("vague specs are rejected as missing", draft.json.missing_fields.includes("specifications"), draft.json.missing_fields);
    check("interview asks follow-up questions for every missing field", draft.json.follow_up_questions.length === draft.json.missing_fields.length && draft.json.missing_fields.includes("incoterm"));
    check("HS code is suggested for confirmation", draft.json.hs_code_suggestions[0] && draft.json.hs_code_suggestions[0].hs_code === "7306.40", draft.json.hs_code_suggestions);

    const complete = await call(buyer, "build_rfq", {
      buyer_id: "buy_001", rfq_id: rfqId,
      specifications: "ASTM A312 TP316L welded pipe, OD 60.3 mm, WT 3.91 mm (Sch 40S), 6 m lengths, pickled & passivated, EN 10204 3.1 MTC",
      hs_code: "7306.40", quantity: 40000, unit: "kg", target_price: 2.95, currency: "EUR",
      required_certifications: ["ISO 9001", "PED 2014/68/EU"], incoterm: "CIF", named_place: "Hamburg",
      destination_country: "DE", destination_port: "Hamburg (DEHAM)", delivery_deadline: "2027-01-31", packaging: "Hexagonal bundles, plastic end caps",
    });
    check("completed RFQ is 'open'", complete.json.status === "open" && complete.json.missing_fields.length === 0, complete.json);
    check("CIF is flagged as sea-only", complete.json.warnings.some((w) => /sea/.test(w)), complete.json.warnings);
    check("CBAM obligation surfaced for steel into the EU", complete.json.rfq.compliance.findings.some((f) => /CBAM/.test(f.finding)), complete.json.rfq.compliance);

    const hijack = await call(newBuyer, "build_rfq", { buyer_id: "buy_001", rfq_id: rfqId });
    check("another buyer cannot edit this RFQ", hijack.isError && hijack.json.unauthorized, hijack.json);
  }

  console.log("\n=== curated matchmaking ===");
  let matchId;
  {
    const denied = await call(supplier, "match_suppliers", { rfq_id: rfqId });
    check("suppliers cannot trigger matchmaking", denied.isError && denied.json.unauthorized, denied.json);
    const m = await call(buyer, "match_suppliers", { rfq_id: rfqId, cohort_size: 3 });
    check("cohort of ≤3 verified suppliers", m.json.success && m.json.cohort.length > 0 && m.json.cohort.length <= 3, m.json);
    const ids = m.json.cohort.map((c) => c.supplier.id);
    check("cohort contains only HS-capable, verified suppliers", ids.every((id) => ["sup_001", "sup_002", "sup_003"].includes(id)), ids);
    check("sanctioned supplier is excluded with a reason", m.json.excluded.some((e) => /Tehran/.test(e.supplier) && e.reasons.length), m.json.excluded);
    check("subscription tier carries zero weight", m.json.cohort.every((c) => /^0/.test(c.breakdown.subscription_tier_weight)));
    check("comparison table rendered as Markdown", /\| Rank \| Supplier/.test(m.json.comparison_table_markdown));
    const raw = JSON.stringify(m.json);
    check("no contact details leak in match results", !/@/.test(raw) && !/\+91/.test(raw), raw.slice(0, 300));
    matchId = m.json.cohort.find((c) => c.supplier.id === "sup_001").match_id;

    const second = await call(buyer, "match_suppliers", { rfq_id: rfqId, cohort_size: 5 });
    check("re-matching respects the lifetime cap of 5 (no lead dumping)", second.json.success && second.json.cohort.length <= 2, second.json);
  }

  console.log("\n=== supplier visibility (no lead browsing) ===");
  {
    const mine = await call(supplier, "list_trade_matches", {});
    check("routed supplier sees its match", mine.json.count === 1 && mine.json.matches[0].match_id === matchId, mine.json);
    const outsiderList = await call(outsider, "list_trade_matches", {});
    check("non-routed supplier sees nothing", outsiderList.json.count === 0, outsiderList.json);
    const peek = await call(outsider, "list_trade_matches", { rfq_id: rfqId });
    check("non-routed supplier cannot query the RFQ", peek.isError && peek.json.unauthorized, peek.json);
    const peekMatch = await call(outsider, "sign_platform_nda", { match_id: matchId, party: "supplier", signatory_name: "Nguyen Thi Lan" });
    check("non-party cannot sign the NDA", peekMatch.isError && peekMatch.json.unauthorized, peekMatch.json);
  }

  console.log("\n=== NDA-gated contact release ===");
  {
    const early = await call(buyer, "get_match_contact", { match_id: matchId });
    check("contact withheld before mutual NDA", early.isError && /withheld/.test(early.json.error), early.json);
    const impersonate = await call(buyer, "sign_platform_nda", { match_id: matchId, party: "supplier", signatory_name: "Katrin Vogel" });
    check("buyer cannot sign as the supplier", impersonate.isError && impersonate.json.unauthorized, impersonate.json);
    const b = await call(buyer, "sign_platform_nda", { match_id: matchId, party: "buyer", signatory_name: "Katrin Vogel" });
    check("buyer signs", b.json.success && b.json.nda_executed === false, b.json);
    const stillEarly = await call(buyer, "get_match_contact", { match_id: matchId });
    check("contact still withheld after one-sided NDA", stillEarly.isError, stillEarly.json);
    const s = await call(supplier, "sign_platform_nda", { match_id: matchId, party: "supplier", signatory_name: "Hemant Joshi" });
    check("supplier signs → NDA executed", s.json.nda_executed === true, s.json);
    const contact = await call(buyer, "get_match_contact", { match_id: matchId });
    check("buyer now receives the supplier's contact only", contact.json.supplier_contact && contact.json.supplier_contact.email && !contact.json.buyer_contact, contact.json);
    check("contact release carries the escrow reminder", /escrow/i.test(contact.json.reminder));
  }

  console.log("\n=== localization + negotiation ===");
  {
    const msg = await call(supplier, "normalize_trade_message", { message: "Best price for you!! TP316L 60.3 mm, CIF Hamburg. Whatsapp me on +91 98250 12345, pay directly to my personal account for discount. Last price.", target_language: "German" });
    check("contacts redacted, off-platform + payment diversion flagged", !/98250/.test(msg.json.sanitized_message) && msg.json.off_platform_signals.includes("WhatsApp") && msg.json.off_platform_signals.includes("personal account payment"), msg.json);
    check("vague + aggressive language flagged", msg.json.vague_commitments.length > 0 && msg.json.aggressive_bargaining.includes("ultimatum"), msg.json);
    check("technical terms protected for translation", msg.json.protected_terms.includes("TP316L") && msg.json.protected_terms.includes("60.3 mm"), msg.json.protected_terms);
    const evasion = await call(buyer, "normalize_trade_message", { message: "Can you make two invoices so we pay less customs duty?" });
    check("duty-evasion message refused", evasion.json.refused === true, evasion.json);

    const o1 = await call(supplier, "submit_counter_offer", { match_id: matchId, party: "supplier", unit_price: 3.3, currency: "USD", quantity: 40000, incoterm: "CIF", named_place: "Hamburg", lead_time_days: 50, conditions: "Approx 40 t, delivery ASAP" });
    check("supplier offer recorded as a structured round", o1.json.success && o1.json.round === 1 && /Counter-Offer — Round 1/.test(o1.json.counter_offer_markdown), o1.json);
    check("vague conditions flagged", o1.json.language_issues.vague_commitments.length >= 2, o1.json.language_issues);
    const selfAccept = await call(supplier, "submit_counter_offer", { match_id: matchId, party: "supplier", action: "accept" });
    check("cannot accept your own offer", selfAccept.isError, selfAccept.json);
    const o2 = await call(buyer, "submit_counter_offer", { match_id: matchId, party: "buyer", unit_price: 2.95, currency: "EUR", lead_time_days: 45, payment_terms: "pay by bank transfer" });
    check("buyer counter records price delta and forces escrow", o2.json.success && typeof o2.json.analysis.price_vs_previous_round_pct === "number" && o2.json.language_issues.off_platform_signals.length > 0, o2.json);
    const acc = await call(supplier, "submit_counter_offer", { match_id: matchId, party: "supplier", action: "accept" });
    check("supplier accepts → terms agreed", acc.json.success && acc.json.status === "terms_agreed" && acc.json.agreed_terms.unit_price === 2.95, acc.json);
  }

  console.log("\n=== escrow + deal sheet ===");
  {
    const supEscrow = await call(supplier, "create_escrow_milestones", { match_id: matchId });
    check("supplier cannot configure buyer escrow", supEscrow.isError && supEscrow.json.unauthorized, supEscrow.json);
    const esc = await call(buyer, "create_escrow_milestones", { match_id: matchId, inspection_provider: "Intertek" });
    check("30/70 escrow with PSI-gated balance", esc.json.success && esc.json.escrow.milestones[0].pct === 30 && /PSI 'PASS'/.test(esc.json.escrow.milestones[1].released_to_supplier_when), esc.json);
    check("FX exposure analysed for the INR-cost supplier", esc.json.fx_risk.some((f) => f.party === "supplier"), esc.json.fx_risk);
    const deal = await call(buyer, "generate_deal_sheet", { match_id: matchId });
    const md = deal.json.deal_sheet_markdown || "";
    for (const field of ["### [Standardized B2B Deal Sheet]", "**Product Name & Spec:**", "**HS Code & Compliance:** 7306.40", "**Order Volume:**", "**Incoterm & Port:** CIF Hamburg", "**Target Price:** 2.95 EUR", "**Payment Terms:** 30/70 via Hoorbit Platform Escrow", "**Inspection Protocol:** Intertek"]) {
      check(`deal sheet contains ${field}`, md.includes(field), md);
    }
    check("deal is ready for contract", deal.json.status === "ready_for_contract", deal.json);
  }

  console.log("\n=== certification gate (unit) ===");
  {
    const gloves = JSON.parse(fs.readFileSync(path.join(ROOT, "src/data/trade_companies.json"), "utf8")).find((c) => c.id === "sup_005");
    const rfq = { hs_code: "4015.12", quantity: 2000000, unit: "pieces", target_price: 0.03, currency: "USD", destination_country: "US", required_certifications: [] };
    const reqs = destinationRequirements("US", ["medical_device"]);
    check("FDA-cleared glove maker is eligible for the US", scoreSupplier(gloves, rfq, reqs).eligible === true);
    const noFda = scoreSupplier({ ...gloves, certifications: ["ISO 13485", "CE"] }, rfq, reqs);
    check("same maker without FDA 510(k) is gated out of the US", !noFda.eligible && noFda.gate_failures.some((g) => /510\(k\)/.test(g)), noFda.gate_failures);
  }

  for (const c of [pm, buyer, supplier, outsider, newBuyer]) await c.close();
  console.log(`\n${pass} passed, ${fail} failed.`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("TRADE SMOKE TEST FATAL:", err);
  process.exit(1);
});

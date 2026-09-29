// Cross-border B2B trade domain logic: HS classification, trade-compliance
// screening, zero-trust business verification, supplier scoring, negotiation
// hygiene, inspection sampling, and shipping-document rules.
//
// Everything here is deterministic and rule-based so a caller can see exactly
// why a verdict or score was produced. It is an illustrative rule set, not a
// licensed customs/export-control engine — see TRADE_DISCLAIMER.

import { CURRENCIES, convert, round2 } from "./currency.js";

export const TRADE_DISCLAIMER =
  "Indicative trade-compliance output from a demo rule set. HS codes are 6-digit international headings — national 8–10 digit " +
  "tariff lines, duty rates and certification rules vary by country and change often. A binding classification needs an advance " +
  "ruling or a licensed customs broker, and export-control/sanctions determinations need a qualified trade-compliance officer. " +
  "Hoorbit facilitates the match and the escrow workflow; it is not a customs broker, freight forwarder, bank, or law firm.";

export const EVASION_REFUSAL =
  "Request refused. Hoorbit will not help undervalue, misdescribe, misclassify, split, or reroute goods to reduce duty or avoid " +
  "sanctions/export controls, and will not help obtain false certificates of origin or duplicate invoices. Every shipment must be " +
  "declared at its true transaction value, correct HS classification, and true origin, with a single commercial invoice. " +
  "Legitimate duty reduction routes exist — preferential origin under an FTA (with a genuine certificate of origin), duty drawback, " +
  "inward processing / bonded warehousing, and advance classification rulings — ask about those instead.";

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

export const COUNTRY_NAMES = {
  AE: "United Arab Emirates", AF: "Afghanistan", AM: "Armenia", AU: "Australia", BY: "Belarus", CA: "Canada", CN: "China",
  CO: "Colombia", CU: "Cuba", DE: "Germany", ES: "Spain", ET: "Ethiopia", FR: "France", GB: "United Kingdom", GE: "Georgia",
  IN: "India", IQ: "Iraq", IR: "Iran", IT: "Italy", JP: "Japan", KG: "Kyrgyzstan", KP: "North Korea", KZ: "Kazakhstan",
  MM: "Myanmar", MX: "Mexico", MY: "Malaysia", NL: "Netherlands", PL: "Poland", RU: "Russia", SA: "Saudi Arabia",
  SG: "Singapore", SY: "Syria", TR: "Türkiye", US: "United States", VE: "Venezuela", VN: "Vietnam",
};
export function countryName(code) {
  return COUNTRY_NAMES[code] || code;
}

export const EU_MEMBERS = ["AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR", "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK"];

// Comprehensive embargoes: no platform trade at all. Heightened: can't be
// auto-verified or auto-matched — needs manual sanctions/export-control review.
export const EMBARGOED = { CU: "Cuba", IR: "Iran", KP: "North Korea" };
export const HEIGHTENED_RISK = {
  RU: "Extensive EU/UK/US sanctions and export controls",
  BY: "Extensive EU/UK/US sanctions and export controls",
  SY: "Sanctions regime substantially changed in 2025 — verify current OFAC/EU/UK status before any trade",
  VE: "OFAC sectoral sanctions",
  MM: "Targeted sanctions on specific sectors and entities",
};
export const EMBARGOED_REGIONS = ["crimea", "donetsk", "luhansk", "sevastopol"];
// Countries flagged by the EU/US/UK as common transshipment routes for Common
// High Priority List goods into Russia/Belarus.
export const DIVERSION_RISK_ROUTES = ["AM", "GE", "KZ", "KG", "AE", "TR"];

// Fictitious names standing in for a real consolidated screening list
// (OFAC SDN, EU Consolidated, UK OFSI, BIS Entity List). Demo only.
export const DEMO_DENIED_PARTIES = ["northstar dual trading", "black sea logistics fze", "tehran industrial pipe"];

export const INCOTERMS_2020 = {
  EXW: { name: "Ex Works", sea_only: false, seller_insures: false, seller_clears_export: false, seller_clears_import: false, place: "seller premises" },
  FCA: { name: "Free Carrier", sea_only: false, seller_insures: false, seller_clears_export: true, seller_clears_import: false, place: "named place of delivery (origin)" },
  CPT: { name: "Carriage Paid To", sea_only: false, seller_insures: false, seller_clears_export: true, seller_clears_import: false, place: "named place of destination" },
  CIP: { name: "Carriage and Insurance Paid To", sea_only: false, seller_insures: true, seller_clears_export: true, seller_clears_import: false, place: "named place of destination" },
  DAP: { name: "Delivered at Place", sea_only: false, seller_insures: false, seller_clears_export: true, seller_clears_import: false, place: "named place of destination" },
  DPU: { name: "Delivered at Place Unloaded", sea_only: false, seller_insures: false, seller_clears_export: true, seller_clears_import: false, place: "named place of destination" },
  DDP: { name: "Delivered Duty Paid", sea_only: false, seller_insures: false, seller_clears_export: true, seller_clears_import: true, place: "named place of destination" },
  FAS: { name: "Free Alongside Ship", sea_only: true, seller_insures: false, seller_clears_export: true, seller_clears_import: false, place: "named port of shipment" },
  FOB: { name: "Free On Board", sea_only: true, seller_insures: false, seller_clears_export: true, seller_clears_import: false, place: "named port of shipment" },
  CFR: { name: "Cost and Freight", sea_only: true, seller_insures: false, seller_clears_export: true, seller_clears_import: false, place: "named port of destination" },
  CIF: { name: "Cost, Insurance and Freight", sea_only: true, seller_insures: true, seller_clears_export: true, seller_clears_import: false, place: "named port of destination" },
};
export const INCOTERM_CODES = Object.keys(INCOTERMS_2020);

// Curated 6-digit HS headings (HS 2022 nomenclature). Keywords drive the
// suggester; flags drive compliance + documentation rules.
export const HS_TABLE = [
  { code: "0901.11", description: "Coffee, not roasted, not decaffeinated (green coffee)", keywords: ["green coffee", "coffee beans", "robusta", "arabica", "unroasted coffee", "coffee"], flags: ["food", "plant_product", "eudr"] },
  { code: "0902.30", description: "Black tea (fermented), in packings ≤ 3 kg", keywords: ["black tea", "tea bags", "assam tea", "tea"], flags: ["food", "plant_product"] },
  { code: "0904.11", description: "Pepper of the genus Piper, neither crushed nor ground", keywords: ["black pepper", "white pepper", "peppercorn"], flags: ["food", "plant_product"] },
  { code: "0910.30", description: "Turmeric (curcuma)", keywords: ["turmeric", "curcuma"], flags: ["food", "plant_product"] },
  { code: "1006.30", description: "Semi-milled or wholly milled rice", keywords: ["basmati", "rice", "milled rice", "parboiled rice"], flags: ["food", "plant_product"] },
  { code: "0306.17", description: "Frozen shrimps and prawns", keywords: ["frozen shrimp", "prawns", "vannamei", "shrimp"], flags: ["food", "animal_product"] },
  { code: "1509.20", description: "Extra virgin olive oil", keywords: ["extra virgin olive oil", "olive oil"], flags: ["food"] },
  { code: "3004.90", description: "Medicaments, packaged for retail sale (other)", keywords: ["tablets", "capsules", "medicine", "pharmaceutical", "generic drug", "paracetamol"], flags: ["pharma"] },
  { code: "3304.99", description: "Beauty or make-up preparations and skin-care preparations (other)", keywords: ["cosmetics", "skin cream", "moisturiser", "moisturizer", "serum", "sunscreen"], flags: ["cosmetics"] },
  { code: "4015.12", description: "Gloves of vulcanised rubber of a kind used for medical, surgical, dental or veterinary purposes", keywords: ["nitrile gloves", "examination gloves", "latex gloves", "medical gloves", "surgical gloves"], flags: ["medical_device"] },
  { code: "5208.12", description: "Woven cotton fabric ≥ 85% cotton, unbleached, plain weave, > 100 g/m²", keywords: ["cotton fabric", "greige fabric", "woven cotton"], flags: ["textiles", "uflpa_sensitive"] },
  { code: "6109.10", description: "T-shirts, singlets and other vests, knitted, of cotton", keywords: ["t-shirt", "tshirt", "t shirts", "cotton tee", "tee shirt"], flags: ["textiles", "uflpa_sensitive"] },
  { code: "6203.42", description: "Men's or boys' trousers and shorts, of cotton", keywords: ["trousers", "chinos", "jeans", "denim pants", "cotton pants"], flags: ["textiles", "uflpa_sensitive"] },
  { code: "6403.99", description: "Footwear with outer soles of rubber/plastics/leather and uppers of leather (other)", keywords: ["leather shoes", "leather boots", "footwear"], flags: [] },
  { code: "4202.21", description: "Handbags with outer surface of leather", keywords: ["leather handbag", "handbags", "leather bag"], flags: [] },
  { code: "7219.33", description: "Flat-rolled stainless steel, width ≥ 600 mm, cold-rolled, thickness > 1 mm but < 3 mm", keywords: ["stainless steel sheet", "stainless coil", "cold rolled stainless", "ss sheet"], flags: ["steel_aluminium"] },
  { code: "7306.40", description: "Tubes and pipes, welded, of circular cross-section, of stainless steel", keywords: ["stainless steel pipe", "stainless steel tube", "welded pipe", "ss pipe", "a312", "tp316l", "tp304l", "welded tube"], flags: ["steel_aluminium"] },
  { code: "7304.41", description: "Seamless tubes and pipes of stainless steel, cold-drawn or cold-rolled, circular", keywords: ["seamless stainless", "seamless pipe", "seamless tube"], flags: ["steel_aluminium"] },
  { code: "7318.15", description: "Threaded screws and bolts of iron or steel (other)", keywords: ["bolts", "screws", "fasteners", "hex bolt", "threaded rod"], flags: ["steel_aluminium"] },
  { code: "8413.70", description: "Centrifugal pumps (other)", keywords: ["centrifugal pump", "water pump", "process pump"], flags: ["machinery", "electrical"] },
  { code: "8481.80", description: "Taps, cocks, valves and similar appliances (other)", keywords: ["ball valve", "gate valve", "valves", "butterfly valve"], flags: ["machinery"] },
  { code: "8501.52", description: "AC motors, multi-phase, output > 750 W but ≤ 75 kW", keywords: ["induction motor", "ac motor", "electric motor", "three phase motor"], flags: ["electrical", "machinery"] },
  { code: "8504.40", description: "Static converters (power supplies, inverters, chargers)", keywords: ["power supply", "inverter", "charger", "converter", "smps"], flags: ["electrical"] },
  { code: "8507.60", description: "Lithium-ion accumulators", keywords: ["lithium ion battery", "li-ion", "lithium battery", "lifepo4", "battery pack"], flags: ["electrical", "battery_lithium", "hazardous"], un: { number: "UN3480", class: "9", name: "Lithium ion batteries" } },
  { code: "8541.43", description: "Photovoltaic cells assembled in modules or made up into panels", keywords: ["solar panel", "pv module", "solar module", "photovoltaic"], flags: ["electrical", "uflpa_sensitive"] },
  { code: "8471.30", description: "Portable automatic data-processing machines ≤ 10 kg (laptops)", keywords: ["laptop", "notebook computer", "portable computer"], flags: ["electrical", "radio", "chpl"] },
  { code: "8517.13", description: "Smartphones", keywords: ["smartphone", "mobile phone", "cell phone"], flags: ["electrical", "radio", "chpl"] },
  { code: "8542.31", description: "Electronic integrated circuits — processors and controllers", keywords: ["microcontroller", "processor", "integrated circuit", "cpu", "fpga", "chip"], flags: ["electrical", "chpl", "dual_use_possible"] },
  { code: "8526.91", description: "Radio navigational aid apparatus (incl. GNSS receivers)", keywords: ["gnss", "gps receiver", "navigation module"], flags: ["electrical", "radio", "chpl", "dual_use_possible"] },
  { code: "8806.22", description: "Unmanned aircraft, remote-controlled only, max take-off weight > 250 g but ≤ 7 kg", keywords: ["drone", "uav", "quadcopter", "unmanned aircraft"], flags: ["electrical", "radio", "chpl", "dual_use_possible"] },
  { code: "8456.11", description: "Machine tools operated by laser", keywords: ["laser cutting machine", "fiber laser", "laser cutter"], flags: ["machinery", "electrical", "dual_use_possible"] },
  { code: "8708.30", description: "Brakes and servo-brakes and parts thereof, for motor vehicles", keywords: ["brake pads", "brake disc", "brake caliper"], flags: [] },
  { code: "9018.90", description: "Instruments and appliances used in medical, surgical or veterinary sciences (other)", keywords: ["surgical instruments", "medical instrument", "forceps", "scalpel"], flags: ["medical_device"] },
  { code: "9403.60", description: "Wooden furniture (other)", keywords: ["wooden furniture", "wood table", "wooden chair", "cabinet"], flags: ["wood", "eudr"] },
  { code: "9503.00", description: "Toys, scale models, puzzles", keywords: ["toys", "toy", "puzzle", "doll"], flags: ["toys"] },
  { code: "3920.10", description: "Plates, sheets, film of polymers of ethylene, non-cellular, not reinforced", keywords: ["polyethylene film", "pe film", "ldpe film", "stretch film"], flags: [] },
  { code: "2815.11", description: "Sodium hydroxide (caustic soda), solid", keywords: ["caustic soda", "sodium hydroxide"], flags: ["hazardous"], un: { number: "UN1823", class: "8", name: "Sodium hydroxide, solid" } },
  { code: "3102.30", description: "Ammonium nitrate, whether or not in aqueous solution", keywords: ["ammonium nitrate"], flags: ["hazardous", "precursor"], un: { number: "UN1942", class: "5.1", name: "Ammonium nitrate" } },
  { code: "3602.00", description: "Prepared explosives, other than propellent powders", keywords: ["explosive", "dynamite", "emulsion explosive"], flags: ["prohibited", "hazardous"] },
  { code: "9306.30", description: "Cartridges and parts thereof (ammunition)", keywords: ["ammunition", "cartridges", "bullets"], flags: ["prohibited"] },
  { code: "9301.90", description: "Military weapons (other)", keywords: ["rifle", "firearm", "weapon", "gun"], flags: ["prohibited"] },
  { code: "2844.10", description: "Natural uranium and its compounds", keywords: ["uranium", "radioactive"], flags: ["prohibited"] },
];

const DUAL_USE_KEYWORDS = [
  "thermal imaging", "night vision", "infrared camera", "encryption", "cryptographic", "drone", "uav", "gnss", "inertial",
  "gyroscope", "accelerometer", "carbon fiber", "carbon fibre", "maraging", "centrifuge", "5-axis", "five-axis", "high-power laser",
  "frequency changer", "spectrometer", "hot isostatic", "rad-hard", "radiation hardened",
];
const END_USE_RED_FLAGS = ["military", "nuclear", "missile", "weapon", "munition", "defence", "defense", "surveillance", "army", "navy", "air force", "enrichment"];

const EVASION_PATTERNS = [
  /under[-\s]?(invoice|value|valuation|declare)/i, /undervalu/i, /lower (the )?(invoice|declared) value/i, /(two|double|second|dual) invoices?/i,
  /mis-?declar/i, /declare (it |them )?as (something|another|a different)/i, /(avoid|evade|dodge|skip|bypass|escape) (the )?(customs|duty|duties|tariff|tariffs|anti-?dumping|sanction|sanctions|inspection by customs)/i,
  /(fake|false|forged|bought) (certificate of origin|coo|origin certificate|invoice|packing list|bill of lading)/i, /change (the )?(country of )?origin/i,
  /(re-?route|transship|trans-?ship) (it |them )?(via|through) .* (to avoid|so (that )?customs|to get around)/i,
  /(split|break up) (the )?shipments? (to|so) (avoid|stay under|get under)/i, /(wrong|lower|different) hs code (to|so)/i, /(change|switch) the hs code (to|so)/i,
  /hide (it |them )?from customs/i, /(without|no) (customs )?declaration/i,
];

const OFF_PLATFORM_PATTERNS = [
  [/\bwhats\s?app\b/i, "WhatsApp"], [/\bwe\s?chat\b/i, "WeChat"], [/\btelegram\b/i, "Telegram"], [/\bskype\b/i, "Skype"],
  [/\bviber\b/i, "Viber"], [/\bsignal app\b|\bon signal\b/i, "Signal"], [/\bline id\b/i, "LINE"],
  [/\b(outside|off)[-\s]?(the )?platform\b/i, "off-platform dealing"], [/\bbypass (the )?(platform|escrow|hoorbit)\b/i, "escrow bypass"],
  [/\bdirect (deal|payment|transfer)\b/i, "direct payment outside escrow"], [/\bpay (me |us )?directly\b/i, "direct payment outside escrow"],
  [/\b(personal|private) (bank )?account\b/i, "personal account payment"], [/\bwestern union\b|\bmoneygram\b/i, "cash-transfer service"],
  [/\b(usdt|crypto|bitcoin|btc)\b/i, "crypto payment"], [/\bpersonal email\b|\bmy email\b/i, "personal email"],
];

const VAGUE_TERMS = [
  [/\bbest price\b/i, "best price", "State a numeric unit price and currency."],
  [/\basap\b|\bas soon as possible\b|\burgent(ly)?\b/i, "ASAP/urgent", "State a calendar date (e.g. 'cargo ready 2026-11-15')."],
  [/\bapprox(\.|imately)?\b|\baround\b|\broughly\b|\babout\b/i, "approximate quantity/price", "State an exact figure with an agreed tolerance (e.g. '20,000 kg ±5% at seller's option')."],
  [/\bmaybe\b|\bperhaps\b|\bmight\b|\bwe will see\b/i, "non-committal wording", "Replace with a firm yes/no or a dated condition."],
  [/\bsoon\b|\bshortly\b|\bin a few days\b/i, "undated timing", "Give a specific date or number of days from a defined event."],
  [/\b(good|high|best|standard|export|first|premium) (quality|grade)\b/i, "subjective quality claim", "Reference a measurable standard, grade, tolerance or approved golden sample ID."],
  [/\bnegotiable\b|\bflexible\b|\btbd\b|\bto be decided\b/i, "open-ended term", "Propose a concrete value; it can still be countered."],
  [/\betc\.?\b/i, "incomplete list", "List every item explicitly — 'etc.' cannot be inspected against."],
];
const AGGRESSIVE_TERMS = [
  [/\b(final|last) (price|offer)\b/i, "ultimatum"], [/\btake it or leave it\b/i, "ultimatum"], [/\bcheapest\b|\blowest (possible )?price\b/i, "price-only pressure"],
  [/\bor (we|i) (will )?go (elsewhere|to another supplier)\b/i, "walk-away threat"], [/\breply (today|immediately|now)\b|\bmust (reply|confirm) today\b/i, "artificial deadline"],
  [/\bstupid\b|\bridiculous\b|\bjoke\b|\bcheat(ing)?\b|\bscam\b/i, "hostile language"],
];

// ---------------------------------------------------------------------------
// HS classification
// ---------------------------------------------------------------------------

export function normalizeHs(code) {
  if (!code) return null;
  const digits = String(code).replace(/[^0-9]/g, "");
  if (digits.length < 6) return null;
  return `${digits.slice(0, 4)}.${digits.slice(4, 6)}`;
}
export function hsHeading(code) {
  const n = normalizeHs(code);
  return n ? n.slice(0, 4) : null;
}
export function lookupHs(code) {
  const n = normalizeHs(code);
  if (!n) return null;
  return HS_TABLE.find((e) => e.code === n) || HS_TABLE.find((e) => e.code.slice(0, 4) === n.slice(0, 4)) || null;
}

export function suggestHsCodes(text, limit = 3) {
  const hay = ` ${String(text || "").toLowerCase()} `;
  const scored = HS_TABLE.map((entry) => {
    let score = 0;
    const hits = [];
    for (const kw of entry.keywords) {
      if (hay.includes(kw)) {
        score += kw.includes(" ") ? 3 : 2; // multi-word phrases are more specific
        hits.push(kw);
      }
    }
    return { entry, score, hits };
  }).filter((s) => s.score > 0);
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0] ? scored[0].score : 0;
  return scored.slice(0, limit).map((s) => ({
    hs_code: s.entry.code,
    description: s.entry.description,
    matched_keywords: s.hits,
    confidence: s.score >= 5 && s.score === top ? "high" : s.score >= 3 ? "medium" : "low",
    flags: s.entry.flags,
  }));
}

// ---------------------------------------------------------------------------
// Compliance screening
// ---------------------------------------------------------------------------

export function detectEvasion(...texts) {
  const joined = texts.filter(Boolean).join(" \n ");
  return EVASION_PATTERNS.some((re) => re.test(joined));
}

function isEu(code) {
  return EU_MEMBERS.includes(code);
}

// Destination-market requirements. `certs` are tokens matched against a
// supplier's certifications list for hard matching gates (any-of per entry).
export function destinationRequirements(dest, flags) {
  const f = new Set(flags || []);
  const out = [];
  const add = (requirement, authority, certs = null, mandatory = true) => out.push({ requirement, authority, certification_any_of: certs, mandatory });

  if (dest === "US") {
    if (f.has("food")) add("FDA food facility registration + Prior Notice for each shipment (FSMA / Bioterrorism Act)", "US FDA", ["FDA Food Facility Registration"]);
    if (f.has("food")) add("FSVP — importer must run a Foreign Supplier Verification Program", "US FDA", null);
    if (f.has("medical_device")) add("FDA establishment registration & device listing; 510(k) clearance where required (e.g. patient examination gloves)", "US FDA", ["FDA 510(k)"]);
    if (f.has("pharma")) add("FDA drug establishment registration, NDC listing, and approved application (NDA/ANDA) or OTC monograph compliance", "US FDA", ["FDA Drug Registration"]);
    if (f.has("cosmetics")) add("MoCRA facility registration and product listing", "US FDA", null);
    if (f.has("radio")) add("FCC equipment authorization for RF devices", "FCC", ["FCC"]);
    if (f.has("toys")) add("Children's Product Certificate based on CPSC-accepted lab testing (ASTM F963)", "CPSC", ["ASTM F963"]);
    if (f.has("battery_lithium")) add("UN38.3 test summary + 49 CFR hazardous-materials shipping compliance", "US DOT / PHMSA", ["UN38.3"]);
    if (f.has("uflpa_sensitive")) add("UFLPA supply-chain tracing: goods with any Xinjiang-linked input are presumed barred — keep full traceability to raw material", "US CBP", null, false);
    add("ISF (10+2) filing ≥ 24h before loading for ocean cargo", "US CBP", null);
  }
  if (isEu(dest)) {
    if (f.has("electrical") || f.has("machinery")) add("CE marking with EU Declaration of Conformity (LVD / EMC / Machinery / RoHS as applicable)", "EU market surveillance", ["CE"]);
    if (f.has("radio")) add("CE marking under the Radio Equipment Directive 2014/53/EU", "EU market surveillance", ["CE"]);
    if (f.has("medical_device")) add("CE marking under the Medical Devices Regulation (EU) 2017/745, EU authorised representative", "EU Notified Body", ["CE"]);
    if (f.has("toys")) add("CE marking under the Toy Safety Directive (EN 71 testing)", "EU market surveillance", ["CE"]);
    if (f.has("cosmetics")) add("CPNP notification and EU Responsible Person (Reg. 1223/2009)", "European Commission", null);
    if (f.has("battery_lithium")) add("UN38.3 test summary; EU Batteries Regulation (EU) 2023/1542 labelling/due diligence", "EU", ["UN38.3"]);
    if (f.has("food") || f.has("plant_product") || f.has("animal_product")) add("Official health/phytosanitary certificate and pre-notification via TRACES", "EU / member-state border control post", null);
    if (f.has("steel_aluminium")) add("CBAM: importer must be an authorised CBAM declarant and report embedded emissions (definitive period from 2026)", "EU CBAM", null);
    if (f.has("eudr")) add("EUDR deforestation-free due-diligence statement with plot geolocation (check the current application date)", "EU", null, false);
    add("ENS / ICS2 safety & security pre-arrival filing by the carrier", "EU customs", null);
  }
  if (dest === "GB") {
    if (f.has("electrical") || f.has("machinery") || f.has("toys") || f.has("radio")) add("UKCA marking — CE marking is still accepted for most of these product categories in Great Britain", "UK OPSS", ["UKCA", "CE"]);
    if (f.has("medical_device")) add("MHRA device registration; UKCA or CE marking", "MHRA", ["UKCA", "CE"]);
    if (f.has("food") || f.has("plant_product") || f.has("animal_product")) add("IPAFFS pre-notification and health/phytosanitary certificate where applicable", "DEFRA / APHA", null);
  }
  if (dest === "IN") {
    if (f.has("electrical")) add("BIS Compulsory Registration Scheme / Quality Control Order certification", "Bureau of Indian Standards", ["BIS"]);
    if (f.has("steel_aluminium")) add("BIS licence under the applicable steel Quality Control Order", "Bureau of Indian Standards", ["BIS"]);
    if (f.has("medical_device")) add("CDSCO import licence (Medical Devices Rules 2017)", "CDSCO", ["CDSCO"]);
    if (f.has("food")) add("FSSAI import clearance", "FSSAI", null);
  }
  if (dest === "AE") {
    if (f.has("medical_device")) add("MOHAP medical device registration (usually supported by CE or FDA clearance)", "UAE MOHAP", ["CE", "FDA 510(k)"]);
    if (f.has("electrical")) add("ECAS / Emirates Conformity Assessment where the product is regulated", "MoIAT", null, false);
    if (f.has("food")) add("Product registration with the emirate food authority (e.g. Dubai Municipality / ZAD)", "Dubai Municipality", null);
  }
  if (dest === "CN") {
    if (f.has("electrical")) add("CCC certification for listed products", "CNCA", ["CCC"]);
    if (f.has("food")) add("GACC overseas food manufacturer registration", "GACC", null);
  }
  return out;
}

export function screenCompliance({ product_description, hs_code, origin_country, destination_country, end_use }) {
  const findings = [];
  let verdict = "clear";
  const escalate = (level) => {
    const order = ["clear", "clear_with_requirements", "license_required", "blocked"];
    if (order.indexOf(level) > order.indexOf(verdict)) verdict = level;
  };
  const text = `${product_description || ""} ${end_use || ""}`.toLowerCase();

  if (detectEvasion(product_description, end_use)) {
    return { verdict: "refused", findings: [{ severity: "critical", regime: "Customs law", finding: "Request describes customs-duty or sanctions evasion." }], refusal: EVASION_REFUSAL, hs: null, un_dangerous_goods: null, destination_requirements: [] };
  }

  let hs = hs_code ? lookupHs(hs_code) : null;
  if (!hs && product_description) {
    const s = suggestHsCodes(product_description, 1)[0];
    if (s) hs = HS_TABLE.find((e) => e.code === s.hs_code);
  }
  const flags = new Set(hs ? hs.flags : []);
  if (DUAL_USE_KEYWORDS.some((k) => text.includes(k))) flags.add("dual_use_possible");

  for (const [code, name] of Object.entries(EMBARGOED)) {
    if (origin_country === code || destination_country === code) {
      escalate("blocked");
      findings.push({ severity: "critical", regime: "OFAC / EU / UK sanctions", finding: `${name} is under comprehensive sanctions. Hoorbit does not facilitate trade to or from ${name}.` });
    }
  }
  if (EMBARGOED_REGIONS.some((r) => text.includes(r))) {
    escalate("blocked");
    findings.push({ severity: "critical", regime: "OFAC / EU / UK sanctions", finding: "Shipment references a comprehensively sanctioned region (Crimea / so-called DNR / LNR)." });
  }
  for (const c of [origin_country, destination_country]) {
    if (c && HEIGHTENED_RISK[c]) {
      escalate("license_required");
      findings.push({ severity: "high", regime: "Sanctions / export controls", finding: `${countryName(c)}: ${HEIGHTENED_RISK[c]}. Manual review by a trade-compliance officer is required before matching.` });
    }
  }
  if (flags.has("prohibited")) {
    escalate("blocked");
    findings.push({ severity: "critical", regime: "Arms / explosives / nuclear controls", finding: `${hs.description} requires government licences (e.g. ITAR/EAR 600-series, EU Common Military List, national explosives/nuclear licensing). Not tradable through the Hoorbit marketplace.` });
  }
  if (flags.has("dual_use_possible")) {
    escalate("license_required");
    findings.push({ severity: "high", regime: "Dual-use export controls (EU Reg. 2021/821 Annex I, US EAR/CCL, Wassenaar)", finding: "Product may be a controlled dual-use item depending on its technical parameters. The exporter must obtain an ECCN / Annex I classification and, if controlled, an export licence before shipment." });
  }
  if (END_USE_RED_FLAGS.some((k) => text.includes(k))) {
    escalate("license_required");
    findings.push({ severity: "high", regime: "End-use controls (catch-all)", finding: "Stated or implied military / nuclear / surveillance end use triggers catch-all controls. An end-user certificate and export-control review are mandatory." });
  }
  if (flags.has("chpl") && DIVERSION_RISK_ROUTES.includes(destination_country)) {
    escalate("clear_with_requirements");
    findings.push({ severity: "medium", regime: "EU Art. 12g 'No-Russia' clause / Common High Priority List", finding: `${countryName(destination_country)} is a known diversion route for Common High Priority List goods. Obtain an end-user statement and include a no-re-export-to-Russia/Belarus clause in the contract.` });
  }
  if (flags.has("precursor")) {
    escalate("license_required");
    findings.push({ severity: "high", regime: "Explosives-precursor controls (e.g. EU Reg. 2019/1148)", finding: "Explosives precursor: requires end-user verification and, in many jurisdictions, import/export licensing." });
  }
  let un = null;
  if (flags.has("hazardous") && hs && hs.un) {
    un = hs.un;
    escalate("clear_with_requirements");
    findings.push({ severity: "medium", regime: "Dangerous goods (IMDG / IATA DGR / ADR)", finding: `${un.number}, Class ${un.class} (${un.name}). Needs a Safety Data Sheet, a dangerous-goods declaration, UN-specification packaging, and carrier DG acceptance.` });
  }

  const destReqs = destination_country ? destinationRequirements(destination_country, [...flags]) : [];
  if (destReqs.length) {
    escalate("clear_with_requirements");
    for (const r of destReqs) findings.push({ severity: r.mandatory ? "medium" : "advisory", regime: r.authority, finding: r.requirement });
  }
  if (flags.has("uflpa_sensitive") && origin_country === "CN" && destination_country === "US") {
    escalate("clear_with_requirements");
    findings.push({ severity: "high", regime: "US Uyghur Forced Labor Prevention Act", finding: "UFLPA high-priority sector sourced from China: CBP presumes Xinjiang-linked goods are barred. Full raw-material traceability is required before shipment." });
  }

  return {
    verdict,
    hs: hs ? { hs_code: hs.code, description: hs.description, flags: [...flags] } : null,
    un_dangerous_goods: un,
    findings,
    destination_requirements: destReqs,
  };
}

// ---------------------------------------------------------------------------
// Zero-trust business verification
// ---------------------------------------------------------------------------

const REGISTRY_FORMATS = {
  IN_GSTIN: { re: /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, registry: "India GST Network" },
  IN_IEC: { re: /^[0-9A-Z]{10}$/, registry: "India DGFT Importer-Exporter Code" },
  CN_USCC: { re: /^[0-9A-HJ-NPQRTUWXY]{2}\d{6}[0-9A-HJ-NPQRTUWXY]{10}$/, registry: "China Unified Social Credit Code" },
  TR_MERSIS: { re: /^\d{16}$/, registry: "Türkiye MERSIS" },
  VN_ERC: { re: /^\d{10}(-\d{3})?$/, registry: "Vietnam Enterprise Registration Certificate" },
  MY_SSM: { re: /^\d{12}$/, registry: "Companies Commission of Malaysia (SSM)" },
  EU_VAT: { re: /^(AT|BE|BG|CY|CZ|DE|DK|EE|EL|ES|FI|FR|HR|HU|IE|IT|LT|LU|LV|MT|NL|PL|PT|RO|SE|SI|SK)[0-9A-Z]{8,12}$/, registry: "EU VIES VAT register" },
  US_EIN: { re: /^\d{2}-?\d{7}$/, registry: "US IRS Employer Identification Number" },
  GB_CRN: { re: /^([0-9]{8}|[A-Z]{2}[0-9]{6})$/, registry: "UK Companies House" },
  AE_TRADE_LICENSE: { re: /^[A-Z0-9-]{5,20}$/, registry: "UAE economic department / free-zone authority" },
};

export function verifyBusiness(company) {
  const checks = [];
  let score = 0;
  let hardFail = false;
  let needsManualReview = false;

  const reg = company.registration || {};
  const fmt = REGISTRY_FORMATS[reg.scheme];
  if (fmt && fmt.re.test(String(reg.number || ""))) {
    score += 25;
    checks.push({ check: "company_registration", passed: true, detail: `${reg.scheme} ${reg.number} matches the ${fmt.registry} format. (Demo: format check only — production queries the live registry.)` });
  } else {
    checks.push({ check: "company_registration", passed: false, detail: fmt ? `${reg.scheme} number '${reg.number}' does not match the ${fmt.registry} format.` : `Registry scheme '${reg.scheme || "none"}' is not supported for automated checks — manual KYB review required.` });
    needsManualReview = true;
  }

  if (EMBARGOED[company.country]) {
    hardFail = true;
    checks.push({ check: "sanctions_country", passed: false, detail: `${countryName(company.country)} is under comprehensive sanctions — cannot be onboarded.` });
  } else if (HEIGHTENED_RISK[company.country]) {
    needsManualReview = true;
    checks.push({ check: "sanctions_country", passed: false, detail: `${countryName(company.country)}: ${HEIGHTENED_RISK[company.country]}. Manual review required.` });
  } else {
    checks.push({ check: "sanctions_country", passed: true, detail: `${countryName(company.country)} is not under comprehensive sanctions.` });
  }
  const lowerName = String(company.company_name || "").toLowerCase();
  const dpHit = DEMO_DENIED_PARTIES.find((n) => lowerName.includes(n));
  if (dpHit) {
    hardFail = true;
    checks.push({ check: "denied_party_screening", passed: false, detail: `Name matches a restricted-party list entry ('${dpHit}').` });
  } else {
    checks.push({ check: "denied_party_screening", passed: true, detail: "No match against the (demo) consolidated restricted-party list." });
  }

  if (company.type === "supplier") {
    const h = company.export_history || {};
    const s = h.shipments_24m || 0;
    const pts = s >= 50 ? 25 : s >= 12 ? 18 : s >= 1 ? 8 : 0;
    score += pts;
    checks.push({ check: "export_trade_history", passed: s >= 12, detail: `${s} export shipments in the last 24 months to ${(h.countries_served || []).length} countries (${pts}/25).` });
    const perfOk = (h.on_time_rate || 0) >= 0.9 && (h.dispute_rate ?? 1) <= 0.03;
    const perfPts = perfOk ? 15 : (h.on_time_rate || 0) >= 0.8 && (h.dispute_rate ?? 1) <= 0.06 ? 7 : 0;
    score += perfPts;
    checks.push({ check: "fulfilment_performance", passed: perfOk, detail: `On-time rate ${Math.round((h.on_time_rate || 0) * 100)}%, dispute rate ${Math.round((h.dispute_rate || 0) * 100)}% (${perfPts}/15).` });
    if (company.country === "IN") {
      const iecOk = company.export_licence && company.export_licence.scheme === "IN_IEC" && REGISTRY_FORMATS.IN_IEC.re.test(company.export_licence.number);
      checks.push({ check: "export_licence", passed: !!iecOk, detail: iecOk ? "Valid-format DGFT IEC on file." : "Indian exporters need a DGFT Importer-Exporter Code (IEC)." });
      if (!iecOk) needsManualReview = true;
    }
  } else {
    const h = company.import_history || {};
    const s = h.shipments_24m || 0;
    const pts = s >= 6 ? 25 : s >= 1 ? 15 : 5;
    score += pts;
    checks.push({ check: "import_trade_history", passed: s >= 1, detail: s ? `${s} import shipments in the last 24 months (${pts}/25).` : "First-time importer — no customs import history (5/25). Escrow-only terms apply." });
    score += 15; // buyers carry no fulfilment-performance risk to the supplier; payment risk is covered by escrow
    checks.push({ check: "payment_risk", passed: true, detail: "Buyer payment risk is covered by mandatory platform escrow (15/15)." });
  }

  if (company.bank_account_verified) {
    score += 20;
    checks.push({ check: "bank_account_ownership", passed: true, detail: "Bank account ownership verified against the registered entity name (20/20)." });
  } else {
    checks.push({ check: "bank_account_ownership", passed: false, detail: "Bank account not yet verified against the registered entity (0/20)." });
  }

  score = Math.min(100, score);
  let status;
  if (hardFail) status = "rejected";
  else if (score >= 75 && !needsManualReview) status = "verified";
  else if (score >= 50) status = "conditionally_verified";
  else status = "unverified";

  const outstanding = checks.filter((c) => !c.passed).map((c) => c.detail);
  return { status, score: hardFail ? 0 : score, checks, outstanding_items: outstanding, needs_manual_review: needsManualReview && !hardFail };
}

// ---------------------------------------------------------------------------
// Supplier scoring for matchmaking
// ---------------------------------------------------------------------------

const UNIT_ALIASES = { kg: "kg", kgs: "kg", kilogram: "kg", kilograms: "kg", mt: "t", t: "t", ton: "t", tons: "t", tonne: "t", tonnes: "t", pcs: "pieces", pc: "pieces", piece: "pieces", pieces: "pieces", units: "pieces", unit: "pieces", sets: "pieces", set: "pieces" };
export function normalizeQuantity(qty, unit) {
  const u = UNIT_ALIASES[String(unit || "").toLowerCase()] || String(unit || "").toLowerCase();
  if (u === "t") return { qty: qty * 1000, unit: "kg" };
  return { qty, unit: u };
}

function portPoints(km) {
  if (km <= 50) return 15;
  if (km <= 150) return 12;
  if (km <= 350) return 8;
  if (km <= 600) return 4;
  return 1;
}

function hasCert(supplierCerts, token) {
  const have = (supplierCerts || []).map((c) => c.toLowerCase());
  return have.some((c) => c === token.toLowerCase() || c.startsWith(token.toLowerCase()));
}

// Returns { eligible, gate_failures[], score, breakdown, flags[] }. The weights
// are documented in the output so the ranking is auditable. A supplier's paid
// subscription tier is deliberately given zero weight.
export function scoreSupplier(supplier, rfq, destReqs) {
  const gate = [];
  const flags = [];
  if (!supplier.verification || supplier.verification.status !== "verified") gate.push(`Not verified (status: ${supplier.verification ? supplier.verification.status : "unknown"}) — zero-trust policy excludes unverified suppliers.`);
  if (EMBARGOED[supplier.country]) gate.push(`${countryName(supplier.country)} is under comprehensive sanctions.`);
  if (HEIGHTENED_RISK[supplier.country]) gate.push(`${countryName(supplier.country)} requires manual sanctions review.`);
  const heading = hsHeading(rfq.hs_code);
  if (!(supplier.hs_headings || []).includes(heading)) gate.push(`Does not manufacture HS heading ${heading}.`);
  if (rfq.origin_preference && rfq.origin_preference.length && !rfq.origin_preference.includes(supplier.country)) gate.push(`Origin ${supplier.country} is outside the buyer's origin preference (${rfq.origin_preference.join(", ")}).`);
  for (const r of destReqs.filter((d) => d.mandatory && d.certification_any_of)) {
    if (!r.certification_any_of.some((t) => hasCert(supplier.certifications, t))) gate.push(`Missing certification required by ${countryName(rfq.destination_country)}: ${r.certification_any_of.join(" or ")} (${r.authority}).`);
  }
  const order = normalizeQuantity(rfq.quantity, rfq.unit);
  const supUnit = normalizeQuantity(1, supplier.capacity_unit).unit;
  const sameUnit = order.unit === supUnit;
  if (sameUnit && supplier.moq && order.qty < supplier.moq) gate.push(`Order ${order.qty.toLocaleString("en-US")} ${order.unit} is below the supplier's MOQ of ${supplier.moq.toLocaleString("en-US")} ${supUnit}.`);

  // Capacity (30): assumes half of monthly capacity can be allocated to one buyer.
  let capacity;
  const leadMonths = rfq.delivery_deadline ? Math.max(1, Math.round((new Date(rfq.delivery_deadline) - new Date()) / (30 * 86400000)) - 1) : 2;
  if (!sameUnit) {
    capacity = 10;
    flags.push(`Unit mismatch (RFQ in ${order.unit}, supplier capacity in ${supUnit}) — confirm conversion.`);
  } else {
    const ratio = ((supplier.monthly_capacity_units || 0) * 0.5 * leadMonths) / order.qty;
    capacity = ratio >= 1.5 ? 30 : ratio >= 1 ? 24 : ratio >= 0.5 ? 12 : 4;
    if (ratio < 1) flags.push("Capacity risk: order exceeds ~50% of the supplier's capacity over the lead time.");
  }

  // Export history (30)
  const h = supplier.export_history || {};
  const volume = Math.min(1, (h.shipments_24m || 0) / 100) * 12;
  const onTime = Math.max(0, Math.min(1, ((h.on_time_rate || 0) - 0.7) / 0.3)) * 10;
  const lane = (h.countries_served || []).includes(rfq.destination_country) ? 5 : 0;
  const disputes = (h.dispute_rate ?? 1) <= 0.02 ? 3 : (h.dispute_rate ?? 1) <= 0.05 ? 1 : 0;
  const exportHistory = Math.round(volume + onTime + lane + disputes);
  if (!lane) flags.push(`No recorded shipments to ${countryName(rfq.destination_country)} — first shipment on this trade lane.`);

  // Port proximity (15)
  const port = portPoints(supplier.port_distance_km ?? 9999);

  // Certification fit (15) against the buyer's own list
  const wanted = rfq.required_certifications || [];
  const certPct = wanted.length ? wanted.filter((c) => hasCert(supplier.certifications, c)).length / wanted.length : 1;
  const certs = Math.round(certPct * 15);
  if (certPct < 1) flags.push(`Holds ${Math.round(certPct * 100)}% of the buyer's requested certifications: missing ${wanted.filter((c) => !hasCert(supplier.certifications, c)).join(", ")}.`);

  // Price fit (10)
  let price = 5;
  const ip = supplier.indicative_unit_price;
  if (ip && rfq.target_price && CURRENCIES[ip.currency] && CURRENCIES[rfq.currency]) {
    const supplierPriceInRfqCcy = convert(ip.amount, ip.currency, rfq.currency);
    const perUnit = normalizeQuantity(1, ip.per).unit;
    if (perUnit === order.unit) {
      const r = supplierPriceInRfqCcy / rfq.target_price;
      price = r <= 1 ? 10 : r <= 1.1 ? 6 : r <= 1.25 ? 3 : 0;
      if (r > 1.1) flags.push(`Indicative price ${round2(supplierPriceInRfqCcy)} ${rfq.currency}/${order.unit} is ${Math.round((r - 1) * 100)}% above target.`);
    }
  }

  if (rfq.destination_country === "US" && supplier.country === "CN" && destReqs.some((d) => /UFLPA/.test(d.requirement))) flags.push("UFLPA traceability evidence required before shipment.");

  const score = capacity + exportHistory + port + certs + price;
  return {
    eligible: gate.length === 0,
    gate_failures: gate,
    score,
    breakdown: {
      operational_capacity: `${capacity}/30`,
      export_history: `${exportHistory}/30`,
      port_proximity: `${port}/15 (${supplier.port_distance_km} km to ${supplier.nearest_port})`,
      certification_fit: `${certs}/15`,
      price_fit: `${price}/10`,
      subscription_tier_weight: "0 — paid platform tier never affects ranking",
    },
    flags,
  };
}

// ---------------------------------------------------------------------------
// Message hygiene: disintermediation, vague commitments, aggressive bargaining
// ---------------------------------------------------------------------------

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_CANDIDATE_RE = /\+?\d[\d\s().-]{7,}\d/g;
const URL_RE = /\b(?:https?:\/\/|www\.)\S+/gi;

export function redactContacts(text) {
  const redactions = [];
  let out = String(text || "");
  out = out.replace(EMAIL_RE, (m) => { redactions.push({ type: "email", value: m }); return "[email removed — use Hoorbit messaging]"; });
  out = out.replace(URL_RE, (m) => { redactions.push({ type: "url", value: m }); return "[link removed]"; });
  out = out.replace(PHONE_CANDIDATE_RE, (m) => {
    const digits = m.replace(/\D/g, "");
    if (digits.length < 9 || /^\d{4}-\d{2}-\d{2}$/.test(m.trim())) return m;
    redactions.push({ type: "phone", value: m });
    return "[phone removed — use Hoorbit messaging]";
  });
  return { text: out, redactions };
}

const PROTECTED_PATTERNS = [
  /\b(?:EXW|FCA|CPT|CIP|DAP|DPU|DDP|FAS|FOB|CFR|CIF)\b(?:\s+[A-Z][A-Za-z-]+(?:\s[A-Z][A-Za-z-]+)?)?/g,
  /\b\d{4}\.\d{2}(?:\.\d{2,4})?\b/g,
  /\b(?:ISO|IEC|EN|ASTM|ASME|DIN|JIS|API|BS|IS|GB\/T|UL)\s?[A-Z]?\d+[A-Za-z0-9.:/-]*/g,
  /\b(?:AISI|SUS|SS|TP)\s?\d{3}[A-Z]?\b/g,
  /[±+-]?\d+(?:[.,]\d+)?\s?(?:mm|cm|µm|um|kg|g\/m²|gsm|MPa|bar|psi|°C|kW|kVA|V|W|Ah|mAh|Hz|%)(?![A-Za-z])/g,
  /\bAQL\s?\d+(?:\.\d+)?\b/g,
  /\b(?:USD|EUR|GBP|INR|CNY|JPY|AED|MYR|SGD|VND|TRY|MXN|AUD|CAD)\s?\d[\d,]*(?:\.\d+)?\b/g,
];

export function analyzeMessage(text) {
  const evasion = detectEvasion(text);
  const { text: sanitized, redactions } = redactContacts(text);
  const offPlatform = [];
  for (const [re, label] of OFF_PLATFORM_PATTERNS) if (re.test(text || "")) offPlatform.push(label);
  const vague = [];
  for (const [re, label, fix] of VAGUE_TERMS) if (re.test(text || "")) vague.push({ issue: label, required_clarification: fix });
  const aggressive = [];
  for (const [re, label] of AGGRESSIVE_TERMS) if (re.test(text || "")) aggressive.push(label);
  const protectedTerms = new Set();
  for (const re of PROTECTED_PATTERNS) for (const m of sanitized.matchAll(re)) protectedTerms.add(m[0].trim());
  return { evasion, sanitized, redactions, off_platform_signals: [...new Set(offPlatform)], vague_commitments: vague, aggressive_bargaining: [...new Set(aggressive)], protected_terms: [...protectedTerms] };
}

// ---------------------------------------------------------------------------
// Inspection: ISO 2859-1 (ANSI/ASQ Z1.4) single sampling, normal, general level II
// ---------------------------------------------------------------------------

const LOT_TO_CODE = [
  [8, "A", 2], [15, "B", 3], [25, "C", 5], [50, "D", 8], [90, "E", 13], [150, "F", 20], [280, "G", 32], [500, "H", 50],
  [1200, "J", 80], [3200, "K", 125], [10000, "L", 200], [35000, "M", 315], [150000, "N", 500], [500000, "P", 800], [Infinity, "Q", 1250],
];
// Accept numbers (Ac; Re = Ac + 1) for sample sizes ≥ 13. Where the standard's
// table arrows to another plan, the plan it points to is used.
const AC_TABLE = {
  "2.5": { 13: 1, 20: 1, 32: 2, 50: 3, 80: 5, 125: 7, 200: 10, 315: 14, 500: 21 },
  "4.0": { 13: 1, 20: 2, 32: 3, 50: 5, 80: 7, 125: 10, 200: 14, 315: 21 },
};

export function aqlPlan(lotSize, aql) {
  const row = LOT_TO_CODE.find(([max]) => lotSize <= max);
  const [, code, n] = row;
  if (n < 13) return { code_letter: code, sample_size: lotSize, accept: 0, reject: 1, note: "Lot too small for statistical sampling — inspect 100% of units." };
  const plans = AC_TABLE[aql];
  const sizes = Object.keys(plans).map(Number).sort((a, b) => a - b);
  const effN = sizes.filter((s) => s <= n).pop();
  return { code_letter: code, sample_size: effN, accept: plans[effN], reject: plans[effN] + 1, note: effN !== n ? `Standard table points from n=${n} to the n=${effN} plan for AQL ${aql}.` : null };
}

export const INSPECTION_PROVIDERS = ["SGS", "Intertek", "Bureau Veritas", "TÜV SÜD", "QIMA"];

export function inspectionPlan({ lot_size, flags = [], first_order = true, risk = "standard" }) {
  const f = new Set(flags);
  const highRisk = risk === "high" || f.has("medical_device") || f.has("pharma") || f.has("battery_lithium") || f.has("toys") || f.has("food");
  const major = aqlPlan(lot_size, "2.5");
  const minor = aqlPlan(lot_size, "4.0");
  const stages = [];
  if (first_order || highRisk) stages.push({ code: "PPI", stage: "Factory audit / PPI (pre-production inspection)", when: "Before production starts", purpose: "Verify raw materials, factory capability, and the approved golden sample." });
  if (highRisk || lot_size >= 10000) stages.push({ code: "DUPRO", stage: "DUPRO (during-production inspection)", when: "At 20–60% of production", purpose: "Catch systemic defects while they can still be corrected." });
  stages.push({ code: "PSI", stage: "PSI (pre-shipment inspection) — escrow release gate", when: "At ≥ 80% packed, before dispatch to port", purpose: "AQL sampling against the agreed spec; a PASS report releases the escrow balance." });
  stages.push({ code: "CLS", stage: "CLS (container loading supervision)", when: "At loading", purpose: "Confirm quantity, packing and seal numbers match the packing list — prevents swaps after PSI." });
  const lab = [];
  if (f.has("steel_aluminium")) lab.push("Chemical composition + mechanical test (PMI / tensile) against the mill test certificate (EN 10204 3.1)");
  if (f.has("medical_device")) lab.push("Pinhole/water-leak test (e.g. ASTM D5151 / EN 455-1) and sterility or biocompatibility where claimed");
  if (f.has("battery_lithium")) lab.push("Verify the UN38.3 test summary matches the exact cell/pack model shipped");
  if (f.has("food") || f.has("plant_product")) lab.push("Moisture, contaminant and pesticide-residue analysis against destination MRLs; grading/defect count");
  if (f.has("toys")) lab.push("EN 71 / ASTM F963 mechanical and chemical tests");
  if (f.has("textiles")) lab.push("Colourfastness, dimensional stability, fibre composition");
  return {
    sampling_standard: "ISO 2859-1 / ANSI Z1.4, single sampling, normal inspection, general inspection level II",
    lot_size,
    aql: {
      critical: { aql: "0", accept: 0, note: "Any critical (safety) defect fails the lot." },
      major: { aql: "2.5", ...major },
      minor: { aql: "4.0", ...minor },
    },
    stages,
    lab_tests: lab,
    providers: INSPECTION_PROVIDERS,
    provider_note: "The buyer appoints and pays the inspector directly (or via escrow); the inspector uploads the report to Hoorbit — reports sent by the supplier are not accepted as release evidence. Hoorbit does not endorse a specific provider.",
    risk_level: highRisk ? "high" : "standard",
  };
}

// ---------------------------------------------------------------------------
// Shipping documentation
// ---------------------------------------------------------------------------

export function requiredDocuments({ origin_country, destination_country, incoterm, mode = "sea", flags = [] }) {
  const f = new Set(flags);
  const term = INCOTERMS_2020[incoterm] || null;
  const docs = [
    { document: "Commercial Invoice", issued_by: "Seller", note: "Single invoice at the true transaction value, with HS code, Incoterm® 2020 + named place, and country of origin." },
    { document: "Packing List", issued_by: "Seller", note: "Per-package net/gross weights, dimensions, marks & numbers — must match the CLS report." },
    mode === "air"
      ? { document: "Air Waybill (AWB)", issued_by: "Airline / forwarder", note: "Non-negotiable; consignee named on the AWB takes delivery." }
      : { document: "Bill of Lading (B/L)", issued_by: "Carrier / NVOCC", note: "Use a 'to order' or escrow-controlled B/L so title does not pass before the balance is released." },
    { document: "Certificate of Origin", issued_by: "Chamber of commerce / authorised body", note: "Non-preferential CoO for customs; a preferential origin proof (e.g. EUR.1 / REX statement, Form E, CEPA/FTA certificate) only where the goods genuinely qualify under that FTA's rules of origin." },
    { document: "Export customs declaration", issued_by: "Exporter / customs broker", note: origin_country === "IN" ? "Shipping Bill filed on ICEGATE." : origin_country === "US" ? "EEI filed in AES (required above USD 2,500 per Schedule B line or when licensed)." : "Filed with the origin customs authority." },
    { document: "Import customs declaration", issued_by: "Importer of record / customs broker", note: incoterm === "DDP" ? "Under DDP the SELLER is the importer of record — confirm they are legally able to act as such in the destination." : "Filed by the buyer's broker in the destination country." },
    { document: "Pre-Shipment Inspection report", issued_by: "Third-party inspector (SGS / Intertek / BV …)", note: "Escrow release evidence — uploaded by the inspector, not the seller." },
  ];
  if (term && term.seller_insures) docs.push({ document: "Insurance certificate", issued_by: "Seller's cargo insurer", note: incoterm === "CIF" ? "CIF: minimum Institute Cargo Clauses (C), 110% of invoice value." : "CIP: Institute Cargo Clauses (A), 110% of invoice value." });
  if (f.has("plant_product")) docs.push({ document: "Phytosanitary Certificate", issued_by: "Origin national plant-protection organisation", note: "Issued after official inspection, per IPPC/ISPM standards." });
  if (f.has("food") || f.has("animal_product")) docs.push({ document: "Health / sanitary certificate", issued_by: "Origin competent authority", note: "Plus any destination-specific lab analysis certificates." });
  if (f.has("hazardous") || f.has("battery_lithium")) docs.push({ document: "Safety Data Sheet + Dangerous Goods Declaration", issued_by: "Shipper", note: mode === "air" ? "IATA DGR Shipper's Declaration." : "IMDG multimodal dangerous goods form." });
  if (f.has("battery_lithium")) docs.push({ document: "UN38.3 Test Summary", issued_by: "Cell/battery manufacturer", note: "Required for every lithium battery model shipped." });
  if (f.has("steel_aluminium")) docs.push({ document: "Mill Test Certificate (EN 10204 3.1)", issued_by: "Manufacturer", note: "Heat numbers must trace to the goods shipped; CBAM emissions data for EU imports." });
  if (f.has("wood") || mode === "sea") docs.push({ document: "ISPM-15 compliant wood packaging", issued_by: "Packer", note: "Any solid wood pallets/crates must be heat-treated and stamped." });
  const destReqs = destinationRequirements(destination_country, [...f]);
  for (const r of destReqs) docs.push({ document: r.requirement, issued_by: r.authority, note: r.mandatory ? "Required by the destination market." : "Advisory for the destination market." });
  return { documents: docs, incoterm_obligations: term ? { rule: `${incoterm} — ${term.name}`, named_place_refers_to: term.place, seller_clears_export: term.seller_clears_export, seller_clears_import: term.seller_clears_import, seller_buys_insurance: term.seller_insures, sea_and_inland_waterway_only: term.sea_only } : null };
}

export const DEFAULT_CCY_BY_COUNTRY = { US: "USD", GB: "GBP", IN: "INR", MY: "MYR", SG: "SGD", AU: "AUD", CA: "CAD", CN: "CNY", JP: "JPY", VN: "VND", TR: "TRY", AE: "AED", MX: "MXN" };
export function homeCurrency(country) {
  if (EU_MEMBERS.includes(country)) return "EUR";
  return DEFAULT_CCY_BY_COUNTRY[country] || "USD";
}

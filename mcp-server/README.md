# Hoorbit Enterprise MCP

A real, protocol-compliant **[Model Context Protocol](https://modelcontextprotocol.io)** server for the
Hoorbit LLC staffing & project-delivery platform **and its verified cross-border B2B trade marketplace** — 71
tools (56 staffing tools + 14 trade tools + `whoami`) across recruitment, contracts, onboarding, insurance,
payroll, invoicing, compliance, dashboards, support, and cross-border trade,
built on [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk), with real
role-based authn/authz enforced on every call.

**Hoorbit is a facilitator, not an employer of record and not an insurance carrier.** It matches
developers with hiring companies and administers the paperwork/invoicing/insurance-enrollment around that
match for a commission — it does not itself employ developers or issue insurance policies. The working
relationship is between the developer and the hiring company (or that company's own licensed EOR); insurance
is underwritten by a licensed third-party partner. See `FACILITATOR_MODEL` in `src/lib/constants.js` — every
contract/offer/payslip/insurance tool response carries this framing rather than implying direct employment
or direct insurance issuance.

This is a genuine MCP server (`initialize` / `tools/list` / `tools/call` over JSON-RPC 2.0) — not a plain
REST API. It's the real implementation of a set of docs that were uploaded describing a 45–56 "tool"
platform; that version was actually a plain Express REST API with most endpoints unimplemented and a
salary-calculation bug (dividing by an extra 100). Both are fixed here: every tool listed has a real
handler, `calculate_gross_salary`/payroll math is unit-tested to be correct, and — added after an explicit
follow-up request — access control lives in the protocol layer itself, not just in a UI that happens to
hide buttons.

## Auth model

Every tool call requires a bearer token. `tools/list` works without one (so a client can still see the
catalog), but every `tools/call` is denied unless the token resolves to a known user — see
`src/lib/auth.js` for the full model. Three things are enforced, in order, for every single call:

1. **Tool-level allow-list.** Each role has an explicit list of callable tools (deny by default). `pm` is
   the only role granted everything.
2. **Row-level scoping.** Being allowed to call a tool isn't being allowed to call it on anyone's data —
   an `employer` token can only pass their own `client_id` to `get_company_dashboard`, a `developer` token
   can only pass their own `developer_id` almost anywhere one appears, `sign_contract` checks the contract
   actually belongs to the caller, etc.
3. **Field-level redaction.** `get_developer_profile` returns real `bank_account`/`tax_id`/payroll totals
   only to `pm` and to the developer viewing their own record; every other role that's allowed to look
   someone up at all (recruiter/onboarding/support) gets those fields redacted.

Call `whoami` any time to see who you're authenticated as, your role's scope description, and your full
allowed-tool list.

| Role | Token | Can do | Cannot do |
|---|---|---|---|
| Project Manager | `hoorbit_pm_naresh` | Everything | — |
| Employer / Client | `hoorbit_employer_<client_id>` | Post jobs, browse the bench, view **their own** company dashboard/invoices | See other employers' data, financial/billing tools, developer profiles |
| Developer | `hoorbit_developer_<dev_id>` | Apply, sign as themselves, view **their own** profile/payroll/insurance | See other developers' data, payroll/invoicing tools |
| Recruiter | `hoorbit_recruiter_aisha` | Post jobs, search/match/import candidates, contracts, offers | Payroll, invoicing, financial dashboards |
| Onboarding Coordinator | `hoorbit_onboarding_tom` | Checklists, background checks, tax docs, insurance enrollment | Payroll, invoicing, sales/contract signing |
| Support Agent | `hoorbit_support_priya` | Tickets, notifications, redacted profile lookups | Any financial/billing tool |
| Trade Buyer | `hoorbit_buyer_<company_id>` | Verify own company, build RFQs, match suppliers, NDA, negotiate, escrow, deal sheets — **own RFQs/matches only** | Act for another company, sign/negotiate as the supplier, see contacts before mutual NDA |
| Trade Supplier | `hoorbit_supplier_<company_id>` | Verify own company, see **only matches routed to it**, NDA, negotiate, deal sheets | Browse RFQs, trigger matchmaking, configure the buyer's escrow, see contacts before mutual NDA |

`client_id`s and `dev_id`s come from `src/data/clients.json` / `developers.json` (e.g.
`hoorbit_employer_client_001` is HSBC's Amanda Wright, `hoorbit_developer_dev_001` is Rajesh Sharma). Trade
`company_id`s come from `src/data/trade_companies.json` (e.g. `hoorbit_buyer_buy_001` is Rheinwerk Anlagenbau,
Germany; `hoorbit_supplier_sup_001` is Gujarat Precision Steel Tubes, India).
`src/lib/auth.js`'s `listDemoAccounts()` (or the login screen in the sibling Hoorbit Console artifact) has
the full directory.

This is a **static demo token directory**, not a real identity provider — no expiry, no rotation, no
hashing. A production deployment should replace `resolveToken()` with real OAuth/JWT verification; the
allow-list + scoping + redaction logic around it is the part worth keeping as-is.

## Why two transports

MCP servers can run two ways, and this repo ships both:

- **`bin/stdio.js`** — local stdio transport. This is what Claude Code / Claude Desktop use for a
  project-scoped custom MCP server (see `.mcp.json` at the repo root). Zero deployment. A stdio process is
  single-session, so identity is resolved once at startup from the `HOORBIT_TOKEN` env var.
- **`bin/http.js`** / **`api/mcp.js`** — a real MCP **Streamable HTTP** endpoint (`POST /mcp`), run
  stateless (fresh server + transport *per request*) so it deploys cleanly to Vercel or any Node host.
  Identity is resolved from that request's own `Authorization: Bearer <token>` header — real per-call
  auth, not a session trusted forever after one handshake.

Both wrap the same `createServer(user)` factory in `src/server.js` — there is exactly one implementation
of the 70 business tools, not two.

## Quick start (local, via Claude Code)

```bash
cd mcp-server
npm install
```

The repo root's `.mcp.json` points Claude Code at `mcp-server/bin/stdio.js` with `HOORBIT_TOKEN` set to
the PM token by default (full access). Once dependencies are installed, restart Claude Code (or run `/mcp`
to reconnect) and the `hoorbit` server's tools become available directly in this conversation.

To try a different role, edit `.mcp.json`'s `env.HOORBIT_TOKEN` to one of the tokens in the table above and
reconnect — or run it standalone: `HOORBIT_TOKEN=hoorbit_employer_client_001 npm run stdio`.

## Quick start (standalone / HTTP)

```bash
cd mcp-server
npm install
npm start                 # POST http://localhost:3000/mcp
curl -s http://localhost:3000/mcp -X POST \
  -H "Content-Type: application/json" -H "Authorization: Bearer hoorbit_pm_naresh" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Testing

```bash
npm test
```

Runs three end-to-end smoke tests against the **real** server (not mocks). `test/smoke.js` spawns
`bin/stdio.js` as a child process via the SDK's `StdioClientTransport` — exactly how Claude Code would —
authenticated as PM, and drives `tools/list` plus a representative `tools/call` for every module. It then
opens five more connections as different roles/tokens (including no token at all) to verify the
tool-level, row-level, and field-redaction auth rules above actually hold — 100+ assertions total.
`test/smoke_trade.js` drives the whole trade pipeline as five different tokens (PM, a verified buyer, a
routed supplier, a non-routed supplier, an unverified buyer): verification, RFQ interview, compliance
screening, matchmaking, NDA-gated contact release, negotiation, escrow, and the deal sheet, plus every trade
auth boundary (82 assertions). `test/smoke_http.js` does the equivalent (authed + unauthenticated) over the Streamable HTTP transport,
importing `bin/http.js` the way `api/mcp.js` does on Vercel.

## Deploying to Vercel

```bash
cd mcp-server
vercel deploy
```

`vercel.json` routes everything to `api/mcp.js`, so the deployed endpoint is `POST https://<your-app>.vercel.app/mcp`.
Every request needs an `Authorization: Bearer <token>` header — see the auth table above.

Register that URL as a custom MCP connector wherever your Claude client supports remote MCP servers.
Note: Vercel's filesystem is read-only outside `/tmp`, so on Vercel the JSON "database" lives in
`/tmp/hoorbit-database` and resets on cold start — this demo has no real persistence layer. Swap
`src/db.js` for a real database, and `src/lib/auth.js`'s token directory for a real identity provider,
before using this for anything beyond a demo.

## Data model

Plain JSON files, seeded from `src/data/*.json` into a runtime `database/` directory (gitignored) on
first run — `clients`, `developers`, `projects`, `candidates`, `interviews`, `contracts`, `onboarding`,
`payroll`, `invoices`, `insurance`, `compliance`, `audit_trail`, `tickets`, plus the trade collections
`trade_companies`, `trade_rfqs`, `trade_matches`, `trade_deals`. Every mutating tool call
appends an `audit_trail` entry under the real authenticated actor's name (read it back with the
`audit_trail` tool). `npm run reset-db` restores the seed data.

The same underlying business (Hoorbit LLC, the same clients/developers/projects) is also modeled in the
`Hoorbit Console` artifact shipped alongside this repo — that's a client-side React demo UI with its own
in-browser state and its own (UI-level) role-based login; this MCP server is the real, callable-by-an-agent
backend for the same story, with the equivalent role boundary enforced server-side instead.

## The 70 business tools (+ `whoami`)

| Module | Tools |
|---|---|
| Recruitment & Sourcing (8) | `post_job`, `search_developers`, `apply_for_job`, `enable_auto_apply`, `get_match_score`, `get_developer_profile`, `bulk_import_developers`, `create_candidate_pipeline` |
| Contract & Legal (7) | `generate_contract`, `add_contract_conditions`, `sign_contract`, `verify_contract_signatures`, `store_contract_archive`, `generate_amendments`, `calculate_severance` |
| Onboarding & HR (6) | `create_onboarding_checklist`, `send_welcome_packet`, `verify_background_check`, `setup_tax_withholding`, `create_employee_record`, `generate_offer_letter` |
| Insurance & Benefits (6) | `verify_insurance_eligibility`, `generate_insurance_quotes`, `enroll_in_insurance`, `manage_benefits_package`, `generate_insurance_coverage_letter`, `track_insurance_claims` |
| Payroll & Compensation (7) | `calculate_gross_salary`, `calculate_taxes`, `calculate_insurance_deductions`, `calculate_net_pay`, `generate_pay_stub`, `process_payroll`, `generate_w2_at_year_end` |
| Invoicing & Transactions (8) | `generate_invoice_to_company`, `itemize_invoice_costs`, `send_invoice_to_company`, `track_payment_status`, `record_payment_received`, `calculate_commission_breakdown`, `process_bank_transfer`, `generate_financial_reports` |
| Compliance & Legal (5) | `verify_labor_law_compliance`, `generate_compliance_report`, `store_compliance_records`, `audit_trail`, `data_security_encryption` |
| Dashboards & Analytics (6) | `get_company_dashboard`, `get_developer_dashboard`, `get_admin_dashboard`, `generate_analytics_report`, `export_data_csv`, `generate_business_intelligence` |
| Support & Communication (3) | `send_notification`, `create_support_ticket`, `generate_dispute_resolution` |
| Cross-Border Trade (14) | `verify_trade_business`, `suggest_hs_code`, `screen_trade_compliance`, `get_trade_documents`, `build_rfq`, `match_suppliers`, `list_trade_matches`, `sign_platform_nda`, `get_match_contact`, `normalize_trade_message`, `submit_counter_offer`, `recommend_inspection`, `create_escrow_milestones`, `generate_deal_sheet` |
| Meta (1) | `whoami` |

## Cross-border B2B trade module

A verified trade marketplace built to avoid the failure modes of directory platforms such as IndiaMART.
Every rule below is enforced by the server, not left to a prompt. The operating brief for the agent ships as
the MCP prompt **`b2b_trade_engine`** (`src/prompts/trade.js`), and it maps each workflow to the tool that
enforces it.

| Principle | How it's enforced |
|---|---|
| **No lead dumping** | `match_suppliers` routes an RFQ to a curated cohort (default 3, lifetime cap 5 per RFQ). Suppliers can't browse RFQs: `list_trade_matches` and the `rfq_id` scope check only show a supplier the matches routed to it. |
| **Merit-based ranking** | Hard gates: verification, sanctions, HS capability, destination-mandated certifications, MOQ. Score: operational capacity 30, export history 30, port proximity 15, certification fit 15, price fit 10. `subscription_tier` has **zero weight**, and every breakdown shows this. |
| **Zero-trust verification** | `verify_trade_business` checks registry-number format per scheme (GSTIN, USCC, EU VAT, EIN, SSM …), sanctions and restricted-party screening, trade history, fulfilment performance and bank-account ownership. Only `verified` companies can post RFQs, be matched, sign NDAs or negotiate. |
| **High-intent RFQs** | `build_rfq` works as an interview. It saves a draft and returns follow-up questions until every mandatory field is present: measurable specs, HS code, quantity, target price, certifications, Incoterm + named place, destination and deadline. Destination-mandated certifications are added automatically. |
| **Compliance first** | `screen_trade_compliance` covers comprehensive embargoes (blocked), heightened-risk countries, dual-use keywords (EU 2021/821 / EAR), end-use catch-all, arms/explosives/nuclear (blocked), UN dangerous goods, the EU Art. 12g "no-Russia" diversion risk, UFLPA, CBAM, EUDR, and FDA/CE/UKCA/BIS/CDSCO/MOHAP/CCC rules. `get_trade_documents` builds the document set and the Incoterms® 2020 obligations. |
| **No disintermediation** | Contacts appear as `[withheld …]` everywhere until both parties call `sign_platform_nda`. After that, `get_match_contact` releases only the *counterparty's* contact, and each release is audit-logged. `normalize_trade_message` strips emails, phones and links, and flags WhatsApp/WeChat/direct-payment requests. |
| **Escrow + inspection** | `create_escrow_milestones` sets up the default 30% deposit and 70% balance, released only when an independent PSI PASS report is uploaded by the inspector. It also covers FX exposure for both sides and failure/dispute rules. `recommend_inspection` gives ISO 2859-1 Level II AQL plans (0 / 2.5 / 4.0), PPI/DUPRO/PSI/CLS stages and lab tests. |
| **Structured negotiation** | `submit_counter_offer` records dated, comparable rounds in the Standardized B2B Counter-Offer Template. It flags vague terms ("approx", "ASAP", "best price") and aggressive terms ("last price") and forces payment terms into escrow. `accept` locks the agreed terms. |
| **Localization** | `normalize_trade_message` returns the sanitized text plus `protected_terms` (Incoterms, HS codes, standards, grades, units, tolerances, amounts). The calling agent must keep these verbatim when it translates. |
| **Deal sheet** | `generate_deal_sheet` renders the exact **Standardized B2B Deal Sheet** format from agreed terms, escrow and the inspection plan. |
| **Evasion refusal** | Requests to under-invoice, misdeclare, fake origin or split shipments to dodge duty are refused (`refused: true`) with the compliance rules restated. The legitimate options (FTA origin, drawback, bonded warehousing, advance rulings) are named instead. |

The HS table, compliance rules and registry checks are a **curated, illustrative rule set**. HS codes are
6-digit headings, registry checks validate format only, and the restricted-party list is a demo stand-in for
OFAC SDN / EU / UK / BIS lists. Real use needs live registry and screening APIs, national tariff data, and a
licensed customs broker / trade-compliance officer. Every trade response carries this disclaimer.

## What this is not

Every document- or money-shaped tool response includes a `disclaimer` field — surface it, don't drop it.
Concretely, this server:

- **Does not send real email**, move real money, or call a real bank — every "send"/"transfer" tool
  simulates and logs the action against the local JSON database only.
- **Does not produce legally valid documents.** Offer letters, staffing agreements, severance
  calculations, and compliance checklists are illustrative templates, not reviewed legal/tax/payroll
  instruments. A real deployment needs licensed counsel and compliance review per jurisdiction —
  including Delaware entity requirements and, for Malaysia-linked payment flows, Bank Negara Malaysia's
  RMiT framework.
- **Is not an employer and not an insurer.** Hoorbit facilitates the match and administers paperwork for a
  commission; it does not employ developers directly (that relationship is with the hiring company or its
  EOR) and does not underwrite insurance (that's a licensed third-party partner). Every relevant tool's
  output says this explicitly — don't let a summary drop it.
- **Auth is real but static.** The tool-level/row-level/field-level enforcement described above genuinely
  runs on every call — it's not decorative. What's *not* real is the identity provider behind it: static
  demo tokens with no expiry/rotation/hashing, checked in to the seed data. Swap `resolveToken()` for a
  real IdP before this leaves demo status.

## Copyright

© 2026 Hoorbit LLC. All rights reserved. [www.hoorbit.com](https://www.hoorbit.com)

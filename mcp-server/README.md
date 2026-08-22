# Hoorbit Enterprise MCP

A real, protocol-compliant **[Model Context Protocol](https://modelcontextprotocol.io)** server for the
Hoorbit LLC staffing & project-delivery platform — 57 tools (56 business tools + `whoami`) across
recruitment, contracts, onboarding, insurance, payroll, invoicing, compliance, dashboards, and support,
built on [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk), with real
role-based authn/authz enforced on every call.

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

`client_id`s and `dev_id`s come from `src/data/clients.json` / `developers.json` (e.g.
`hoorbit_employer_client_001` is HSBC's Amanda Wright, `hoorbit_developer_dev_001` is Rajesh Sharma).
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
of the 56 business tools, not two.

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

Runs two end-to-end smoke tests against the **real** server (not mocks). `test/smoke.js` spawns
`bin/stdio.js` as a child process via the SDK's `StdioClientTransport` — exactly how Claude Code would —
authenticated as PM, and drives `tools/list` plus a representative `tools/call` for every module. It then
opens five more connections as different roles/tokens (including no token at all) to verify the
tool-level, row-level, and field-redaction auth rules above actually hold — 100+ assertions total.
`test/smoke_http.js` does the equivalent (authed + unauthenticated) over the Streamable HTTP transport,
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
`payroll`, `invoices`, `insurance`, `compliance`, `audit_trail`, `tickets`. Every mutating tool call
appends an `audit_trail` entry under the real authenticated actor's name (read it back with the
`audit_trail` tool). `npm run reset-db` restores the seed data.

The same underlying business (Hoorbit LLC, the same clients/developers/projects) is also modeled in the
`Hoorbit Console` artifact shipped alongside this repo — that's a client-side React demo UI with its own
in-browser state and its own (UI-level) role-based login; this MCP server is the real, callable-by-an-agent
backend for the same story, with the equivalent role boundary enforced server-side instead.

## The 56 business tools (+ `whoami`)

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
| Meta (1) | `whoami` |

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
- **Auth is real but static.** The tool-level/row-level/field-level enforcement described above genuinely
  runs on every call — it's not decorative. What's *not* real is the identity provider behind it: static
  demo tokens with no expiry/rotation/hashing, checked in to the seed data. Swap `resolveToken()` for a
  real IdP before this leaves demo status.

## Copyright

© 2026 Hoorbit LLC. All rights reserved. [www.hoorbit.com](https://www.hoorbit.com)

# Hoorbit Enterprise MCP

A real, protocol-compliant **[Model Context Protocol](https://modelcontextprotocol.io)** server for the
Hoorbit LLC staffing & project-delivery platform — 56 tools across recruitment, contracts, onboarding,
insurance, payroll, invoicing, compliance, dashboards, and support, built on
[`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk).

This is a genuine MCP server (`initialize` / `tools/list` / `tools/call` over JSON-RPC 2.0) — not a plain
REST API. It's the real implementation of a set of docs that were uploaded describing a 45–56 "tool"
platform; that version was actually a plain Express REST API with most endpoints unimplemented and a
salary-calculation bug (dividing by an extra 100). Both are fixed here: every tool listed has a real
handler, and `calculate_gross_salary`/payroll math is unit-tested to be correct.

## Why two transports

MCP servers can run two ways, and this repo ships both:

- **`bin/stdio.js`** — local stdio transport. This is what Claude Code / Claude Desktop use for a
  project-scoped custom MCP server (see `.mcp.json` at the repo root). Zero deployment, zero auth —
  it just runs as a child process.
- **`bin/http.js`** / **`api/mcp.js`** — a real MCP **Streamable HTTP** endpoint (`POST /mcp`), run
  stateless (fresh server + transport per request) so it deploys cleanly to Vercel or any Node host, and
  can be registered as a remote custom connector.

Both wrap the same `createServer()` factory in `src/server.js` — there is exactly one implementation of
the 56 tools, not two.

## Quick start (local, via Claude Code)

```bash
cd mcp-server
npm install
```

The repo root already has a `.mcp.json` pointing Claude Code at `mcp-server/bin/stdio.js` — once
dependencies are installed, restart Claude Code (or run `/mcp` to reconnect) and the `hoorbit` server's
56 tools become available directly in this conversation.

## Quick start (standalone / HTTP)

```bash
cd mcp-server
npm install
npm start                 # POST http://localhost:3000/mcp
```

## Testing

```bash
npm test
```

Runs two end-to-end smoke tests against the **real** server (not mocks): `test/smoke.js` spawns
`bin/stdio.js` as a child process via the SDK's `StdioClientTransport` — exactly how Claude Code would —
and drives it through `tools/list` plus a representative `tools/call` for every module (87 assertions,
including that the salary bug is actually fixed and that bad input returns `isError`). `test/smoke_http.js`
does the same over the Streamable HTTP transport, importing `bin/http.js` the way `api/mcp.js` does on
Vercel.

## Deploying to Vercel

```bash
cd mcp-server
vercel deploy
```

`vercel.json` routes everything to `api/mcp.js`, so the deployed endpoint is `POST https://<your-app>.vercel.app/mcp`.

Register that URL as a custom MCP connector wherever your Claude client supports remote MCP servers.
Note: Vercel's filesystem is read-only outside `/tmp`, so on Vercel the JSON "database" lives in
`/tmp/hoorbit-database` and resets on cold start — this demo has no real persistence layer. Swap
`src/db.js` for a real database before using this for anything beyond a demo.

## Data model

Plain JSON files, seeded from `src/data/*.json` into a runtime `database/` directory (gitignored) on
first run — `clients`, `developers`, `projects`, `candidates`, `interviews`, `contracts`, `onboarding`,
`payroll`, `invoices`, `insurance`, `compliance`, `audit_trail`, `tickets`. Every mutating tool call
appends an `audit_trail` entry (read it back with the `audit_trail` tool). `npm run reset-db` restores
the seed data.

The same underlying business (Hoorbit LLC, the same clients/developers/projects) is also modeled in the
`Hoorbit Console` artifact shipped alongside this repo — that's a client-side React demo UI with its own
in-browser state; this MCP server is the real, callable-by-an-agent backend for the same story.

## The 56 tools

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
- **Has no access control of its own.** Any MCP client connected to this server can call any of the 56
  tools — there's no per-role permission boundary inside the protocol layer (unlike the Hoorbit Console
  artifact, which does model role-based access for a human UI). A production version would need real
  authn/authz in front of this server.

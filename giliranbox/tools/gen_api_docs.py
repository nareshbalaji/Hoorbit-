#!/usr/bin/env python3
"""Generates the RPC reference table in docs/API.md from the live schema (database `gb`, see supabase/tests/run.sh).
Run: python3 tools/gen_api_docs.py > docs/API_RPC.md"""
import subprocess

DESC = {
 # customer
 'home_feed': ('customer', 'ONE request for the home screen: enabled categories, promos, book-again. ~1 KB.'),
 'create_job': ('customer', 'Create a booking of any type (instant / scheduled / quote; scrap items via `p_scrap`). Validates category enabled + region enabled, stores the exact address in `job_private`, snaps public location to ~500 m, then dispatches offers. Errors: `auth_required category_unavailable area_not_served bad_schedule photos_required scrap_items_required`.'),
 'accept_quote': ('customer', 'Pick one of up to 3 quotes; locks price, rejects the others. Errors: `quote_gone not_allowed`.'),
 'submit_review': ('customer', 'Rate (1-5) a DONE job, optional tip. One review per job.'),
 'report_problem': ('both', 'Report a problem within 7 days of completion/cancellation. Error `report_window_closed`.'),
 'send_sos': ('both', 'Emergency alert with one-shot location; appears in the admin SOS list.'),
 'repeat_job': ('customer', 'Repeat a DONE job every N days. `p_auto_book=true` (weekly cleaning): the sweep creates + dispatches the next scheduled job. `false` (aircond every 120 days): customer gets a reminder push instead.'),
 'my_addresses': ('customer', 'Saved addresses as lat/lng (max 20).'),
 'add_address': ('customer', 'Save an address pin.'),
 'job_contact': ('both', 'Exact address + phone of a job. Returns rows only for the customer, or for the assigned provider (until 7 days after completion). Otherwise empty.'),
 'nearby_providers': ('customer', 'Public provider cards (name, rating, distance, from-price) within 30 km, nearest first.'),
 'nearby_shops': ('customer', 'Open queue shops with live waiting count and estimated wait; ordered by distance when lat/lng given. Max 20 per call; `p_offset` for paging.'),
 'join_queue': ('customer', 'Take a ticket (idempotent: returns the existing active ticket). Error `shop_closed`.'),
 'cancel_ticket': ('customer', 'Leave the queue.'),
 'ticket_position': ('customer', '`{number,status,ahead,wait_secs,serving}` for the caller\'s own ticket.'),
 'delete_my_account': ('both', 'PDPA erasure: deletes addresses, tokens, exact job addresses; anonymises profile and chat; disables sign-in. Job rows are kept anonymised for accounting.'),
 # provider
 'become_provider': ('customer→provider', 'Create provider profile (status `pending`). Requires PDPA consent. Admin must approve.'),
 'set_online': ('provider', 'Go online/offline with a single position fix. Error `not_approved_provider`.'),
 'accept_offer': ('provider', 'First-to-accept wins (atomic UPDATE). Errors: `offer_expired already_taken not_approved_provider`.'),
 'decline_offer': ('provider', 'Decline an offer.'),
 'submit_quote': ('provider', 'Send/update a quote (max 3 quotes per job, DB-enforced). Errors `not_quotable quote_limit`.'),
 'set_job_status': ('both', 'Provider: accepted→on_the_way→arrived→in_progress→done. Either party may cancel before in_progress. Errors: `bad_transition price_required use_complete_scrap not_allowed`. On `done`: commission computed, tracking row deleted.'),
 'set_final_price': ('provider', 'Set final price (sen) while arrived/in_progress.'),
 'complete_scrap': ('provider', 'Enter actual kg per item; payout = Σ round(kg × per-kg rate); marks job done. Returns payout in sen.'),
 'ping_location': ('provider', 'Live location for an ACTIVE job only (accepted/on_the_way/arrived); server throttles to 1 write / 4 s. Error `not_active`.'),
 'provider_earnings': ('provider', '`{jobs,gross,commission,tips,scrap_payouts,net}` for the last N days.'),
 # queue staff
 'queue_next': ('shop staff', 'NEXT: finishes the current ticket (updates avg service time) and calls the next waiting number.'),
 'queue_recall': ('shop staff', 'RECALL: re-announces the current number (re-triggers push + TV).'),
 'queue_skip': ('shop staff', 'SKIP: marks the current number skipped and calls the next.'),
 'queue_snapshot': ('shop staff / kiosk', '`{serving,waiting,wait_secs,open}` for a shop. Contains no personal data.'),
 'kiosk_pair_claim': ('shop staff', 'Staff app claims a kiosk pairing code (from the QR) for a shop. Error `bad_code`.'),
 # kiosk
 'kiosk_pair_start': ('kiosk (anon)', 'Pi asks for a 10-char pairing code (valid 10 min); shows it as QR `giliranbox://pair?code=...`.'),
 'kiosk_pair_poll': ('kiosk (anon)', 'Returns `{status: waiting|expired|paired, token?, shop_id?}`; the device token is returned ONCE.'),
 'kiosk_create_ticket': ('kiosk (token)', 'Online ticket creation; idempotent by `p_client_id`.'),
 'kiosk_reserve_block': ('kiosk (token)', 'Reserve up to 200 consecutive numbers for offline issuing. `{first,last,day}`.'),
 'kiosk_sync': ('kiosk (token)', 'Replay locally-issued tickets/status changes; idempotent by `client_id`.'),
 'kiosk_call_next': ('kiosk (token)', 'Same as NEXT, server-authoritative.'),
 'kiosk_recall': ('kiosk (token)', 'Same as RECALL.'),
 'kiosk_snapshot': ('kiosk (token)', 'Same as `queue_snapshot` for the paired shop.'),
 # admin
 'admin_set_provider_status': ('admin', 'approve / reject / suspend. Approval fails with `license_missing` unless every licence required by the provider\'s categories (e.g. electrical competency, pest control) has an approved document.'),
 'demand_heatmap': ('admin', '1 km grid of job counts for the last N days (+ category).'),
 'admin_sos': ('admin', 'Open SOS alerts with name, phone, coordinates.'),
}
ORDER = ['customer', 'both', 'customer→provider', 'provider', 'shop staff', 'shop staff / kiosk', 'kiosk (anon)', 'kiosk (token)', 'admin']

q = """select p.proname, pg_get_function_arguments(p.oid), pg_get_function_result(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype
  and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  and has_function_privilege('authenticated', p.oid, 'execute') order by 1"""
rows = [r.split('|') for r in subprocess.run(['su', 'postgres', '-c', "psql -X -d gb -At -F '|' -c \"%s\"" % q.replace('"', '\\"')], capture_output=True, text=True, check=True).stdout.strip().splitlines()]
sigs = {r[0]: (r[1], r[2]) for r in rows}
print('# RPC reference (generated by `tools/gen_api_docs.py` from the live schema)\n')
print('Call with `POST {SUPABASE_URL}/rest/v1/rpc/<name>`, JSON body = named parameters, headers `apikey: <anon key>` and `Authorization: Bearer <user JWT>` (kiosk/anon functions: anon key only). Errors come back as HTTP 400 with `{"message":"<code>"}`.\n')
by = {}
for name, (who, d) in DESC.items():
    by.setdefault(who, []).append(name)
missing = [n for n in sigs if n not in DESC and n not in ('can_see_job', 'is_participant', 'is_admin', 'is_shop_staff', 'me_provider', 'region_for', 'cancel_ticket', 'kl_today', 'pt', 'snap_area') and not n.startswith('_') and not n.startswith('t_')]
for who in ORDER:
    if who not in by: continue
    print(f'## {who}\n\n| Function | Parameters | Returns | What it does |\n|---|---|---|---|')
    for n in by[who]:
        if n not in sigs: raise SystemExit(f'documented function missing from schema: {n}')
        a, r = sigs[n]
        print(f'| `{n}` | `{a or "-"}` | `{r}` | {DESC[n][1]} |')
    print()
if missing:
    raise SystemExit('undocumented public functions: %s' % missing)

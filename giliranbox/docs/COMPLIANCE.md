# Safety & compliance notes

> This is an engineering checklist, **not legal advice**. Have a Malaysian lawyer review the privacy notice and terms before launch.

## PDPA 2010 (Malaysia)
| Requirement | Implementation |
|---|---|
| Consent at signup | Login screen blocks "Send OTP" until the consent box is ticked; `profiles.pdpa_consent_at` + `pdpa_version` stored; `become_provider` re-checks it. |
| Privacy policy | Link on the login screen and in Account (`PRIVACY_URL`). You must publish the policy (what is collected: phone, name, addresses, job photos, provider documents, location during jobs; purposes; retention; who sees what; contact for access/correction requests; cross-border transfer notice — Supabase Singapore, Firebase). |
| Data minimisation | Provider `ic_last4` only (no full IC stored; real IC verification is a placeholder). Photos compressed to ≤ 300 KB. Customer phone + exact address live in `job_private` and are visible to the provider only **after** acceptance and for 7 days after completion. Public job rows carry a ~500 m-snapped point. |
| Location | Provider location is collected only during an active job (accepted → arrived), stops when the job is in progress/done/cancelled; idle providers give a single fix on going online / app resume. No background location otherwise. |
| Right to deletion | Account → *Delete my account* → `delete_my_account()`: erases addresses, device tokens, exact job addresses; anonymises name/phone/photo/chat; disables sign-in. Job rows remain, anonymised, for accounting/dispute records — set your retention period and add a purge job accordingly. |
| Access / correction | Name and language editable in-app; other requests via your published contact. |
| Security | RLS everywhere, column-level grants, private storage buckets with signed URLs, hashed kiosk tokens, HTTPS only. |

## Safety
* **SOS** on every live job screen (customer and provider): one-shot location to `sos_events` (shown in the admin *SOS* tab) or dial 999.
* **Masked calls** and in-app chat avoid exposing numbers (masking needs the telephony proxy wired in — placeholder).
* Provider licences (electrical competency, pest-control licence, …) are mandatory per category (`categories.license_kind`); an admin cannot approve a provider whose licence document is not approved (`license_missing`).
* **No medical services**: no medical category exists; the shop queue is for counter queuing only; a notice is shown on Login/Account. Review shop onboarding so clinics use the queue only for ticketing.
* Reports within 7 days (`report_problem`) feed the admin *Disputes* tab with refund amounts (payout of refunds is manual until a gateway exists).

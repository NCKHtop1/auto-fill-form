# PandaStudy launch hardening V7

Release marker: `2026-10-20-launch-hardening-v7`.

This release closes four launch blockers found by the independent product-readiness audit without changing the V6 visual direction:

- Replace the stale third-party SheetJS 0.18.5 script with the authoritative SheetJS CDN release 0.20.3.
- Reject impossible calendar dates on the server-side validation path.
- Treat a Google response as confirmed only when the returned page has visible confirmation text and is no longer a respondent form; script/question text cannot impersonate success.
- Require an administrator to record both the exact received amount and a bank transaction reference before a top-up can be approved.

Regression coverage is added for invalid dates, false-positive Google confirmation pages, required bank evidence, admin browser behavior and the production release marker/library source.

No automatic Form retry is introduced. Unknown delivery remains unknown and holds the credit for reconciliation. No pricing, OAuth scope, database schema, package quantity or V6 visual design changes are included.

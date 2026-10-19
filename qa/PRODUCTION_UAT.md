# PandaStudy production UAT — custom domain, OAuth, wallet and manual top-ups

Date prepared: 19/10/2026

This UAT is designed to validate the production cutover without changing the existing six-step Google Forms workflow. The release remains financially gated until every blocking item below passes.

## Safety state before UAT

- Canonical site: `https://www.pandastudy.info.vn`
- Apex: `https://pandastudy.info.vn` redirects to the canonical host.
- Google OAuth callback: `https://www.pandastudy.info.vn/api/auth/callback`
- `BILLING_ENABLED=false`
- `BILLING_TOPUPS_PAUSED=true`
- Do not use a live research Form for write testing.
- Do not approve a top-up unless the money is visible in the real receiving bank account.

## Automated gates

The repository CI must pass all existing checks plus the read-only production smoke:

1. JavaScript syntax.
2. Existing browser smoke.
3. Native unit/backend tests.
4. Real public Google Form read-only parser check.
5. Existing native UI smoke.
6. Mocked QA submission browser flow.
7. Mocked billing/admin browser UAT.
8. Responsive/accessibility audit.
9. PostgreSQL transaction/concurrency tests.
10. Production custom-domain smoke:
   - apex redirect;
   - OAuth `redirect_uri`;
   - required Google Forms scopes retained;
   - billing profile read-only response;
   - QR hidden while top-ups are gated;
   - unauthenticated admin API denied;
   - six-step UI remains intact at 320/390/768/1440 px.

The production smoke creates no order, sends no Google response, approves no payment, and never signs in with a real user.

## Manual UAT A — Google login on custom domain

Use a Google test account allowed by the OAuth consent screen.

1. Open `https://www.pandastudy.info.vn`.
2. Start Google connection.
3. Confirm the browser goes to Google Accounts.
4. Complete consent.
5. Confirm return host is exactly `www.pandastudy.info.vn`.
6. Confirm the application shows the signed-in email.
7. Refresh the page; session must survive.
8. Sign out; refresh; protected actions must require login again.
9. Repeat in a private/incognito window.
10. Verify the legacy `.vercel.app` URL still works as rollback access, but the normal user journey stays on the custom domain.

Pass criteria: no `redirect_uri_mismatch`, no loop between domains, no lost session after callback.

## Manual UAT B — existing core flow regression

Use a duplicate Google Form and synthetic data only.

1. Import Excel/CSV.
2. Import the duplicate Form.
3. Map columns.
4. Build plan.
5. Validate.
6. Export preview CSV.
7. Confirm no Google response was created by preview/export.
8. Reload and repeat basic navigation to Home, App, Blog and FAQ.

Pass criteria: existing content, six-step sequence and semantics are unchanged.

## Manual UAT C — billing readiness with purchases still closed

Before opening purchases:

1. Sign in.
2. Open the wallet.
3. Confirm the UI does not invite a real transfer while billing is disabled/paused.
4. Open `/admin-topups.html` with a non-admin account: no order data or approval action may be exposed.
5. Open the same page with an authorized admin account: the page may load, but no real payment should be approved during this gate.

Pass criteria: no payment can accidentally be initiated while release flags are closed.

## Manual UAT D — database and ledger

Before any real-money UAT:

1. Confirm migration version 1 exists in the production PostgreSQL database.
2. Confirm tables `ps_billing_customers`, `ps_billing_orders`, `ps_billing_bank_payments`, `ps_billing_operations`, `ps_billing_ledger`, `ps_billing_admin_actions`, and `ps_billing_outbox` exist.
3. Confirm there are no unexpected production test balances.
4. Confirm the database has backup/recovery appropriate for the intended launch.

Pass criteria: schema is ready and no synthetic credit is treated as purchased credit.

## Manual UAT E — controlled real-money top-up

Only run after email/sender, database, admin access and bank details are verified.

1. Set `BILLING_ENABLED=true` but keep `BILLING_TOPUPS_PAUSED=false` only for the controlled UAT window.
2. Sign in as a buyer.
3. Create the smallest agreed test order.
4. Verify bank name, account holder, account number, exact amount and unique memo.
5. Scan the QR with a banking app and verify the displayed recipient before sending.
6. Transfer the exact amount with the exact memo.
7. Click “I have transferred”.
8. Confirm order becomes `pending_review`; credits must still be unchanged.
9. Admin checks the real bank statement/app, enters the real bank reference and exact amount, then approves.
10. Confirm order becomes `approved` and credits increase exactly once.
11. Repeat the approve request or refresh/re-submit the admin form; credits must not increase again.
12. Reuse the same bank reference on a different order; approval must be rejected.

Pass criteria: only a verified real transfer changes the ledger, exactly once.

## Manual UAT F — usage-credit lifecycle

Use a duplicate Form with synthetic data.

1. Confirm the buyer has at least two credits.
2. Send one authorized test row.
3. If Google confirms receipt, available credit falls by one and reserved returns to zero.
4. Simulate/observe a definitely-not-sent validation/network case before POST; the reserved credit must be released.
5. For an ambiguous post-dispatch result, the credit must remain reserved/unknown; the application must not automatically resend.
6. Admin resolves the unknown operation using evidence, selecting consume or release.
7. Confirm the resolution is logged and does not trigger another Google submission.

Pass criteria: no duplicate dispatch and no double credit consumption.

## Manual UAT G — notification path

1. Confirm `RESEND_API_KEY` and `BILLING_EMAIL_FROM` are configured with a verified sender.
2. Buyer submits a paid order.
3. Confirm all configured notification recipients receive the message, including spam-folder check.
4. Force one provider failure in UAT if practical, then use retry.
5. Confirm retry does not duplicate the order or change credit balance.

Pass criteria: email is notification only; it never approves money.

## Release decision

GO only when:

- all GitHub checks are green;
- custom-domain OAuth manual login passes;
- production PostgreSQL schema is verified;
- email sender is verified;
- controlled real-money top-up passes;
- duplicate approval/reference tests pass;
- one-credit Form UAT on a duplicate Form passes;
- there are no unresolved blocking production errors.

After GO, keep `BILLING_TOPUPS_PAUSED` as the operational kill switch for new purchases. Do not use `BILLING_ENABLED=false` as the normal financial rollback after paid credits exist.

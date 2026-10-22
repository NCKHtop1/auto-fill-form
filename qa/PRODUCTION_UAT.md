# PandaStudy production UAT — custom domain, OAuth, wallet and manual top-ups

Date prepared: 19/10/2026. Reconciled: 20/10/2026 (UTC+7), main `612c89121c40bcbd176941ad4323e3386caf1974`.

This UAT is designed to validate the production cutover without changing the existing six-step Google Forms workflow. The release remains financially gated until every applicable blocking item below passes. PR [#12](https://github.com/NCKHtop1/auto-fill-form/pull/12) merged on 18/10 and [#14](https://github.com/NCKHtop1/auto-fill-form/pull/14) on 19/10/2026. Merge is not deployment verification, activation or production UAT evidence. This revision is a source review only; production configuration and payment state remain unverified.

See [BILLING_RELEASE.md](BILLING_RELEASE.md) for the code/operations/owner decision matrix. Email transport is optional in code; verified Google identity email remains mandatory for billing. The owner must choose email-required launch or dashboard-only operations with a named operator and review cadence. No decision means NO-GO, not an implicit waiver. This documentation update does not authorize flag changes, migrations, payments, approvals or Form writes.

## Safety state before UAT

- Canonical site: `https://www.pandastudy.info.vn`
- Apex: `https://pandastudy.info.vn` redirects to the canonical host.
- Google OAuth callback: `https://www.pandastudy.info.vn/api/auth/callback`
- Main application shell is hidden until Google sign-in succeeds.
- Before the first-ever paid launch, keep billing disabled during initial cutover. Inspect deployed flags and whether paid credits already exist first; never disable enforcement once real payments exist. This is a procedure, not a claim about current flags.
- Keep `BILLING_TOPUPS_PAUSED=true` except during a separately authorized controlled UAT window and after GO. Pausing purchases does not stop existing-order review or credit use.
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
   - OAuth requests only `openid email profile`; sensitive Google Forms scopes are absent from ordinary sign-in;
   - unauthenticated billing profile response; authenticated profile can create a customer and grant active promotions even with billing disabled;
   - QR hidden while top-ups are gated;
   - unauthenticated admin API denied;
   - six-step UI remains intact at 320/390/768/1440 px.

The production smoke creates no order, sends no Google response, approves no payment, and never signs in with a real user.

## Manual UAT A — Google login on custom domain

Verify `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APP_SESSION_SECRET` (at least 32 characters), `PUBLIC_SITE_URL`, allowed origin and exact callback without recording secrets. Preview needs its own allowed callback; do not disable deployment protection. Use a normal Google account. Ordinary PandaStudy sign-in should request only basic identity scopes and must not show the Google unverified-app warning.

1. Open `https://www.pandastudy.info.vn`.
2. Confirm only the PandaStudy login screen is visible; the main navigation/workspace must be hidden.
3. Start Google connection.
4. Confirm the browser goes to Google Accounts.
5. Complete consent.
6. Confirm return host is exactly `www.pandastudy.info.vn`.
7. Confirm the main application appears only after the callback succeeds.
8. Confirm the account bar shows email, credit balance, top-up history and logout.
9. Refresh the page; session must survive.
10. Sign out; the login wall must return and the main shell must disappear.
11. Repeat in a private/incognito window.
12. Verify the legacy `.vercel.app` alias maps to the intended deployment if retained for operations; it is not permission to roll back financial enforcement. Normal users stay on the custom domain.

Pass criteria: no `redirect_uri_mismatch`, no unverified-app warning for ordinary login, no loop between domains, no lost session after callback.

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

1. Review the approved promotion policy before signing in: authenticated profile can grant bonuses even with purchases closed.
2. Sign in and open the wallet.
3. Confirm the UI does not invite a real transfer while billing is disabled/paused.
4. Open `/admin-topups.html` with a non-admin account: no order data or approval action may be exposed.
5. Open the same page with an authorized admin account: the page may load, but no real payment should be approved during this gate.

6. Record `/api/billing?action=health` fields: `billingEnabled`, `financialConfigReady`, `missing`, `warnings`, `databaseReachable`, `schemaReady`. Required configuration categories are database, administrators, bank, payment_qr and admin_url; transport, recipients and worker are warnings.
7. Verify API authorization independently of the login wall: Google `sub` and verified email identify the wallet; `BILLING_ADMIN_EMAILS` controls approval, not notification recipients.

Pass criteria: new purchases are unavailable while flags are closed; existing-order reporting/review remains available as designed. HTTP 200/`ok:true` and `configured=true` when billing is disabled do not prove readiness. Health checks only version 1; complete D separately.

## Manual UAT D — database and ledger

Before any real-money UAT:

1. After explicit database-owner authorization and backup, apply `npm run migrate:billing` to the selected database (001 + 002). Verify versions 1 and 2 in `ps_billing_schema_migrations`; APIs do not migrate.
2. Confirm tables `ps_billing_customers`, `ps_billing_orders`, `ps_billing_bank_payments`, `ps_billing_operations`, `ps_billing_ledger`, `ps_billing_admin_actions`, and `ps_billing_outbox` exist.
3. Verify v2 tables `ps_billing_packages`, `ps_billing_promotions`, `ps_billing_promotion_grants`, `ps_billing_config_audit`, order snapshot columns and constraints. Confirm no unexpected test balances; distinguish paid, promotional and synthetic credits.
4. Verify connectivity, read/write permissions, secure connection and backup/restore evidence. Run concurrency/fault-injection tests only in an isolated database/schema.
5. Review migration 002 before execution: it seeds enabled `WELCOME_OCT_2026`, 10 credits, 19/10 23:40 to before 28/10 00:00 UTC+7. Obtain owner approval of catalog/campaign; billing flags do not prevent profile-triggered grants.

Pass criteria: schema is ready and no synthetic credit is treated as purchased credit.

## Manual UAT E — controlled real-money top-up

Only a separately authorized operator may run this after database, OAuth/admin access, bank/QR and owner decisions are verified. Email/sender is required only in email-required mode; dashboard-only mode needs approved monitoring evidence. Record buyer, amount, window and closure plan. Flags do not restrict purchases to the test buyer: approve an access-control plan before opening the window.

1. In the authorized window only, the operator enables enforcement (`BILLING_ENABLED=true`) and opens purchases (`BILLING_TOPUPS_PAUSED=false`) on the intended deployment. This checklist does not execute or authorize that change by itself.
2. Sign in as a buyer.
3. Create the smallest agreed test order.
4. Verify bank name, account holder, account number, exact amount and unique memo.
5. Scan the QR with a banking app and verify the displayed recipient before sending.
6. Transfer the exact amount with the exact memo.
7. Click “I have transferred”.
8. Confirm order becomes `pending_review`; credits must still be unchanged.
9. Admin checks the real bank statement/app and exact amount/memo. The API requires `confirmedBankTransfer=true`; amount/reference are optional in code. Operational policy is to record actual amount and real reference where available. If no reference exists, follow the owner-approved alternative reconciliation procedure; never fabricate a reference.
10. Confirm order becomes `approved` and credits increase exactly once.
11. Repeat the approve request or refresh/re-submit the admin form; credits must not increase again.
12. Verify supplied-reference reuse is rejected using isolated test orders/environment. Do not approve another live order without its own payment. If reference is omitted, the code generates an order-specific manual reference which cannot detect reuse of one real payment across different orders.
13. Close the UAT purchase window with `BILLING_TOPUPS_PAUSED=true` pending GO. Keep enforcement enabled after any real payment.

Pass criteria: admin identity and bank-confirmation checkbox are mandatory; supplied amount must match and supplied reference cannot be reused on the receiving account; ledger changes once per order. Checkbox is not bank evidence. The owner must accept the manual-reference limitation or require a separate API change before GO; do not claim unconditional cross-order duplicate-payment protection.

## Manual UAT F — usage-credit lifecycle

Use a duplicate Form with synthetic data.

1. Confirm the buyer has at least two credits.
2. Send one authorized test row.
3. If Google confirms receipt, available credit falls by one and reserved returns to zero.
4. In isolated authorized UAT, simulate/observe a definitely-not-sent validation/network case before POST; the reserved credit must be released.
5. For an ambiguous post-dispatch result, the credit must remain reserved/unknown; the application must not automatically resend.
6. Admin resolves the unknown operation using evidence, selecting consume or release.
7. Confirm the resolution is logged and does not trigger another Google submission.

Pass criteria: no duplicate dispatch and no double credit consumption.

## Manual UAT G — notification path

Email is optional and never part of financial authorization.

1. If `RESEND_API_KEY` and `BILLING_EMAIL_FROM` are configured, verify the sender.
2. Buyer submits a paid order.
3. When email is enabled, confirm configured recipients receive the message, including spam-folder check.
4. When email is disabled, confirm the order still reaches `pending_review` and is visible in the admin dashboard.
5. In isolated UAT, force provider failure and retry; do not break production provider configuration.
6. Confirm retry does not duplicate the order or change credit balance.

7. In email-required mode, verify worker authorization succeeds and missing/wrong secret fails. The workflow targets `auto-fill-form-liard.vercel.app`; verify it maps to the intended deployment/database. Enable `PANDASTUDY_BILLING_LIVE` only with evidence and explicit authorization.
8. In dashboard-only mode, record delivery/worker checks as N/A with owner approval, named dashboard operator, review cadence and backlog/escalation procedure. No valid recipients means no recipient outbox; later configuration does not prove older orders were notified.

Pass criteria: email never approves money or grants credits. Email-required mode needs verified sender, actual inbox/spam receipt for all configured recipients, retry and worker evidence. Dashboard-only mode needs pending-review visibility and approved monitoring. Missing email alone is not a financial code blocker.

## Manual UAT H — package pricing and revenue reporting

1. Snapshot the owner-approved deployed catalog. Defaults: 20/10,000; 100/45,000; 250/110,000; 500/200,000 VND, list prices 10,000/50,000/125,000/250,000 and discounts 0/10/12/20%. Database catalog can be edited; validate approved live values, not a fixed assumption.
2. With unchanged defaults, confirm Popular is highlighted and shows 10% savings; otherwise verify approved featured/badge/discount values.
3. Select each package and verify the transfer total before creating an order.
4. In isolated UAT, default Popular must charge 45,000 VND and credit 100. For customized catalog use approved snapshot values. Production transfer/approval follows E only; do not make live purchases for every package.
5. Enter a custom quantity and confirm it uses 500 VND per credit with no package discount.
6. In admin, verify package name, advertised credits, list price, discount and final amount are visible on the order.
7. Approve a controlled order and verify the current-month revenue card increases by the exact approved amount, credits sold by the advertised package credits, and package performance by one approved order.
8. Verify the 12-month table is grouped in Asia/Ho_Chi_Minh and pending-review amounts are not counted as revenue.

Pass criteria: package prices are enforced server-side, credited quantities match the advertised bundle, and only approved orders contribute to revenue.


## Manual UAT I — admin-only blog and managed campaigns

Use isolated UAT for catalog/campaign changes, repeated grants and expiry tests. On production inspect approved settings and existing audit evidence; do not edit live prices, grant synthetic balances or publish blog posts just to complete tests.

1. Sign in with a normal non-admin Google account and open Blog.
2. Confirm the “Viết bài mới” action is not visible. Manually navigating to `#blog-viet-bai` must return to the Blog list with an admin-only message.
3. Sign in with an email listed in `BILLING_ADMIN_EMAILS`; confirm “Viết bài mới” is visible and the editor opens. GitHub remains the final publication confirmation layer.
4. During the active `WELCOME_OCT_2026` window (19/10/2026 23:40 through 27/10/2026 23:59:59, Asia/Ho_Chi_Minh), sign in with an account that has not received the campaign.
5. Confirm exactly 10 credits are added once and the user sees the experience-credit message. Refresh/sign in again and confirm the balance does not gain another 10.
6. Open the admin page and confirm the user card reports promotional credits separately from paid credits.
7. In “Gói nạp & ưu đãi”, edit a package name/badge/credits/price/list price/order/featured flag, save it, and verify the user top-up dialog reflects the new catalog.
8. Create an order from that package, then edit the package again. Confirm the existing order retains the original package name, credits, amount and list price snapshot.
9. Create or edit a timed promotion, including start/end, credit amount and enabled state. Confirm the granted-account count changes only when eligible users receive it.
10. Confirm the commerce audit table records the admin email, target and timestamp of package/promotion changes.

Pass criteria: non-admins cannot enter the writer UI; package and promotion controls are admin-only; bonuses are granted at most once per account per campaign; existing paid orders never change when catalog pricing changes.

## Release decision and evidence record

**Source-review status: production gates NOT VERIFIED; insufficient evidence for GO.** This does not assert production billing is off.

GO requires:
- passing CI tied to the exact release SHA; mocks and isolated PostgreSQL are regression evidence only;
- verified deployment/alias/flags, real custom-domain OAuth, buyer/admin/non-admin permissions and core regression;
- production database versions 1 and 2, commerce schema, connectivity and backup/restore evidence;
- approved bank/QR, separately authorized real-money UAT, once-only crediting and supplied-reference rejection evidence;
- credit lifecycle on an authorized duplicate Form; ambiguous results held for audited reconciliation without resend;
- approved catalog, immutable order snapshots, revenue reporting and campaign policy;
- recorded email-required or dashboard-only decision with applicable G evidence;
- owner decision on optional amount/reference limitations, named operator, incident plan and no unresolved blockers.

Missing required evidence or decisions means NO-GO for new purchases. After real payments exist, use `BILLING_TOPUPS_PAUSED=true`; never disable enforcement, roll back to free submission, delete ledger/balances or replay ambiguous Google requests.

Record restricted evidence links and redacted IDs; never commit secrets, bank statements or personal data:

| Gate | Status at source review | Evidence / SHA / deployment | Operator / timestamp |
|---|---|---|---|
| CI and isolated regressions | Not rerun | Pending | Pending |
| A–C: OAuth, core, flags/roles | Not verified | Pending | Pending |
| D: schema 001/002, restore, campaign | Not verified | Pending | Pending |
| E: authorized real-money UAT | Not performed | Pending | Pending |
| F: duplicate-Form lifecycle | Not performed | Pending | Pending |
| G: email mode and evidence | Owner decision pending | Pending | Pending |
| H–I: catalog, snapshots, campaigns | Not verified | Pending | Pending |
| Amount/reference policy | Owner decision pending | Pending | Pending |
| Final GO approval, scope/time | Not approved by this review | Pending | Pending |

PASS requires scoped evidence. N/A requires an approved reason, e.g. delivery checks in dashboard-only mode. Mocked results are never production UAT PASS.

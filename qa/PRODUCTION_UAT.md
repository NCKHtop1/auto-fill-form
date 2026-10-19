# PandaStudy production UAT — custom domain, OAuth, wallet and manual top-ups

Date prepared: 19/10/2026

This UAT is designed to validate the production cutover without changing the existing six-step Google Forms workflow. The release remains financially gated until every blocking item below passes.

## Safety state before UAT

- Canonical site: `https://www.pandastudy.info.vn`
- Apex: `https://pandastudy.info.vn` redirects to the canonical host.
- Google OAuth callback: `https://www.pandastudy.info.vn/api/auth/callback`
- Main application shell is hidden until Google sign-in succeeds.\n- `BILLING_ENABLED=false` during the first production cutover.\n- `BILLING_TOPUPS_PAUSED=true` until database and real-money UAT pass.
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
   - billing profile read-only response;
   - QR hidden while top-ups are gated;
   - unauthenticated admin API denied;
   - six-step UI remains intact at 320/390/768/1440 px.

The production smoke creates no order, sends no Google response, approves no payment, and never signs in with a real user.

## Manual UAT A — Google login on custom domain

Use a normal Google account. Ordinary PandaStudy sign-in should request only basic identity scopes and must not show the Google unverified-app warning.

1. Open `https://www.pandastudy.info.vn`.\n2. Confirm only the PandaStudy login screen is visible; the main navigation/workspace must be hidden.\n3. Start Google connection.
4. Confirm the browser goes to Google Accounts.\n5. Complete consent.\n6. Confirm return host is exactly `www.pandastudy.info.vn`.\n7. Confirm the main application appears only after the callback succeeds.\n8. Confirm the account bar shows email, credit balance, top-up history and logout.\n9. Refresh the page; session must survive.\n10. Sign out; the login wall must return and the main shell must disappear.\n11. Repeat in a private/incognito window.\n12. Verify the legacy `.vercel.app` URL remains rollback access, but the normal user journey stays on the custom domain.

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
9. Admin checks the real bank statement/app. Amount and bank reference are optional audit details; the confirmation checkbox is mandatory before approval.
10. Confirm order becomes `approved` and credits increase exactly once.
11. Repeat the approve request or refresh/re-submit the admin form; credits must not increase again.
12. Reuse the same bank reference on a different order; approval must be rejected.

Pass criteria: only an admin who explicitly ticks the bank-confirmation checkbox can approve; optional amount/reference are validated when supplied; the ledger changes exactly once.

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

Email is optional and never part of financial authorization.\n\n1. If `RESEND_API_KEY` and `BILLING_EMAIL_FROM` are configured, verify the sender.\n2. Buyer submits a paid order.\n3. When email is enabled, confirm configured recipients receive the message, including spam-folder check.\n4. When email is disabled, confirm the order still reaches `pending_review` and is visible in the admin dashboard.\n5. If practical, force one provider failure and retry.\n6. Confirm retry does not duplicate the order or change credit balance.\n\nPass criteria: email is notification only; it never approves money and its absence never grants credits.

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


## Manual UAT H — package pricing and revenue reporting

1. Open the top-up dialog after login and confirm four package cards: 20/10,000; 100/45,000; 250/110,000; 500/200,000 VND.
2. Confirm the Popular package is highlighted and shows 10% savings.
3. Select each package and verify the transfer total before creating an order.
4. Create a Popular order and confirm the order/QR amount is exactly 45,000 VND while approval credits exactly 100.
5. Enter a custom quantity and confirm it uses 500 VND per credit with no package discount.
6. In admin, verify package name, advertised credits, list price, discount and final amount are visible on the order.
7. Approve a controlled order and verify the current-month revenue card increases by the exact approved amount, credits sold by the advertised package credits, and package performance by one approved order.
8. Verify the 12-month table is grouped in Asia/Ho_Chi_Minh and pending-review amounts are not counted as revenue.

Pass criteria: package prices are enforced server-side, credited quantities match the advertised bundle, and only approved orders contribute to revenue.


## Manual UAT I — admin-only blog and managed campaigns

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

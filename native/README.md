# PandaStudy native Vercel application

Production: https://auto-fill-form-liard.vercel.app

## Working features

- Import public Google Forms by the /edit link without Apps Script.
- Preview and validate 50, 100 or another number of rows.
- Download question-by-question CSV. PREVIEW CSV DOES NOT SEND RESPONSES.
- Read a public Google Sheet's row count from a user-supplied Sheet link.
- Authorized QA step 6: send 1 test row into a duplicate Google Form, then the remaining validated rows. Stop on any ambiguous response, compare the count before/after and export a submission report.
- Read the real response count via official Google Forms API after administrator sign-in. The Google Forms API does NOT provide a create-response method.

## Configure Google OAuth in Vercel

In Google Cloud Console, enable the Google Forms API, configure the OAuth consent screen, and create an OAuth Client ID of type Web application.

Authorized JavaScript origin: https://auto-fill-form-liard.vercel.app

Authorized redirect URI: https://auto-fill-form-liard.vercel.app/api/auth/callback

Vercel project: ngochailuong/auto-fill-form. Root Directory: native.

Set these Vercel environment variables for Production (and Preview as needed):

- GOOGLE_CLIENT_ID: OAuth web client ID.
- GOOGLE_CLIENT_SECRET: OAuth client secret.
- APP_SESSION_SECRET: a random secret with at least 32 characters.
- PUBLIC_SITE_URL: https://auto-fill-form-liard.vercel.app
The existing Step 6 API checks Google sign-in, explicit consent and a supported public respondent Form. Legacy `PANDASTUDY_ADMIN_EMAILS`, `PANDASTUDY_TEST_FORM_IDS` and `ENABLE_QA_SUBMISSIONS` helpers are not called by the current submission route; they must not be mistaken for an enforced administrator boundary. Payment approval uses its separate verified `BILLING_ADMIN_EMAILS` role.

Enter secrets directly in Vercel Settings > Environment Variables. Do not paste secrets in chat or GitHub. Redeploy after updating environment variables.

## Workflow

1. Upload Excel/CSV with data you are authorized to handle, or use a duplicate Form with synthetic QA data.
2. Import the Google Form link, map its questions to data.
3. Build the plan (4a), validate the data (4b).
4. Step 5 exports PREVIEW CSV only, not a Google submission.
5. Step 6 requires Google sign-in and consent: provide a link to the response Sheet, send 1 authorized test row, inspect the result, send the remaining rows, and download the submission report. Use a duplicate Form with synthetic data for testing.

Results distinguish page-confirmed, failed and unverified. Google Forms response creation via the public formResponse URL is unofficial and may change. There is no official Forms API response.create endpoint. Never assume a 200 HTTP status implies a response was recorded. There are no automatic retries after ambiguous results.

A difference in the public Sheet's count is evidence of a change to that Sheet, NOT proof that a particular submitted response is included if other users can submit concurrently.

Do not inject synthetic responses into a live study. Only test with a Form COPY, preserving genuine research responses. The user-provided live study Form and Sheet may be used for READ-ONLY verification.

## Quality checks

From the native directory run: npm test ; npm run check

CI browser tests include tests/qa_browser.py (mocked network, no real Google writes).

## Manual bank top-ups and usage credits

The new payment module is disabled by default and preserves the existing six-step flow. It adds a separate wallet modal and `/admin-topups.html`, a PostgreSQL ledger, durable email notifications, and server-side credit enforcement. The fixed price is 500 VND per credit. Approval only adds credits; it never resumes Form submission.

See [the billing deployment and UAT runbook](../qa/BILLING_RELEASE.md) for configuration, evidence, release gates and the incident procedure. Provision the real database and verified email sender before enabling `BILLING_ENABLED`. Apply the migration explicitly with `npm run migrate:billing`; application requests do not run migrations.

Merchant details, the approved QR URL and notification recipients are configured through the environment variables listed in `.env.example`; no real bank account or payment QR is included in this change. The QR asset must be served from the same origin as the application. Notification recipients and payment administrators are configured separately. Missing or invalid required configuration keeps purchases unavailable.

Use `BILLING_TOPUPS_PAUSED=true` to pause purchases after launch while keeping existing balances and approvals usable. Disabling billing enforcement after paid launch would restore the old free submission path and is not a financial rollback.

The GitHub workflow `billing-notifications.yml` retries the durable queue every five minutes after the repository variable `PANDASTUDY_BILLING_LIVE=true` and matching worker secret have been configured. Scheduled Actions may be delayed; an initial bounded delivery attempt happens during the payment report request and administrators can retry from their page.

`tests/billing_browser.py` exercises the wallet/admin UI with simulated APIs. `native/tests/billing-postgres.test.js` runs the real PostgreSQL concurrency gate when `BILLING_TEST_DATABASE_URL` points to an isolated UAT database. It creates and drops only its own random schema.

No Apps Script runtime. FinQuery is never modified.

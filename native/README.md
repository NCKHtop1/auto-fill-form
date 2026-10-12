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
- PANDASTUDY_ADMIN_EMAILS: comma-separated administrator Google email addresses.
- PANDASTUDY_TEST_FORM_IDS: comma-separated IDs of COPIES of forms made for testing.
- ENABLE_QA_SUBMISSIONS: true only after the copy is ready and restrictions are correct.

Enter secrets directly in Vercel Settings > Environment Variables. Do not paste secrets in chat or GitHub. Redeploy after updating environment variables.

## Workflow

1. Upload Excel/CSV with data you are authorized to handle, or use a duplicate Form with synthetic QA data.
2. Import the Google Form link, map its questions to data.
3. Build the plan (4a), validate the data (4b).
4. Step 5 exports PREVIEW CSV only, not a Google submission.
5. Step 6 is admin-only and test-form-only: provide a link to its response Sheet, confirm permission, send 1 test row, inspect the result, send the remaining rows, and download the submission report.

Results distinguish page-confirmed, failed and unverified. Google Forms response creation via the public formResponse URL is unofficial and may change. There is no official Forms API response.create endpoint. Never assume a 200 HTTP status implies a response was recorded. There are no automatic retries after ambiguous results.

A difference in the public Sheet's count is evidence of a change to that Sheet, NOT proof that a particular submitted response is included if other users can submit concurrently.

Do not inject synthetic responses into a live study. Only test with a Form COPY, preserving genuine research responses. The user-provided live study Form and Sheet may be used for READ-ONLY verification.

## Quality checks

From the native directory run: npm test ; npm run check

CI browser tests include tests/qa_browser.py (mocked network, no real Google writes).

No Apps Script runtime. FinQuery is never modified.

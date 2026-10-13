# PandaStudy — QA Test Plan (13/10/2026)

Production baseline: 49a42547a72548418170a3f005b16f35b13bd2b6

Full workbook: PandaStudy_Bo_Test_Cases_UX_UI_2026-10-13.xlsx supplied with QA handoff.
Automated audit: tests/ux_audit.py ; CI: .github/workflows/tests.yml.
Existing regression: tests/native_smoke.py, tests/qa_browser.py, native/tests/*.test.js.

## Severity / release gates

| Level | Meaning | Release gate |
|---|---|---|
| P0 | Security, incorrect real-world writes, data corruption | No-Go |
| P1 | Main functionality, OAuth, valid Form sending or JS crash | No-Go |
| P2 | Major usability, small mobile overflow, misleading help text, missing labels | Must prioritize before wide rollout |
| P3 | Copy, spacing and minor polish | Track in backlog |

## Coverage: 153 test cases

- Navigation, hash routes, browser history, deep links and tab isolation
- Google OAuth: signed in/out, refresh, token expiry, unauthorized Form, wrong Origin
- Form import: valid /edit, public/closed/private, zero questions, unsupported questions
- Excel/CSV/JSON: Unicode, empty, malformed, large files, multiline records
- Mapping: multiple-choice, grid/checkbox grid, Likert, labels, numeric values, Unicode
- 4a/4b: valid/invalid rows, 1/50/100, limits, mapping updates and plan invalidation
- Step 5: CSV export, BOM, formula injection guard
- Step 6: consent, send one, remaining rows, retry uncertainty, duplicate protection
- 6c/6d: before/after totals and report download
- Blog: list/search/filter/article/deep link/editor/local draft
- Accessibility: focus, accessible names, live status, keyboard, contrast
- Responsive: 320,375,390,768,1024,1440 px, overflow, mobile navigation
- Ops/security/performance: Vercel status, error logs, CSRF, rate limits, Web Vitals

## How to run

1. Open a PR; GitHub Actions runs Node tests, read-only live Form smoke, browser tests and tests/ux_audit.py.
2. Browser write requests are always mocked. No production Google Form or Sheet receives test submissions.
3. Each audit generates qa-artifacts/ux_audit.json with cases and evidence and screenshots for desktop/mobile widths.
4. The workflow uploads a temporary GitHub artifact named pandastudy-ux-audit.
5. P0/P1 audit failures fail CI; P2/P3 usability findings remain FAIL/REVIEW for triage, without silently being called PASS.

## Baseline (GitHub Actions run 38336094414)

74 automated cases; 63 PASS, 8 FAIL (all P2), 3 REVIEW.
Identified issues:
- At 320px, horizontal overflow affects home, app, blog and FAQ (17–26px)
- The 5-step overview omits the sixth send/verify stage
- FAQ suggests background scheduling although it is disabled
- Form URL input has a placeholder but lacks a real accessible label

No P0/P1 was discovered in this automated sample. The test suite does not certify real authenticated Form submissions.

## Manual release checks

- Authenticate/reconnect using a real eligible Google account.
- On an authorized COPY of a Form, submit only a test row and verify one new Google response and the exact Sheet count. Never send synthetic data to an active survey.
- Repeat with real Android Chrome/iPhone Safari, zoom 200%, NVDA/VoiceOver, weak network, and Lighthouse.
- Obtain permission to access Vercel production runtime logs and monitor recent 4xx/5xx clusters.

Go when blocking faults and user-facing P2 problems are addressed and manual validations have evidence.

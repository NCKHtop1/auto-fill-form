# PandaStudy UX cohesion V5

## Purpose and evidence

Make the existing Google Form/data workflow feel consistent across sign-in, homepage, account/billing UI and the six-step workspace. Preserve the green cinematic panda artwork and restrained floating motion while improving image clarity, text separation and first-screen hierarchy.

The signed-in site review found a 600px hero rendered about 872px wide, headline/art overlap, a hard-to-read promotion CTA, roughly 308px of header/account/promotion content before the hero, and a mapping helper pointing to the wrong step. These are observations of the previous live version, not claims about the final V5 rendering.

No exact FOMO reference has been verified. The linked earlier ChatGPT conversation was not readable in this session; this brief does not claim to reproduce its decisions. The concrete visual basis is PandaStudy's existing green palette and cinematic panda direction.

## Scope

- Presentation in `native/index.html`, `native/motion-ui.css`, `native/auth-gate.css` and `native/billing.css`; responsive hero assets and limited explanatory copy.
- A defined two-column hero, stacking at 900px and below; clear separation between headline/CTA and artwork.
- Consistent green/ink/soft-background tokens, typography, button hierarchy and focus treatment across auth and billing. The cinematic hero stays dark; the data workspace stays light.
- A more compact account/promotion area that keeps balance, top-up and role-specific actions available.
- Hero body: “Nhập liên kết Form, ghép cột dữ liệu với câu hỏi và kiểm tra trước khi gửi.” The primary CTA still leads to `#app`; help leads to `#how`.

This is not a product or billing redesign. Preserve routes, control IDs, OAuth scopes, access checks, Form import/mapping/generation/submission/reconciliation, pricing, credit accounting, payment approval, blog publishing and database behavior. Final diff review must verify this boundary; reading a source snapshot alone does not prove it.

## Image budget: V3 supersession

For this release, this section supersedes the **600×338 production image and universal <60KB hero gate** in `FRONTEND_CINEMATIC_V3_BRIEF.md` sections 4/7 and the matching image checks in `qa/UAT_CINEMATIC_V3.md`. Other functional and release protections remain applicable. Do not compress the larger image to the obsolete 60KB limit at the expense of clarity.

| Asset | Source dimensions | Verified file bytes | V5 automated size ceiling |
|---|---:|---:|---:|
| `native/assets/hero-cinematic-v3.webp` | 600×338 | 14,884 | Historical asset; no longer the production hero source |
| `native/assets/hero-cinematic-v4-768.webp` | 768×432 | 52,656 | <100,000 bytes for the ≤800w tier |
| `native/assets/hero-cinematic-v4-1536.webp` | 1536×864 | 129,480 | <200,000 bytes for the ≤1600w tier |

The asset filenames retain `v4`; the integrated presentation release is V5. Dimensions/bytes were read directly from local files. The ceilings match `tests/motion_ui_browser.py`; they are limits, not preferred target sizes.

`index.html` supplies both widths through `srcset`, breakpoint-aware `sizes`, explicit 1536×864 dimensions, eager loading and high fetch priority. Check the selected `currentSrc` at each tested width/DPR; do not assume the correct variant was downloaded merely because the attributes exist.

The old forced enlargement is replaced by a bounded 16:9 image slot and larger sources. The image's base scale is 1; its breathing animation still reaches 1.012 and moves vertically by 4px. This removes the previous undersized-source/layout mechanism, but **“no blur at every size” requires visual evidence**. Soft background glows remain intentional. The important Excel/CSV and Google Form labels also exist as crisp DOM text. Reduced motion disables the image animation and parallax.

The first CI screenshot review found that an elliptical mask still left visible straight picture edges. The final pass feathers the narrow perimeter with intersecting horizontal and vertical masks, leaving the subject and panels fully detailed. The decorative frame remains borderless; do not reintroduce oversizing to hide the edge.

## Copy and workflow contract

The auth note is now:

> PandaStudy dùng thông tin đăng nhập Google để xác định tài khoản và quản lý phiếu của bạn.

This avoids claiming the app uses a person's name or avatar. Source review found `openid`, `email`, `profile` scopes, while the callback/identity code actually uses the Google subject and verified email. V5 does not change those scopes or identity behavior.

| Step | Task | Target |
|---:|---|---|
| 1 | Optional file input | `#dropZone` within `#fileStep` |
| 2 | Import Google Form `/edit` link | `#formSetupStep` |
| 3 | Map columns or configure sample answers | `#mappingStep` |
| 4 | Build preview and validate | `#planStep` |
| 5 | Inspect results and download CSV | `#previewSection` |
| 6 | Send and reconcile; export results | `#qaRunStep`, created by `qa-run.js` |

Home navigation, mapping empty states and QA errors must identify Form import as **Step 2**. The visible Vietnamese helper and `qa-run.js` error were verified against this sequence. Require the English string to agree as well; the current language setter forces Vietnamese, so dormant translations are not evidence of a current English UI test.

Step 5 download must continue to describe a local CSV export. Step 6 retains distinct actions: 6a sends one row, 6b sends remaining rows, 6c reconciles and 6d exports results. The four cards in `#how` summarize phases; they do not renumber the operational six-step controls.

Credit copy must continue to distinguish available credits, credits awaiting reconciliation and confirmed outcomes. No new urgency, fabricated social proof, changed offer, automatic payment or implicit submission behavior is part of V5.

## Acceptance and release gates

**Status at this document's source review: implementation inspected; browser/CI/production acceptance pending.** No passing browser suite, final visual approval or live deployment is asserted here. The local preview supervisor was unavailable; use screenshots from the CI artifacts for visual review before merge.

| Gate | Required evidence | Status at source review |
|---|---|---|
| Assets/source | Dimensions, file sizes, responsive markup, auth wording, Step 2 helpers | Files/markup inspected; final copy parity check required |
| Visual hierarchy | Desktop/tablet/mobile screenshots show readable H1/body/CTA, no art/text collision and a compact account area | Pending |
| Image quality | Correct source at tested DPR; panda/panels sharp; no unintended crop or stretch | Pending visual review |
| Accessibility/motion | Text contrast, keyboard focus, touch targets, reduced motion, no overflow at the suite's supported widths | Pending suite and visual review |
| Workflow regression | Six-step routes, file input, preview/validation/export and existing auth/billing behavior remain intact | Pending required CI gates |
| Diff scope | No server/API/schema/business-rule changes; only intended presentation/copy/assets/tests/docs | Pending final PR diff review |
| Production | Deployment READY, custom domain serving the intended version, read-only smoke and asset checks | Pending deployment |

Review the existing required `browser-smoke`, `billing-postgres`, cinematic motion and UX/accessibility checks. Resolve observed regressions before merge. Tests using mocked responses must be identified as mocked; they do not prove real payment approval or real Google receipt. Do not perform a payment or uncontrolled Form write just to complete this presentation release.

After CI, inspect the screenshots rather than relying only on green test status. Record any remaining limitation in the handoff. Roll back the presentation commit if needed; this release has no intended database migration.

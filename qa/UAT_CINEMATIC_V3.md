# PandaStudy Cinematic Hero V3 — Detailed UAT Matrix

Environment for release sign-off:
- Preview: Vercel deployment from feature PR.
- Production: https://www.pandastudy.info.vn after merge.
- Live testing is read-only for external Google Form/payment operations unless explicitly marked controlled/manual.
- Test accounts: one normal Google user and one configured PandaStudy admin account.

| ID | Area | Priority | Preconditions | Steps | Expected result | Automation |
|---|---|---:|---|---|---|---|
| HERO-001 | Asset | P0 | Preview/live available | Request /assets/hero-cinematic-v3.webp | HTTP 200, image/webp, non-empty, under 60 KB target | Yes |
| HERO-002 | Desktop visual | P1 | 1440x900, signed in | Open #home | Dark cinematic hero, copy left, artwork right, no overlap | Yes |
| HERO-003 | Image load | P0 | Network normal | Reload #home | New cinematic artwork loads; no broken-image icon | Yes |
| HERO-004 | LCP reserve | P1 | DevTools/browser | Reload repeatedly | Hero height does not jump when image decodes | Partial |
| HERO-005 | CTA primary | P0 | #home | Click “Bắt đầu ngay” | Hash becomes #app and workspace is visible | Yes |
| HERO-006 | CTA secondary | P1 | #home | Click “Xem cách dùng” | Existing target/route opens correctly | Yes |
| HERO-007 | Pointer parallax | P2 | Fine pointer, motion allowed | Move pointer across artwork | Subtle parallax changes; no click interception | Yes |
| HERO-008 | Pointer reset | P2 | Same | Move pointer out of artwork | Scene returns toward neutral | Yes |
| HERO-009 | Ambient animation | P2 | Motion allowed | Observe 10s | Slow controlled motion, no flashing or distracting loop | Yes |
| HERO-010 | Reduced motion | P0 | OS/browser reduced-motion=reduce | Open #home and move pointer | No continuous hero animation/parallax; content stays visible | Yes |
| RESP-001 | 1440 desktop | P1 | 1440x900 | Open home/app/blog/faq | No horizontal overflow | Yes |
| RESP-002 | 1024 desktop/tablet | P1 | 1024x860 | Same | No clipping; hero remains balanced | Yes |
| RESP-003 | 768 tablet | P1 | 768x900 | Same | Layout adapts; CTA/image readable | Yes |
| RESP-004 | 390 mobile | P0 | 390x844 | Open #home | Single column, no overflow, image fully usable | Yes |
| RESP-005 | 320 mobile | P0 | 320x800 | Open #home | No horizontal scroll or clipped CTA | Yes |
| A11Y-001 | Keyboard | P0 | Desktop | Tab through top nav and hero CTAs | Visible focus, logical order | Yes |
| A11Y-002 | Contrast | P1 | #home | Inspect hero text/buttons | High contrast; no low-contrast muted text over image | Manual |
| A11Y-003 | Semantics | P1 | #home | Inspect image/decorative layers | Hero img has useful alt; decorative layers aria-hidden | Yes |
| A11Y-004 | Zoom | P1 | Browser 200% | Navigate home | Content remains readable, no essential clipping | Manual |
| AUTH-001 | Signed out | P0 | No session | Open site | Existing login wall appears; main app not bypassed | Yes |
| AUTH-002 | Normal Google login | P0 | Normal test user | Complete OAuth | User lands in same authenticated experience as before | Manual live |
| AUTH-003 | Admin login | P0 | Admin test user | Complete OAuth | Admin capabilities still appear | Manual live |
| BLOG-001 | Normal user | P0 | Signed in non-admin | Open Blog | “Viết bài mới” is hidden; direct editor route denied | Yes |
| BLOG-002 | Admin | P0 | Signed in admin | Open Blog | “Viết bài mới” visible and editor opens | Yes |
| FORM-001 | Public form read | P0 | Known public test Form | Load test form read-only | Metadata/questions load; no response submitted | Yes |
| FORM-002 | Mapping UI | P0 | Form + sample sheet | Map columns/questions | Existing mapping behavior unchanged | Yes |
| FORM-003 | Preview | P1 | Mapping complete | Generate preview | Preview rows render correctly | Yes |
| FORM-004 | Submission safety | P0 | Automated CI | Run browser suite | No uncontrolled production Google Form writes | Yes |
| BILL-001 | Profile | P0 | Signed in | Open account area | Credit/profile data load normally | Yes |
| BILL-002 | Packages | P0 | Purchases enabled | Open top-up dialog | Configured packages and custom quantity render correctly | Yes |
| BILL-003 | Package select | P1 | Dialog open | Select popular package | Price/credits/savings update correctly | Yes |
| BILL-004 | QR order | P0 | Controlled billing test only | Create top-up order | Existing order/QR workflow unchanged | Mocked + manual controlled |
| BILL-005 | Admin approve | P0 | Pending controlled order | Admin ticks confirmation and approves | Correct credits added exactly once | Mocked + manual controlled |
| BILL-006 | Optional audit fields | P1 | Admin approval form | Leave amount/reference blank, tick confirmation | Approval allowed per current rule | Yes |
| PROMO-001 | Timed bonus | P0 | Eligible test account | Sign in in active period | Bonus granted once only | Yes/mock |
| PROMO-002 | Repeat login | P0 | Bonus already granted | Re-login/refresh | No duplicate grant | Yes |
| ADMIN-001 | User directory | P0 | Admin | Open admin | Accounts, balances, roles load | Yes |
| ADMIN-002 | Revenue | P0 | Admin | Open dashboard | Monthly/all-time approved revenue metrics load | Yes |
| ADMIN-003 | Commerce config | P1 | Admin | Open packages/promotions | Existing editing controls still work | Yes |
| ADMIN-004 | Non-admin API | P0 | Non-admin | Call admin resources | 403/denied | Yes |
| NAV-001 | Hash routes | P0 | Signed in | Visit #home/#app/#blog/#how/#faq/#about | Correct section only is visible | Yes |
| NAV-002 | Back/forward | P1 | Navigate several tabs | Browser back/forward | State follows history correctly | Yes |
| PERF-001 | JS size | P1 | Repo | Check motion-ui.js size | < 12 KB | Yes |
| PERF-002 | CSS size | P1 | Repo | Check motion-ui.css size | < 24 KB | Yes |
| PERF-003 | Image size | P1 | Repo | Check hero WebP size | < 60 KB | Yes |
| PERF-004 | Console | P0 | Browse core sections | Capture pageerror/console errors | No uncaught errors from release | Yes |
| LIVE-001 | Production commit | P0 | Deployment READY | Inspect production deployment | Deployment is from merged release commit/descendant | Yes |
| LIVE-002 | Custom domain | P0 | Deployment READY | Open www.pandastudy.info.vn | Domain serves new release | Yes |
| LIVE-003 | Live hero asset | P0 | Production | Fetch hero WebP | 200 + expected content type/bytes | Yes |
| LIVE-004 | Live auth status | P0 | Production anonymous | GET /api/auth/status | Healthy JSON response; no 5xx | Yes |
| LIVE-005 | Live runtime errors | P0 | Production after deploy | Review recent runtime error clusters | No new release-related production errors | Yes |
| LIVE-006 | Live responsive visual | P1 | Production | Screenshot 1440/390 | Hero visually matches approved composition | Manual/automated evidence |

## Sign-off rules

Release is blocked by any failed P0 or P1 case. P2 issues may ship only when they are cosmetic, documented, and do not affect accessibility, conversion-critical CTA behavior, or core workflows.

Production testing must not:
- send responses into a real survey without explicit controlled permission;
- approve a real bank transaction without a controlled test order;
- change package/promotion configuration merely to validate visuals;
- expose OAuth tokens, raw Google subject IDs, or secrets in logs/screenshots.

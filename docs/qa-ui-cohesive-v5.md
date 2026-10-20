# Cohesive V5 — UI regression evidence and image quality gate

Release marker: `2026-10-20-cohesive-v5`. Motion assets use `v=20261020e`.

## Why the hero gate changed

The previous hero was 600 × 338 pixels, 14,884 bytes. Its browser test required
exactly those dimensions and a file smaller than 60,000 bytes. That checked a
particular export, but allowed visibly enlarged imagery on high-density screens.
The requested change prioritizes sharper imagery while retaining a bounded
download cost.

The V4 image exports used by this V5 UI release are:

| Candidate | Encoded pixels | Current bytes | Maximum allowed |
|---|---|---:|---:|
| `hero-cinematic-v4-768.webp` | 768 × 432 | 52,656 | 100,000 |
| `hero-cinematic-v4-1536.webp` | 1536 × 864 | 129,480 | 200,000 |

These are separate responsive transfer budgets, not a general relaxation of
performance checks. A future candidate above 1600 pixels has a hard 300,000-byte
ceiling. Motion JavaScript remains below 12,000 bytes and CSS below 24,000 bytes.

## What the browser tests prove

`tests/motion_ui_browser.py` decodes the declared WebP candidates with
`createImageBitmap`, verifies the width descriptors and aspect ratios, and
compares the browser's actual `currentSrc` against the rendered image at each
tested DPR. It does not mistake density-corrected `naturalWidth` for the encoded
file width.

The coverage assertion checks both axes after `object-fit: cover`, animation
scale, and desktop parallax. The selected source must cover the maximum measured
image dimensions × DPR, with only two pixels of rounding tolerance. A small file
cannot pass merely because a larger candidate exists in `srcset`.

The layout assertion uses actual H1 text ranges and the actual transformed image
rectangle. It samples animation keyframes and quarter-cycle positions, including
desktop pointer extremes. A roomy `.hero-art` container alone cannot hide an
image protruding into the headline. Headline clipping at viewport edges also
fails the gate.

The matrix includes 1440/1024/768 pixels at DPR 2, 390/360 pixels at DPR 3, and
320 pixels at DPR 2, plus the original desktop DPR 1 and reduced-motion paths.
Each viewport uses a fresh context so a cached oversized image cannot conceal a
bad responsive candidate choice.

Pixel coverage is necessary for sharpness; it does not independently certify
compression quality, illustration detail or good art direction. Review the
screenshots alongside the source images before merging.

## Additional regressions covered

- The standalone promo CTA has at least 4.5:1 text contrast in its default,
  hover and keyboard-focus states. The check composes background colors and
  gradient samples, catching the previous missing-token/transparent-background
  case. Keyboard focus must be visible.
- All six shortcut numbers match their destination step's number and heading.
  Mapping's empty-state instruction must reference the actual Form input step.
  Action prefixes must match their containing steps, and optional file input
  must remain visibly optional.
- Viewing package options and closing the modal must restore page scrolling.
  The test stops before any create-order control.
- Signed-out screens at 320 and 390 pixels retain legible login CTAs and avoid
  horizontal overflow. Palette cohesion is reviewed visually rather than by
  requiring one exact green value in a test.

All existing navigation, blog, role, six-step state, motion, reduced-motion,
overflow and P0/P1/P2 gates remain enabled. Account/profile/order responses are
fixtures; unexpected non-GET/HEAD traffic is aborted or intercepted by fixture
routes and recorded as a P0 failure. No real Google responses, billing orders,
payments, email or account changes are part of these UI tests.

## CI evidence to inspect before merge

The existing `PandaStudy checks` workflow runs both browser suites and uploads
`qa-artifacts/` under the `pandastudy-ux-audit` artifact. Inspect:

- `auth_signed_out_320.png`, `auth_signed_out_390.png`;
- `home_390.png`, `home_768.png`, `home_1440.png`;
- `app_mobile_390.png` and the complete step content in the home/app captures;
- `promo_packages_390.png`, `promo_packages_1440.png`;
- `hero-quality-*-dpr*.json`, `hero-quality-desktop.json`;
- the motion, reduced-motion screenshots and `ux_audit.json`.

UX screenshots use reduced motion so off-screen reveal opacity cannot produce
misleading blank sections in a full-page capture. The separate motion suite
still exercises the real animation and parallax behavior; its screenshots
disable animations only for capture.

After merge, `tests/production_smoke.py` checks the live release marker,
CSS/JavaScript delivery, every responsive image candidate and the same pixel /
layout assertions. Existing canonical-domain, OAuth, billing readiness,
unauthenticated admin/QR access and core navigation gates remain in place.
The reusable hero helpers are import-safe: importing the motion test does not
start a local server or browser.

## Current verification status

The source was prepared without running a standalone local browser or preview
server in the agent environment. Python and embedded JavaScript syntax checks
are separate from browser test results. Browser PASS and visual approval require
the CI run and review of its uploaded evidence; they must not be inferred from
syntax validation alone.

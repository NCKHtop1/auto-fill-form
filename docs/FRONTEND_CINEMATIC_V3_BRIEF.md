# PandaStudy Cinematic Hero V3 — Frontend Implementation Brief

## 1. Objective

Upgrade the first-screen experience from a light 3D banner to a premium cinematic SaaS hero while preserving all PandaStudy business behavior.

The hero should feel closer to a high-end product launch: strong contrast, real depth, premium lighting, controlled motion, and clear CTA hierarchy. It must still feel like a trustworthy research/productivity tool rather than a crypto or gaming site.

## 2. Non-negotiable functional boundary

This release is presentation-only. Do not change:

- Google OAuth/login wall behavior.
- Google Form import, mapping, generation, preview, submission, or reconciliation logic.
- Billing, QR, packages, promotions, ledger, credits, admin permissions, revenue, user directory, or notification APIs.
- Blog permissions or publishing workflow.
- Existing hash routes, IDs, form controls, API endpoints, database schema, or server-side business rules.

## 3. Hero visual system

### Theme
- Dark cinematic hero only; the rest of the application remains light.
- Base: near-black green (#06100c / #08140f).
- Brand accent: PandaStudy green (#68d66b / #36a958).
- Supporting glow: cool cyan/blue, used sparingly.
- Copy remains highly legible with WCAG-conscious contrast.

### Layout
Desktop >= 1024px:
- Hero min-height: ~660–700px.
- Two-column composition.
- Left: product proposition, supporting copy, primary/secondary CTA.
- Right: cinematic PandaStudy data-flow artwork.
- Artwork frame should occupy ~55–60% of horizontal space and visually merge into the dark background with a vignette.

Tablet 651–1023px:
- Two columns may compress, then stack before text becomes cramped.
- Hero artwork remains at least 16:9 and readable.
- Motion amplitude reduced.

Mobile <= 650px:
- Single column.
- Copy first, image second.
- Image uses 16:9 ratio with rounded corners.
- Pointer parallax disabled.
- No horizontal overflow at 320px.

## 4. Image asset

Production asset:
- /assets/hero-cinematic-v3.webp
- 600 x 338 WebP
- Target payload below 20 KB for the production hero; hard gate remains below 60 KB.
- Explicit width/height attributes to reserve layout space.
- eager + fetchpriority=high because it is the LCP visual.
- Existing /assets/hero.png remains in the repository as rollback/fallback only.

Art direction:
- Premium 3D panda astronaut.
- Excel / CSV panel on the left.
- Google Form panel on the right.
- Visible data flow between them.
- Cinematic orbital/space environment.
- Strong depth, lighting, foreground/background separation.
- PandaStudy green remains the dominant brand cue.

## 5. Motion design

### Ambient
- Slow hero image float/breathing loop.
- Soft moving green/cyan glows.
- Subtle star/data texture drift.
- One restrained data-flow sweep; no marquee and no flashing.

### Pointer parallax
Fine pointer only:
- Translation <= 8px X / 6px Y.
- Rotation <= ~2deg.
- requestAnimationFrame throttling.
- Reset to neutral on pointerleave and visibilitychange.

### CTA micro-interactions
- Hover/focus lift: 2px maximum.
- Primary button receives subtle green light bloom.
- Secondary button remains glass/outline.
- Keyboard focus must remain clearly visible.

### Scroll reveal
- Opacity + translateY only.
- Trigger once using IntersectionObserver.
- No layout-changing properties.
- Existing hash navigation still reveals the target immediately.

## 6. Reduced motion

When prefers-reduced-motion: reduce:
- Hero float, ambient drift, sweep, button shine, and parallax are disabled.
- Reveal elements are immediately visible and untransformed.
- All controls and content remain functionally identical.
- No information is communicated only through motion.

## 7. Performance budget

- No new runtime framework or animation library.
- motion-ui.js remains < 12 KB unminified.
- motion-ui.css remains < 24 KB unminified.
- hero-cinematic-v3.webp remains < 60 KB.
- No JS console errors.
- No horizontal overflow at 320/390/768/1024/1440 widths.
- Hero reserves image dimensions to avoid CLS.
- Animated properties should be transform/opacity where possible.

## 8. Accessibility

- Decorative layers aria-hidden.
- Hero image has meaningful alt text.
- Text contrast on dark hero must remain readable.
- CTA controls remain links with original href values.
- Keyboard navigation and focus ring are preserved.
- No autoplay audio/video.

## 9. Implementation files

- native/assets/hero-cinematic-v3.webp — new optimized visual.
- native/index.html — hero image/markup and cache revision only.
- native/motion-ui.css — cinematic theme and responsive motion overrides.
- native/motion-ui.js — existing dependency-free motion controller, tuned for V3.
- tests/motion_ui_browser.py — local browser regression/visual behavior gate.
- tests/production_smoke.py — read-only live asset/HTML verification.
- qa/UAT_CINEMATIC_V3.md — detailed UAT matrix.

## 10. Release gate

The change can merge only when:
- browser-smoke passes;
- billing-postgres passes;
- dedicated cinematic motion UAT passes;
- comprehensive UX/accessibility audit has no P0/P1/P2 regression.

After merge:
- Vercel production deployment must reach READY;
- custom domain must resolve to the deployment;
- read-only live smoke verifies the new hero asset and unchanged critical APIs;
- runtime error review shows no new production error cluster attributable to the release.

## 11. Rollback

Rollback is presentation-only:
- restore the previous index.html + motion-ui.css/js revision;
- /assets/hero.png is retained;
- no database rollback is necessary because this release contains no schema/data mutations.

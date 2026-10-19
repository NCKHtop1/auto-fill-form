# PandaStudy Premium Motion UI Specification

Status: implementation candidate for `feat/premium-motion-ui`.

## Product intent

Refresh only the presentation layer. Authentication, billing, account/admin, Google Form workflow, blog permissions, promotion logic, database schema, APIs and existing business rules remain unchanged.

The visual goal is “living research SaaS”: premium, cinematic and dimensional, but still trustworthy, light, fast and appropriate for an academic/research tool. The reference feeling is a hero scene with depth, slow floating objects and pointer-responsive parallax rather than a static banner.

## Motion principles

1. Motion explains hierarchy, flow and depth; it must not compete with the form workflow.
2. No fake urgency, flashing, infinite marquees or forced popups.
3. Continuous animation is limited to the hero visual and small ambient decoration.
4. Interactive motion uses short 120–260 ms transitions.
5. Scroll reveals use opacity + translate only; no layout-changing animation.
6. `prefers-reduced-motion: reduce` disables continuous animation, parallax and scroll transforms.
7. Motion is implemented with native CSS and a small dependency-free JavaScript layer. No WebGL/Three.js in this release.
8. Existing links, IDs, buttons, forms, API calls and billing hooks are preserved.

## Hero composition

Desktop:
- Two-column hero remains.
- Left copy keeps the existing product proposition and CTAs.
- Right scene uses the existing PandaStudy hero artwork as the visual anchor.
- The image gets a slow 3D float/drift, subtle scale breathing and pointer parallax.
- Three lightweight floating chips reinforce the workflow: Excel/CSV, Ghép dữ liệu, Google Form.
- A soft orbital ring, moving data dots and ambient green/blue glows create depth.
- Scene is clipped inside a premium rounded frame with glass-like highlights.

Tablet:
- Reduce translation/rotation amplitude by ~40%.
- Floating chips remain but avoid overlapping copy.

Mobile:
- One-column layout.
- Hero visual remains visible, but pointer parallax is disabled.
- Only the primary decorative chip remains prominent; secondary chips are softened.
- No horizontal overflow at 320 px.

## Interaction motion

- Primary buttons: lift by 2 px, soft shadow increase, short highlight sweep.
- Secondary buttons: subtle border/background transition.
- Workspace, step cards, blog sections and guidance cards: reveal once when entering viewport.
- Steps strip: small hover/focus lift; current link remains fully usable.
- Package cards: gentle lift and border/shadow emphasis; no change to selection logic.
- Admin cards: restrained hover only; no continuous animation.

## Accessibility and performance

- Reduced-motion users receive fully static content with no hidden reveal state.
- Focus states remain visible and are not replaced by hover-only affordances.
- Decorative motion elements are `aria-hidden="true"`.
- Motion JS never intercepts clicks, keyboard navigation, form submission or hash routing.
- No new third-party runtime dependencies.
- Use transforms/opacity only for animated properties where possible.
- Pause pointer work when the document is hidden; use `requestAnimationFrame` for pointer updates.
- No animation should cause layout shift after page load.

## Acceptance criteria

### Functional preservation
- Signed-out users still see the login wall.
- Signed-in users still reach the same main application.
- Google Form workflow IDs and handlers are unchanged.
- Account, package purchase, QR, admin, promotions and blog permissions continue to work.
- Existing hash navigation still resolves to the same sections.

### Visual/motion
- Hero image has measurable CSS animation on desktop when reduced motion is not requested.
- Pointer movement changes hero parallax CSS variables on fine-pointer devices.
- At least the workspace and content sections reveal through IntersectionObserver.
- Buttons and package cards expose hover/focus motion without changing actions.
- 320/390/768/1440 px layouts do not overflow horizontally.

### Reduced motion
- Hero continuous animations resolve to `animation-name: none` or equivalent static state.
- Scroll-reveal elements are immediately visible and untransformed.
- Pointer movement does not move the hero scene.

### Performance guardrails
- No new external JavaScript/CSS libraries.
- Motion script is under 12 KB unminified.
- Motion CSS is under 20 KB unminified.
- No console errors from motion code.

## Release plan

1. Implement on feature branch.
2. Run syntax, unit, PostgreSQL, auth, billing/admin, blog, UX/accessibility and dedicated motion browser tests in PR CI.
3. Merge only after required CI jobs pass.
4. Main-branch Vercel integration deploys production after merge.
5. Post-merge production smoke remains read-only and must pass.

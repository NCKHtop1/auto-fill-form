# PandaStudy V6 — Seamless tonal transition

## Decision
Keep the cinematic dark-green / near-black panda hero. Preserve the light working area for Google Form/data input and legibility. Make the transition feel intentional instead of recoloring every page dark. Color consistency means shared green/ink/cream roles, not identical section backgrounds.

## Scope
- Add one decorative and screen-reader-ignored \`ps-tone-bridge\` directly after the hero.
- Fade near-black green through muted sage to the light mint page background. It sits *behind* the floating six-step shortcut strip.
- Give six shortcuts a consistent light surface and number badge. The former always-dark first shortcut is no longer misleadingly styled as a selected step.
- Harmonize header active navigation, workspace head and divider tones. Keep panda artwork, animation, high-DPR assets, functional links and all existing JS/business behavior.
- When tabs switch away from Home, hide the bridge along with hero and step strip; do not add empty space to Blog, How, FAQ, About or App.

## UX/QA acceptance
1. Desktop and mobile visually have a continuous dark-to-light seam without a sharp horizontal cut.
2. Shortcut strip reads as one six-step system with identical default styling. Focus and hover remain visible.
3. \`#app\` opens the light workspace; no bridge is visible or taking space on other tabs.
4. 320/360/390/768/1024/1440 responsive layouts have no horizontal overflow.
5. Prefers-reduced-motion still works; the seam has no animation.
6. Regression tests cover pixels/DPR, auth gate, mock billing/admin, local form, and read-only postdeploy checks.
7. Do not simulate payment approvals, spend credits or submit responses to a real Form.

## Rollback
This is presentation-only: revert the V6 commit if required. No migrations, changed pricing, OAuth scopes, API or database schema.

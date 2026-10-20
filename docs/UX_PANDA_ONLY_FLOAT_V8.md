# PandaStudy V8 — panda-only floating motion

## Product decision
The cinematic hero scene stays visually fixed. Only the PandaStudy mascot floats vertically. This removes the previous feeling that the whole artwork/card was breathing or drifting.

## Implementation
- Keep the responsive V4 cinematic scene as the static base.
- Cover the original baked-in panda with a small inpainted scene patch.
- Reuse the same responsive hero source as a clipped panda-only layer, so the browser cache can reuse the selected asset.
- Animate only the panda layer on the Y axis: about 18px total travel on desktop and 11px on phones.
- Remove whole-scene pointer parallax.
- Keep aura/scan ambience; these do not translate the hero frame.
- Respect `prefers-reduced-motion`: panda float is disabled.

## QA acceptance
1. `.hero-art` computed transform remains `none` before and after pointer movement.
2. `.hero-scene` has no animation.
3. `.hero-mascot` uses `psPandaFloat`, moves vertically by at least 10px on desktop, and does not move horizontally.
4. Existing responsive pixel coverage, headline non-overlap, tonal bridge, CTA/navigation and reduced-motion checks still pass.
5. No auth, billing, Form, pricing, database or V7 launch-hardening behavior changes.

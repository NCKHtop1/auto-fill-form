# PandaStudy V8.2 — mascot-only float

The cinematic hero frame, data panels, labels and background stay completely static. Only the transparent panda mascot moves vertically.

- Dedicated transparent mascot asset: `/assets/hero-panda-float-v8.webp`.
- Dedicated erase/background patch removes the panda baked into the base hero without moving the scene.
- Desktop/tablet travel: +16px to -20px (36px peak-to-peak), 4.6s ease-in-out.
- Mobile travel: +10px to -14px (24px peak-to-peak), 4.8s.
- No horizontal drift, scale, tilt or frame parallax.
- `prefers-reduced-motion: reduce` disables the mascot animation.
- No auth, billing, Google Form, data validation, pricing or database behavior changes.

QA must verify: scene animation is none; hero container transform stays none before/after pointer movement; mascot uses the dedicated asset; vertical travel is at least 34px on desktop; responsive layouts and reduced-motion remain clean.

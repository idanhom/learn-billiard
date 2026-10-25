# Pool Angle Trainer

## Never leave a stale build on the preview server

`npm run preview` (http://127.0.0.1:4173) serves the **static contents of
`dist/`**. It does not watch, does not rebuild, and will happily serve a build
from an hour ago as if it were current. Nothing warns you.

So: **after any change under `src/` or to `index.html`, run `npm run build`
before saying anything is ready to look at.** Say which port and that it is
rebuilt. If the preview server is not running, start it.

A plain browser reload is enough once rebuilt — the server sends `no-cache` on
both `index.html` and the hashed assets, so there is no need to hard-refresh.

To check what is actually being served rather than assuming:

```bash
find src index.html -type f -newer dist/index.html   # any output means dist is stale
```

`npm run dev` (http://127.0.0.1:5173) hot-reloads and has none of this problem.
Prefer it for iterating; use `preview` when the point is to exercise the real
production artifact, which is what `verify:browser` drives.

## Verification

```bash
npm run typecheck
npm test                                  # 19 files, vitest, geometry + physics + progression
npm run build && npm run preview          # then, in another terminal:
npm run verify:browser                    # drives the production build in real Chromium
```

`verify:browser` needs `preview` already running on 4173, and therefore needs
the build to be current too. Screenshots land in `artifacts/`. It uses
Playwright's cached Chromium; on a machine without one, point `CHROMIUM_PATH`
at a system Chromium binary.

## Calibration is coupled — do not change one number alone

The physical constants are not independent knobs, and several carry derived
values that go stale silently:

- `ROLLING_FRICTION` / `CLOTH_PRESETS` are set from **how long a roll takes**
  (a table length of free roll in 4.7 / 4.0 / 3.4 s), and normal cloth at 0.022
  sits over twice the published 0.005-0.015 band and above Alciatore's measured
  0.01. That is a deliberate departure, not a measurement, and it has never been
  checked against a real table. Say so; do not restate it as though the
  literature were wrong. If you move it, re-time it — the timing formula is
  piecewise now and lives in `src/geometry/roll-time.ts`, in one place on
  purpose.
- `TERMINAL_ROLL_SPEED` / `TERMINAL_ROLL_BOOST` have **no published value at
  all**, unlike everything else in that file. Never cite them. The knee also
  carries `ROLLING_FRICTION` with it: it does part of the job the plain
  coefficient used to, which is why that came down from 0.025.
- Rolling resistance stays below `SLIDING_FRICTION` at every speed: a ball
  cannot shed speed faster rolling than skidding. A fast step that took ten
  times 0.022 above 1 m/s broke that and was removed; long cue-ball run-outs
  play out in real time and Retry or Next ends them early, so shortening them
  is not the cloth's job.
- The ball-to-ball friction is `contactFriction`, Alciatore's TP A.14 fit to
  Marlow's measurements, and none of its three constants is tuned. At an
  ordinary pot's contact speed it puts the square-hit travel ratio at 7.2x,
  near Alciatore's "about 7 times as far"; faster contacts read lower as the
  friction falls, which is a prediction, not a fit. If holding the ratio near 7
  at ordinary speeds ever needs those constants moved, the collision model has
  a structural error rather than a calibration one. That is exactly how an
  inverted spin-transfer sign was caught: it needed a constant 0.045 where 0.06
  is published.
- Throw is the same friction's sideways share, and the ideal line is corrected
  for it (`analyseShot`), so the ghost ball, the cut a layout is generated at
  and the recommended stroke all move with the contact model.
- `CUSHION_RESTITUTION` / `CUSHION_FRICTION` are a fitted pair: the best
  match to Alciatore's measured square rebounds (HSV B.15) and rebound angles
  (TP B.11). Refit them together if either moves, against the same data;
  `tests/physics/world.test.ts` holds the angles and
  `tests/physics/collision.test.ts` the rebound speeds.
- `POWER_CURVE_EXPONENT` follows the cloth AND the contact model — the object
  ball's backspin changes the speed a pot asks for. It is whatever puts a
  typical pot (0.6 m to the pocket, 0.5 m of cue-ball travel, normal cloth) near
  40% of the meter, and must be re-derived whenever either moves.
- All of these feed shot generation through `isPowerFeasible`, and the
  recommended power through `src/game/power.ts`. After changing any, re-measure
  the per-level power spread and the template-fallback rate before trusting
  them.

`MEASURE=1 npx vitest run tests/zz-calibration.test.ts --reporter=verbose`
prints this whole list, seeded, in one run. The default reporter swallows its
output.

When a number in a comment or in `README.md` states a measured figure, it is a
claim someone can check. Re-measure it rather than leaving it, and if a value
no longer has the provenance the comment claims, say so plainly instead of
keeping the citation.

## Physics tests: measure at impact, not at launch

A collision property (cushion retention, ball-to-ball transfer, follow-through)
measured against a ball's *launch* speed silently folds in whatever the cloth
took on the run-up, so it breaks whenever friction changes even though the
collision model did not. Measure against the speed **at contact** — `stepUntil`
returns `before` for exactly this.

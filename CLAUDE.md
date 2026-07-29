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
npm test                                  # 17 files, vitest, geometry + physics + progression
npm run build && npm run preview          # then, in another terminal:
npm run verify:browser                    # drives the production build in real Chromium
```

`verify:browser` needs `preview` already running on 4173, and therefore needs
the build to be current too. Screenshots land in `artifacts/`.

## Calibration is coupled — do not change one number alone

The physical constants are not independent knobs, and several carry derived
values that go stale silently:

- `ROLLING_FRICTION` / `CLOTH_PRESETS` are set from **how long a roll takes**
  (a table length of free roll in 4.7 / 4.0 / 3.4 s), and normal cloth at 0.022
  sits over twice the published 0.005-0.015 band and above Alciatore's measured
  0.01. That is a deliberate departure, not a measurement, and it has never been
  checked against a real table. Say so; do not restate it as though the
  literature were wrong. If you move it, re-time it — the timing formula is
  piecewise now and lives in `tests/support/roll-time.ts`, in one place on
  purpose.
- `TERMINAL_ROLL_SPEED` / `TERMINAL_ROLL_BOOST` have **no published value at
  all**, unlike everything else in that file. Never cite them. They also carry
  `ROLLING_FRICTION` with them: the knee does part of the job the plain
  coefficient used to, which is why it came down from 0.025.
- `BALL_CONTACT_FRICTION` is published-typical (0.03-0.08, at the middle) and
  should stay that way. If holding the object/cue travel ratio inside 6.5-8x
  ever needs it dragged off that range, the collision model has a structural
  error rather than a calibration one. That is exactly how an inverted
  spin-transfer sign was caught: it needed 0.045.
- `POWER_CURVE_EXPONENT` follows the cloth AND the contact model — the object
  ball's backspin changes the speed a pot asks for. It is whatever puts a
  typical pot (0.6 m to the pocket, 0.5 m of cue-ball travel, normal cloth) near
  40% of the meter, and must be re-derived whenever either moves.
- All of these feed shot generation through `isPowerFeasible`, and the
  recommended power through `src/game/power.ts`. After changing any, re-measure
  the per-level power spread and the template-fallback rate before trusting
  them.

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

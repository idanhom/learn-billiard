# 3D Pool Angle Trainer — Design & Implementation Plan (rev 2, post-critique)

## Context

The user plays 8-ball and wants to learn aiming: cue stick → cue ball → object ball, and how cut angles determine where the object ball goes. Deliverable: a browser game built in this repo (`/home/pi/Development/pool`, empty unborn git repo). Target: this Raspberry Pi 5's browser at 60 fps.

Confirmed decisions: focused aiming trainer (not full 8-ball rules) · ghost-ball teaching with progressively fading guides · center-ball hits only, no english · behind-cue camera with overhead toggle · curriculum of drill levels · Three.js + custom TypeScript physics + Vite.

Rev 2 incorporates external review. Key changes: analytic `ShotGeometry` is the authority for aiming truth and progression is scored on **aim error, not pots** (pots confound power/pocket tuning with aiming skill); the static 90° tangent guide is **dropped from MVP** (inconsistent with restitution < 1 and cue-ball follow — it would teach what the sim contradicts); collision handling uses **earliest-time-of-impact event ordering** covering cushions and pockets, not just ball-ball sweeps; one `TableGeometry` model is the single source of truth for physics, generator, and meshes; the shot lifecycle is an idempotent state machine; persistence is versioned behind an interface. The physics model is explicitly labeled **ideal (no english, no ball-ball throw, no cushion-induced sidespin)** in-app.

## Design

### Table geometry — single source of truth

`TableGeometry` module derives everything from base constants (7-ft playing surface 1.98 × 0.99 m; ball r = 28.575 mm, m = 170 g):

- Cushions as line segments **with gaps at the six pocket mouths**, plus short angled jaw-facing segments.
- Pockets as capture circles centered in the mouths (corner ≈ 5.5 cm, side ≈ 5 cm radius — side jaws make the effective opening; constants tunable in one place).
- Legal ball-center bounds, pocket target points (aim reference on the capture circle).
- Physics, shot generator, and Three.js meshes all consume this module — no duplicated dimensions.

### ShotGeometry — analytic authority

Pure functions, independent of the simulation:

- Ghost-ball center = objectCenter + 2r · normalize(objectCenter − pocketTarget).
- Cut angle, cut side (left/right), reachability (ghost center in legal bounds, cue→ghost path clear, object→pocket path clear).
- **Aim error**: signed angle between player's line and ideal line. Convention: **thick** = aimed closer to the object-ball center than ideal, **thin** = farther, per cut side; straight-in shots (< 2° cut) report **left/right** instead.
- Analytic power feasibility: object-ball speed after an ideal cut (cos-angle transfer, e-scaled) vs. distance to pocket under rolling resistance.

Progression and feedback use ShotGeometry; the physics sim decides only what physically happens.

### Physics (2D on table plane, rendered in 3D)

- Fixed tick 1/240 s. Within each tick: compute earliest time-of-impact among ball-ball, ball-cushion-segment, and pocket-capture events; advance to it; resolve; repeat on remaining time with a hard iteration cap (~8). Max cue speed capped. Initial-overlap resolved by positional correction before integration.
- Ball state: position, velocity, roll spin. Cue strike = pure sliding; sliding friction (μ≈0.2) until slip reaches zero, then rolling resistance (μ≈0.01). Produces natural follow on the cue ball — which is *why* the static tangent guide is out.
- Ball-ball: impulse along line of centers, e ≈ 0.95 (straight hit transfers 97.5% of normal velocity — tests assert this, not "full transfer"). No throw; labeled ideal.
- Cushion: point impulse applied 0.27R above the ball's centre (WPA nose height), using the contact-point velocity and rotational effective mass, so a rail is passive at every spin state. Contact restitution 0.54 reproduces both published figures — a square rolling rebound at 0.65, settling to 0.50 after the skid. Tangential retention 0.95; no cushion-induced sidespin.

  *Revised after play testing.* The original model reflected the ball's roll along with its velocity, so a rail returned 2.25× too much kinetic energy on a square rolling contact and the table felt like ice. An intermediate fix that computed the impulse from the centre velocity was rejected: it created 58% energy for a ball whose roll opposed its motion.

- Cloth: rolling resistance is a player setting — fast 0.007, normal 0.010, slow 0.014, all inside the published 0.005–0.015. Generation validates power feasibility against the slowest so layouts stay makeable at any setting.

- **Known deviation:** object/cue travel ratio after a square full hit is 5.25×; published is 6.5–8×. The cause is frictionless ball-ball collisions. Modelling that friction would introduce throw and break the ghost-ball model `ShotGeometry` teaches against, so it is deliberate.
- Rest: velocity zero-clamp below threshold, all balls at rest for a dwell of N ticks → settled; potted balls excluded; hard max sim duration (~20 s) as a failsafe.

### Guides (teaching system)

Tier 0: aim line, ghost-ball outline, object-ball path to pocket, cut-angle/fullness readout. Tier 1: object-ball path removed. Tier 2: ghost ball removed. Tier 3: no guides. No tangent line in MVP (possible later: physics-predicted cue path, shown only within stun tolerance).

### Outcome contract

Evaluated once, at the shot's single terminal transition:

- **Qualifying shot** (drives progression): |aim error| ≤ level tolerance (L1 ≈ 2.0° tapering to ≈ 0.75° at L5; tunable constants).
- Pot in target pocket = success stat; wrong-pocket pot = non-target note; scratch (cue potted) = flagged, still scored on aim error; no contact = non-qualifying.
- **Miss distance** = minimum distance of object-ball center to target capture center observed during simulation ("never contacted" when applicable).

### Shot lifecycle & input

- FSM: `AIMING → CHARGING → SIMULATING → SETTLED → EVALUATED → next`. Each shot has an ID; evaluation is a guarded one-shot transition; progress persists only after it.
- `R` = same layout again, `N` = new layout (attempts count only if a shot was actually evaluated). Commands are legal only in specific states (no re-strike while simulating).
- Input scoped to the focused game surface. **`V` toggles overhead — Tab is left to the browser.** Space charges power (preventDefault only when game focused); `blur`/`pointercancel` cancels a charge. Key-repeat suppressed.
- Game loop: frame-delta clamp, max catch-up steps, render interpolation between physics states.

### Curriculum & progression

Levels: 1 straight-in (0–5°) · 2 gentle (5–20°) · 3 medium (20–40°) · 4 steep (40–60°) · 5 thin (60–80°) · 6 distance/rail-adjacent · 7 **exam** — fixed no-guide scored mode, exempt from tiers, scored on pots (the real-world test).

- Generator: **seeded**, constructive placement within level constraints, validated against invariants (non-overlap, legal bounds, clear paths, cut angle in range, cut side balance, analytic power feasibility), bounded rejection retries, falling back to per-level template shots. Seed logged for reproducibility.
- Tier advance: 3 qualifying of last 5 evaluated attempts at the current tier; window resets per tier; no regression within a session. Level complete when tier 3 clears.

### Persistence

`ProgressStore` interface; localStorage adapter kept out of game logic. Versioned schema + runtime validation; invalid/missing state → clean reset with a visible notice. Explicit reset action in UI. (Local-only by design; no sync/auth.)

### Rendering & UI

- Three.js: table from TableGeometry, cue stick with pull-back animation, camera rig (behind-cue orbit + overhead), one shadow light, DPR capped.
- MVP balls: cue + plain-colored object balls. Numbered/striped 1–15 canvas textures in polish phase.
- DOM HUD: power meter, tier/level indicator, readouts, post-shot report (aim error thick/thin, cut angle, miss distance, pot result), per-level stats, level select.

## Architecture

```
src/
  geometry/  # TableGeometry, ShotGeometry — pure, zero deps, unit-tested
  physics/   # event-ordered solver, friction model, collisions — pure TS
  game/      # shot FSM, generator, tiers/progression, ProgressStore iface
  scene/     # Three.js rendering, camera rig, guide visuals, cue animation
  ui/        # DOM HUD, menus, feedback
  main.ts    # wiring, game loop (clamped accumulator + interpolation)
```

`geometry`, `physics`, `game` import nothing from `scene`/`ui`. Debug hook (`window.__debug`) gated to dev builds.

## Implementation phases

1. **Bootstrap:** Vite + TS + three + vitest scaffold; `.gitignore`, committed lockfile; scripts `dev / typecheck / test / build / preview`; commit design spec to `docs/superpowers/specs/2026-07-28-pool-angle-trainer-design.md`.
2. **Geometry + physics core (TDD):** TableGeometry, ShotGeometry, TOI solver. Closed-form tests: 97.5% straight-hit transfer at e=0.95; object ball departs along line of centers at known cuts; sliding→rolling distances; cushion reflection; no-tunnel property at max cue speed; rest/dwell; no-NaN property sweeps.
3. **Vertical slice:** minimal scene (plain balls), both cameras, aim + power controls, shot FSM — **two deterministic shots (straight-in, fixed 30° cut) playable end-to-end** with evaluation + feedback; production build verified before proceeding.
4. **Guides & tiers:** tier visuals, readouts, tier state machine.
5. **Curriculum & persistence:** seeded generator + invariant tests, level definitions, progression, versioned ProgressStore (+ corruption-handling tests), exam mode.
6. **Polish:** ball textures, camera/feel refinements, Pi performance pass (frame-time check on production build), in-app "ideal physics" notice.

## Verification

- `npm run typecheck && npm test` — geometry/physics closed-form and property tests, generator invariants, storage validation. Locked scripts, no unpinned `npx`.
- `npm run build && npm run preview` — verify the production artifact, not just dev server.
- Playwright MCP against the preview URL: screenshot both camera views; drive the deterministic straight shot via the dev-gated debug hook; assert one-and-only-one evaluation event fires.
- Manual acceptance: user plays L1–L3; guides fade on 3-of-5 qualifying; `R`/`N` behave per contract; reload preserves progress; corrupted storage resets cleanly.

## Critique disposition (summary)

Adopted: tangent-guide removal · ShotGeometry authority + aim-error scoring · TOI event ordering incl. cushions/pockets · unified table geometry with pocket gaps/jaws · generator seeding + invariants + feasibility · shot FSM idempotency + input policy (no Tab steal) · versioned validated persistence · outcome/miss-distance/thick-thin contracts · loop hygiene · vertical-slice ordering · locked scripts + production-build testing · texture deferral · exam exemption from tiers.

Discarded (with reason): trusted-scoring/auth concerns (personal local tool) · multi-tab policy, storage backups, migration test suite (YAGNI at this scope; versioned validate-or-reset suffices) · ball-ball throw implementation (out of scope; labeled ideal instead) · deploy rollback/static-host selection (runs locally on the Pi) · physical calibration of coefficients to a reference table (published typical values are adequate for teaching geometry).

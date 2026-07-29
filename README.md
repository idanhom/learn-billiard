# Pool Angle Trainer

A browser trainer for one thing: cue stick → cue ball → object ball, and how the
cut angle decides where the object ball goes. Not a game of 8-ball — there are
no rules, no opponent and no break. Just shots, and honest feedback on your aim.

## Running it

```bash
npm install
npm run dev        # http://127.0.0.1:5173
```

Or the production build:

```bash
npm run build
npm run preview    # http://127.0.0.1:4173
```

## Playing

| | |
|---|---|
| drag with the left button | aim (hold `Shift` to fine-tune) |
| `←` / `→` | nudge the aim (hold `Shift` for coarse) |
| hold `Space` | charge power, release to strike |
| `V` | switch between behind-the-cue and overhead |
| `.` | cycle full / half / quarter speed |
| `C` | cycle fast / normal / slow cloth |
| `R` | retry the same layout |
| `N` | next shot |
| `1`–`7` | jump to a level |

Aiming is by drag rather than by pointing at the cloth. Pointing reads well on
paper, but behind the cue the camera sits low and close to the table, so a few
pixels near the horizon sweep an enormous angle. A drag maps a fixed number of
pixels to a fixed number of degrees no matter where the camera is. The rate is
`AIM_DEGREES_PER_PIXEL` in `src/game/input.ts` — one constant, currently 0.08°,
about 8° per 100px.

## Slow motion

The simulation runs on a fixed 1/240 s tick, and wall-clock time only decides
*how many ticks a rendered frame is allowed to run*. So `.` changes how long you
watch a shot for, not what the shot does — quarter speed replays identical
physics, collision for collision. The browser verification asserts exactly this:
the same shot at 1x and 0.25x differs in wall-clock by 4.7x and in simulated
duration by nothing at all.

The setting is remembered between sessions, stored separately from your
progress so a bad preference can never cost you a level.

## How it scores you

**On your aim, not on whether the ball goes in.** A pot depends on power and on
how the pocket is tuned; the angle you aimed at depends only on you. So a shot
"qualifies" when the line you struck along is within the level's tolerance of
the ideal line — 2° on level 1, tightening to 0.75° by level 5. Pots, scratches
and wrong-pocket drops are all reported, but they don't drive progression.

Three qualifying shots out of the last five take away one layer of guides:

0. aim line, ghost ball, path to the pocket, and the live thick/thin readout
1. the path to the pocket and the live thick/thin readout go
2. the ghost ball goes
3. everything goes — you read the angle yourself

A bad run never sends you backwards. Clearing tier 3 completes the level.

Level 7 is the exam: no guides, no tiers, ten shots, scored on pots.

## Calibrating yourself

After every shot the report tells you how you missed — `1.24° thick`, or
`left`/`right` on a straight-in, where thick and thin have no meaning.

More useful is the **Recent shots** panel: the last twelve shots and, above
them, the average. One shot being thick is noise; *consistently* hitting cuts
0.9° thick is a bias you can carry to a real table and correct for. Cuts and
straight-ins are averaged separately — a left bias on straight shots has nothing
to do with a thick bias on cuts, and folding them together would cancel a real
tendency against an unrelated one. Shots that miss the object ball entirely are
excluded; they say nothing about how thick you are hitting them.

The history clears when you change level, since a tendency measured on
straight-ins tells you nothing about thin cuts.

## The physics is idealised

Centre-ball hits only — no english, no draw, no swerve. No throw between balls,
and cushions impart no sidespin. Balls slide, then roll, with published typical
friction values rather than measurements of a specific table.

Cushions *do* couple top and bottom spin, because that is what makes a rail
behave like a rail: the nose sits above the ball's centre, so the impulse also
torques the ball. A rolling ball hit square comes off at 0.65 of its speed and
settles at 0.50 once it has skidded out of its now-backwards roll — both
published figures, from one coefficient.

Cloth speed is a setting (`C`) with three presets inside the published
0.005-0.015 range for rolling resistance, so you can match your own table
rather than accept a guess.

**Known deviation:** after a rolling cue ball hits an object ball square, the
object should travel 6.5-8x farther than the cue ball; here it travels 5.25x, so
the cue ball drifts a little too far. The cause is that ball-to-ball collisions
are frictionless. Modelling that friction would introduce throw, which would
break the ghost-ball line-of-centres model this trainer teaches and scores
against — so it is deliberate, not an oversight.

This matters, and the app says so on screen. Everything the guides teach is
consistent with what the simulation does — which is why there is no static 90°
tangent line: with restitution below 1 and a sliding cue ball picking up follow,
the cue ball doesn't leave along the tangent, so drawing that line would teach
you something this table then contradicts.

Angles transfer to a real table. Cue ball control does not.

## Development

```bash
npm run typecheck
npm test              # geometry, physics, progression, persistence
npm run build
npm run preview       # then, in another terminal:
npm run verify:browser
```

`verify:browser` drives the production build in a real browser: both cameras,
tier promotion, reload persistence, corrupt-storage recovery, and a frame-time
pass. Screenshots land in `artifacts/`. It talks to the page through a debug
hook that is exposed in dev builds, and in a production build only when the URL
carries `?debug=1`.

Design notes and the decisions behind them are in
`docs/superpowers/specs/2026-07-28-pool-angle-trainer-design.md`.

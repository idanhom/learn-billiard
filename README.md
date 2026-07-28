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
| Move the mouse | aim |
| `←` / `→` | fine aim (hold `Shift` for coarse) |
| hold `Space` | charge power, release to strike |
| `V` | switch between behind-the-cue and overhead |
| `R` | retry the same layout |
| `N` | next shot |
| `1`–`7` | jump to a level |

## How it scores you

**On your aim, not on whether the ball goes in.** A pot depends on power and on
how the pocket is tuned; the angle you aimed at depends only on you. So a shot
"qualifies" when the line you struck along is within the level's tolerance of
the ideal line — 2° on level 1, tightening to 0.75° by level 5. Pots, scratches
and wrong-pocket drops are all reported, but they don't drive progression.

Three qualifying shots out of the last five take away one layer of guides:

0. aim line, ghost ball, path to the pocket, and the live thick/thin readout
1. the path to the pocket goes
2. the ghost ball goes
3. everything goes — you read the angle yourself

A bad run never sends you backwards. Clearing tier 3 completes the level.

Level 7 is the exam: no guides, no tiers, ten shots, scored on pots.

## The physics is idealised

Centre-ball hits only — no english, no draw, no swerve. No throw between balls.
Cushions rebound with a fixed restitution and no spin coupling. Balls slide,
then roll, with published typical friction values rather than measurements of a
specific table.

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

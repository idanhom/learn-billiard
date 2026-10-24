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

Every key also has a button in the toolbar along the bottom of the screen. On
a small screen, a phone either way up, the panels shrink, and the level list
and the recent shots fold away behind toolbar buttons of their own, so the
table keeps most of the screen. `?` opens the controls and the notes on what
the physics leaves out.

Aiming is by drag rather than by pointing at the cloth. Pointing reads well on
paper, but behind the cue the camera sits low and close to the table, so a few
pixels near the horizon sweep an enormous angle. A drag maps a fixed number of
pixels to a fixed number of degrees no matter where the camera is. The rate is
`AIM_DEGREES_PER_PIXEL` in `src/game/input.ts` — one constant, currently 0.08°,
about 8° per 100px.

Every shot is dealt with the cue pointed 3–8° off the object ball's centre, to
one side or the other, and never within 3° of the line. Finding the line is the
exercise, so the cue does not start on it. `R` deals the same layout again with
the cue somewhere new.

## Slow motion

The simulation runs on a fixed 1/240 s tick, and wall-clock time only decides
*how many ticks a rendered frame is allowed to run*. So `.` changes how long you
watch a shot for, not what the shot does — quarter speed replays identical
physics, collision for collision. The browser verification asserts exactly this:
the same shot at 0.25x takes several times as long on the clock as at 1x, and
differs in simulated duration, in outcome and in the final orientation of every
ball by nothing at all. (Not quite four times: once the object ball has dropped
or stopped, the rest of a shot fast-forwards at either speed.)

The setting is remembered between sessions, stored separately from your
progress so a bad preference can never cost you a level.

## Power

The meter is not linear, and that is the point.

A cue can send a ball anywhere from a touch shot to a break, but almost nothing
in this trainer wants a break. An ordinary pot — 0.6 m to the pocket, half a
metre of cue-ball travel — is a 1.22 m/s stroke, which on a bar spread linearly
across 0.35–4.5 m/s is 21% of the travel. The longest pot in the curriculum,
level 6's 1.4 m, asks 1.93 m/s, or 38%.

Not every shot, though, and that is why the range itself stays: an 80° cut
with 0.4 m to the pocket throws away cos(80°) at contact and genuinely needs
3.86 m/s, which is 85% of a linear bar. The problem is the shape, not the ends.

So the bar is a curve — `speed = 0.35 + 4.15 × power^1.7` — set so an ordinary
pot lands near 40%:

| power | launch | band |
|---:|---:|---|
| 20% | 0.62 m/s | slow |
| 30% | 0.89 m/s | slow |
| 40% | 1.22 m/s | medium |
| 50% | 1.63 m/s | medium |
| 70% | 2.61 m/s | fast |
| 100% | 4.50 m/s | power |

Measured over 200 generated layouts per level, the stroke each one asks for now
runs from 32% on a straight-in to 89% on the worst thin cut, with the median
climbing 38% → 40% → 43% → 50% → 64% as the cut angle opens up. What pushes you
up the meter is the *cut*, which is worth feeling: a thin cut throws away
`cos(θ)` of the speed at contact, so a 70° cut has to arrive almost three times
as fast as a straight-in to send the object ball the same distance.

The exponent follows the cloth rather than taste: it is whatever puts that
typical pot at 40%, and it has to be re-derived if the rolling resistance
moves.

The range itself is unchanged — an 80° cut genuinely needs most of it, and shot
generation uses that ceiling to decide a layout is makeable at all.

Under the meter, always, is what you just charged, in the same units and the
same words a real table uses: `0.81 m/s · slow`. That is a speedometer, not an
answer, so it stays on at every tier and through the exam.

The **tick on the bar** is the answer — the stroke that would leave the object
ball dying in the pocket, computed for the cloth you are actually on. So it is
a guide, and it comes away with the ghost ball at tier 1. It is absent when no
legal stroke can make the ball, rather than pinned at 100% implying one can.

It answers for the object ball, not for the cue ball. On a thin cut the cue
ball keeps nearly all its speed, and it can come back off two cushions into the
object ball before that ball has finished creeping in — the stroke was right,
and the cue ball spoiled it. Over 500 level-5 layouts at the recommended power
that happened once, and it knocked the ball 20 cm wide of the pocket. Every
other layout on every level potted, 500 out of 500. Where the cue ball goes is
the part of the game this trainer does not teach.

Once the object ball has dropped or stopped, the rest of the shot plays at four
times the speed: off a thin cut the cue ball can run on for three seconds and
as many rails after the part you were watching. It is the same shot, tick for
tick — only the clock is faster.

## How it scores you

**On your aim, not on whether the ball goes in.** A pot depends on power and on
how the pocket is tuned; the angle you aimed at depends only on you. So a shot
"qualifies" when the line you struck along is within the level's tolerance of
the ideal line — 2° on level 1, tightening to 0.75° by level 5. Pots, scratches
and wrong-pocket drops are all reported, but they don't drive progression.

Three qualifying shots out of the last five take away one layer of guides:

0. aim line, ghost ball, path to the pocket, the live thick/thin readout, and
   the target mark on the power meter
1. the path to the pocket, the live thick/thin readout and the power mark go
2. the ghost ball goes
3. everything goes — you read the angle yourself

A bad run never sends you backwards. Clearing tier 3 completes the level.

Only the first shot at a layout counts. `R` deals the same layout again, but a
retry has already seen where the first shot went, so it is practice: it is
played and reported, marked as a retry, and counted toward nothing — not the
tier, not the level's record, not the exam.

Level 7 is the exam: no guides, no tiers, ten shots, scored on pots.

The shot that clears a level, or ends an exam run, stays on the table with its
report and a summary card until you move on (`N`, or Continue). Going back to a
level you have already cleared is practice by choice: it keeps its record, and
it does not move you on again after every shot.

## Calibrating yourself

After every shot the report tells you how you missed — `1.24° thick`, or
`left`/`right` on a straight-in, where thick and thin have no meaning.

More useful is the **Recent shots** panel: the last twelve shots and, above
them, the average. One shot being thick is noise; *consistently* hitting cuts
0.9° thick is a bias you can carry to a real table and correct for. Cuts and
straight-ins are averaged separately — a left bias on straight shots has nothing
to do with a thick bias on cuts, and folding them together would cancel a real
tendency against an unrelated one. Shots that miss the object ball entirely are
excluded; they say nothing about how thick you are hitting them. Retries are
listed but excluded too: a retry leans away from the miss it has just seen,
and averaging it in would pull a real bias toward zero.

The history clears when you change level, since a tendency measured on
straight-ins tells you nothing about thin cuts.

## The physics is idealised

Centre-ball hits only — no english, no draw, no swerve. No throw between balls,
and cushions impart no sidespin. Balls slide, then roll — visibly so: the cue
ball carries six marks, and off the tip it skids, turning about 2.4x less than
its travel would imply, before the cloth catches it and the two lock together.

Balls *do* rub against each other at the contact, though only in the vertical
direction. The two contact faces sit on opposite sides of their respective
centres, so they mesh like gear teeth: a cue ball rolling forward leaves the
object ball with a little backspin, which is the published direction — follow
transfers as a touch of draw, exactly as left english arrives as right english.
That is what keeps a rolling cue ball from drifting too far after the hit. The
horizontal share of the same friction is throw, and it is declined: at a
half-ball hit that is about 1.7° of deflection, which would break the
ghost-ball line-of-centres model this trainer teaches and scores against.

Sliding friction, restitution and ball-to-ball friction are published typical
values rather than measurements of a specific table. The two cushion
coefficients are fitted to published measurements, as below. The rolling
resistance is neither, and the next section says what it is instead.

Cushions follow Han (2005), as the pooltool simulator implements it. The rail
touches the ball 0.27R above its centre (the WPA's nominal height), so the push
runs through the centre at a 15.7° tilt, back and down into the cloth, and
friction at the rail's nose is what turns the ball. Its restitution (0.74) and
friction (0.23) are fitted to Alciatore's measurements on typical cloth: a
rolling ball hit square comes off at 0.71 of its speed and settles at 0.48 once
it has skidded out of its now-backwards roll (measured: 0.72 and 0.52); a stun
ball comes off at 0.63 and settles at 0.51 (0.58 and 0.54); and a slow rolling
ball leaves the rail within 6° of his measured angles from 10° to 80°.

The model it replaced pushed above the centre instead, and got the rolling
ball about right but sent a stun ball off at 0.31 and a ball with draw at 0.13.
Restitution here is constant in speed: published measurements disagree on
which way it moves, and none of them is a pool table. The cushion still puts no
sidespin on a ball. And one known miss: measured, a ball with draw comes off a
rail faster than a stun ball, and here it comes off slower, because this model
has no table friction during the impact. Nothing in the trainer draws yet.

Cloth speed is a setting (`C`), so you can match your own table rather than
accept a guess. The three presets are 0.0156, 0.022 and 0.0308, which is a
deliberate departure from the literature and is stated here as one: the usual
quoted range is 0.005–0.015, and Alciatore's TP B.2 derives μ_r = 0.01 by
timing a rolling ball to a stop under `a = μ_r·g`. Normal cloth here is over
twice that.

On top of it sits one more departure, with no published value behind it at
all: below 0.12 m/s the rolling resistance doubles. Real cloth does something
like this as the ball settles into the pile while it dies, but the number here
is not measured — it is calibrated by eye against how a ball ought to stop.
Treat it as a judgement, not a citation.

There used to be a second one. Above 1 m/s the rolling resistance was ten times
larger, so the cue ball off a thin cut, which keeps nearly all of its speed,
would not run on round the table. Real cloth does nothing like it, and it was
not merely unmeasured but impossible: ten times 0.022 is more than the 0.2
sliding friction, and no ball loses speed faster rolling than skidding. It is
gone, and the cue ball now runs as far as the cloth says.

What the two buy, on this 7-foot table: a table length of free roll in 4.0 s
instead of 5.8, down and back in 5.75 s instead of 8.4, and a ball that spends
its last 0.2 m/s dying over 0.65 s and 7.6 cm instead of 1.4 s and 17 cm. That
terminal crawl is what the "it feels like ice" reports kept landing on. The
three presets come out at 4.7 s, 4.0 s and 3.4 s for a table length.

Whether it has gone too far the other way is open — nobody has timed it against
a real table. **Do that.** Roll a ball the length of your table so it just dies
at the far cushion, and time it: about 5.8 s means the published value is right
and this is wrong, about 4 s means this is. Every figure above is held to the
code by `tests/documented-figures.test.ts`, the knee's own two numbers
included. That the simulation actually behaves that way — rather than merely
being configured to — is `tests/physics/world.test.ts`'s job.

After a rolling cue ball hits an object ball square, the object ball should
travel about seven times as far as the cue ball follows. That is Alciatore's
figure (*Billiards Digest*, June 2020, "Speed Control"), and he adds that it
varies some with the balls and the cloth. Here it is 7.3x at an ordinary pot's
contact speed of 0.79 m/s, 6.8x at 1.20, 6.6x at 1.55 and 6.5x at 2.5 —
settling toward the 6.4x that the slide-then-roll arithmetic gives with this
restitution and contact friction, and above the 6.25x of the frictionless
textbook case. It was 5.2x everywhere before contact friction, and used to be
listed here as a known deviation. (An earlier version of this section held
the ratio to a 6.5–8x band that nobody had a source for.)

Alciatore's ratio holds at every speed, and this one does not — that is the
price of the terminal knee. Below the knee every ball loses speed at a fixed
extra rate, which takes a proportionally bigger bite out of the cue ball's
short follow than the object ball's long run. On the softest shots — 0.50 m/s
at contact — it reaches 9.6x. There the cue ball follows under 3 cm, and nobody
can see where it stopped.

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

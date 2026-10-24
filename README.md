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

On a phone on the same network, `npm run preview:lan` serves the build to the
LAN instead of just this machine; open the address it prints.

### Hosting

Every push to `main` builds the trainer and publishes it to GitHub Pages
(`.github/workflows/pages.yml`), at https://idanhom.github.io/learn-billiard/.
One-time setup, in the repository's settings: the repository has to be
public, and Pages > Build and deployment > Source is set to **GitHub
Actions**.

It is one site for every device. A phone gets the touch controls and the small
layout because it has a touch screen and a small one, not because of which
browser it runs. Added to a home screen it runs full screen like an app, and on
an iPhone that is also what keeps its progress: Safari clears a site's saved
data after 7 days of use without a visit, and a home-screen app is not caught
by that.

## Playing

| | |
|---|---|
| drag with the left button | aim (hold `Shift` to fine-tune) |
| `←` / `→` | nudge the aim a twentieth of a degree (hold `Shift` for a whole one) |
| hold `Space` | charge power, release to strike |
| `V` | switch between behind the cue, overhead, and down in your stance |
| `.` | cycle full / half / quarter speed |
| `C` | cycle fast / normal / slow cloth |
| `R` | retry the same layout |
| `N` | next shot |
| `1`–`8` | jump to a level |
| `F` | call the fraction the shot needs |

On a touch screen, drag on the table to aim and nudge the aim a twentieth of a
degree at a time with the `‹` `›` buttons. Power is the strip down the right edge:
press it, drag down to the stroke you want, and lift to strike. The power
follows your finger, so lifting at the target mark plays the marked stroke. A
tap that does not travel is not a stroke, and sliding off the side of the strip
calls the shot off.

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

The stance view puts the eye where a player's is when down on the shot, on the
cue line 45 cm behind the cue ball and 30 cm over the cloth, and draws it at
true scale: the screen is a window onto the table, so an angle on screen is the
angle at the table. True scale depends on how far you sit from the screen,
which the controls panel lets you set; 60 cm to start. A desktop window is
often too short to hold both balls at true scale, and then the view widens just
enough to keep them. It is the default at the last tier and in the exam, when
the guides have gone and the question is how the shot looks from where you
will play it.

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
level 6's 1.4 m, asks 1.90 m/s, or 37%.

Not every shot, though, and that is why the range itself stays: an 80° cut
with 0.4 m to the pocket throws away cos(80°) at contact and genuinely needs
3.83 m/s, which is 84% of a linear bar. The problem is the shape, not the ends.

So the bar is a curve, `speed = 0.35 + 4.15 × power^1.71`, set so an ordinary
pot lands near 40%:

| power | launch | band |
|---:|---:|---|
| 20% | 0.61 m/s | slow |
| 30% | 0.88 m/s | slow |
| 40% | 1.22 m/s | medium |
| 50% | 1.62 m/s | medium |
| 70% | 2.61 m/s | fast |
| 100% | 4.50 m/s | power |

Measured over 200 generated layouts per level, the stroke each one asks for now
runs from 32% on a straight-in to 66% on the thinnest eighth-ball cut, with the
median climbing 39% → 41% → 44% → 48% → 54% from the full-ball level to the
eighth-ball one. What pushes you
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

## The levels

Levels 1 to 5 are the five ball fractions players aim by: how much of the
object ball the cue ball covers at contact, as seen down the cue.

| level | fraction | cut |
|---|---|---|
| 1 | full | 0° |
| 2 | ¾ | 14.5° |
| 3 | ½ | 30° |
| 4 | ¼ | 48.6° |
| 5 | ⅛ | 61° |

Each level's shots run halfway to the fraction either side of it, so the one it
is named for is always the nearest. Level 6 is long shots with the object ball
near a cushion, and level 7 the exam, which mixes in thin cuts to 70° and shots
of up to 1.3 m. Level 8 is a mixed review of the five fractions, dealing more
of the ones whose shots you miss most.

Once you reach the last tier of a fraction level, two shots in five come from
the fractions before it. Telling a half-ball cut from a three-quarter one is
part of the skill, and a level that only ever deals one kind never tests it.

Before a shot you can call the fraction you think it needs (`F`, or the
buttons in the shot panel once the numbers are hidden); the report says
whether you were right. At the middle tier, once the ghost ball has gone, the
panel draws the overlap your line makes as seen down the cue, so you learn
what each fraction looks like without being told which one the shot needs.

## How it scores you

**On your aim, not on whether the ball goes in.** A pot depends on power as
well as aim, and only aim is being trained. So each shot is scored on where
your line would send the object ball at the right stroke, against how far it
could go either side of the ideal line and still drop: the share of the pocket
you used. A shot "qualifies" when it used no more than the level allows: all
of the pocket on level 1, tightening to 70% by level 5. Pots, scratches and
wrong-pocket drops are all reported, but they don't drive progression.

That is a much finer test than the cue-ball degrees it replaced. On an
ordinary straight-in the pocket leaves about a fifth of a degree of aim either
side, and a long shot off a rail about a tenth; the two degrees level 1
used to forgive sent the object ball some seventeen degrees off line. Hence
the twentieth-of-a-degree nudge. A simulated player whose aim wanders by 0.15°
clears every practice level; one who wanders by a whole degree rarely
qualifies anywhere.

How far the pocket reaches is measured, not drawn. The object ball alone is
rolled from its spot at the speed the ideal stroke gives it, along lines
further and further from the ideal one, until it stops dropping. Real pockets
take more than the lines that never touch rubber: about 14% more on the open
table, where a ball can clip a facing deep in the jaws and still fall, and
several times as much along a rail, which steers a ball running into it on
toward the pocket.

The ideal line sends the object ball at the middle of the pocket as the ball
sees it, which is not always the middle of the pocket; the Pockets section
below says why. And it allows for throw: the ghost ball is where the cue ball
has to be for the object ball to leave along that line, which is a little
thinner than the line of centres pointing at it.

Three qualifying shots out of the last five take away one layer of guides:

0. aim line, ghost ball, path to the pocket, the cut and fullness numbers, and
   the target mark on the power meter
1. the path to the pocket, the numbers and the power mark go
2. the ghost ball goes
3. the aim line goes too, and you read the angle yourself

There is no live thick/thin readout at any tier. Zeroing a number on a panel
is a different skill from seeing the angle in the balls, and it is the one a
real table never offers.

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

After every shot the report says, in table terms, what you did and what
happened:

- **Aim**: how much of the pocket your line used, and which way, `thick` or
  `thin` on a cut and `left` or `right` on a straight-in, against the share
  the level allows.
- **Hit**: how much of the object ball you covered, against how much the shot
  needed, as fractions of a ball, which is how a cut is judged at a table.
- **Result**: potted; rattled out of the jaws, or hung in them; on line but
  stopped short by so many centimetres, which is the stroke and not the aim;
  or missed the pocket by so many centimetres, measured out at the pocket.

More useful is the **Recent shots** panel: the last twelve shots and, above
them, the average. One shot being thick is noise; *consistently* using half
the pocket thick is a bias you can carry to a real table and correct for. The
average is a share of the pocket rather than degrees off the cue ball, so a
long shot and a short one weigh the same. It is split by which way the shot
cuts, since a player can favour one side, and by band of cut angle once the
shots span more than one. Straight-ins are averaged on their own: a left bias
on straight shots has nothing to do with a thick bias on cuts, and folding
them together would cancel a real tendency against an unrelated one. Shots
that miss the object ball entirely are excluded; they say nothing about how
thick you are hitting them. Retries are listed but excluded too: a retry leans
away from the miss it has just seen, and averaging it in would pull a real
bias toward zero.

The history clears when you change level, since a tendency measured on
straight-ins tells you nothing about thin cuts.

## The physics is idealised

Centre-ball hits only: no english, no draw, no swerve, and cushions impart no
sidespin. Balls slide, then roll, visibly so: the cue
ball carries six marks, and off the tip it skids, turning about 2.4x less than
its travel would imply, before the cloth catches it and the two lock together.

Balls rub against each other at the contact, with the friction Alciatore fits
to Marlow's measurements in TP A.14: 0.11 when the surfaces barely slide, 0.06
at 0.7 m/s, and falling toward 0.01 as they slide faster. It works two ways at
once. Vertically, the two contact faces sit on opposite sides of their
respective centres, so they mesh like gear teeth: a cue ball rolling forward
leaves the object ball with a little backspin, which is the published
direction (follow transfers as a touch of draw, exactly as left english
arrives as right english), and that is what keeps a rolling cue ball from
drifting too far after the hit.

Sideways, the cue ball's motion across the line of centres drags the object
ball with it. That is throw: on a cut the object ball leaves a little short of
the line of centres, turned toward the way the cue ball was going. It is about
a degree on a rolling half-ball hit at medium pace, and nearer five on a slow
stun shot, which is enough to miss a pocket from across the table. So the
ghost ball shows the throw-corrected aim, over-cut by that much. Throw falls as
the contact speeds up, so the right aim moves a little with the stroke; the
ghost ball is drawn for the recommended one.

Sliding friction and restitution are published typical values rather than
measurements of a specific table, and the ball-to-ball friction is a published
fit to measurements. The two cushion coefficients are fitted to published
measurements, as below. The rolling resistance is neither, and the next
section says what it is instead.

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
varies some with the balls and the cloth. Here it is 7.2x at an ordinary pot's
contact speed of 0.79 m/s. Faster contacts read lower: 6.2x at 1.20 m/s, 5.9x
at 1.55 and 5.6x at 2.5, because the friction falls with speed and a fast
contact gears less spin, so the ratio heads for the 5.2x it would be with no
friction at all at this restitution. Whether real balls fall off like that is
open, since Alciatore's figure does not say at what speed. (With a constant
0.06 the ratio held between 6.5x and 7.3x at all four speeds, and an earlier
version of this section held it to a 6.5–8x band that nobody had a source
for.)

At the slow end the terminal knee pushes it the other way. Below the knee
every ball loses speed at a fixed extra rate, which takes a proportionally
bigger bite out of the cue ball's short follow than the object ball's long
run. On the softest shots, 0.50 m/s at contact, it reaches 10.5x. There the
cue ball follows under 3 cm, and nobody can see where it stopped.

This matters, and the app says so on screen. Everything the guides teach is
consistent with what the simulation does — which is why there is no static 90°
tangent line: with restitution below 1 and a sliding cue ball picking up follow,
the cue ball doesn't leave along the tangent, so drawing that line would teach
you something this table then contradicts.

Angles transfer to a real table. Cue ball control does not.

## Pockets

The pockets follow the WPA's equipment specification (section 9). A corner
mouth is 4.57" between the cushion noses and a side mouth 5.08", inside the
4.5–4.625" and 5–5.125" it allows. Behind the noses the cushions are cut back
into the pocket at 142° at a corner and 104° at a side, so both narrow toward
the hole. Between the mouth and the hole is the shelf, slate the ball still
rolls on: 1.57" deep at a corner and 0.2" at a side.

A ball drops when its centre crosses the back edge of the shelf. Until then it
is still on the table: it can meet a facing and rattle back out, or die on the
shelf and hang in the jaws. A firm stroke rattles where a soft one drops.

That moves the ideal line. From any spot there is a band of lines along which
the object ball reaches the hole without touching rubber, and the trainer aims
at the middle of it, the line with the most room either side. Straight in,
that is the middle of the mouth. Coming into a corner down a rail, the far
facing closes the band from its far side, so its middle moves toward that
rail: half a centimetre to a centimetre and a quarter, for a ball 0.8 m out.
The corner of the table, where the trainer used to aim, can be off the band
altogether; from a flat enough angle a ball sent there catches the rail it is
running along before it reaches the mouth.

A ball frozen to a rail is not dealt. Sent along its rail, throw drives it into
the cushion and it comes back off, because the simulation takes the cue ball,
the object ball and the rail one pair at a time where the real contact is all
three at once; and sent any other way, the ghost ball that would send it is
inside the rail. Level 6 deals balls within six centimetres of the cushion
instead.

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

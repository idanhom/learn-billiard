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

A first launch is three coached shots: the ghost ball and turning the line
onto it, the stroke and the meter's marker, and what the tiers take away. Each
step moves on when you have done what it asks, and Skip ends it; choosing a
level does too. It does not come back once done.

| | |
|---|---|
| drag with the left button | aim (hold `Shift` to fine-tune) |
| `←` / `→` | nudge the aim a twentieth of a degree (hold `Shift` for a whole one) |
| `↑` / `↓` | move the tip up the ball for follow, or down it for draw (levels 14 to 16, 19 and 20) |
| hold `Space` | charge power, release to strike |
| `V` | switch between behind the cue, overhead, and down in your stance |
| `.` | cycle full / half / quarter speed |
| `C` | cycle fast / normal / slow cloth |
| `R` | retry the same layout. While the balls still roll, the rest of the shot plays out at once and is scored as it would have been |
| `N` | next shot, mid-shot the same way; `Space` or `Enter` too, once a shot is scored |
| `1`–`9`, `0` | jump to a level (`0` is level 10) |
| `F` | call the fraction the shot needs |
| `G` | get down on the line, or stand back up (last tier and exam; optional) |
| `T` | at the table: what to take to a real one, and what this can't teach |
| `M` | sound on or off |
| `P` | replay the shot just played, from overhead at a quarter speed; `Esc` stops it |

On a touch screen, drag on the table to aim and nudge the aim a twentieth of a
degree at a time with the `‹` `›` buttons. Power is the strip down the right edge:
press it, drag down to the stroke you want, and lift to strike. The power
follows your finger, so lifting at the target mark plays the marked stroke. A
tap that does not travel is not a stroke, and sliding off the side of the strip
calls the shot off.

The table sounds as it plays: the strike, the balls meeting, the cushions and
the pockets, each made from the simulation's own contacts and as loud as the
contact was hard. `M` turns it off, as does the switch under `?`. A potted ball
drops into the hole rather than vanishing at its edge.

Once a shot is scored, the table keeps where each ball went, drawn on the
cloth, with the line the object ball needed dashed beside it; it reads best
from overhead. Once a shot is scored, `Space` or `Enter` deals the next one, so a run of shots
needs no reaching for `N`. Under `?`, Next shot by itself deals it three
seconds after the report instead, counting down in the report; a replay, an
open panel or a summary card holds it.

`P` (or Replay in the report) plays the shot again from
overhead at a quarter speed. The solver runs on a fixed tick, so the replay is
the same shot, not a reconstruction of it. It does not wait for the balls to
creep to a stop: once the last contact has passed and every ball is down to a
crawl, it fades back into the shot, where the trails show where each one
stopped. While the self-estimate is asking, both wait, since the dashed line
would answer it.

Under `?` the guides can be drawn in high contrast: solid, brighter and twice
as thick. When the system asks for reduced motion the camera cuts between
framings instead of gliding, a potted ball goes without the drop, and nothing
in the HUD slides or fades. The shot report is a live region, so a screen
reader reads each result as it comes; the auto-next countdown is left out of
it.

Every key also has a button in the toolbar along the bottom of the screen. On
a small screen, a phone either way up, the panels shrink, and the level list
and the recent shots fold away behind toolbar buttons of their own, so the
table keeps most of the screen. After a shot the power strip and the aim
buttons go, and the report keeps to the verdict and the aim, low down upright
and beside the table sideways; **Details** opens the rest. `?` opens the
controls and the notes on what the physics leaves out.

At the table (`T`) gathers what carries the trainer over to a real table.
**Drill sheet** deals ten shots to set up at a real table, from the fractions
you miss most here, weighted as the mixed review weights them. Each gives the
hit, the cut it should come to, the pocket, and where both balls go in
diamonds, with a picture; the sheet prints on its own, in black on white.
**Session log** keeps your sessions at a real table: the day, the table, shots
taken and made, the sheet if you played one, and a note. It sets your last
five sessions against the five before, which is the test of whether any of
this carries over. It lives in this browser only.
**Time your cloth** is a stopwatch for the test below: roll a ball a table
length so it just dies at the far cushion, time it, and the panel picks the
cloth here that comes nearest, for a 7-, 8- or 9-foot table. It picks one of
the three; a hand-held stopwatch is not good enough to fit a new coefficient.
**What this can't teach** is the rest: stance and sighting, a bridge, a
straight stroke (with a test for it), spin and cue ball control, speed by feel,
and the table you play on. Every stroke here goes exactly where you aimed, so
every miss here is the aim; at a table it may be the stroke.

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
enough to keep them.

At the last tier and in the exam, when the guides have gone, you can play from
it the way you would at a table: choose the line standing, then get down on it
(`G`, or Get down). Once down, the line moves only half a degree either way;
anything bigger means standing back up to choose again, and the stroke waits
until the aim has been still for a moment. Getting down is your choice: from
any view, standing, the stroke goes as on any other level. The report says how
long the shot took, whether it was played in the stance or standing, and how
many times you stood back up.

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
ball by nothing at all.

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

Level 9, Read the angle, has no shots at all. It alternates two drills. In one
the layout shows for a second and a half, then the balls go and you call the
fraction the shot needed, by `1` to `5` or the buttons. In the other you click
or tap where the ghost ball belongs, and the line of centres through where you
put it is scored by the share of the pocket it would use, as a shot is. Either
way the answer then shows on the table: the true ghost ball with its lines, and
for a placing yours in red, with the line it would have sent the object ball
on. The drills count toward the tiers as shots do, and show no guide at any.

Level 10, Weak angles, deals from the ten-degree bands of cut you have
mastered least (below), each band as likely as the share of its recent shots
that missed, an untried band as an even chance, and a mastered one still now
and then.

Level 11 is the daily set: ten shots, the same for everyone on a given day,
dealt in turn from levels 1 to 6, with no guides and from the stance. It is
scored on the median share of the pocket your shots used, so one wild shot
cannot sink it, and a shot that misses the object ball counts as ten pockets
off. Only your first run of the day counts; after it the set is practice, and
the card at the end sets the run against your first runs of the days before.
A run in play is kept, so a reload or a visit to another level picks it up
where it was rather than starting the day's first run over, and `N` deals the
same shot until it is played, so none can be passed over. The exam keeps your
first finished run of each day beside your best, and the levels panel counts
the days in the last seven with any practice, rather than a streak that one
missed day would break.

Levels 12 and 13 are about where the cue ball goes, centre ball: the 90° rule,
stunned, and the 30° rule, rolling. The shot is aimed and struck for you, and
you say beforehand where the cue ball will go by clicking on its path from the
ghost ball. You are scored on the angle between that and where it went, within
6°: stunned, the way it left; rolling, the way it ran once the cloth had
straightened its curve. The stun is struck below centre with just enough
backspin that the cloth has taken it all off at contact, arriving at 1.2 m/s;
the roll is struck 0.4 of the radius above centre, which rolls from the start.
As the physics section says, neither rule is exact here or at a table, which
is the point of saying where the ball goes rather than reciting the rule.

Levels 14 to 16 are about where the cue ball stops, and the only ones where
the tip moves: `↑` and `↓` (or ▲ ▼ beside the aim buttons on a touch screen)
take it a tenth of the radius up the ball for follow or down it for draw, as far
as half the radius either way, past which a real tip miscues. A tip at offset b
starts the ball spinning at 2.5 (b/R) times its speed, so 0.4 R rolls it from
the start. Each shot is a straight-in, and counts when it pots the ball and
leaves the cue ball inside a ring 10 cm across the spot. The stop shot's spot
is where the cue ball meets the object ball; the follow and draw ladders' spots
are 20 cm past it or back from it at the first rung and further at each of
the four, which are the levels' tiers, with the layout leaving room to reach
them. The guides show the shot throughout; what is tested is the cue ball.

Levels 17 and 18 take the object ball away. Speed control asks the cue ball to
stop in a ring 50 cm away at the first rung and 85 cm, 1.2 m and 1.5 m at the
others, touching no cushion, with a quarter metre of table past the ring. The
lag sends it to the far cushion and back, to stop in a ring 6 cm off the near
cushion without touching it, as players lag for the break. The cue starts
pointed the right way, so the drill is the speed alone, and neither shows the
power marker.

Level 19, Position zones, deals ordinary cuts with a zone 30 cm across to
leave the cue ball in, as a player plays for the next shot: pot it and stop in
the zone. Every zone is one the cue ball can reach. Strokes are tried on the
shot's ideal line at a spread of speeds and tips until one pots cleanly and
leaves the cue ball in open table, and the zone is centred where it stopped.
Finding a stroke that does it is the drill, so the line is shown and the speed
and tip are yours.

Level 20, Patterns, deals two balls to pot in order at the first two tiers and
three at the last two, each shot played from wherever the last one left the
cue ball, with the balls still to come on the table. A run counts once, at its
end, when every ball has gone down in order; a miss or a scratch ends it and
the next is a fresh pattern. Every pattern can be run: it is built forward,
each ball placed as an ordinary cut from where a clean stroke on the shot
before left the cue ball, and kept only if, with every ball on the table from
the start, those strokes still run it the same way. Building one takes a
fraction of a second of simulation when it is dealt.

Level 21 is the assessment, the exam made general: twelve stations played
straight through with no guides, one point each. Four cuts, from three-quarter
ball to an eighth, score on the pot. Two stop shots, a follow of 40 cm and a
draw of 35 cm, two speed-control rings at 85 cm and 1.2 m, and two position
zones score on their own levels' tasks. The card at the end gives the score
part by part, a rating (starting out below 4, developing from 4, solid from 7,
strong from 10), your best, and your first finished run of the day. It
follows the shape of the Billiard University and PAT exams, standard drills
scored together, but it is not calibrated against either, and the ratings are
this trainer's own. `N` deals the same station until it is played.

Levels 22 and 23 are the shots for when there is no pot, centre ball. A kick
puts a ball straight between the cue ball and the object ball, and counts when
the cue ball meets a cushion and then the object ball before anything else.
The mirror system aims at the object ball reflected in the cushion, across the
line the ball's centre rolls along against it, and at tier 0 the reflection
is drawn. It is where to start, not the answer: aimed straight at it, a kick
gets there in 42 of 60 layouts at 2.5 m/s but only 10 at 1.8 and 3 at 1.2,
because a rolling ball's spin bends its path as it comes off the cushion, as
it does at a table. A safety deals the object ball and two others, and counts
when the cue ball hits the object ball first, nothing goes down, and no pocket
is left with a direct pot from where the cue ball stops: a line to the ghost
ball and on to the pocket that nothing blocks, at a cut and a stroke this
trainer would deal.

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
wrong-pocket drops are all reported, but they don't drive progression. A pot
off aim is called one: from inside the pocket but past what the level allows
it is off aim, though potted, and from a line outside the pocket it is a lucky
pot, and the recent shots list marks it as luck.

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

## Mastery

Every shot played without the ghost ball, on any level, counts toward the
mastery of its ten-degree band of cut, from 0–10° to 60–70°. Levels judge a
shot against their own allowance, which tightens as they go; mastery holds
every band to one standard, 80% of the pocket, so a band played mostly on the
forgiving early levels does not look better than it is. The levels panel shows
each band as a cell coloured from red to green by the share of its last 20
such shots that met the standard, once there are ten. A band where 16 of the
last 20 meet it is mastered, and stays mastered: an achievement for a skill
shown, not for time put in, and the only kind there is. Mastery is kept with
your progress; a save from before it loads with no band played.

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

From tier 2 on, once the ghost ball has gone, and in the exam, the report waits
for you to say how you hit the shot: way thick, a bit thick, on, a bit thin or
way thin (left and right on a straight-in), with `1` to `5` or the buttons;
`Esc` skips. On is within a quarter of the pocket either side of the middle, a
bit is inside the pocket, and way is outside it. The report then sets what you
said beside what it was. Knowing your own miss without being told is what lets
you correct at a table, where nothing reports it.

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
and this is wrong, about 4 s means this is. On a 9-foot table the three cloths
take 5.4, 4.6 and 3.9 s and the published value 6.6 s; Time your cloth, under
At the table, works these out for your table and has the stopwatch. Every figure above is held to the
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

The two rules players steer the cue ball by hold here about as well as they
do at a table. Struck centre and arriving stunned, the cue ball leaves 81° to
87° from the object ball's line rather than 90°: restitution of 0.95 keeps a
little of its speed along the line of centres, and the rub at contact throws
both balls a little more, so it falls furthest short on full hits. Arriving
rolling, it ends up 27° to 35° off its own line from a quarter to a
three-quarter hit, most at half ball, against the textbook 27.3° to 33.7°.
`tests/physics/world.test.ts` holds both.

Angles transfer to a real table. Cue ball control does not.

## Diamonds

The rail caps carry the eighteen sights of the WPA's specification (section
6): three between each pair of pockets, an eighth of the playing length apart,
each centred 3 11/16" (93.7 mm) back from the cushion nose. Lines between
opposite sights divide the playing surface into squares, eight along and four
across, so a diamond is 24.75 cm on this 7-foot table.

The shot panel says where the balls start in diamonds, so a layout can be set
up on a real table: counted from the bottom-left corner pocket as the overhead
view shows the table on a wide screen, first along the long rails, 0 to 8,
then across, 0 to 4. A tenth of a diamond is 2.5 cm here, a little under a
ball's radius. On a bigger table the same diamonds lay the shot out larger,
but the balls do not grow with it, so the cut comes out different: by a third
of a degree for a typical shot on an 8-foot table and half a degree on a
9-foot, and by over a degree for one shot in ten on a 9-foot. That is more
than the aim a shot here allows, so set it up on a 7-foot table to play the
shot you saw. The coordinates are left off on a phone, where the panel has no
room for them.

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

## The room

The table stands in a billiard room laid out to the WPA's [Recommended
Equipment Specifications](https://wpapool.com/wp-content/uploads/2024/01/RECOMMENDED-EQUIPMENT-SPECIFICATIONS.pdf)
(read 2026-10-25), so what the stance and behind views show past the table is
what a player down on a real one sees, at true scale:

- The floor is 76.5 cm below the bed, the middle of the 29 1/4" to 31" that
  section 2 allows.
- The walls stand 1.83 m out from the outside edge of the rails, the 6 feet
  that section 19 asks for between the rail and any obstacle. Round this
  7-foot table that makes the room 5.92 by 4.93 m.
- The lamp's underside hangs 40" (1.016 m) over the bed, the lowest that
  section 15 allows for a fixture that can be moved aside. It is drawn only
  while the eye is below that, so it never hangs between the overhead view and
  the table.

None of it is lit by the scene's lights. Its light is worked out once, as the
page loads, and stored in the colours of its surfaces: the lamp's light
falling past the table, which leaves a dark skirt of shadow round it and a soft
halo beyond; the venue's own dim light on the floor and walls, fading up the
walls into the dark, so there is no ceiling to draw; and two sconces on each
long wall. Each amount is a fraction of the light on the bed, measured against
what the scene's lights give the cloth, so it stays right if those lights
change. Under the table the floor gets a tenth of the bed's light, the halo
just under half, and the floor by the walls between a quarter and a third.

The quarter is not the WPA's figure. Section 15 asks for at least 520 lux on
the bed and 50 in the rest of the room, a ratio of about 0.1, but those are
minimums, and at a tenth the room rendered close to black. It sits higher,
still inside what the specification allows, so that it reads on a screen.
Where the lamp's shade cuts its light off (50 to 60 degrees from straight
down) and how wide a sconce's pool is are design choices, not measurements.

It is meant to cost close to nothing, since this runs on a Pi and on phones:
four draw calls, 21,514 triangles, and two textures drawn as the page loads
(floorboards, and one bay of panelling) that take 2 MiB of video memory with
their mipmaps. No lights, no shadows, nothing to download. On the development
machine it is built and baked in 25 to 30 ms, and up to 60 while the machine
is busy. There, on an Intel Iris Xe, a frame takes 1.5 ms with the room and
1.2 ms without it. Under software rendering, which is what `verify:browser`
runs on, it takes 57 ms against 34, because a software rasteriser pays for
every pixel and the black the room replaced cost nothing. It has not been
timed on a Pi.

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

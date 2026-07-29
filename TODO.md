# TODO

## `isPowerFeasible` judges full-power shots with the wrong cue ball

**Status:** not started. Known, and safe in direction. Binds on level 5 and
nowhere else. Needs a signature change, so it is a decision rather than a
patch.

`src/geometry/shot.ts` — `isPowerFeasible` asks whether *any* legal stroke can
drive the object ball to the pocket, so it evaluates the object ball's run at
`MAX_CUE_SPEED`. Since `5c12fbc` it also passes `objectRollFraction(cut)`, the
backspin a contact gears onto the object ball, which costs about 9% of its
reach on a full hit and 4% at 60 degrees.

But that roll fraction is the one a **rolling** cue ball transfers, and at
`MAX_CUE_SPEED` the cue ball is not rolling. 4.5 m/s slides 2.53 m before its
slip closes; this table is 1.98 m long. A cue ball at full power is always
still sliding when it arrives, so it transfers *less* backspin than the check
assumes, and the object ball reaches slightly further than the check allows.

The direction is the safe one — it under-promises, so the failure mode is
declaring a makeable layout unmakeable, never the reverse, and `POWER_MARGIN`
exists to prevent exactly the reverse.

**Where it actually bites: level 5, and only level 5.** Measured over 1500
generated layouts per level, against the slowest cloth (which is what
generation validates against), as the ratio of the feasibility limit to the
distance the layout actually asks for:

```
L1 Straight in         max cut  5.0 deg   tightest headroom 15.07x
L2 Gentle cuts         max cut 20.0 deg   tightest headroom 12.21x
L3 Half ball           max cut 40.0 deg   tightest headroom  8.28x
L4 Steep cuts          max cut 60.0 deg   tightest headroom  4.63x
L5 Thin cuts           max cut 79.9 deg   tightest headroom  1.00x   <-- binding
L6 Distance and rails  max cut 44.9 deg   tightest headroom  5.25x
L7 Exam                max cut 54.9 deg   tightest headroom  4.41x
```

Everywhere but level 5 the check has 4x to 15x of slack and could not change a
decision if it tried. Level 5 generates right up against the limit, so the
understatement directly shrinks the space of thin cuts the curriculum can
offer — by 1.6% at 80 degrees and 3.0% at 70. On the slowest cloth a 70-degree
cut reads a maximum potable distance of 1.684 m against a true 1.736 m.

So: small, but not nothing, and it lands precisely on the hardest level rather
than being spread harmlessly around. (An earlier note here said the effect was
nil. It is not — that claim was never measured per level.)

### Why it is not a one-line fix

The honest roll fraction depends on how much of its slide the cue ball has used
up on the way in, which is a function of the cue-to-ghost distance. The current
signature has no room for it:

```ts
isPowerFeasible(cut: number, objectToPocket: number, rollingFriction?: number)
```

Adding `cueToGhost` ripples into `analyseShot` (which calls it from a
`ShotLayoutQuery` that does have the distance, so that part is easy) and into
the generator's feasibility filter. Worth doing together with any other change
to that signature rather than on its own.

Three ways to close it, roughly in order of effort:

- **Pass `cueToGhost` and compute the cue ball's roll at contact.** Correct,
  and the machinery is already there — `slidePhase` in the same file gives the
  exit speed, so the cue ball's roll fraction on arrival is a short derivation.
- **Interpolate between the sliding and rolling roll fractions** on the
  fraction of the slide phase spent. Cheaper, still needs the distance.
- **Drop the roll fraction from this call only**, back to `k = 0`. Restores the
  pre-`5c12fbc` reach exactly, at the cost of the check no longer matching the
  physics it is checking. Simplest, and arguably the wrong direction — it
  overstates rather than understates.

The comment above `isPowerFeasible` states the premise plainly rather than
claiming the check is exact. Whatever gets built, re-run the headroom table
above — level 5 is the only row that can move — and check the per-level pot
rate at the recommended power, since a longer legal thin cut is a harder one.
`tests/game/generator.test.ts:161` asserts generated layouts are never
`underpowered`, which is the invariant that must survive.

## Touch controls, so the trainer is playable on a phone

**Status:** not started. Wanted; design decision outstanding.

The app already serves fine to a phone — `npm run preview -- --host`, then
`http://<pi-lan-ip>:4173` — and aiming already works there, because
`src/game/input.ts:161-164` uses pointer events and pointer events fire for
touch. The canvas carries `tabindex="0"` and takes focus, and the level
buttons in the HUD are click handlers, so those work too.

**What does not work: firing.** Charging the cue is bound to Space and to
nothing else — `src/game/input.ts:93` starts the charge on keydown,
`src/game/input.ts:138` releases it on keyup. There is no touch or pointer
path into `beginCharge` / `setPower` / `release`. On a phone you can line a
shot up perfectly and then have no way to take it.

A Bluetooth keyboard paired to the phone works today and needs no code. This
entry is about not needing one.

### The decision to make first

Aiming already owns the drag gesture on the canvas, so charging has to live
somewhere that does not fight it. Three candidates, none obviously right:

- **A dedicated power strip.** Press and hold on the existing power meter to
  charge, lift to release. Cleanest separation — aim on the table, power on
  the bar — and the meter is already on screen showing exactly what the hold
  is doing. Costs vertical space on a phone in portrait.
- **Second finger.** Keep one finger on the table for aim, tap-and-hold with
  another to charge. Preserves the whole screen for the table, but
  multi-touch while aiming is fiddly and easy to trigger by accident.
- **Tap to aim, hold to fire.** Change the gesture model: a tap sets the aim
  line, a hold anywhere charges. Simplest to use, but it breaks the
  drag-to-aim feel the desktop version is built around, and fine-tuning aim
  by tapping is much worse than by dragging.

Whichever wins, the power value still has to come from somewhere — hold
duration, or drag distance along the strip. Hold duration matches the
keyboard behaviour and the existing charge loop; drag distance is more
directly controllable and is what the meter already looks like.

### Also worth handling if this gets built

- Everything else is keyboard-only too: `V` camera, `C` cloth, `.` slow
  motion, `R` retry, `N` next shot, `1`-`7` level. Levels are clickable in
  the HUD; the rest are not reachable by touch at all.
- The controls panel in `src/ui/hud.ts` names keys, and would need to say
  something different on a touch device.
- `npm run preview` binds to loopback, so serving to a phone needs `--host`
  every time. Worth a `preview:lan` script if this becomes routine.

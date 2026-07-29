# TODO

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

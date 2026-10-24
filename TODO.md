# TODO

## `isPowerFeasible` judged full-power shots with the wrong cue ball

**Status:** resolved in roadmap step B4, which had to change the signature
anyway. Kept as a record of what the check is now.

`isPowerFeasible` asks whether any legal stroke can drive the object ball to
the pocket, so it plays the shot out at `MAX_CUE_SPEED`. It used to take the
cue ball as arriving at that speed and rolling, which at full power it never
is: 4.5 m/s slides 2.53 m before its slip closes, and this table is 1.98 m
long. One half of that was optimistic (no speed lost on the run-up) and the
other pessimistic (the backspin a rolling cue ball gears on).

It now takes the cue-to-ghost distance and plays out the cue ball as it really
arrives: slowed by the run-up, only partly rolling, and gearing on only the
topspin the cloth has given it by then, with the contact friction falling with
speed as TP A.14 has it. Measured over 1500 generated layouts per level,
against the slowest cloth (which is what generation validates against), as the
ratio of the feasibility limit to the distance the layout actually asks for:

```
L1 Full ball           max cut  7.2 deg   tightest headroom 13.07x
L2 Three-quarter ball  max cut 22.2 deg   tightest headroom 11.18x
L3 Half ball           max cut 39.3 deg   tightest headroom  7.93x
L4 Quarter ball        max cut 54.8 deg   tightest headroom  5.57x
L5 Eighth ball         max cut 67.3 deg   tightest headroom  3.36x
L6 Distance and rails  max cut 45.0 deg   tightest headroom  4.85x
L7 Exam                max cut 69.7 deg   tightest headroom  1.23x   <-- nearest
L8 Mixed review        max cut 67.2 deg   tightest headroom  2.11x
```

(`MEASURE=1 npx vitest run tests/zz-calibration.test.ts --reporter=verbose`
prints this table, seeded.) Since the practice levels were centred on the ball
fractions (roadmap step D1), the thinnest cut they deal is 67 degrees, and none
of them comes near the limit; it used to be level 5's 80-degree cuts, at 1.00x.
The exam, widened to 70-degree cuts and 1.3 m shots (D2), is where it now comes
nearest. (The review row is the generator on that level's own band; in play it
deals from the five fraction levels instead.)
`tests/game/generator.test.ts` asserts generated layouts are never
`underpowered`, which is the invariant that must survive.

## Mobile browsers (Android and iOS), and hosting on GitHub Pages

**Status:** built and live at https://idanhom.github.io/learn-billiard/,
linked from https://idanhom.github.io/, apart from the checks only a real phone
can make; see "Still open" at the end. Done straight after roadmap step B2, ahead of B3, as
asked on 2026-10-24, and it absorbed roadmap steps E8 (HUD density) and E9
(touch). The rest of this entry is the record of what it found and why.

The goal: one URL — the repo's GitHub Pages site — that plays properly on a
desktop browser, on Android (Chrome, Samsung Internet, Firefox) and on iOS.
There is one build for all of them. The page adapts to what the device can do,
not to which browser it is: screen size through CSS media queries, touch
versus mouse through pointer events and `(pointer: coarse)`. On iOS every
browser is Safari's WebKit underneath, so iOS Safari stands in for all of
them.

### Where it stands: not mobile compatible

Measured with the production build in Chromium emulating an iPhone 13
(390x664 CSS px, touch, device scale 3), portrait and landscape:

- **Nothing can fire a shot.** Charging is bound to Space and nothing else:
  `src/game/input.ts` starts the charge on keydown and releases it on keyup.
  There is no touch path into `beginCharge` / `setPower` / `release`.
- **Every other action is keyboard-only too:** `V` camera, `.` slow motion,
  `C` cloth, `R` retry, `N` next, `1`-`7` level, the arrow-key nudges, and
  Shift for fine aim. The level list and the summary card's Continue are the
  only things a finger can press.
- **The HUD covers about 60% of the screen** in both orientations. The panels
  are fixed-pixel and placed for a 1280x760 window. In portrait the controls
  panel's `max-width: min(360px, calc(50% - 149px))` comes out at 46 px, so it
  renders one word per line down the whole left edge, over the status and
  level panels.
- **A drag can move the page.** The canvas has no `touch-action: none`, so
  touch drags are free to scroll or pinch-zoom, and double-tap zoom is live.
  iOS ignores viewport zoom locks, so `touch-action` is the fix, not the
  viewport meta.
- The controls panel names keys, which mean nothing on a phone.

What already works: three.js renders through WebGL on mobile Chrome and
Safari, and the device pixel ratio is capped at 1.5, which also keeps a
phone's GPU load down. Pointer events fire for touch, so dragging on the table
already aims. And the production build is static files with Vite's
`base: './'`, so it serves correctly from a sub-path such as
`/learn-billiard/`.

### The work

1. **Firing by touch.** Settled in the roadmap (E9): a power strip on the
   right edge. Press and drag along it to set the power, lift to strike, slide
   off it to cancel. Fine-aim buttons, since Shift-drag has no touch
   equivalent.
2. **A toolbar for the keyboard-only actions:** retry, next, camera, slow
   motion, cloth, level.
3. **A HUD that fits a phone** (E8). Collapse the controls behind `?`, move
   view, speed and cloth into a chip row, and lay out portrait and landscape
   separately. Touch targets at least 44 px. Respect the notch with
   `env(safe-area-inset-*)`, and size with `dvh` rather than `100%`, so a
   mobile browser's address bar never sits over the power strip.
4. **Input hygiene:** `touch-action: none` on the canvas, no double-tap zoom,
   no pull-to-refresh mid-drag.
5. **Feature detection, not browser detection.** Show the on-screen controls
   for a coarse pointer and key hints where there is a keyboard, and keep both
   working on a touch laptop.
6. **Hosting:** a GitHub Actions workflow that runs typecheck, tests and the
   build, then publishes `dist/` to GitHub Pages. For this repo
   (`idanhom/learn-billiard`) that is `https://idanhom.github.io/learn-billiard/`
   by default, or the same path under the account's custom domain if it has
   one.
7. **Verification:** a phone pass in `verify:browser` — Chromium emulation at
   iPhone and Pixel sizes, with touch — that fires a shot by touch, reaches
   every toolbar action, and checks that no panel covers the middle of the
   table. Then a real iPhone and a real Android phone, because this machine's
   emulation is Chromium and iOS is WebKit. `npm run preview -- --host` serves
   to a phone on the LAN (E9's `preview:lan` script).

### Caveats to carry into it

- **iOS can wipe progress.** Safari deletes a site's script-writable storage,
  `localStorage` included, once the user has gone 7 days of Safari use
  without interacting with it. An occasional iOS player can lose their
  levels. A web app added to the home screen keeps its own count of days of
  use, so it is not caught by this; a web app manifest makes that an option.
- **The origin is shared.** Every Pages site of the account lives on
  `idanhom.github.io`. The storage keys are namespaced
  (`pool-angle-trainer/...`), so nothing collides, but any page on that origin
  can read them.
- **The `?debug=1` hook ships.** On a public build anyone can use it to set
  their own local progress. It touches nothing but that player's browser, so
  it is a cheat, not a risk.
- **Frame time is unmeasured on a phone.** The budget check in
  `verify:browser` runs in headless software rendering. Check a mid-range
  phone.

### Still open

- **A real iPhone and a real Android phone.** Everything above is checked in
  Chromium emulating a phone (`npm run verify:browser`, the phone pass). iOS
  is WebKit, and its touch handling, viewport and storage are what most needs
  a real device.
- **Frame time on a mid-range phone,** with the overhead and behind views both.
- **The behind-the-cue camera upright.** On a phone held upright the vertical
  field of view widens so the view across stays usable, but the top third of
  the screen is sky. The roadmap's stance camera (D3) is where the framing
  gets designed properly.


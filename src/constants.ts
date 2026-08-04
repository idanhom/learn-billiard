/**
 * Physical constants shared by the analytic geometry and the simulation.
 *
 * Most of these are published typical values for cloth and phenolic-resin
 * balls, not measurements of a specific table. `ROLLING_FRICTION` is the
 * exception and says so at length: it sits at 0.022, over twice the published
 * band, on purpose — and `TERMINAL_ROLL_SPEED` / `TERMINAL_ROLL_BOOST` have no
 * published value behind them at all. The model is deliberately IDEAL: no
 * english, no ball-to-ball throw, and no cushion-induced sidespin. Two things
 * DO couple top and bottom spin, because both are what make the shot behave
 * the way a player expects: cushions, since contact above the ball's centre
 * torques it, and ball-to-ball contacts, since the two faces mesh like gear
 * teeth. The app says what is and is not modelled on screen, because a trainer
 * that teaches geometry the sim then contradicts would be worse than useless.
 */

export const GRAVITY = 9.81;

/** Sliding (kinetic) friction between ball and cloth, before the ball rolls. */
export const SLIDING_FRICTION = 0.2;

/**
 * Rolling resistance between the terminal knee and the fast step, once the
 * contact point has stopped slipping.
 *
 * A deliberate departure from the literature, and worth naming as one rather
 * than dressing up. The usual quoted range is 0.005-0.015, and Alciatore's
 * TP B.2 ("Rolling Resistance", billiards.colostate.edu) derives mu_r = 0.01 by
 * timing a rolling ball to a stop under a = mu_r*g. This runs at 0.022, over
 * twice that — and on top of a knee that doubles it again at the very end,
 * which the published model does not have at all.
 *
 * Solved, not chosen: it is whatever holds a table length of free roll at 4.0 s
 * with `TERMINAL_ROLL_SPEED` and `TERMINAL_ROLL_BOOST` in place. It came down
 * from 0.025 when the knee arrived, because the knee now does part of that job.
 *
 * What the departure buys, on this 7-foot table: a table length in 4.0 s
 * instead of 5.8, down and back in 5.2 s instead of 8.4 (the fast step owns
 * half a second of that — it was 5.7 before the step), and a ball that spends
 * its last 0.2 m/s dying over 0.65 s and 7.6 cm instead of 1.4 s and 17 cm.
 * That terminal crawl is what the "it feels like ice" reports kept landing on.
 *
 * Whether 0.022 is too far the other way is open: nobody has timed it against a
 * real table. Do that — roll a ball the length of your table so it just dies at
 * the far cushion, and time it. About 5.8 s means the published 0.01 is right
 * and this is wrong; about 4 s means this is. Every figure in this comment is
 * held to the code by `tests/documented-figures.test.ts`.
 */
export const ROLLING_FRICTION = 0.022;

/**
 * Cloth speed, as rolling resistance. Real cloth varies table to table — a
 * fast new cloth against a slow worn one — so picking one number for everybody
 * is a guess. These keep the 0.7x / 1x / 1.4x spread around normal, which is
 * roughly a second either side on a table-length roll: 4.7 s, 4.0 s, 3.4 s.
 *
 * Each is solved to hold its own time, so they moved with `ROLLING_FRICTION`
 * when the knee arrived and are no longer the round numbers they were. The
 * slow one has since drifted a hair: its table-length roll clips the fast
 * step, so 0.0308 now times at 3.37 s rather than the 3.4 it was solved for —
 * see `ROLL_FAST_SPEED` for why that is tolerated rather than re-solved.
 *
 * Only the coefficient lives here. What the player picked is a preference, and
 * belongs in the settings store; physics must not import from game.
 */
export const CLOTH_PRESETS = {
  fast: { rollingFriction: 0.0156 },
  normal: { rollingFriction: ROLLING_FRICTION },
  slow: { rollingFriction: 0.0308 },
} as const;

export type ClothPreset = keyof typeof CLOTH_PRESETS;

export const CLOTH_PRESET_IDS = ['fast', 'normal', 'slow'] as const;

export const DEFAULT_CLOTH: ClothPreset = 'normal';

/** The most sluggish cloth on offer. Shot generation validates against this so
 * a layout stays makeable whichever cloth the player is using. */
export const SLOWEST_CLOTH: ClothPreset = 'slow';

export function clothRollingFriction(preset: ClothPreset): number {
  return CLOTH_PRESETS[preset].rollingFriction;
}

/** Ball-to-ball restitution. A straight hit therefore transfers (1+e)/2 = 97.5%. */
export const BALL_RESTITUTION = 0.95;

/**
 * Coulomb friction between two balls at the moment of contact.
 *
 * The published range for polished phenolic on phenolic is 0.03-0.08, and this
 * is the middle of it — Alciatore's typical figure. It is NOT tuned: the
 * square-hit object/cue travel ratio lands mid-band (6.5-8x) at the published
 * value, and that agreement is the check worth keeping. If holding the ratio in
 * band ever needs this dragged off 0.03-0.08, the collision model has a
 * structural error rather than a calibration one, which is how the first draft
 * of this change was caught: it had the spin transfer inverted, and needed
 * 0.045 to compensate.
 *
 * Only the vertical (gear-meshing) share of the friction impulse is applied.
 * The horizontal share is throw, which this model declares it does not have.
 */
export const BALL_CONTACT_FRICTION = 0.06;

/**
 * Below this speed a rolling ball sheds speed `TERMINAL_ROLL_BOOST` times
 * faster.
 *
 * These two — and the fast step's two below — have **no published value behind
 * them**, unlike everything else in this file. They are a caricature of a real
 * effect — the ball settling into the cloth pile as it dies — calibrated by
 * eye against how a ball ought to stop, and nothing more. Do not cite them.
 *
 * Piecewise-constant rather than a smooth ramp, deliberately: it keeps every
 * analytic function in `src/geometry/shot.ts` closed-form and exactly
 * invertible, which is the property those functions are built around.
 */
export const TERMINAL_ROLL_SPEED = 0.12;
export const TERMINAL_ROLL_BOOST = 2;

/**
 * The other end of the same ladder: above `ROLL_FAST_SPEED`, rolling resistance
 * is `ROLL_FAST_BOOST` times larger.
 *
 * As unpublished as the terminal knee, and for the same reason — real rolling
 * resistance is very nearly constant in speed, so this is a second deliberate
 * departure in this file and not a measurement of anything. Do not cite it
 * either.
 *
 * What it is for: a cue ball leaving a thin cut carries almost all of its
 * speed, because the contact takes `cos(theta)` of it and a thin cut has
 * little. At level 5 it leaves at about 1.95 m/s, which a single constant
 * deceleration turns into nearly nine metres of travel. The step is what stops
 * that reading like ice.
 *
 * Why it is cheap — not free: the calibration this file rests on — a table
 * length of free roll in 4.0 s — is a SLOW-ball measurement. That roll launches
 * at 1.24 m/s and enters its roll phase at 0.88 m/s, and the typical pot behind
 * `POWER_CURVE_EXPONENT` rolls from about 0.87 m/s. Neither ever reaches
 * 1.0 m/s while rolling, so neither is touched, and `ROLLING_FRICTION` and
 * `POWER_CURVE_EXPONENT` both survive this unchanged.
 * `tests/documented-figures.test.ts` holds that claim rather than trusting it.
 *
 * What it does move, re-measured when the step landed: the slow preset's
 * table-length roll enters its roll phase at 1.11 m/s, clips the step, and now
 * reads 3.37 s against the 3.4 it was solved for; down and back went 5.7 s to
 * 5.2; and the longest pot in the curriculum went 1.93 m/s to 2.75, 57% of the
 * meter to 72%, because its cue ball crosses the step on the 1.5 m run-up. It
 * also drops the square-hit travel ratio at a 1.55 m/s contact from 6.6x to
 * 6.45x, BELOW the published 6.5-8x band `tests/physics/world.test.ts` holds —
 * that one is unresolved, and the failing test is the record of it.
 *
 * Note the slide phase is untouched: a hard stroke still slides at
 * `SLIDING_FRICTION` for its first metre or so, and only what is left when the
 * slip closes meets this step.
 */
export const ROLL_FAST_SPEED = 1;
export const ROLL_FAST_BOOST = 10;

/**
 * Where the cushion touches the ball, as a fraction of the ball's radius above
 * its centre. The WPA specifies the cushion nose at 62.5-64.5% of ball diameter
 * (nominal 63.5%), and the centre sits at 50%, so contact is 0.27R up.
 *
 * This is the whole reason a rail behaves the way it does. Contact above the
 * centre means the impulse also torques the ball toward rolling in its new
 * direction, which is why real rebounds keep more speed than they would if the
 * spin simply carried on unchanged.
 */
export const CUSHION_CONTACT_HEIGHT_RATIO = 0.27;

/**
 * Restitution AT THE CONTACT POINT — not the published ball-rail coefficient of
 * restitution, which is measured on the ball's centre. The two differ because
 * the contact point sits above the centre and moves faster than it.
 *
 * At 0.54 the model reproduces both published figures, which describe different
 * moments of the same event: a square rebound at 0.65 of the incoming speed
 * (published ball-rail COR is 0.6-0.9), settling to 0.50 once the ball has
 * skidded out of its now-backwards roll (published: "loses about half of its
 * speed after rebound and skid").
 */
export const CUSHION_CONTACT_RESTITUTION = 0.54;

/** Fraction of tangential speed a ball keeps after a cushion contact. */
export const CUSHION_TANGENT_RETENTION = 0.95;

/** Speed transferred to the object ball on a dead-straight full hit. */
export const NORMAL_TRANSFER = (1 + BALL_RESTITUTION) / 2;

/** Hardest legal stroke. Caps the tunnelling risk as well as the difficulty. */
export const MAX_CUE_SPEED = 4.5;

/**
 * Softest stroke that still counts as a stroke — a touch shot, which carries
 * the cue ball only 14 cm on normal cloth. Deliberately below the speed any
 * pot in this curriculum asks for, so the bottom of the meter is somewhere you
 * can go wrong rather than a floor that is already enough.
 */
export const MIN_CUE_SPEED = 0.35;

/**
 * Shape of the power meter: speed is MIN + (MAX - MIN) * power^this.
 *
 * Not a feel knob. The range 0.35-4.5 m/s is right — a level-5 thin cut throws
 * away cos(80 degrees) of its speed at contact and genuinely needs ~3.5 m/s,
 * which is 76% of a linear bar — but spread linearly it crushes the ordinary
 * shots into the bottom quarter of it: a typical pot is a 1.22 m/s stroke at
 * 21%. (The longest in the curriculum stopped being an ordinary shot when the
 * fast step landed: 2.75 m/s, 58% even of a linear bar.) The exponent is set
 * so that typical pot (0.6 m to the pocket, 0.5 m of cue-ball travel, normal
 * cloth) reads 40% here, which moves the same two to 40% and 72%.
 *
 * It follows the cloth, and now the contact model too, and has to be
 * re-derived from that typical pot whenever either moves. It survived the knee
 * at 1.70 by coincidence rather than by construction — the faster cloth wanted
 * it lower, the object ball's new backspin wanted it higher, and the two very
 * nearly cancelled. If the cloth ever goes back to 0.010 this becomes 2.251.
 */
export const POWER_CURVE_EXPONENT = 1.7;

/**
 * How far past the pocket the recommended power would carry the object ball,
 * as a multiple of the distance to it. Enough that the ball drops rather than
 * dying on the lip, not so much that the advice stops being a touch shot.
 */
export const DROP_MARGIN = 1.15;

/** Below this speed a ball is treated as stopped. */
export const REST_SPEED = 5e-3;

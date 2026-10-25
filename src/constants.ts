/**
 * Physical constants shared by the analytic geometry and the simulation.
 *
 * Most of these are published typical values for cloth and phenolic-resin
 * balls, not measurements of a specific table. `ROLLING_FRICTION` is the
 * exception and says so at length: it sits at 0.022, over twice the published
 * band, on purpose — and `TERMINAL_ROLL_SPEED` / `TERMINAL_ROLL_BOOST` have no
 * published value behind them at all. The model is deliberately IDEAL: no
 * english and no cushion-induced sidespin. Two things DO couple top and bottom
 * spin, because both are what make the shot behave the way a player expects:
 * cushions, since contact above the ball's centre torques it, and ball-to-ball
 * contacts, since the two faces mesh like gear teeth. The same contact friction
 * pushes the object ball sideways too, which is throw, and the ideal line
 * allows for it. The app says what is and is not modelled on screen, because a
 * trainer that teaches geometry the sim then contradicts would be worse than
 * useless.
 */

export const GRAVITY = 9.81;

/** Sliding (kinetic) friction between ball and cloth, before the ball rolls. */
export const SLIDING_FRICTION = 0.2;

/**
 * Rolling resistance above the terminal knee, once the contact point has
 * stopped slipping.
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
 * instead of 5.8, down and back in 5.7 s instead of 8.4, and a ball that spends
 * its last 0.2 m/s dying over 0.65 s and 7.6 cm instead of 1.4 s and 17 cm.
 * That terminal crawl is what the "it feels like ice" reports kept landing on.
 *
 * One coefficient at every speed above the knee. A fast step used to sit on
 * top of it, taking ten times as much above 1 m/s so the cue ball off a thin
 * cut would not sail — and 0.022 x 10 is more than `SLIDING_FRICTION`, which no
 * cloth can do: a ball cannot shed speed faster rolling than skidding. It is
 * gone. The cue ball now runs as far as this coefficient says, and the shot
 * plays it out in real time; Retry or Next ends a long run-out early.
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
 * when the knee arrived and are no longer the round numbers they were.
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
 * Coulomb friction between two balls at the moment of contact, which falls as
 * the two surfaces slide past each other faster: mu(v) = a + b*exp(-c*v), with
 * v the sliding speed at the contact in m/s.
 *
 * Alciatore, TP A.14 ("The effects of cut angle, speed, and spin on object ball
 * throw"), fitted there to Marlow's measurements (The Physics of Pocket
 * Billiards, 1995, Table 10): 0.11, 0.06 and 0.01 at 0.071, 0.71 and 7.1 m/s of
 * slip. It passes 0.06, the middle of the 0.03-0.08 usually quoted for
 * phenolic on phenolic, at 0.71 m/s. None of the three constants is tuned.
 *
 * The check worth keeping is the square-hit travel ratio: a rolling cue ball
 * sends the object ball "about 7 times as far" as it follows itself
 * (Alciatore, Billiards Digest, June 2020). If holding that ever needs these
 * moved, the collision model has a structural error rather than a calibration
 * one, which is how the first draft of the contact friction was caught: it had
 * the spin transfer inverted, and needed a coefficient of 0.045 to compensate.
 */
export const CONTACT_FRICTION_FLOOR = 9.951e-3;
export const CONTACT_FRICTION_RISE = 0.108;
/** In s/m. */
export const CONTACT_FRICTION_DECAY = 1.088;

/** Ball-to-ball friction at a contact sliding at `slip` m/s. */
export function contactFriction(slip: number): number {
  return CONTACT_FRICTION_FLOOR + CONTACT_FRICTION_RISE * Math.exp(-CONTACT_FRICTION_DECAY * slip);
}

/**
 * Below this speed a rolling ball sheds speed `TERMINAL_ROLL_BOOST` times
 * faster.
 *
 * These two have **no published value behind them**, unlike everything else in
 * this file. They are a caricature of a real effect — the ball settling into
 * the cloth pile as it dies — calibrated by eye against how a ball ought to
 * stop, and nothing more. Do not cite them.
 *
 * Piecewise-constant rather than a smooth ramp, deliberately: it keeps every
 * analytic function in `src/geometry/shot.ts` closed-form and exactly
 * invertible, which is the property those functions are built around.
 */
export const TERMINAL_ROLL_SPEED = 0.12;
export const TERMINAL_ROLL_BOOST = 2;

/**
 * Where the cushion touches the ball, as a fraction of the ball's radius above
 * its centre. The WPA specifies the cushion nose at 62.5-64.5% of ball diameter
 * (nominal 63.5%), and the centre sits at 50%, so contact is 0.27R up.
 *
 * That tilts the contact normal, which on a sphere runs through the centre,
 * 15.7 degrees below horizontal. The rail pushes the ball back AND down into
 * the cloth, and only friction at the nose can turn it.
 */
export const CUSHION_CONTACT_HEIGHT_RATIO = 0.27;

/**
 * Ball-rail coefficient of restitution, applied along that tilted normal as in
 * Han (2005). Fitted together with `CUSHION_FRICTION`, not chosen: the pair is
 * the best match to Alciatore's measured rebounds on typical cloth. His
 * high-speed video of square hits (HSV B.15) has a rolling ball coming off at
 * 0.72 and settling at 0.52, and a stun ball at 0.58 and 0.54; TP B.11
 * measures the rebound angles of a slow rolling ball. The model gives 0.71 and
 * 0.48, 0.63 and 0.51, and angles within 6 degrees (3 degrees rms). Both
 * values sit inside Han's published ranges (0.6-0.95 and 0.1-0.35), and this
 * one inside Alciatore's 0.6-0.9. pooltool's defaults for the same model, 0.85
 * and 0.2, fit the same data worse.
 *
 * Constant in speed, on purpose. The sources disagree on which way it moves:
 * Mathavan measured a fall on snooker cushions, mostly above 2.5 m/s, and Han
 * fitted a rise on a carom table. Nobody has measured a pool table, so there is
 * no slope to fit.
 *
 * One known miss: measured draw comes off a rail faster than stun, and here it
 * comes off slower, because Han has no table friction during the impact. No
 * shot draws yet. Revisit when one does.
 */
export const CUSHION_RESTITUTION = 0.74;

/**
 * Friction between ball and cushion nose, fitted with `CUSHION_RESTITUTION`.
 * It is what turns a ball at the rail: it fights a rolling ball's topspin down
 * and winds a stun ball's up. It also costs a ball some of its run along the
 * rail.
 */
export const CUSHION_FRICTION = 0.23;

/** Speed transferred to the object ball on a dead-straight full hit. */
export const NORMAL_TRANSFER = (1 + BALL_RESTITUTION) / 2;

/** Hardest legal stroke. Caps the tunnelling risk as well as the difficulty. */
export const MAX_CUE_SPEED = 4.5;

/**
 * The furthest from centre a tip can strike, up or down, as a fraction of the
 * ball's radius: past about half the radius a tip miscues. A tip at offset b
 * starts the ball with a spin whose surface speed is 2.5 (b/R) times its own,
 * so 0.4 R rolls it from the start and below centre draws.
 */
export const MAX_TIP_OFFSET = 0.5;

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
 * Not a feel knob. The range 0.35-4.5 m/s is right: an 80 degree cut with 0.4 m
 * to the pocket throws away cos(80 degrees) of its speed at contact and
 * genuinely needs 3.83 m/s, which is 84% of a linear bar. But spread linearly
 * it crushes the ordinary shots into the bottom of it: a typical pot is a
 * 1.22 m/s stroke at 21%, and the longest in the curriculum 1.90 m/s at 37%.
 * The exponent is set so that typical pot (0.6 m to the pocket, 0.5 m of
 * cue-ball travel, normal cloth) reads 40% here, which moves the same two to
 * 40% and 56%.
 *
 * It follows the cloth and the contact model, and has to be re-derived from
 * that typical pot whenever either moves. It went from 1.70 to 1.71 when the
 * ball-to-ball friction became TP A.14's, which falls with speed and so lays
 * less backspin on a fast contact. If the cloth ever goes back to 0.010 this
 * becomes 2.240.
 */
export const POWER_CURVE_EXPONENT = 1.71;

/**
 * How far past the pocket the recommended power would carry the object ball,
 * as a multiple of the distance to it. Enough that the ball drops rather than
 * dying on the lip, not so much that the advice stops being a touch shot.
 */
export const DROP_MARGIN = 1.15;

/** Below this speed a ball is treated as stopped. */
export const REST_SPEED = 5e-3;

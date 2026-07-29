/**
 * Physical constants shared by the analytic geometry and the simulation.
 *
 * These are published typical values for cloth and phenolic-resin balls, not
 * measurements of a specific table. The model is deliberately IDEAL: no english,
 * no ball-to-ball throw, and no cushion-induced sidespin. Cushions DO couple
 * top and bottom spin, because contact above the ball's centre is what makes a
 * rail behave like a rail. The app says what is and is not modelled on screen,
 * because a trainer that teaches geometry the sim then contradicts would be
 * worse than useless.
 */

export const GRAVITY = 9.81;

/** Sliding (kinetic) friction between ball and cloth, before the ball rolls. */
export const SLIDING_FRICTION = 0.2;

/** Rolling resistance once the contact point has stopped slipping. */
export const ROLLING_FRICTION = 0.01;

/** Ball-to-ball restitution. A straight hit therefore transfers (1+e)/2 = 97.5%. */
export const BALL_RESTITUTION = 0.95;

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

/** Softest stroke that still counts as a stroke. */
export const MIN_CUE_SPEED = 0.6;

/** Below this speed a ball is treated as stopped. */
export const REST_SPEED = 5e-3;

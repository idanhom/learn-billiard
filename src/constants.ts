/**
 * Physical constants shared by the analytic geometry and the simulation.
 *
 * These are published typical values for cloth and phenolic-resin balls, not
 * measurements of a specific table. The model is deliberately IDEAL: no
 * ball-to-ball throw, no spin transfer at the cushions. The app says so on
 * screen, because a trainer that teaches geometry the sim then contradicts
 * would be worse than useless.
 */

export const GRAVITY = 9.81;

/** Sliding (kinetic) friction between ball and cloth, before the ball rolls. */
export const SLIDING_FRICTION = 0.2;

/** Rolling resistance once the contact point has stopped slipping. */
export const ROLLING_FRICTION = 0.01;

/** Ball-to-ball restitution. A straight hit therefore transfers (1+e)/2 = 97.5%. */
export const BALL_RESTITUTION = 0.95;

/** Cushion normal restitution. */
export const CUSHION_RESTITUTION = 0.75;

/** Fraction of tangential speed a ball keeps after a cushion contact. */
export const CUSHION_TANGENT_RETENTION = 0.85;

/** Speed transferred to the object ball on a dead-straight full hit. */
export const NORMAL_TRANSFER = (1 + BALL_RESTITUTION) / 2;

/** Hardest legal stroke. Caps the tunnelling risk as well as the difficulty. */
export const MAX_CUE_SPEED = 4.5;

/** Softest stroke that still counts as a stroke. */
export const MIN_CUE_SPEED = 0.6;

/** Below this speed a ball is treated as stopped. */
export const REST_SPEED = 5e-3;

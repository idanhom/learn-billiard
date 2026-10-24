/**
 * The pot window: how far either side of the ideal line the object ball can
 * leave and still drop, played out in the simulation.
 *
 * The clean band in `src/geometry/pocket-window.ts` is the lines that reach
 * the hole without touching rubber. Real pockets take more than that: a ball
 * that clips a facing deep in the jaws still drops, and one running down a
 * rail is steered in by it. So the pot window is measured, not drawn: the
 * object ball alone, launched from its spot at the speed and spin the ideal
 * contact gives it, along headings further and further from the ideal one,
 * until it stops dropping. The speed is held at the ideal one on purpose. On a
 * thin cut a thinner hit also slows the object ball, but that is the stroke's
 * business, and this measures the aim.
 *
 * It runs the simulation, so it lives here rather than beside the geometry,
 * and it is worked out once per layout and cloth and remembered: a retry deals
 * the same layout again.
 */

import { type ClothPreset, clothRollingFriction } from '../constants';
import { pocketWindow } from '../geometry/pocket-window';
import { type ShotAnalysis, contactState, objectRollFraction, objectSpeedAfterCut } from '../geometry/shot';
import { pocketById } from '../geometry/table';
import { dist, fromAngle, scale } from '../geometry/vec2';
import { TICK, createBall, stepWorld } from '../physics/world';
import type { ShotLayout } from './drills';

export interface PotWindow {
  /** The heading the ideal shot sends the object ball along. */
  readonly ideal: number;
  /** How far the departure can turn clockwise of `ideal` and still drop, in radians. */
  readonly clockwise: number;
  /** And counter-clockwise. */
  readonly counterClockwise: number;
}

/** No window is measured past this many clean half-widths a side. */
const MAX_REACH = 32;

/** Bisections on each edge once it is bracketed: 6 leave it to within 1/64 of the bracket. */
const EDGE_BISECTIONS = 6;

/** A ball still going after this long has missed. */
const MAX_RUN_SECONDS = 6;

/**
 * A ball this much further from the pocket than it has been at its closest is
 * going away from it, and has missed. Further than a rattle carries a ball back
 * out of the jaws before it can drop after all.
 */
const GIVE_UP_DISTANCE = 0.15;

const remembered = new Map<string, PotWindow>();
const REMEMBERED = 64;

/**
 * The pot window for a layout on a cloth, at the stroke `analysis` assumes.
 * Undefined when the ideal shot itself does not drop, which a generated
 * layout never asks for.
 */
export function potWindow(layout: ShotLayout, cloth: ClothPreset, analysis: ShotAnalysis): PotWindow | undefined {
  const key = `${layout.id}|${layout.object.x}|${layout.object.y}|${layout.cue.x}|${layout.cue.y}|${cloth}`;
  if (remembered.has(key)) return remembered.get(key);
  const window = measure(layout, cloth, analysis);
  remembered.set(key, window as PotWindow);
  if (remembered.size > REMEMBERED) remembered.delete(remembered.keys().next().value!);
  return window;
}

function measure(layout: ShotLayout, cloth: ClothPreset, analysis: ShotAnalysis): PotWindow | undefined {
  const pocket = pocketById(layout.targetPocket);
  const band = pocketWindow(layout.object, pocket);
  if (!band) return undefined;
  const ideal = band.heading;
  const halfBand = (band.high - band.low) / 2;

  const rollingFriction = clothRollingFriction(cloth);
  const contact = contactState(analysis.launchSpeed, analysis.cueToGhost, rollingFriction);
  const speed = objectSpeedAfterCut(contact.speed, analysis.cutAngle);
  const roll = objectRollFraction(analysis.cutAngle, contact.speed, contact.rollFraction);

  const drops = (heading: number): boolean => {
    const direction = fromAngle(heading);
    let balls = [createBall(1, layout.object, scale(direction, speed), scale(direction, speed * roll))];
    let closest = Number.POSITIVE_INFINITY;
    for (let time = 0; time < MAX_RUN_SECONDS; time += TICK) {
      balls = stepWorld(balls, TICK, cloth).balls;
      const ball = balls[0]!;
      if (ball.potted) return ball.pocket === pocket.id;
      if (ball.vel.x === 0 && ball.vel.y === 0 && ball.roll.x === 0 && ball.roll.y === 0) return false;
      const away = dist(ball.pos, band.target);
      closest = Math.min(closest, away);
      if (away > closest + GIVE_UP_DISTANCE) return false;
    }
    return false;
  };
  if (!drops(ideal)) return undefined;

  // A clean line always drops at this speed, so each edge is at least the clean
  // band's. Step out from there, doubling, which brackets a rail shot (whose
  // window runs to ten times the clean band) in a handful.
  const edge = (turn: 1 | -1): number => {
    let inside = halfBand;
    let outside = 0;
    for (let reach = 2 * halfBand; reach <= MAX_REACH * halfBand; reach *= 2) {
      if (!drops(ideal + turn * reach)) {
        outside = reach;
        break;
      }
      inside = reach;
    }
    if (outside === 0) return inside;
    for (let i = 0; i < EDGE_BISECTIONS; i++) {
      const middle = (inside + outside) / 2;
      if (drops(ideal + turn * middle)) inside = middle;
      else outside = middle;
    }
    return inside;
  };

  return { ideal, clockwise: edge(-1), counterClockwise: edge(1) };
}

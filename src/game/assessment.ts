/**
 * The assessment: the exam made general. A fixed battery of stations across
 * what the levels teach, one point each, played straight through with no
 * guides: four cuts potted, two stop shots, a follow and a draw to a ring,
 * two speed-control rings, and two position zones.
 *
 * It follows the shape of the Billiard University and PAT exams, a set of
 * standard drills scored together into a rating, but it is not calibrated
 * against either, and its ratings are this trainer's own.
 */

export interface Station {
  /** Which part of the game it tests. */
  readonly part: 'Aim' | 'Cue ball' | 'Speed' | 'Position';
  readonly label: string;
  /** The level whose shots it deals, and at which rung. */
  readonly level: number;
  readonly rung: number;
  /** What earns the point: the pot, or the level's own task. */
  readonly points: 'pot' | 'task';
}

export const STATIONS: readonly Station[] = [
  { part: 'Aim', label: 'three-quarter ball', level: 2, rung: 0, points: 'pot' },
  { part: 'Aim', label: 'half ball', level: 3, rung: 0, points: 'pot' },
  { part: 'Aim', label: 'quarter ball', level: 4, rung: 0, points: 'pot' },
  { part: 'Aim', label: 'eighth ball', level: 5, rung: 0, points: 'pot' },
  { part: 'Cue ball', label: 'stop shot', level: 14, rung: 0, points: 'task' },
  { part: 'Cue ball', label: 'stop shot', level: 14, rung: 0, points: 'task' },
  { part: 'Cue ball', label: 'follow 40 cm', level: 15, rung: 1, points: 'task' },
  { part: 'Cue ball', label: 'draw 35 cm', level: 16, rung: 1, points: 'task' },
  { part: 'Speed', label: 'speed to 85 cm', level: 17, rung: 1, points: 'task' },
  { part: 'Speed', label: 'speed to 1.2 m', level: 17, rung: 2, points: 'task' },
  { part: 'Position', label: 'position zone', level: 19, rung: 0, points: 'task' },
  { part: 'Position', label: 'position zone', level: 19, rung: 0, points: 'task' },
];

/** The ratings, from the lowest score each starts at. */
export const RATINGS: readonly { readonly from: number; readonly name: string }[] = [
  { from: 0, name: 'starting out' },
  { from: 4, name: 'developing' },
  { from: 7, name: 'solid' },
  { from: 10, name: 'strong' },
];

export function ratingFor(points: number): string {
  return [...RATINGS].reverse().find((rating) => points >= rating.from)!.name;
}

/** A run's points, part by part, in the order the parts come. */
export function pointsByPart(points: readonly boolean[]): { readonly part: Station['part']; readonly points: number; readonly of: number }[] {
  const parts: { part: Station['part']; points: number; of: number }[] = [];
  STATIONS.forEach((station, i) => {
    let entry = parts.find((p) => p.part === station.part);
    if (!entry) {
      entry = { part: station.part, points: 0, of: 0 };
      parts.push(entry);
    }
    entry.of++;
    if (points[i]) entry.points++;
  });
  return parts;
}

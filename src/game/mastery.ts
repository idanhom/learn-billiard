/**
 * Mastery by angle: how reliably shots in each ten-degree band of cut go where
 * they should, played without the ghost ball, against one standard for every
 * level.
 *
 * Levels judge a shot against their own allowance, which tightens as they go;
 * mastery holds every band to the same share of the pocket, so a band played
 * mostly on the forgiving early levels does not look better than it is. Only
 * the latest shots count, so it says how a band goes now. A band that reaches
 * the mark is mastered for good: an achievement for a skill shown, not for
 * time put in.
 */

/** The bands, in degrees of cut: as far as any level deals. */
export const MASTERY_BANDS: readonly (readonly [number, number])[] = [
  [0, 10],
  [10, 20],
  [20, 30],
  [30, 40],
  [40, 50],
  [50, 60],
  [60, 70],
];

/** The share of the pocket a shot may use and still count, the same on every level. */
export const MASTERY_STANDARD = 0.8;
/** How many of a band's latest shots it is judged on. */
export const MASTERY_WINDOW = 20;
/** Fewer shots than this in a band say nothing yet. */
export const MASTERY_MIN = 10;
/** The share of a full window that has to meet the standard for the band to be mastered. */
export const MASTERED_AT = 0.8;

export interface BandRecord {
  /** Unguided shots ever played in the band. */
  readonly attempts: number;
  /** The latest, oldest first: true for each that met the standard. */
  readonly recent: readonly boolean[];
  /** It reached the mark once, which stays. */
  readonly mastered: boolean;
}

export function emptyBand(): BandRecord {
  return { attempts: 0, recent: [], mastered: false };
}

/** Which band a cut falls in, or undefined past the last. */
export function bandIndex(cutDegrees: number): number | undefined {
  const index = MASTERY_BANDS.findIndex(([from, to]) => cutDegrees >= from && cutDegrees < to);
  return index === -1 ? undefined : index;
}

/** How a band is stored: by the degree it starts at, since JSON has no integer keys. */
export function bandKey(index: number): string {
  return String(MASTERY_BANDS[index]![0]);
}

/** "30-40°", with an en dash. */
export function bandLabel(index: number): string {
  const [from, to] = MASTERY_BANDS[index]!;
  return `${from}–${to}°`;
}

/** The share of the latest shots that met the standard, or null while there are too few to say. */
export function masteryRate(band: BandRecord): number | null {
  if (band.recent.length < MASTERY_MIN) return null;
  return band.recent.filter(Boolean).length / band.recent.length;
}

/** A band with one more shot in it; mastered once a full window meets the mark. */
export function recordInBand(band: BandRecord, onStandard: boolean): BandRecord {
  const recent = [...band.recent, onStandard].slice(-MASTERY_WINDOW);
  const full = recent.length === MASTERY_WINDOW;
  const rate = recent.filter(Boolean).length / recent.length;
  return { attempts: band.attempts + 1, recent, mastered: band.mastered || (full && rate >= MASTERED_AT) };
}

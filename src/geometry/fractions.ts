/**
 * The ball fractions players aim by: how much of the object ball the cue ball
 * covers at contact, as seen along the cue. Full, three quarters, half, a
 * quarter and an eighth are the reference hits, and each one is a cut angle:
 * the fullness is 1 - sin(cut), so a half-ball hit is 30 degrees.
 *
 * Learning these five, and seeing them on a real table, is how most players
 * aim, so the practice levels are built around them.
 */

export type FractionName = 'full' | 'three-quarter' | 'half' | 'quarter' | 'eighth';

export interface Fraction {
  readonly name: FractionName;
  /** How it reads on a button or in a report. */
  readonly label: string;
  /** The share of the object ball covered. */
  readonly fullness: number;
  /** The cut angle that covers it, in degrees. */
  readonly cutDegrees: number;
}

const fraction = (name: FractionName, label: string, covered: number): Fraction => ({
  name,
  label,
  fullness: covered,
  cutDegrees: (Math.asin(1 - covered) * 180) / Math.PI,
});

/** Fullest first. */
export const FRACTIONS: readonly Fraction[] = [
  fraction('full', 'full', 1),
  fraction('three-quarter', '¾', 0.75),
  fraction('half', '½', 0.5),
  fraction('quarter', '¼', 0.25),
  fraction('eighth', '⅛', 0.125),
];

export function fractionByName(name: FractionName): Fraction {
  return FRACTIONS.find((f) => f.name === name)!;
}

/** The reference fraction nearest a cut, judged by angle: where a player would call it. */
export function nearestFraction(cut: number): Fraction {
  const degrees = (cut * 180) / Math.PI;
  let best = FRACTIONS[0]!;
  for (const f of FRACTIONS) {
    if (Math.abs(f.cutDegrees - degrees) < Math.abs(best.cutDegrees - degrees)) best = f;
  }
  return best;
}

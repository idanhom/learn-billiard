/**
 * Calling your own miss before you see it.
 *
 * Once the ghost ball has gone, the report waits while the player says how
 * they hit the shot: thick or thin (left or right on a straight-in), and by a
 * little or a lot. Knowing your own error without being told is what lets you
 * correct at a real table, where nothing reports it, and saying it before the
 * report is the only way to find out whether you can.
 *
 * Five answers, signed like the bias: thick or left positive. Two means out
 * of the pocket altogether, one inside it but off centre, nought on the line.
 */

export type Estimate = -2 | -1 | 0 | 1 | 2;

/** Thickest first, as the buttons read left to right. */
export const ESTIMATES: readonly Estimate[] = [2, 1, 0, -1, -2];

/** Within this share of the pocket either side, a shot counts as on the line. */
export const ON_THE_LINE = 0.25;

/** What a signed share of the pocket was, in the terms the player is asked in. */
export function estimateOf(pocketShare: number): Estimate {
  const used = Math.abs(pocketShare);
  if (used <= ON_THE_LINE) return 0;
  const size = used <= 1 ? 1 : 2;
  return (pocketShare > 0 ? size : -size) as Estimate;
}

/** How an estimate reads, on a cut or on a straight-in. */
export function estimateLabel(estimate: Estimate, straight: boolean): string {
  if (estimate === 0) return 'on';
  const side = straight ? (estimate > 0 ? 'left' : 'right') : estimate > 0 ? 'thick' : 'thin';
  return `${Math.abs(estimate) === 2 ? 'way' : 'a bit'} ${side}`;
}

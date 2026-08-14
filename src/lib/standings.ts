export type StandingRow = {
  userId: string;
  displayName: string;
  points: number;
  gameweeksPlayed: number;
  /** Shared where points are level: 1, 2, 2, 4. */
  position: number;
  /** True when at least one other player has the same points. */
  tied: boolean;
};

export type RankInput = {
  userId: string;
  displayName: string;
  points: number;
  gameweeksPlayed: number;
};

/**
 * Rank players by points, with shared positions for ties.
 *
 * The spreadsheet sorts on total points alone and has no tiebreak, so neither
 * does this — players level on points genuinely share a position rather than
 * being separated by something invented here. Name is used only to make the
 * render order stable, never to break a tie in the standings themselves.
 *
 * If a tiebreak is wanted later, the obvious candidates are fewest auto-picks
 * (rewarding turning up) or head-to-head over the season.
 */
export function rank(rows: RankInput[]): StandingRow[] {
  const sorted = [...rows].sort(
    (a, b) => b.points - a.points || a.displayName.localeCompare(b.displayName),
  );

  const counts = new Map<number, number>();
  for (const r of sorted) counts.set(r.points, (counts.get(r.points) ?? 0) + 1);

  const out: StandingRow[] = [];
  let position = 0;
  let lastPoints: number | null = null;

  sorted.forEach((row, index) => {
    if (row.points !== lastPoints) {
      position = index + 1;
      lastPoints = row.points;
    }
    out.push({
      ...row,
      position,
      tied: (counts.get(row.points) ?? 0) > 1,
    });
  });

  return out;
}

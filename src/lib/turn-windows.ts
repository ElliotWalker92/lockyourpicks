const HOUR = 3_600_000;

/**
 * When each seat still to pick is due.
 *
 * Only the seat on the clock has a deadline stored — `drafts.turn_expires_at`
 * — because the rest are computed from `now()` at the moment the turn passes
 * on. So the honest answer for a player further down the order is a
 * projection: the deadline they'd be given if everyone ahead of them used
 * their turn in full.
 *
 * This mirrors `turn_deadline` and `advance_draft_turn` in migration 0015
 * exactly, walking the same arithmetic forward one seat at a time. Where it
 * disagrees with the database the database wins — this only ever puts a time
 * on screen, it can't hand anybody a turn.
 *
 * Returns one entry per seat: null for seats that have already picked, a
 * Date for the rest, with `projected` false only for the seat on the clock.
 */
export function turnDeadlines({
  seats,
  currentTurn,
  currentExpiry,
  hardDeadline,
  now,
}: {
  /** How many players are in the draft. */
  seats: number;
  /** Index of the seat on the clock. */
  currentTurn: number;
  /** `drafts.turn_expires_at` — authoritative for the current seat. */
  currentExpiry: Date | null;
  /** Five minutes before the first kickoff. Nobody picks past this. */
  hardDeadline: Date;
  now: Date;
}): ({ at: Date; projected: boolean } | null)[] {
  const out: ({ at: Date; projected: boolean } | null)[] = Array.from(
    { length: seats },
    () => null,
  );

  const end = hardDeadline.getTime();
  let previous = now.getTime();

  for (let seat = Math.max(currentTurn, 0); seat < seats; seat++) {
    const remaining = seats - seat;
    let at: number;

    // Only a stored expiry is a fact. Everything else — including the seat on
    // the clock if it somehow has none — is this function's arithmetic, and
    // is labelled as such.
    const stored = seat === currentTurn && currentExpiry !== null;

    if (stored) {
      at = currentExpiry!.getTime();
    } else if (remaining <= 1) {
      at = end;
    } else {
      const available = Math.max(end - previous, 0);
      const share = available / remaining;
      // An hour held back for each player still behind this one, or an equal
      // share of a window too short to promise even that.
      const reserve = Math.min(HOUR, share);
      at = Math.min(end - reserve * (remaining - 1), previous + share);
    }

    out[seat] = { at: new Date(at), projected: !stored };
    previous = at;
  }

  return out;
}

/**
 * `Fri 29 Aug, 18:20`.
 *
 * London explicitly, on both sides of the render: the fixtures are English
 * and a deadline that reads differently on the server and in the browser is
 * a hydration mismatch as well as a lie.
 */
export function formatDeadline(at: Date): string {
  return at.toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/London',
  });
}

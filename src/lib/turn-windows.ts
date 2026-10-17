const HOUR = 3_600_000;

/** What a turn holds back for each player still behind it — see 0030. */
const RESERVE = 6 * HOUR;

/**
 * The next midday or eight in the evening, London time.
 *
 * Mirrors `next_pick_slot` in migration 0030. Deadlines are pushed forward
 * to one of these so a turn ends when somebody might plausibly be looking
 * at their phone, rather than at 06:33 on a Monday.
 */
function nextPickSlot(at: Date): Date {
  const london = new Date(
    at.toLocaleString('en-US', { timeZone: 'Europe/London' }),
  );
  const offset = at.getTime() - london.getTime();

  for (const [days, hour] of [
    [0, 12],
    [0, 20],
    [1, 12],
    [1, 20],
  ] as const) {
    const slot = new Date(london);
    slot.setDate(slot.getDate() + days);
    slot.setHours(hour, 0, 0, 0);
    if (slot.getTime() >= london.getTime()) {
      return new Date(slot.getTime() + offset);
    }
  }

  const last = new Date(london);
  last.setDate(last.getDate() + 2);
  last.setHours(12, 0, 0, 0);
  return new Date(last.getTime() + offset);
}

/**
 * When each seat still to pick is due.
 *
 * Only the seat on the clock has a deadline stored — `drafts.turn_expires_at`
 * — because the rest are computed from `now()` at the moment the turn passes
 * on. So the honest answer for a player further down the order is a
 * projection: the deadline they'd be given if everyone ahead of them used
 * their turn in full.
 *
 * This mirrors `turn_deadline` in migration 0030 exactly — the share, the
 * six-hour reserve and the snap to the next civilised hour — walking the
 * same arithmetic forward one seat at a time. Where it
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
      // Held back for each player still behind this one, or an equal share
      // of a window too short to promise even that.
      const reserve = Math.min(RESERVE, share);
      const latest = end - reserve * (remaining - 1);
      const raw = Math.min(previous + share, latest);

      // Snapping forward is a kindness, not a licence to overrun: it applies
      // only while it still leaves the reserve intact.
      const snapped = nextPickSlot(new Date(raw)).getTime();
      at = snapped <= latest ? snapped : raw;
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

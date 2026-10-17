/**
 * Formatting only.
 *
 * This file used to carry a copy of the database's deadline arithmetic so
 * the board could put a time against seats that hadn't been reached yet.
 * That copy drifted out of step with migration 0030 and showed every player
 * a projection that was too early, at an hour nobody would choose — the
 * second time it had drifted. The schedule now comes from `turn_schedule`
 * in migration 0035, which is also the thing that can hand somebody a turn,
 * so there is nothing left to keep in step.
 */

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

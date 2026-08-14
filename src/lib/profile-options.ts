/**
 * Shared profile constants and types.
 *
 * These deliberately do NOT live in `lib/actions/profile.ts`: a `'use server'`
 * module may only export async functions. Exporting a plain object or array
 * from one makes Next treat it as a server reference, and it arrives on the
 * client as a promise rather than the value — which shows up as
 * "Cannot update a component while rendering a different component", nowhere
 * near the actual cause.
 */

export type ProfileState = { error: string | null; success: string | null };

export const EMPTY: ProfileState = { error: null, success: null };

/** Palette offered in the profile picker — the same family the draft board uses. */
export const AVATAR_COLORS = [
  '#c8f135',
  '#7dd3fc',
  '#fca5a5',
  '#fcd34d',
  '#c4b5fd',
  '#86efac',
  '#f9a8d4',
  '#fdba74',
] as const;

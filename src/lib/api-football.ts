/**
 * API-Football (api-sports.io) client.
 *
 * Two things about this API that bite if you don't handle them:
 *
 * 1. It returns HTTP 200 with an `errors` object for plan violations, rate
 *    limits and bad parameters. A naive `res.ok` check passes straight over a
 *    failed request and hands you an empty array, which then looks like "no
 *    fixtures this week" rather than an error. Every response goes through
 *    `unwrap()` here for that reason.
 *
 * 2. `errors` is `[]` when empty but an object when populated, so it can't be
 *    tested for length.
 */

import { serverEnv } from '@/lib/server-env';

const BASE = 'https://v3.football.api-sports.io';

export type ApiFootballResponse<T> = {
  errors: Record<string, string> | never[];
  results: number;
  response: T[];
};

export type ApiLeague = {
  league: { id: number; name: string; type: string };
  country: { name: string };
  seasons: { year: number; current: boolean }[];
};

export type ApiTeam = {
  id: number;
  name: string;
  code: string | null;
  logo: string | null;
};

export type ApiFixture = {
  fixture: {
    id: number;
    date: string;
    status: { short: string };
  };
  league: { id: number; season: number; round: string };
  teams: { home: ApiTeam; away: ApiTeam };
  goals: { home: number | null; away: number | null };
};

export class ApiFootballError extends Error {
  constructor(
    message: string,
    readonly detail?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiFootballError';
  }
}

function unwrap<T>(body: ApiFootballResponse<T>, context: string): T[] {
  const { errors } = body;
  const hasErrors =
    errors && !Array.isArray(errors) && Object.keys(errors).length > 0;

  if (hasErrors) {
    const detail = errors as Record<string, string>;
    throw new ApiFootballError(
      `${context}: ${Object.entries(detail)
        .map(([k, v]) => `${k}: ${v}`)
        .join('; ')}`,
      detail,
    );
  }

  return body.response ?? [];
}

/**
 * The plan has a per-minute request ceiling as well as a daily one, and a
 * handful of competition fetches back to back is enough to trip it. When it
 * does, the API answers HTTP 200 with a rateLimit error — so without this the
 * competition simply vanishes from the results and nothing looks wrong.
 */
let lastRequestAt = 0;
const MIN_GAP_MS = 1500;

async function throttle() {
  const wait = lastRequestAt + MIN_GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

async function request<T>(
  path: string,
  params: Record<string, string | number>,
): Promise<T[]> {
  const key = serverEnv('API_FOOTBALL_KEY');
  if (!key) throw new ApiFootballError('API_FOOTBALL_KEY is not set');

  await throttle();

  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }

  const res = await fetch(url, {
    headers: { 'x-apisports-key': key },
    // Fixture data changes constantly; never let Next cache it.
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new ApiFootballError(
      `${path} returned HTTP ${res.status} ${res.statusText}`,
    );
  }

  return unwrap<T>(await res.json(), path);
}

/**
 * Every English competition with its per-season coverage.
 *
 * Worth calling before fixtures: competitions don't share a current season.
 * In August 2026 the FA Cup still reported 2025 as current while the leagues
 * had rolled to 2026, so assuming one season number across the board silently
 * returns nothing for the cup.
 */
export async function getEnglandLeagues(): Promise<ApiLeague[]> {
  return request<ApiLeague>('/leagues', { country: 'England' });
}

/** Current season year for a competition, or null if it reports none. */
export function currentSeasonOf(league: ApiLeague): number | null {
  return league.seasons.find((s) => s.current)?.year ?? null;
}

/**
 * Whether a competition has data for a given season year.
 *
 * Prefer this over `currentSeasonOf` when ingesting. "Current" is the
 * provider's idea of which season is live *for that competition*, which is not
 * the same as the season we're playing: in August 2026 the FA Cup still had
 * 2025 marked current, so following it would fetch the 2025/26 competition —
 * 872 fixtures, every one of them before our season even starts.
 */
export function hasSeason(league: ApiLeague, year: number): boolean {
  return league.seasons.some((s) => s.year === year);
}

export async function getFixtures(
  leagueId: number,
  season: number,
): Promise<ApiFixture[]> {
  return request<ApiFixture>('/fixtures', { league: leagueId, season });
}

/** Every fixture on a given date, across all competitions. */
export async function getFixturesByDate(date: string): Promise<ApiFixture[]> {
  return request<ApiFixture>('/fixtures', { date });
}

/**
 * Map an API-Football status code to our `fixture_status` enum.
 * Reference: NS/TBD scheduled · 1H/HT/2H/ET/BT/P/LIVE in play ·
 * FT/AET/PEN finished · PST/SUSP postponed · CANC/ABD cancelled.
 */
export function mapStatus(
  short: string,
): 'scheduled' | 'live' | 'finished' | 'postponed' | 'cancelled' {
  if (['FT', 'AET', 'PEN'].includes(short)) return 'finished';
  if (['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE', 'INT'].includes(short)) {
    return 'live';
  }
  if (['PST', 'SUSP'].includes(short)) return 'postponed';
  if (['CANC', 'ABD', 'AWD', 'WO'].includes(short)) return 'cancelled';
  return 'scheduled';
}

export type ApiStandingRow = {
  rank: number;
  team: { id: number; name: string; logo: string | null };
  points: number;
  goalsDiff: number;
  form: string | null;
  status: string | null;
  description: string | null;
  all: ApiStandingSplit;
  home: ApiStandingSplit;
  away: ApiStandingSplit;
};

export type ApiStandingSplit = {
  played: number;
  win: number;
  draw: number;
  lose: number;
  goals: { for: number; against: number };
};

type ApiStandingsResponse = {
  league: {
    id: number;
    name: string;
    season: number;
    /** Grouped — one array per group. A league has exactly one. */
    standings: ApiStandingRow[][];
  };
};

/**
 * The league table for one competition.
 *
 * Knockouts have no table: the FA Cup and EFL Cup return zero results
 * rather than an error, so an empty array here is expected, not a failure.
 */
export async function getStandings(
  leagueId: number,
  season: number,
): Promise<ApiStandingRow[]> {
  const response = await request<ApiStandingsResponse>('/standings', {
    league: leagueId,
    season,
  });

  // Groups are concatenated so a grouped competition would still work.
  return (response[0]?.league?.standings ?? []).flat();
}

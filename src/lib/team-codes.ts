/**
 * Three-letter club codes, for when a fixture has to fit on a phone.
 *
 * `teams.short_name` exists and is null for all 92 clubs: it's mapped from
 * the provider's `team.code`, but teams are ingested out of the *fixtures*
 * response, whose embedded team object carries only id, name and logo. So
 * every "short" name on the board has silently been the long one.
 *
 * Fetching the codes properly is possible — /teams does return them — but
 * they collide badly across four divisions: Brighton and Bristol Rovers are
 * both BRI, Chelsea and Chesterfield and Cheltenham are all CHE, and a cup
 * tie would render as CHE v CHE. Notts County and Nottingham Forest are both
 * NOT. Salford City has no code at all.
 *
 * These are the broadcast abbreviations instead — the ones already on the
 * scoreboard when the game is on — chosen to be unique across the 92. A club
 * that isn't here (promotion from the National League brings two or three
 * every summer) falls back to a derivation, which is worse but never blank.
 */
const TEAM_CODES: Record<string, string> = {
  'Accrington ST': 'ACC',
  'AFC Wimbledon': 'WIM',
  Arsenal: 'ARS',
  'Aston Villa': 'AVL',
  Barnet: 'BNT',
  Barnsley: 'BAR',
  Birmingham: 'BIR',
  Blackburn: 'BLB',
  Blackpool: 'BLP',
  Bolton: 'BOL',
  Bournemouth: 'BOU',
  Bradford: 'BRD',
  Brentford: 'BRE',
  Brighton: 'BHA',
  'Bristol City': 'BRC',
  'Bristol Rovers': 'BRR',
  Bromley: 'BRO',
  Burnley: 'BUR',
  'Burton Albion': 'BTA',
  'Cambridge United': 'CAM',
  Cardiff: 'CAR',
  Charlton: 'CHA',
  Chelsea: 'CHE',
  Cheltenham: 'CHL',
  Chesterfield: 'CHF',
  Colchester: 'COL',
  Coventry: 'COV',
  'Crawley Town': 'CRW',
  Crewe: 'CRE',
  'Crystal Palace': 'CRY',
  Derby: 'DER',
  Doncaster: 'DON',
  Everton: 'EVE',
  'Exeter City': 'EXE',
  'Fleetwood Town': 'FLE',
  Fulham: 'FUL',
  Gillingham: 'GIL',
  Grimsby: 'GRM',
  Huddersfield: 'HUD',
  'Hull City': 'HUL',
  Ipswich: 'IPS',
  Leeds: 'LEE',
  Leicester: 'LEI',
  'Leyton Orient': 'LEY',
  Lincoln: 'LIN',
  Liverpool: 'LIV',
  Luton: 'LUT',
  'Manchester City': 'MCI',
  'Manchester United': 'MUN',
  'Mansfield Town': 'MNS',
  Middlesbrough: 'MID',
  Millwall: 'MIL',
  'Milton Keynes Dons': 'MKD',
  Newcastle: 'NEW',
  'Newport County': 'NPT',
  Northampton: 'NTH',
  Norwich: 'NOR',
  'Nottingham Forest': 'NFO',
  'Notts County': 'NTC',
  Oldham: 'OLD',
  'Oxford United': 'OXF',
  Peterborough: 'PET',
  Plymouth: 'PLY',
  'Port Vale': 'PVA',
  Portsmouth: 'POR',
  Preston: 'PNE',
  QPR: 'QPR',
  Reading: 'RDG',
  Rochdale: 'ROC',
  Rotherham: 'ROT',
  'Salford City': 'SAL',
  'Sheffield Utd': 'SHU',
  'Sheffield Wednesday': 'SHW',
  Shrewsbury: 'SHR',
  Southampton: 'SOU',
  Stevenage: 'STV',
  'Stockport County': 'SPT',
  'Stoke City': 'STK',
  Sunderland: 'SUN',
  Swansea: 'SWA',
  'Swindon Town': 'SWI',
  Tottenham: 'TOT',
  Tranmere: 'TRA',
  Walsall: 'WAL',
  Watford: 'WAT',
  'West Brom': 'WBA',
  'West Ham': 'WHU',
  Wigan: 'WIG',
  Wolves: 'WOL',
  Wrexham: 'WRX',
  Wycombe: 'WYC',
  York: 'YRK',
};

/**
 * Last resort for a club the table doesn't know.
 *
 * Drops the article-ish prefixes that carry no identity — AFC Wimbledon is
 * Wimbledon, not AFC — and takes three letters off what's left. Two new
 * clubs could collide, which is why this is the fallback and not the rule.
 */
function derive(name: string): string {
  const words = name
    .replace(/[^A-Za-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((w, i) => !(i === 0 && /^(afc|fc)$/i.test(w)));

  const first = words[0] ?? name;
  return (first.length >= 3 ? first.slice(0, 3) : first).toUpperCase();
}

/** `Nottingham Forest` → `NFO`. Never empty. */
export function abbreviate(name: string): string {
  return TEAM_CODES[name] ?? derive(name);
}

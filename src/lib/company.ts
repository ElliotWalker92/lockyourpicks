/**
 * Who actually runs this.
 *
 * Lock Your Picks is a Top Reds Ltd brand, and a UK company has to put
 * its name, registered number, place of registration and registered
 * office somewhere easy to find on its website — the trading disclosure
 * rules under the Companies Act. A footer on the public pages is the
 * usual way to do it, and it is what deskhops.com, the other Top Reds
 * site, already does.
 *
 * Kept here rather than typed into each footer so the number and the
 * address exist once. If the registered office moves, this is the only
 * line to change.
 */
export const COMPANY = {
  name: 'Top Reds Ltd',
  jurisdiction: 'England and Wales',
  number: '17532182',
  office: 'Flat 1, 69 Camberwell Grove, London, England, SE5 8JE',
} as const;

/** The disclosure itself, worded the same way across the brands. */
export const COMPANY_LINE =
  `${COMPANY.name} is a company registered in ${COMPANY.jurisdiction}, ` +
  `number ${COMPANY.number}. Registered office: ${COMPANY.office}.`;

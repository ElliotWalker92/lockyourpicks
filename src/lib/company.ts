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
  /**
   * The company's own ICO registration, so it is the same number
   * deskhops.com publishes — it belongs to Top Reds Ltd, not to either
   * brand.
   */
  ico: 'ZC281295',
  /** Where a data request or anything else legal should land. */
  email: 'info@lockyourpicks.com',
} as const;

/**
 * Where the personal data physically sits, named in the privacy policy.
 *
 * This is the Supabase project's region, which is fixed when the project
 * is created and is not readable from the API — it is only on the
 * project's settings page. Written down here so the claim in the policy
 * has one source, and so it is obvious what to correct if the project
 * ever moves.
 */
export const DATA_REGION = 'the European Union (Ireland)';

/** Set by hand whenever either policy is edited. */
export const LEGAL_UPDATED = '7 November 2026';

/** The disclosure itself, worded the same way across the brands. */
export const COMPANY_LINE =
  `${COMPANY.name} is a company registered in ${COMPANY.jurisdiction}, ` +
  `number ${COMPANY.number}. Registered office: ${COMPANY.office}.`;

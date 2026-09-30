/** The public domain, printed on every share card and PDF page. */
export const SITE_DOMAIN = "moneyautopsy.xyz";
/** Where the site is actually served: the bare domain 308-redirects to www on Vercel, so links,
 * canonical URLs and payment callbacks point straight here instead of through that hop. */
export const SITE_URL = `https://www.${SITE_DOMAIN}`;
/** Vercel's own production address for this project. It serves the same app, so anyone who
 * lands there is sent to the real domain (see next.config.ts). */
export const VERCEL_PRODUCTION_HOST = "moneyautopsy-five.vercel.app";
export const SITE_NAME = "Money Autopsy";
export const SITE_TITLE = "Money Autopsy: what actually happened to your money?";
export const SITE_DESCRIPTION =
  "Upload a bank statement and see where your money really went: what you spent, what you only moved, and what to change. Read once, never saved.";

/** The logo mark (a pie with a slice cut out) as one SVG path on a 64×64 grid. Source: img/mark-green.svg. */
export const LOGO_MARK_PATH = "M32 32 L50.4 13.6 A26 26 0 1 1 32 6 Z";

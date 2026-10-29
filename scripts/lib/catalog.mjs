// Every series the dashboard shows. Nothing here needs an API key (FRED_API_KEY is optional).
// `expect` (label/title regex) and `sane` (plausible range for the latest value) guard against wrong ids.

const START = '1990-01-01';

const valet = (key, label, ids, expect, extra = {}) =>
  ({ key, source: 'valet', label, ids, expect, unit: '%', sane: [-1, 30], ...extra });
const statcan = (key, label, vector, expect, sane, extra = {}) =>
  ({ key, source: 'statcan', label, vector, expect, sane, unit: 'index', ...extra });
const fred = (key, label, id, sane, extra = {}) =>
  ({ key, source: 'fred', label, id, sane, unit: '%', ...extra });

const YIELD = { daily: true, group: 'bond_yields_benchmark' };

export const START_DATE = START;

export const CATALOG = [
  // ---- Bank of Canada (Valet) ----
  valet('ca_policy', 'BoC target for the overnight rate', ['V39079'], /overnight/i, { stepOnly: true, sane: [0, 25] }),
  valet('ca_prime', 'Chartered bank prime rate', ['V80691311'], /prime/i,
    { stepOnly: true, group: 'chartered_bank_interest', sane: [0, 30] }),
  valet('ca_mort5_posted', 'Posted 5-year conventional mortgage rate', [], /5[- ]?year.*(mortgage|conventional)|(mortgage|conventional).*5[- ]?year/i,
    { group: 'chartered_bank_interest', sane: [0, 30], optional: true }),
  valet('ca_corra', 'CORRA (overnight repo rate)', ['AVG.INTWO'], /corra|repo/i, { daily: true, sane: [0, 25], optional: true }),
  valet('ca_y2', 'GoC 2-year benchmark yield', ['BD.CDN.2YR.DQ.YLD'], /\b2[ -]?y(ea)?r/i, YIELD),
  valet('ca_y3', 'GoC 3-year benchmark yield', ['BD.CDN.3YR.DQ.YLD'], /\b3[ -]?y(ea)?r/i, YIELD),
  valet('ca_y5', 'GoC 5-year benchmark yield', ['BD.CDN.5YR.DQ.YLD'], /\b5[ -]?y(ea)?r/i, YIELD),
  valet('ca_y7', 'GoC 7-year benchmark yield', ['BD.CDN.7YR.DQ.YLD'], /\b7[ -]?y(ea)?r/i, YIELD),
  valet('ca_y10', 'GoC 10-year benchmark yield', ['BD.CDN.10YR.DQ.YLD'], /\b10[ -]?y(ea)?r/i, YIELD),
  valet('ca_y30', 'GoC long-term benchmark yield', ['BD.CDN.LONG.DQ.YLD'], /long/i, YIELD),
  valet('ca_cpi_trim', 'CPI-trim (core), year over year', ['CPI_TRIM'], /trim/i, { sane: [-5, 25] }),
  valet('ca_cpi_median', 'CPI-median (core), year over year', ['CPI_MEDIAN'], /median/i, { sane: [-5, 25] }),
  valet('ca_cpi_common', 'CPI-common (core), year over year', ['CPI_COMMON'], /common/i, { sane: [-5, 25], optional: true }),

  // Canadian banks, the Bank of Canada balance sheet and household credit performance (counterparts of the US bank charts)
  valet('ca_boc_assets', 'Bank of Canada total assets ($ millions)', ['V36610'], /total assets/i,
    { group: 'B2_WEEKLY', daily: true, unit: '$mn', sane: [20000, 2000000], optional: true }),
  valet('ca_bank_mortgages', 'Chartered banks: residential mortgage loans, Canadian-dollar ($ millions)', ['V36857'], /mortgages/i,
    { group: 'C1_MONTHLY', unit: '$mn', sane: [300000, 20000000], optional: true }),
  valet('ca_bank_nonmortgage', 'Chartered banks: non-mortgage loans, Canadian-dollar ($ millions)', ['V36855'], /non-mortgage loans/i,
    { group: 'C1_MONTHLY', unit: '$mn', sane: [300000, 20000000], optional: true }),
  valet('ca_arrears_mtg', 'Mortgage arrears rate (Bank of Canada financial vulnerabilities indicator)', ['FVI_LOANS_ARR_MTG'], /mortgage/i,
    { group: 'FVI_HOUSEHOLD_CREDIT_PERFORMANCE', sane: [0, 10], optional: true }),
  valet('ca_rrb', 'GoC real return bond yield, long-term', ['BD.CDN.RRB.DQ.YLD'], /real return/i,
    { group: 'bond_yields_benchmark', daily: true, sane: [-3, 10], optional: true }),

  // ---- Statistics Canada (WDS) ----
  statcan('ca_cpi_index', 'CPI, all-items, Canada (2002=100)', 41690973, /canada.*all-items/i, [40, 500]),
  statcan('ca_unemp', 'Unemployment rate, Canada (seasonally adjusted)', 2062815, /unemployment rate/i, [1, 30], { unit: '%' }),
  statcan('ca_employment', 'Employment, Canada (thousands, seasonally adjusted)', 2062811, /employment;.*seasonally adjusted/i, [10000, 40000], { unit: 'thousands', optional: true }),
  statcan('ca_nhpi', 'New housing price index, Canada total', 111955442, /canada.*house and land/i, [10, 400]),
  // housing starts: StatCan gives only the geography as a title, so this one is range-checked only (expect = null)
  statcan('ca_starts', 'Housing starts, Canada (thousands of units, annualised)', 52300157, null, [100, 800], { unit: 'thousand units', optional: true }),

  // ---- US Federal Reserve & markets (FRED) ----
  fred('us_ff_upper', 'Fed funds target, upper bound', 'DFEDTARU', [0, 25], { stepOnly: true }),
  fred('us_ff_lower', 'Fed funds target, lower bound', 'DFEDTARL', [0, 25], { stepOnly: true }),
  fred('us_effr', 'Effective fed funds rate', 'EFFR', [0, 25], { daily: true }),
  fred('us_sofr', 'SOFR', 'SOFR', [0, 25], { daily: true, optional: true }),
  fred('us_y3m', 'US Treasury 3-month yield', 'DGS3MO', [-1, 25], { daily: true }),
  fred('us_y2', 'US Treasury 2-year yield', 'DGS2', [-1, 25], { daily: true }),
  fred('us_y5', 'US Treasury 5-year yield', 'DGS5', [-1, 25], { daily: true }),
  fred('us_y10', 'US Treasury 10-year yield', 'DGS10', [-1, 25], { daily: true }),
  fred('us_y30', 'US Treasury 30-year yield', 'DGS30', [-1, 25], { daily: true }),
  fred('us_10y2y', 'US 10-year minus 2-year spread', 'T10Y2Y', [-6, 6], { daily: true }),
  fred('us_be10', 'US 10-year breakeven inflation', 'T10YIE', [-3, 10], { daily: true }),
  fred('us_cpi_index', 'US CPI, all items (index)', 'CPIAUCSL', [10, 1000], { unit: 'index' }),
  fred('us_core_cpi_index', 'US core CPI (index)', 'CPILFESL', [10, 1000], { unit: 'index' }),
  fred('us_core_pce_index', 'US core PCE price index', 'PCEPILFE', [10, 1000], { unit: 'index' }),
  fred('us_unemp', 'US unemployment rate', 'UNRATE', [0, 30]),
  fred('us_payrolls', 'US nonfarm payrolls (thousands)', 'PAYEMS', [50000, 300000], { unit: 'thousands' }),
  fred('us_mort30', 'Freddie Mac 30-year fixed mortgage rate', 'MORTGAGE30US', [0, 25], { daily: true }),
  fred('us_hy_oas', 'US high-yield credit spread (ICE BofA OAS)', 'BAMLH0A0HYM2', [0, 30], { daily: true, optional: true }),
  fred('us_wti', 'WTI crude oil ($/bbl)', 'DCOILWTICO', [-100, 400], { daily: true, unit: '$' }),
  fred('usdcad', 'CAD per USD', 'DEXCAUS', [0.5, 3], { daily: true, unit: 'CAD' }),
  // US banks and who holds US government debt
  fred('us_walcl', 'Fed balance sheet, total assets ($ millions)', 'WALCL', [1e5, 3e7], { unit: '$mn' }),
  fred('us_bank_credit', 'Bank credit, all US commercial banks ($ billions)', 'TOTBKCR', [1000, 60000], { unit: '$bn', optional: true }),
  fred('us_delinq_mort', 'Delinquency rate on single-family mortgages, US banks', 'DRSFRMACBS', [0, 30], { optional: true }),
  fred('us_debt_fed', 'US federal debt held by the Federal Reserve ($ billions)', 'FDHBFRBN', [100, 1e5], { unit: '$bn', optional: true }),
  fred('us_debt_foreign', 'US federal debt held by foreign & international investors ($ billions)', 'FDHBFIN', [100, 1e5], { unit: '$bn', optional: true }),
  fred('us_debt_private', 'US federal debt held by private investors, incl. foreign ($ billions)', 'FDHBPIN', [100, 1e5], { unit: '$bn', optional: true }),
];

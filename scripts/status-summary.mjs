// Shared status helpers so the headline never hides a worse offshore rating.
// Ranks follow the poster colours: GREEN (GOOD) < AMBER/YELLOW (CAUTION) < RED (ALERT).
const RANK = { GREEN: 1, YELLOW: 2, AMBER: 2, RED: 3 };
const WORD = { GREEN: 'GOOD', YELLOW: 'CAUTION', AMBER: 'CAUTION', RED: 'ALERT' };

export const normalStatus = value => {
  const s = String(value ?? '').trim().toUpperCase();
  return RANK[s] ? (s === 'YELLOW' ? 'AMBER' : s) : null;
};

export const statusWord = value => WORD[normalStatus(value)] || 'UNRATED';

/** Worst of any number of statuses; null when none are rated. */
export function worstStatus(...values) {
  let worst = null;
  for (const v of values) {
    const s = normalStatus(v);
    if (s && (!worst || RANK[s] > RANK[worst])) worst = s;
  }
  return worst;
}

/**
 * Summary of the offshore banks on a poster payload (bank1/bank2).
 * Returns { status, word, worse, names, text } where `worse` is true when an
 * offshore bank is rated worse than the inshore Kingston / Maiden Cay headline.
 */
export function offshoreSummary(d) {
  const banks = [1, 2]
    .map(n => ({ name: String(d?.[`bank${n}`] || '').trim(), status: normalStatus(d?.[`bank${n}status`]) }))
    .filter(b => b.name && b.status);
  const status = worstStatus(...banks.map(b => b.status));
  if (!status) return { status: null, word: 'UNRATED', worse: false, names: [], text: 'OFFSHORE BANKS: NOT RATED' };
  // Short names keep the warning on one line of the poster ("California Bank" -> "California").
  const names = banks.filter(b => b.status === status).map(b => b.name.replace(/\s+bank$/i, ''));
  const inshore = normalStatus(d?.status);
  const worse = !inshore || RANK[status] > RANK[inshore];
  const word = WORD[status];
  const text = worse
    ? `OFFSHORE ${word}: ${names.join(' & ').toUpperCase()}`
    : `OFFSHORE BANKS: ${word}`;
  return { status, word, worse, names, text };
}

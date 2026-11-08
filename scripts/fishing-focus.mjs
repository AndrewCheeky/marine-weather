// Which fishing METHOD today's conditions suit. This is about the sea state, never a claim
// about which fish are present. Same rule as bestFishingType_ in the Apps Script.
//   rough   : seas over 6 ft or wind over 18 kt
//   reef    : wind 12 kt or less and seas 4 ft or less
//   either  : as reef, plus a pelagic sign (current 0.3 kt or more, or a Moderate/High weed line)
//   pelagic : otherwise, seas 5 ft or less (a moderate breeze suits trolling)
//   choppy  : seas 5–6 ft
//   mixed   : not enough data
export const FOCUS_KEYS = ['pelagic', 'reef', 'either', 'choppy', 'rough', 'mixed'];

export function fishingMethod({windKn, waveM, currentKn, weedLevel} = {}) {
  const w = Number(windKn), s = Number(waveM) * 3.28084, c = Number(currentKn);
  if (windKn == null || waveM == null || !Number.isFinite(w) || !Number.isFinite(s)) return 'mixed';
  if (s > 6 || w > 18) return 'rough';
  const pelagicSign = (Number.isFinite(c) && c >= 0.3) || /^(moderate|high)/i.test(String(weedLevel || ''));
  if (w <= 12 && s <= 4) return pelagicSign ? 'either' : 'reef';
  if (s <= 5) return 'pelagic';
  return 'choppy';
}

// Poster headline and second line for each key.
export function focusLabel(focus) {
  return {
    pelagic: ['SUITS TROLLING', 'Tuna · Wahoo · Dolphin'],
    reef: ['SUITS BOTTOM / REEF', 'Snapper · Grouper · Reef fish'],
    either: ['TROLLING OR BOTTOM', 'Both methods suit today'],
    choppy: ['CHOPPY: TROLL WITH CARE', 'Hard to hold bottom'],
    rough: ['ROUGH: STAY CLOSE OR IN', 'Not suited to offshore'],
    mixed: ['MIXED FISHING', 'Pelagic · Bottom / Reef'],
  }[focus] || ['MIXED FISHING', 'Pelagic · Bottom / Reef'];
}

export function fishingFocus(bank = {}) {
  // Catch reports win when there are enough of them.
  const evidence = bank.fishingEvidence ?? bank.catchEvidence ?? null;
  const pelagic = Number(evidence?.pelagicReports);
  const reef = Number(evidence?.reefReports);
  const valid = Number.isInteger(pelagic) && Number.isInteger(reef) && pelagic >= 0 && reef >= 0;
  if (valid && pelagic + reef >= 5 && Math.abs(pelagic - reef) >= 3) {
    return pelagic > reef ? 'pelagic' : 'reef';
  }
  // Otherwise a focus worked out from the conditions (Apps Script or the generator).
  if (bank.focusVerified === true) {
    const focus = String(bank.focus ?? '').trim().toLowerCase();
    if (FOCUS_KEYS.includes(focus)) return focus;
  }
  if (bank.conditions) return fishingMethod(bank.conditions);
  return 'mixed';
}

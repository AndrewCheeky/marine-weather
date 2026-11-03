// Conservative fishing approach guidance, never a fish-presence prediction.
// Weather affects safety and comfort, not evidence of which species are present.
export function fishingFocus(bank = {}) {
  const evidence = bank.fishingEvidence ?? bank.catchEvidence ?? null;
  const pelagic = Number(evidence?.pelagicReports);
  const reef = Number(evidence?.reefReports);
  const valid = Number.isInteger(pelagic) && Number.isInteger(reef) && pelagic >= 0 && reef >= 0;
  // Require at least 5 recent reports and a meaningful lead; avoid noisy switches.
  if (valid && pelagic + reef >= 5 && Math.abs(pelagic - reef) >= 3) {
    return pelagic > reef ? 'pelagic' : 'reef';
  }
  // A specifically verified approach recommendation can be provided by the data source.
  if (bank.focusVerified === true) {
    const focus = String(bank.focus ?? '').trim().toLowerCase();
    if (['pelagic', 'reef', 'mixed'].includes(focus)) return focus;
  }
  return 'mixed';
}

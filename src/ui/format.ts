const SUFFIXES = [
  'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc',
] as const;

// Decimals to show per abbreviated tier (parallel to SUFFIXES). Precision is
// adaptive: it grows with magnitude so the counter keeps visibly ticking — a
// fixed 2 decimals makes large counters appear frozen (e.g. at T-scale, 0.01T
// is 10B, which takes ~2 min to reach at 92M/s). T uses 4 decimals so a step
// is ~100M ≈ 1s of significant production; M/B stay at 2 (small values need
// no excess decimals).
const ABBREV_DECIMALS = [2, 2, 4, 4, 5, 5, 6, 6, 7, 7] as const;

export function formatNumber(value: number): string {
  if (Number.isNaN(value)) return '0';
  // An infinite value means an upstream overflow — surface it honestly
  // instead of masking the bug behind a plausible-looking '0'.
  if (!Number.isFinite(value)) return value > 0 ? '∞' : '-∞';

  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);

  if (abs < 1_000_000) return `${sign}${abs.toLocaleString('en-US')}`;

  let tier = Math.floor(Math.log10(abs) / 3);
  // Float drift near tier boundaries (e.g. log10(1e21) = 20.999...) can
  // under-select the tier; nudge up when the scaled value still exceeds 1000.
  if (tier >= 2 && abs / 1000 ** (tier + 1) >= 1) tier += 1;

  if (tier - 2 < SUFFIXES.length) {
    const scaled = abs / 1000 ** tier;
    // Decimals scale with the tier so large counters keep visibly ticking
    // (100.3700T moves every 0.0001T instead of every 1T).
    return `${sign}${scaled.toFixed(ABBREV_DECIMALS[tier - 2])}${SUFFIXES[tier - 2]}`;
  }

  // Past the suffix table: scientific notation keeps the counter compact
  // instead of printing absurd strings like "1000000000000.00Dc".
  const exponent = Math.floor(Math.log10(abs));
  const mantissa = abs / 10 ** exponent;
  return `${sign}${mantissa.toFixed(2)}e${exponent}`;
}

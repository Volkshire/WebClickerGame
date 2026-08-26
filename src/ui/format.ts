const SUFFIXES = [
  'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc',
] as const;

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
    // Two decimals everywhere in the abbreviated range so large counters keep
    // visibly ticking (100.37T moves every 0.01T instead of every 1T).
    return `${sign}${scaled.toFixed(2)}${SUFFIXES[tier - 2]}`;
  }

  // Past the suffix table: scientific notation keeps the counter compact
  // instead of printing absurd strings like "1000000000000.00Dc".
  const exponent = Math.floor(Math.log10(abs));
  const mantissa = abs / 10 ** exponent;
  return `${sign}${mantissa.toFixed(2)}e${exponent}`;
}

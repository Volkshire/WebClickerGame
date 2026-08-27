import { mergeNamesFile, type NamePools } from './heroNames';

/** Custom mech names are intentionally favoured over the built-in fallback. */
export const MECH_CUSTOM_NAME_WEIGHT = 0.9;

export const BUILT_IN_MECH_NAMES: readonly string[] = [
  'Atlas', 'Aegis', 'Colossus', 'Titan-01', 'Iron Reaper', 'Siegebreaker',
  'Warhound', 'Bulwark', 'Leviathan', 'Sentinel-9', 'Oblivion Engine', 'Goliath',
];

/** Same parsing rules as hero-names.txt, with an independent fallback pool. */
export function mergeMechNamesFile(rawContent: string): NamePools {
  const parsed = mergeNamesFile(rawContent);
  return { custom: parsed.custom, generated: [...BUILT_IN_MECH_NAMES] };
}

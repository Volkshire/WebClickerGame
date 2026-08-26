import type { BattleHeroOutcome } from './types';

export interface HeroFateInput {
  /** Every Hero that took part, one entry per individual (Name I / Name II). */
  roster: readonly { name: string }[];
  /** Names that fled mid-battle; they survive automatically and stay tracked. */
  fledNames: ReadonlySet<string>;
  /** True when the player's legion won the battle. */
  victory: boolean;
  /** initialAttackerPower / initialDefenderPower at first contact. */
  advantageRatio: number;
  /**
   * Age-final rule: on victory there is nowhere left to run — every standing
   * survivor is slain outright instead of rolling the kill chance.
   */
  noEscape?: boolean;
  rng: () => number;
}

/**
 * Rolls each Hero's fate once the battle is decided.
 *
 * Victory: kill chance ramps from 30% at even odds toward 85% on crushing
 * wins; survivors are reported as escaped. Defeat: standing Heroes held
 * the field — they get no fate line at all (an army that just broke yours
 * has not "escaped" anything). Mid-battle fleeers appear as fled on both
 * outcomes; the grudge ledger tracks them regardless. With noEscape set
 * (an Age's final target), survivors are cut down to a man.
 */
export function rollHeroFates(input: HeroFateInput): BattleHeroOutcome[] {
  const results: BattleHeroOutcome[] = [];
  input.fledNames.forEach((name) => {
    results.push({ name, killed: false, fled: true });
  });

  if (!input.victory) return results;

  const noEscape = input.noEscape === true;
  for (const hero of input.roster) {
    if (input.fledNames.has(hero.name)) continue;
    if (noEscape) {
      results.push({ name: hero.name, killed: true });
      continue;
    }
    const killChance = Math.min(
      0.85,
      Math.max(0.3, 0.3 + 0.18 * (input.advantageRatio - 1)),
    );
    results.push({ name: hero.name, killed: input.rng() < killChance });
  }
  return results;
}

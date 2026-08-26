/**
 * The single seam between Prestige state and every permanent bonus.
 * The base combat bonus scales with the Prestige count; everything else
 * aggregates the player's purchased Prestige Shop catalog. Future effects
 * add a field here plus a case in applyKnownEffect(); consumers read the
 * fields they care about and ignore the rest, so shop items whose
 * consumer systems do not exist yet resolve to no gameplay change.
 */

import { SHOP_ITEMS } from './shop';

export interface PrestigeEffects {
  /** Multiplier applied to attacker effective power in every battle. */
  attackerDamageMultiplier: number;
  /** Flat Souls added to every harvest click before multipliers. */
  soulsPerClickFlat: number;
  /** Multiplier applied to the final per-click Soul gain. */
  soulHarvestMultiplier: number;
  /** Multiplier applied to passive Souls per second. */
  soulGenerationMultiplier: number;
  /** Multiplier applied to every unit recruitment cost (lower = cheaper). */
  recruitCostMultiplier: number;
  /** Multiplier applied to deployed army power (consumer pending). */
  armyCombatPowerMultiplier: number;
  /** Multiplier applied to building troop generation (consumer pending). */
  troopGenerationMultiplier: number;
  /** Multiplier applied to victory loot grants (consumer pending). */
  passiveResourceMultiplier: number;
  /** Bonus Souls granted right after each run reset. */
  startingSouls: number;
  /** Bonus owned count applied to every Soul Generator at 0. */
  startingGeneratorOwned: number;
}

function applyKnownEffect(effects: PrestigeEffects, kind: string, value: number): void {
  if (!Number.isFinite(value)) return;
  switch (kind) {
    case 'attacker-damage-multiplier':
      effects.attackerDamageMultiplier *= value;
      break;
    case 'click-power-flat':
      effects.soulsPerClickFlat += value;
      break;
    case 'soul-harvest-multiplier':
      effects.soulHarvestMultiplier *= value;
      break;
    case 'soul-generation-multiplier':
      effects.soulGenerationMultiplier *= value;
      break;
    case 'recruit-cost-multiplier':
      effects.recruitCostMultiplier *= value;
      break;
    case 'army-combat-power-multiplier':
      effects.armyCombatPowerMultiplier *= value;
      break;
    case 'troop-generation-multiplier':
      effects.troopGenerationMultiplier *= value;
      break;
    case 'passive-resource-multiplier':
      effects.passiveResourceMultiplier *= value;
      break;
    case 'starting-souls':
      effects.startingSouls += value;
      break;
    case 'starting-troops':
      break;
    case 'starting-generator-owned':
      effects.startingGeneratorOwned += value;
      break;
    default:
      // Unknown kinds are legal catalog data referencing future systems;
      // until a consumer implements them they do nothing.
      break;
  }
}

export function computePrestigeEffects(
  _count: number,
  purchases: Readonly<Record<string, number>> = {},
): PrestigeEffects {
  const effects: PrestigeEffects = {
    attackerDamageMultiplier: 1,
    soulsPerClickFlat: 0,
    soulHarvestMultiplier: 1,
    soulGenerationMultiplier: 1,
    recruitCostMultiplier: 1,
    armyCombatPowerMultiplier: 1,
    troopGenerationMultiplier: 1,
    passiveResourceMultiplier: 1,
    startingSouls: 0,
    startingGeneratorOwned: 0,
  };

  for (const item of SHOP_ITEMS) {
    const owned = purchases[item.id] ?? 0;
    if (!Number.isSafeInteger(owned) || owned <= 0) continue;
    // Sanity bound so corrupt saves can never loop unreasonably.
    const copies = Math.min(owned, 1000);
    for (let copy = 0; copy < copies; copy += 1) {
      applyKnownEffect(effects, item.effect.kind, item.effect.value ?? 0);
    }
  }

  // Integer bonuses stay integral despite float accumulation.
  effects.soulsPerClickFlat = Math.round(effects.soulsPerClickFlat);
  effects.startingSouls = Math.round(effects.startingSouls);
  return effects;
}

import type { ExponentialCostDefinition } from './upgrades';
import { calculateExponentialCost } from './upgrades';

export interface GeneratorDefinition extends ExponentialCostDefinition {
  id: string;
  name: string;
  /** One-line flavor text shown in the shop row; optional. */
  flavor?: string;
  productionPerSecond: number;
}

/**
 * Wealth-peek divisor: a generator row also becomes visible once the player's
 * soul balance reaches 1/REVEAL_FACTOR of its current cost, hinting at the
 * next tier before it is affordable.
 */
export const GENERATOR_REVEAL_FACTOR = 8;

/**
 * The SINGLE SOURCE OF TRUTH for generator visibility in the shop. A
 * generator is revealed when ANY of these hold (evaluated in definition
 * order):
 *   1. the player owns ≥ 1 of it,
 *   2. it is the first unowned generator (the "next tier" hint), or
 *   3. wealth peek: souls × REVEAL_FACTOR ≥ its current cost.
 *
 * Both ClickerView (rendering) and ClickerSystem (Dark Infrastructure's
 * unlock-grant watermark) consume this one function so gameplay and UI can
 * never disagree about what "naturally unlocked" means.
 *
 * Deliberately NOT sticky: a balance drop (Prestige) can un-reveal tiers.
 * Consumers that need permanence latch results themselves.
 */
export function revealedGeneratorIds(
  souls: number,
  owned: Record<string, number>,
): Set<string> {
  const firstUnownedId =
    GENERATORS.find((definition) => (owned[definition.id] ?? 0) === 0)?.id ?? null;

  const revealed = new Set<string>();
  for (const definition of GENERATORS) {
    const ownedCount = owned[definition.id] ?? 0;
    const isRevealed =
      ownedCount > 0 ||
      definition.id === firstUnownedId ||
      souls * GENERATOR_REVEAL_FACTOR >= calculateExponentialCost(definition, ownedCount);
    if (isRevealed) revealed.add(definition.id);
  }
  return revealed;
}

export const GENERATORS: readonly GeneratorDefinition[] = [
  {
    id: 'grave-keeper',
    name: 'Grave Keeper',
    flavor: 'He asks the dead to wait their turn. They never do.',
    baseCost: 25,
    growthRate: 1.15,
    productionPerSecond: 1,
  },
  {
    id: 'soul-collector',
    name: 'Soul Collector',
    flavor: 'Fills quotas nobody remembers setting.',
    baseCost: 250,
    growthRate: 1.15,
    productionPerSecond: 5,
  },
  {
    id: 'grim-reaper',
    name: 'Grim Reaper',
    flavor: 'The original freelancer. Non-negotiable rates.',
    baseCost: 2500,
    growthRate: 1.15,
    productionPerSecond: 25,
  },
  {
    id: 'soul-siphon',
    name: 'Soul Siphon',
    flavor: 'Drinks the essence straight from the source. No ice.',
    baseCost: 25000,
    growthRate: 1.15,
    productionPerSecond: 250,
  },
  {
    id: 'bone-choir',
    name: 'Bone Choir',
    flavor: 'They sing for the dead. The dead tip generously.',
    baseCost: 250000,
    growthRate: 1.15,
    productionPerSecond: 2500,
  },
  {
    id: 'wraith-foundry',
    name: 'Wraith Foundry',
    flavor: 'Industrial-grade haunting. The wraiths unionized last winter.',
    baseCost: 2500000,
    growthRate: 1.15,
    productionPerSecond: 25000,
  },
  {
    id: 'obsidian-altar',
    name: 'Obsidian Altar',
    flavor: 'Sacrifices accepted around the clock. Bring your own knife.',
    baseCost: 25000000,
    growthRate: 1.15,
    productionPerSecond: 250000,
  },
  {
    id: 'necropolis-heart',
    name: 'Necropolis Heart',
    flavor: 'A city-sized engine that beats once per harvest.',
    baseCost: 250000000,
    growthRate: 1.15,
    productionPerSecond: 2500000,
  },
  {
    id: 'soul-forge',
    name: 'Soul Forge',
    flavor: 'Where souls are smelted into something more useful than hope.',
    baseCost: 2500000000,
    growthRate: 1.15,
    productionPerSecond: 25000000,
  },
];

export interface ExponentialCostDefinition {
  baseCost: number;
  growthRate: number;
}

export interface UpgradeEffects {
  soulsPerClick?: number;
}

export interface UpgradeDefinition extends ExponentialCostDefinition {
  id: string;
  name: string;
  /** One-line flavor text shown in the shop row; optional. */
  flavor?: string;
  effects: UpgradeEffects;
  describe: (level: number) => string;
}

export const UPGRADES: readonly UpgradeDefinition[] = [
  {
    id: 'soul-harvesting',
    name: 'Soul Harvesting',
    flavor: 'You learned to scoop with both hands.',
    baseCost: 10,
    growthRate: 1.15,
    effects: { soulsPerClick: 1 },
    describe: (level) => (level > 0 ? `+${level} Soul${level === 1 ? '' : 's'} per click` : ''),
  },
  {
    id: 'soul-extraction',
    name: 'Soul Extraction',
    flavor: 'Now with 40% less screaming.',
    baseCost: 500,
    growthRate: 1.15,
    effects: { soulsPerClick: 10 },
    describe: (level) => (level > 0 ? `+${level * 10} Souls per click` : ''),
  },
  {
    id: 'soul-rend',
    name: 'Soul Rend',
    flavor: 'Tears the soul neatly along its seams.',
    baseCost: 50000,
    growthRate: 1.15,
    effects: { soulsPerClick: 100 },
    describe: (level) => (level > 0 ? `+${level * 100} Souls per click` : ''),
  },
  {
    id: 'spirit-crush',
    name: 'Spirit Crush',
    flavor: 'Subtlety died ages ago. So did everyone else.',
    baseCost: 5000000,
    growthRate: 1.15,
    effects: { soulsPerClick: 1000 },
    describe: (level) => (level > 0 ? `+${level * 1000} Souls per click` : ''),
  },
];

export function calculateExponentialCost(
  definition: ExponentialCostDefinition,
  count: number,
): number {
  return Math.round(definition.baseCost * definition.growthRate ** count);
}

/**
 * Data-driven Prestige Shop catalog.
 *
 * The shop itself only understands id/name/description/cost/limits and
 * optional requirements — everything else about an item lives in its
 * opaque `effect` descriptor. Known effect kinds are resolved by
 * computePrestigeEffects() (effects.ts); UNKNOWN kinds are legal data:
 * they let items reference systems that do not exist yet (unlocking new
 * mechanics, modifying Ages, future combat features) without breaking
 * the shop. Consumers simply ignore kinds they do not implement yet.
 *
 * Editing this catalog (add/remove/reorder/reprice) requires no changes
 * to the shop UI or the Prestige system.
 */

export interface PrestigeEffectDescriptor {
  /** Registry key consumed by effects.ts ('soul-generation-multiplier', ...). */
  kind: string;
  /** Numeric payload for multiplier/flat effects; ignored by exotic kinds. */
  value?: number;
  /**
   * Escape hatch for future non-numeric effects (unlock targets, Age ids,
   * arbitrary parameters). Never interpreted by the shop itself.
   */
  params?: Readonly<Record<string, unknown>>;
}

export type ShopRequirementKind = 'prestige-count' | 'item';

export interface ShopItemRequirement {
  kind: ShopRequirementKind | (string & {});
  /**
   * For 'prestige-count': minimum Prestiges performed.
   * For 'item': minimum owned copies. Defaults to 1.
   */
  amount?: number;
  /** Required item id when kind === 'item' (prerequisite chains). */
  itemId?: string;
}

export interface ShopItemDefinition {
  id: string;
  name: string;
  description: string;
  /** Cost in Prestige Points per purchase. */
  cost: number;
  /** Total allowed purchases; null = repeatable without limit. */
  maxPurchases: number | null;
  /** Permanent items are kept forever across resets (every current item). */
  permanent: boolean;
  /** Optional gate; the item stays locked until the requirement is met. */
  requires?: ShopItemRequirement;
  /** Opaque effect payload; interpreted by consumers, never by the shop. */
  effect: PrestigeEffectDescriptor;
}

/**
 * Initial placeholder catalog: ten one-time permanent boons, each priced
 * at exactly one Prestige Point. Items whose consumers are not wired yet
 * (army power, troop generation rate, loot yield) are still purchasable —
 * their descriptors ride along until a consumer implements them.
 */
export const SHOP_ITEMS: readonly ShopItemDefinition[] = [
  {
    id: 'endless-wellspring',
    name: 'Endless Well',
    description: '+25% passive Soul generation.',
    cost: 1,
    maxPurchases: 1,
    permanent: true,
    effect: { kind: 'soul-generation-multiplier', value: 1.25 },
  },
  {
    id: 'reaping-crescent',
    name: 'Reaping Crescent',
    description: 'Harvest clicks yield +50% Souls.',
    cost: 1,
    maxPurchases: 1,
    permanent: true,
    effect: { kind: 'soul-harvest-multiplier', value: 1.5 },
  },
  {
    id: 'grave-touch',
    name: 'Grave-Touch',
    description: 'Harvest clicks yield ×2 Souls.',
    cost: 1,
    maxPurchases: 1,
    permanent: true,
    effect: { kind: 'soul-harvest-multiplier', value: 2 },
  },
  {
    id: 'legion-drums',
    name: 'Legion Drums',
    description: '+25% troop generation from Crypt buildings.',
    cost: 1,
    maxPurchases: 1,
    permanent: true,
    // Consumer pending: no production system reads this multiplier yet.
    effect: { kind: 'troop-generation-multiplier', value: 1.25 },
  },
  {
    id: 'bone-market-pact',
    name: 'Bone Market Pact',
    description: 'Troop recruitment costs -10%.',
    cost: 1,
    maxPurchases: 1,
    permanent: true,
    effect: { kind: 'recruit-cost-multiplier', value: 0.9 },
  },
  {
    id: 'dark-infrastructure',
    name: 'Dark Infrastructure',
    description: 'The first purchase of each Soul Generator grants 1 free extra level.',
    cost: 2,
    maxPurchases: 1,
    permanent: true,
    effect: { kind: 'starting-generator-owned', value: 1 },
  },
  {
    id: 'crown-of-dread',
    name: 'Crown of Dread',
    description: '+15% Army Combat Power in battle.',
    cost: 1,
    maxPurchases: 1,
    permanent: true,
    // Consumer pending: deployed army power is not scaled yet.
    effect: { kind: 'army-combat-power-multiplier', value: 1.15 },
  },
  {
    id: 'deathlords-edge',
    name: "Deathlord's Edge",
    description: '+20% combat damage in every battle.',
    cost: 1,
    maxPurchases: 1,
    permanent: true,
    effect: { kind: 'attacker-damage-multiplier', value: 1.2 },
  },
  {
    id: 'buried-hoard',
    name: 'Buried Hoard',
    description: 'Begin every run with 5,000 bonus Souls.',
    cost: 1,
    maxPurchases: 1,
    permanent: true,
    effect: { kind: 'starting-souls', value: 5000 },
  },
  {
    id: 'tithe-of-flesh',
    name: 'Tithe of Flesh',
    description: '+25% loot resources from victories.',
    cost: 1,
    maxPurchases: 1,
    permanent: true,
    // Consumer pending: loot grants are not scaled yet.
    effect: { kind: 'passive-resource-multiplier', value: 1.25 },
  },
];

export function getShopItem(itemId: string): ShopItemDefinition | null {
  return SHOP_ITEMS.find((entry) => entry.id === itemId) ?? null;
}

export type ShopPurchaseFailureReason =
  | 'unknown-item'
  | 'insufficient-points'
  | 'limit-reached'
  | 'requirement-not-met';

export interface ShopPurchaseResult {
  ok: boolean;
  reason?: ShopPurchaseFailureReason;
}

/** Authoritative numbers a requirement may inspect at purchase time. */
export interface ShopRequirementContext {
  prestigeCount: number;
  /** Owned purchase count of any item id. */
  ownedOf: (itemId: string) => number;
}

function requirementAmount(requirement: ShopItemRequirement): number {
  const amount = requirement.amount;
  return typeof amount === 'number' && Number.isSafeInteger(amount) && amount > 0
    ? amount
    : 1;
}

/**
 * Requirement gates fail CLOSED: unknown requirement kinds count as unmet
 * so future gate types must be taught to the checker before items using
 * them go on sale.
 */
export function checkShopRequirement(
  requirement: ShopItemRequirement,
  context: ShopRequirementContext,
): boolean {
  const amount = requirementAmount(requirement);
  switch (requirement.kind) {
    case 'prestige-count':
      return context.prestigeCount >= amount;
    case 'item':
      return requirement.itemId !== undefined && context.ownedOf(requirement.itemId) >= amount;
    default:
      return false;
  }
}

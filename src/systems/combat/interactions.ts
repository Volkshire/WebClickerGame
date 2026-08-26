import type { UnitTag, UnitType } from './unitTypes';

/**
 * Central registry of type/tag combat interactions.
 *
 * A rule fires when an attacker group's `type` (or, once introduced, its
 * tags) matches the rule's attacker-side fields AND the defending army
 * contains raw power carrying the matching defender-side tag/type. The
 * modifier scales only the proportionally-matched share — never the whole
 * army (composition-aware, per spec).
 *
 * Extensibility: add rules here; for future mechanics extend the optional
 * fields (defenderType, attackerTag) and the matcher below. Resistances are
 * just modifiers < 1; immunities are 0. No engine changes required.
 */
export interface TypeTagRule {
  id: string;
  attackerType?: UnitType;
  defenderTag?: UnitTag;
  modifier: number;
}

export const TYPE_TAG_RULES: readonly TypeTagRule[] = [
  { id: 'weakness-flesh-vs-ranged', attackerType: 'ranged', defenderTag: 'flesh', modifier: 1.25 },
  { id: 'weakness-bone-vs-melee', attackerType: 'melee', defenderTag: 'bone', modifier: 1.25 },
  // Armored defenders resist by attack discipline: -50% from ranged fire,
  // -25% from melee blows, applied only to the armored share of the army.
  // Symmetric — enemy and player armored units benefit alike.
  { id: 'resist-armored-vs-ranged', attackerType: 'ranged', defenderTag: 'armored', modifier: 0.5 },
  { id: 'resist-armored-vs-melee', attackerType: 'melee', defenderTag: 'armored', modifier: 0.75 },
];

export interface PowerGroup {
  count: number;
  combatPower: number;
  type?: UnitType;
  tags?: readonly UnitTag[];
}

/**
 * Effective power of `attackerGroups` against `defenderGroups`:
 * each attacker group's raw power is scaled by
 *   1 + Σ (modifier − 1) × (defender raw-power share carrying the rule's tag)
 * so ×1.25 applies exactly to the relevant slice of the enemy army.
 */
export function computeEffectivePower(
  attackerGroups: readonly PowerGroup[],
  defenderGroups: readonly PowerGroup[],
): number {
  let defenderTotal = 0;
  const tagRaw = new Map<UnitTag, number>();
  for (const group of defenderGroups) {
    const raw = group.count * group.combatPower;
    if (raw <= 0) continue;
    defenderTotal += raw;
    for (const tag of group.tags ?? []) {
      tagRaw.set(tag, (tagRaw.get(tag) ?? 0) + raw);
    }
  }
  if (defenderTotal <= 0) return 0;

  let effective = 0;
  for (const group of attackerGroups) {
    const raw = group.count * group.combatPower;
    if (raw <= 0 || group.type === undefined) {
      effective += raw;
      continue;
    }

    let multiplier = 1;
    for (const rule of TYPE_TAG_RULES) {
      if (rule.attackerType !== group.type || rule.defenderTag === undefined) continue;
      const share = (tagRaw.get(rule.defenderTag) ?? 0) / defenderTotal;
      multiplier += (rule.modifier - 1) * share;
    }
    effective += raw * multiplier;
  }
  return effective;
}

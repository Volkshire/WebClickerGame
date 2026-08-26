import type { CombatAbilityDefinition } from './abilities';
import { ABILITY_TIERS } from './abilities';

/**
 * The first Commander Tactics, written as plain data on the shared ability
 * framework. Magnitudes are deliberately MODEST: each swing shifts a
 * battle's casualties by a noticeable but non-decisive margin (guarded by
 * tests), and long cooldowns keep activations occasional beats rather than
 * a constant hum.
 *
 * Internal tick counts (durations/cooldowns) never reach player-facing
 * text; the activation/effect lines below are the only strings shown.
 */

export const TACTIC_IDS = {
  pressTheAssault: 'press-the-assault',
  rally: 'rally',
  volleyFire: 'volley-fire',
} as const;

export const COMBAT_TACTICS: Readonly<Record<string, CombatAbilityDefinition>> = {
  [TACTIC_IDS.pressTheAssault]: {
    id: TACTIC_IDS.pressTheAssault,
    name: 'Press the Assault',
    description:
      'Smelling weakness across the line, the commander commits every reserve to a furious push.',
    trigger: { kind: 'strength-below', side: 'opposing', fraction: 0.6 },
    effect: { kind: 'side-power', side: 'defender', multiplier: 1.25 },
    durationTicks: 5,
    cooldownTicks: 12,
    activationLines: [
      '{commander} sees the enemy falter. He raises his blade.',
      '{commander} bellows the order — forward, everything, now!',
      'A sharp word from {commander}, and the defending line surges like a tide.',
      '{commander} hurls his reserves at the thinning ranks.',
    ],
    effectLines: ['Enemy damage increased.'],
  },
  [TACTIC_IDS.rally]: {
    id: TACTIC_IDS.rally,
    name: 'Rally',
    description:
      'As his own dead pile up, the commander plants the banner and welds the breaking line shut.',
    trigger: { kind: 'heavy-casualties', fraction: 0.35 },
    effect: { kind: 'side-power', side: 'attacker', multiplier: 0.85 },
    durationTicks: 6,
    cooldownTicks: 12,
    activationLines: [
      '{commander} rallies his wavering forces.',
      '{commander} plants the banner high, and the broken line closes again.',
      '{commander} rides the shrinking line, shouting his troops back into order.',
      'Behind {commander}, the defenders find their courage one more time.',
    ],
    effectLines: ['Enemy survivability increased.'],
  },
  [TACTIC_IDS.volleyFire]: {
    id: TACTIC_IDS.volleyFire,
    name: 'Volley Fire',
    description:
      'The commander coordinates every ranged unit into massed volleys — and the first one is devastating.',
    tier: ABILITY_TIERS.advanced,
    trigger: { kind: 'always' },
    // Only worth ordering when a real ranged line stands opposite.
    conditions: [{ kind: 'min-units', side: 'attacker', count: 1000, type: 'ranged' }],
    cooldownTicks: 14,
    durationTicks: 4,
    weight: 2,
    effects: [
      {
        kind: 'side-power',
        side: 'defender',
        multiplier: 1.3,
        selector: { type: 'ranged' },
      },
      {
        kind: 'casualties',
        side: 'attacker',
        percent: 0.5,
        filter: [{ type: 'ranged', noun: 'ranged units' }],
        reportTemplate: 'The first volley kills {count} ranged units.',
      },
    ],
    activationLines: [
      '{commander} signals the ranged ranks — bows up, loose on command!',
      '{commander} orders the volleys. Arrows darken the sky.',
      'At {commander}\u2019s word, every ranged unit fires as one.',
    ],
    effectLines: ['Ranged units strike harder.'],
  },
};

/** Convenience list for UI/iteration; registry above stays the source of truth. */
export const ALL_TACTICS: readonly CombatAbilityDefinition[] = Object.values(COMBAT_TACTICS);

/** Direct references for consumers/tests; registry above stays the source of truth. */
export const PRESS_THE_ASSAULT: CombatAbilityDefinition = COMBAT_TACTICS[TACTIC_IDS.pressTheAssault];
export const RALLY: CombatAbilityDefinition = COMBAT_TACTICS[TACTIC_IDS.rally];
export const VOLLEY_FIRE: CombatAbilityDefinition = COMBAT_TACTICS[TACTIC_IDS.volleyFire];

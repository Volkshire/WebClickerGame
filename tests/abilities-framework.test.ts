import { describe, expect, it } from 'vitest';
import { AbilityRuntime, evaluateTrigger } from '../src/systems/combat/abilities';
import type { AbilityTickContext } from '../src/systems/combat/abilities';
import type { CombatAbilityDefinition } from '../src/systems/combat/abilities';
import { COMBAT_TACTICS } from '../src/systems/combat/tactics';

/**
 * Focused tests for the generic combat ability foundation: trigger
 * predicates, duration expiry, cooldown gating, owner dedupe/death rules,
 * and the player-facing activation text contract.
 */

const CTX = (over: Partial<AbilityTickContext> = {}): AbilityTickContext => ({
  attackerSurviving: 100,
  attackerDeployed: 100,
  defenderSurviving: 100,
  defenderDeployed: 100,
  ...over,
});

function def(over: Partial<CombatAbilityDefinition> & { id: string }): CombatAbilityDefinition {
  return {
    name: over.id,
    description: '',
    trigger: { kind: 'battle-start' },
    cooldownTicks: 0,
    durationTicks: 1,
    effect: { kind: 'side-power', side: 'defender', multiplier: 1.5 },
    activationLines: ['{commander} acts.'],
    effectLines: ['Effect applied.'],
    ...over,
  };
}

/** Runtime wired to always pick the first flavor/effect line (rng -> 0). */
function makeRuntime(
  defs: CombatAbilityDefinition[],
  owners: { name: string; surviving: number; tactics?: readonly string[]; retreated?: boolean }[],
) {
  const registry = Object.fromEntries(defs.map((d) => [d.id, d]));
  const log: string[] = [];
  const runtime = new AbilityRuntime(owners, registry, () => 0, (m) => log.push(m));
  return { runtime, log };
}

describe('trigger predicates', () => {
  it('strength-below fires only under the fraction and only while alive', () => {
    const trigger = { kind: 'strength-below', side: 'own', fraction: 0.6 } as const;
    expect(evaluateTrigger(trigger, CTX({ defenderSurviving: 60 }), 'defender')).toBe(true);
    expect(evaluateTrigger(trigger, CTX({ defenderSurviving: 61 }), 'defender')).toBe(false);
    // Wiped sides never trigger anything.
    expect(evaluateTrigger(trigger, CTX({ defenderSurviving: 0 }), 'defender')).toBe(false);
  });

  it('strength-below resolves the opposing side for a defender owner', () => {
    const trigger = { kind: 'strength-below', side: 'opposing', fraction: 0.6 } as const;
    expect(evaluateTrigger(trigger, CTX({ attackerSurviving: 59 }), 'defender')).toBe(true);
    expect(evaluateTrigger(trigger, CTX({ attackerSurviving: 61 }), 'defender')).toBe(false);
  });

  it('heavy-casualties is inclusive of its loss threshold', () => {
    const trigger = { kind: 'heavy-casualties', fraction: 0.35 } as const;
    // 65 survivors of 100 = exactly 35% lost.
    expect(evaluateTrigger(trigger, CTX({ defenderSurviving: 65 }), 'defender')).toBe(true);
    expect(evaluateTrigger(trigger, CTX({ defenderSurviving: 66 }), 'defender')).toBe(false);
    expect(evaluateTrigger(trigger, CTX({ defenderSurviving: 0 }), 'defender')).toBe(false);
  });
});

describe('ability runtime mechanics', () => {
  it('battle-start activates on tick 0 only and expires after its duration', () => {
    const surge = def({
      id: 'surge',
      trigger: { kind: 'battle-start' },
      cooldownTicks: 3,
      durationTicks: 2,
      effect: { kind: 'side-power', side: 'defender', multiplier: 1.25 },
    });
    const { runtime, log } = makeRuntime([surge], [{ name: 'Test Commander', surviving: 1, tactics: ['surge'] }]);

    runtime.processTick(0, CTX());
    expect(log).toHaveLength(2);
    expect(runtime.sideMultiplier('defender', 0)).toBeCloseTo(1.25);
    expect(runtime.sideMultiplier('defender', 1)).toBeCloseTo(1.25);
    // Duration was 2 ticks: retired once read at tick >= 2.
    expect(runtime.sideMultiplier('defender', 2)).toBe(1);

    // Cooldown runs ticks 2-4; nothing re-fires (battle-start also can't).
    runtime.processTick(1, CTX());
    runtime.processTick(4, CTX());
    expect(log).toHaveLength(2);
  });

  it('cooldown gates reactivation until duration + cooldown have passed', () => {
    const again = def({
      id: 'again',
      trigger: { kind: 'strength-below', side: 'opposing', fraction: 0.9 },
      cooldownTicks: 2,
      durationTicks: 1,
    });
    const ctx = CTX({ attackerSurviving: 50 });
    const { runtime, log } = makeRuntime([again], [{ name: 'Test Commander', surviving: 1, tactics: ['again'] }]);

    runtime.processTick(0, ctx); // activation #1
    runtime.processTick(1, ctx); // still active
    runtime.processTick(2, ctx); // cooling down
    expect(log).toHaveLength(2);
    runtime.processTick(3, ctx); // available again -> activation #2
    const announcements = log.filter((l) => l.includes('USES'));
    expect(announcements).toHaveLength(2);
  });

  it('deduplicates one instance of a tactic across multiple owning stacks', () => {
    const shared = def({ id: 'shared', trigger: { kind: 'battle-start' }, durationTicks: 2, cooldownTicks: 10 });
    const owners = [
      { name: 'Commander A', surviving: 3, tactics: ['shared' as const] },
      { name: 'Commander B', surviving: 2, tactics: ['shared' as const] },
    ];
    const { runtime, log } = makeRuntime([shared], owners);
    runtime.processTick(0, CTX());
    expect(log.filter((l) => l.includes('USES'))).toHaveLength(1);
    // The effect applies exactly once, not stacked per owner.
    expect(runtime.sideMultiplier('defender', 0)).toBeCloseTo(shared.effect.multiplier);
  });

  it('never activates when every owner is dead or fled', () => {
    const dead = def({ id: 'dead-owner' });
    const fled = def({ id: 'fled-owner' });
    const { runtime, log } = makeRuntime(
      [dead, fled],
      [
        { name: 'Fallen Commander', surviving: 0, tactics: ['dead-owner'] },
        { name: 'Gone Commander', surviving: 2, retreated: true, tactics: ['fled-owner'] },
      ],
    );
    runtime.processTick(0, CTX());
    expect(log).toHaveLength(0);
    expect(runtime.sideMultiplier('attacker', 0)).toBe(1);
    expect(runtime.sideMultiplier('defender', 0)).toBe(1);
  });

  it('scales only the side the effect targets', () => {
    const atk = def({
      id: 'atk-only',
      trigger: { kind: 'battle-start' },
      effect: { kind: 'side-power', side: 'attacker', multiplier: 0.8 },
    });
    const { runtime } = makeRuntime([atk], [{ name: 'C', surviving: 1, tactics: ['atk-only'] }]);
    runtime.processTick(0, CTX());
    expect(runtime.sideMultiplier('attacker', 0)).toBeCloseTo(0.8);
    expect(runtime.sideMultiplier('defender', 0)).toBe(1);
  });

  it('activates at most ONE ability per tick; overlapping windows combine', () => {
    const mk = (id: string, mult: number) =>
      def({
        id,
        trigger: { kind: 'always' },
        effect: { kind: 'side-power', side: 'defender' as const, multiplier: mult },
        durationTicks: 3,
        cooldownTicks: 50,
      });
    const a = mk('a', 1.2);
    const b = mk('b', 1.5);
    const owners = [
      { name: 'C1', surviving: 1, tactics: ['a' as const] },
      { name: 'C2', surviving: 1, tactics: ['b' as const] },
    ];
    const { runtime } = makeRuntime([a, b], owners);
    runtime.processTick(0, CTX()); // only 'a' may fire this tick
    expect(runtime.sideMultiplier('defender', 0)).toBeCloseTo(1.2);
    runtime.processTick(1, CTX()); // 'b' follows on the next tick
    // Both passive windows are now live and combine multiplicatively.
    expect(runtime.sideMultiplier('defender', 1)).toBeCloseTo(1.2 * 1.5);
  });
});

describe('player-facing text contract', () => {
  it('announces commander, tactic name and natural effect — never timing terms', () => {
    const t = def({
      id: 'styled',
      name: 'Styled Move',
      trigger: { kind: 'battle-start' },
      activationLines: ['{commander} sees the moment.'],
      effectLines: ['Enemy damage increased.'],
    });
    const { runtime, log } = makeRuntime([t], [{ name: 'Aldric', surviving: 1, tactics: ['styled'] }]);
    runtime.processTick(0, CTX());

    expect(log[0]).toBe('Aldric sees the moment.');
    expect(log[1]).toBe('ALDRIC USES STYLED MOVE — Enemy damage increased.');
    for (const line of log) {
      expect(line).not.toMatch(/\b(tick|ticks|cooldown|duration)\b/i);
    }
  });

  it('shipped tactic definitions contain no internal timing vocabulary', () => {
    for (const t of Object.values(COMBAT_TACTICS)) {
      for (const text of [t.name, t.description, ...t.activationLines, ...t.effectLines]) {
        expect(text).not.toMatch(/\b(tick|ticks|cooldown|duration)\b/i);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Guardrails: battle-wide activation policy + per-definition repetition caps
// ---------------------------------------------------------------------------

import { ACTIVATION_POLICY_UNLIMITED, ABILITY_TIERS } from '../src/systems/combat/abilities';
import type {
  AbilityRuntimeOptions,
  AbilityTier,
  ActivationPolicy,
  EffectExecutor,
} from '../src/systems/combat/abilities';

interface LoggedLine {
  message: string;
  tier?: AbilityTier;
}

interface RuntimeBuildOptions {
  policy?: Partial<ActivationPolicy>;
  applyEffect?: EffectExecutor;
  countUnits?: (side: 'attacker' | 'defender', selector: object) => number;
  /** Repeating rng sequence for deterministic weighted picks. */
  rngSeqOverride?: number[];
}

function buildRuntime(
  defs: CombatAbilityDefinition[],
  owners: { name: string; surviving: number; tactics?: readonly string[] }[],
  opts: RuntimeBuildOptions = {},
) {
  const registry = Object.fromEntries(defs.map((d) => [d.id, d]));
  const lines: LoggedLine[] = [];
  let seqIndex = -1;
  const seq = opts.rngSeqOverride;
  const rng = seq ? () => seq[(++seqIndex) % seq.length]! : () => 0;
  const runtime = new AbilityRuntime(
    owners,
    registry,
    rng,
    (message, tier) => lines.push({ message, tier }),
    {
      ...(opts.applyEffect ? { applyEffect: opts.applyEffect } : {}),
      ...(opts.countUnits ? { countUnits: opts.countUnits as AbilityRuntimeOptions['countUnits'] } : {}),
      ...(opts.policy
        ? { policy: { ...ACTIVATION_POLICY_UNLIMITED, ...opts.policy } }
        : {}),
    },
  );
  return { runtime, lines };
}

describe('activation policy guardrails', () => {
  const alwaysSkill = (id: string) =>
    def({
      id,
      trigger: { kind: 'always' },
      cooldownTicks: 0,
      durationTicks: 1,
    });

  it('enforces the minimum gap between any two activations', () => {
    const { runtime, lines } = buildRuntime([alwaysSkill('a')], [{ name: 'C', surviving: 1, tactics: ['a'] }], {
      policy: { minGapTicks: 5 },
    });
    for (let tick = 0; tick < 12; tick++) runtime.processTick(tick, CTX());
    // Fires at t0 and t5 (and t10): never inside the 5-tick gap.
    expect(lines.filter((l) => l.message.includes('USES')).length).toBe(3);
  });

  it('stops after the per-battle budget regardless of eligibility', () => {
    const defs = ['a', 'b', 'c', 'd'].map(alwaysSkill);
    // Single owner with all 4 tactics: one entry per id, each sharing the
    // same per-entry budget — but since they are different entries, each can
    // fire independently. With maxPerBattle: 2 and 4 entries, total = 8.
    // Test with a single tactic id to verify per-entry budget works.
    const { runtime, lines } = buildRuntime([alwaysSkill('x')], [{ name: 'C', surviving: 1, tactics: ['x'] }], {
      policy: { maxPerBattle: 2 },
    });
    for (let tick = 0; tick < 10; tick++) runtime.processTick(tick, CTX());
    expect(lines.filter((l) => l.message.includes('USES')).length).toBe(2);
  });

  it('honors maxUsesPerBattle even with zero cooldown', () => {
    const limited = alwaysSkill('limited');
    const capped = { ...limited, maxUsesPerBattle: 2 };
    const { runtime, lines } = buildRuntime([capped], [{ name: 'C', surviving: 1, tactics: ['limited'] }]);
    for (let tick = 0; tick < 8; tick++) runtime.processTick(tick, CTX());
    expect(lines.filter((l) => l.message.includes('USES')).length).toBe(2);
  });

  it('risingEdgeOnly fires on condition crossings, not while it lingers', () => {
    const edge = def({
      id: 'edge',
      trigger: { kind: 'strength-below', side: 'own', fraction: 0.9 },
      risingEdgeOnly: true,
      cooldownTicks: 0,
      durationTicks: 1,
    });
    const { runtime, lines } = buildRuntime([edge], [{ name: 'C', surviving: 1, tactics: ['edge'] }]);
    const below = CTX({ defenderSurviving: 50 }); // condition true
    const above = CTX({ defenderSurviving: 95 }); // condition false

    runtime.processTick(0, below); // rise -> fires
    runtime.processTick(1, below); // still true -> no edge, no refire
    runtime.processTick(2, above); // falls
    expect(lines.filter((l) => l.message.includes('USES'))).toHaveLength(1);
    runtime.processTick(3, below); // rises again -> refires
    expect(lines.filter((l) => l.message.includes('USES'))).toHaveLength(2);
  });

  it('weighted selection follows configured weights deterministically', () => {
    const heavy = { ...alwaysSkill('heavy'), weight: 9 };
    const light = { ...alwaysSkill('light'), weight: 1 };
    const owners = [
      { name: 'H', surviving: 1, tactics: ['heavy'] },
      { name: 'L', surviving: 1, tactics: ['light'] },
    ];
    // roll = rng()*totalWeight; 0.04 -> heavy (0.4 < 9), then 0.99 -> light.
    const { runtime, lines } = buildRuntime([heavy, light], owners, {
      policy: { minGapTicks: 0 },
      rngSeqOverride: [0.04, 0.99],
    });
    runtime.processTick(0, CTX());
    expect(lines.some((l) => l.message.includes('USES HEAVY'))).toBe(true);
    expect(lines.some((l) => l.message.includes('USES LIGHT'))).toBe(false);
    runtime.processTick(1, CTX());
    expect(lines.some((l) => l.message.includes('USES LIGHT'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Conditions & chance curves (pure data-driven gating)
// ---------------------------------------------------------------------------

import { evaluateConditions, resolveScalingChance, computeCasualtyDistribution } from '../src/systems/combat/abilities';
import { NameDeck as NameDeckClass } from '../src/systems/combat/heroNames';
import { mulberry } from './helpers';

describe('composable conditions', () => {
  const countStub =
    (matches: number) =>
    () =>
      matches;

  it('requires min-units through a selector and fails closed without a resolver', () => {
    const cond = [{ kind: 'min-units' as const, side: 'attacker' as const, unitId: 'wraith', count: 50 }];
    expect(evaluateConditions(cond, CTX(), countStub(50))).toBe(true);
    expect(evaluateConditions(cond, CTX(), countStub(49))).toBe(false);
    expect(evaluateConditions(cond, CTX())).toBe(false);
  });

  it('AND-composes multiple conditions', () => {
    const conds = [
      { kind: 'min-units' as const, side: 'attacker' as const, unitId: 'wraith', count: 50 },
      { kind: 'age-in' as const, ageIds: ['age-of-ash'] },
    ];
    const ctx = { ...CTX(), ageId: 'age-of-ash', stage: 10, totalStages: 10 };
    expect(evaluateConditions(conds, ctx, countStub(100))).toBe(true);
    expect(evaluateConditions(conds, { ...ctx, ageId: 'age-of-ruin' }, countStub(100))).toBe(false);
    expect(evaluateConditions(conds, ctx, countStub(10))).toBe(false);
  });

  it('gates by last stage and explicit-side strength', () => {
    const stageLast = [{ kind: 'stage-last' as const }];
    expect(evaluateConditions(stageLast, { ...CTX(), stage: 10, totalStages: 10 })).toBe(true);
    expect(evaluateConditions(stageLast, { ...CTX(), stage: 9, totalStages: 10 })).toBe(false);
    expect(evaluateConditions(stageLast, CTX())).toBe(false);

    const strong = [{ kind: 'strength-above' as const, side: 'attacker' as const, fraction: 0.9 }];
    expect(evaluateConditions(strong, CTX({ attackerSurviving: 91 }))).toBe(true);
    expect(evaluateConditions(strong, CTX({ attackerSurviving: 89 }))).toBe(false);
  });

  it('resolves chance curves: base, interval steps, hard ceiling', () => {
    const cfg = {
      side: 'attacker' as const,
      baseChance: 0.02,
      thresholdUnits: 1_000_000,
      intervalUnits: 1_000_000,
      chancePerInterval: 0.03,
      maxChance: 0.35,
    };
    expect(resolveScalingChance(cfg, 0)).toBe(0);
    expect(resolveScalingChance(cfg, 500_000)).toBeCloseTo(0.02);
    expect(resolveScalingChance(cfg, 2_000_000)).toBeCloseTo(0.02 + 0.03);
    expect(resolveScalingChance(cfg, 2_999_999)).toBeCloseTo(0.02 + 0.03 * 1);
    expect(resolveScalingChance(cfg, 50_000_000)).toBeCloseTo(0.35);
  });
});

describe('casualty distribution safety', () => {
  it('rounds down and distributes exactly across stacks', () => {
    expect(computeCasualtyDistribution([10], 0.2)).toEqual([2]);
    expect(computeCasualtyDistribution([3], 0.5)).toEqual([1]);
    // total 10 × 50% = 5: quotas 1.5 / 1.5 / 2 -> largest remainders first.
    expect(computeCasualtyDistribution([3, 3, 4], 0.5)).toEqual([2, 1, 2]);
  });

  it('respects absolute caps', () => {
    expect(computeCasualtyDistribution([1000], 0.9, 500)).toEqual([500]);
    expect(computeCasualtyDistribution([600, 400], 0.6, 100)).toEqual([60, 40]);
  });

  it('never exceeds existing survivors and never goes negative', () => {
    const result = computeCasualtyDistribution([7], 1.5);
    expect(result).toEqual([7]);
    for (const n of result) expect(n).toBeGreaterThanOrEqual(0);
  });

  it('handles zero eligible stacks safely', () => {
    expect(computeCasualtyDistribution([], 0.5)).toEqual([]);
    expect(computeCasualtyDistribution([0, 0], 0.5)).toEqual([0, 0]);
    expect(computeCasualtyDistribution([5, 0], 0.2)).toEqual([1, 0]);
  });
});

// ---------------------------------------------------------------------------
// Tier presentation
// ---------------------------------------------------------------------------

describe('tier-driven presentation', () => {
  it('high-tier abilities get the dramatic three-line beat with tier styling', () => {
    const skill = def({
      id: 'devastator',
      name: 'Spirit Devastator',
      tier: ABILITY_TIERS.veryHigh,
      trigger: { kind: 'battle-start' },
      activationLines: ['The wraiths scream as the spirit devastator descends.'],
      effectLines: [],
      durationTicks: null,
      effect: { kind: 'casualties', side: 'attacker', percent: 0.2 },
    });
    const { runtime, lines } = buildRuntime([skill], [{ name: 'Aldric', surviving: 1, tactics: ['devastator'] }], {
      applyEffect: () => ({ applied: true, reportLine: '487,231 WRAITHS DESTROYED.' }),
    });
    runtime.processTick(0, CTX());

    expect(lines.map((l) => l.message)).toEqual([
      'THE WRAITHS SCREAM AS THE SPIRIT DEVASTATOR DESCENDS.',
      'SPIRIT DEVASTATOR',
      '487,231 WRAITHS DESTROYED.',
    ]);
    for (const line of lines) expect(line.tier).toBe(ABILITY_TIERS.veryHigh);
  });

  it('basic abilities keep the standard two-line format without tier class', () => {
    const tactic = def({
      id: 'plain',
      name: 'Plain Move',
      trigger: { kind: 'battle-start' },
      activationLines: ['{commander} acts.'],
      effectLines: ['Effect applied.'],
      durationTicks: 1,
    });
    const { runtime, lines } = buildRuntime([tactic], [{ name: 'Aldric', surviving: 1, tactics: ['plain'] }]);
    runtime.processTick(0, CTX());

    expect(lines.map((l) => l.message)).toEqual(['Aldric acts.', 'ALDRIC USES PLAIN MOVE — Effect applied.']);
    expect(lines.every((l) => l.tier === undefined || l.tier === ABILITY_TIERS.basic)).toBe(true);
  });

  it('refused instant effects suppress the activation entirely', () => {
    const skill = def({
      id: 'no-op',
      tier: ABILITY_TIERS.high,
      trigger: { kind: 'always' },
      effect: { kind: 'casualties', side: 'attacker', percent: 0.2 },
      activationLines: ['boom'],
      effectLines: [],
      durationTicks: null,
    });
    const { runtime, lines } = buildRuntime([skill], [{ name: 'H', surviving: 1, tactics: ['no-op'] }], {
      applyEffect: () => ({ applied: false }),
    });
    runtime.processTick(0, CTX());
    runtime.processTick(1, CTX());
    expect(lines).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Scoped power pieces & multi-effect activations
// ---------------------------------------------------------------------------

describe('scoped power pieces', () => {
  it('groupPower multiplies only matching groups and expires on time', () => {
    const buffed = def({
      id: 'buff',
      trigger: { kind: 'battle-start' },
      effect: {
        kind: 'side-power',
        side: 'defender',
        multiplier: 1.3,
        selector: { type: 'ranged' },
      },
      durationTicks: 2,
      cooldownTicks: 10,
    });
    const { runtime } = makeRuntime([buffed], [{ name: 'C', surviving: 1, tactics: ['buff'] }]);
    runtime.processTick(0, CTX());
    expect(runtime.groupPower('defender', { type: 'ranged' }, 0)).toBeCloseTo(1.3);
    expect(runtime.groupPower('defender', { type: 'melee' }, 0)).toBe(1);
    expect(runtime.groupPower('attacker', { type: 'ranged' }, 0)).toBe(1);
    // Duration was 2 ticks: retired at reads >= tick 2.
    expect(runtime.groupPower('defender', { type: 'ranged' }, 2)).toBe(1);
  });

  it('unscoped pieces keep whole-side behavior through groupPower', () => {
    const plain = def({
      id: 'plain',
      trigger: { kind: 'battle-start' },
      effect: { kind: 'side-power', side: 'defender', multiplier: 1.25 },
      durationTicks: 2,
      cooldownTicks: 10,
    });
    const { runtime } = makeRuntime([plain], [{ name: 'C', surviving: 1, tactics: ['plain'] }]);
    runtime.processTick(0, CTX());
    expect(runtime.groupPower('defender', { type: 'ranged' }, 0)).toBeCloseTo(1.25);
    expect(runtime.groupPower('defender', { type: 'melee' }, 0)).toBeCloseTo(1.25);
    expect(runtime.sideMultiplier('defender', 0)).toBeCloseTo(1.25);
  });
});

describe('multi-effect activations', () => {
  const combo = () =>
    def({
      id: 'combo',
      trigger: { kind: 'always' },
      durationTicks: 4,
      cooldownTicks: 20,
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
          reportTemplate: 'Killed {count}.',
        },
      ],
      activationLines: ['{commander} strikes.'],
      effectLines: ['Boost applied.'],
    });

  it('executes passive and instant pieces in ONE atomic activation', () => {
    const { runtime, lines } = buildRuntime(
      [combo()],
      [{ name: 'C', surviving: 1, tactics: ['combo'] }],
      { applyEffect: () => ({ applied: true, reportLine: 'Killed 5.' }) },
    );
    runtime.processTick(0, CTX());
    expect(runtime.activationCount).toBe(1);
    expect(runtime.groupPower('defender', { type: 'ranged' }, 0)).toBeCloseTo(1.3);
    expect(lines.filter((l) => l.message.includes('USES'))).toHaveLength(1);
    expect(lines.some((l) => l.message === 'Killed 5.')).toBe(true);
  });

  it('suppresses everything when any instant piece refuses', () => {
    const { runtime, lines } = buildRuntime(
      [combo()],
      [{ name: 'C', surviving: 1, tactics: ['combo'] }],
      { applyEffect: () => ({ applied: false }) },
    );
    runtime.processTick(0, CTX());
    expect(runtime.activationCount).toBe(0);
    expect(runtime.groupPower('defender', { type: 'ranged' }, 0)).toBe(1);
    expect(lines).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Name deck (shuffle-bag)
// ---------------------------------------------------------------------------

describe('hero name deck', () => {
  const POOL = ['Aldric', 'Brigid', 'Cedric', 'Dierna', 'Eamon'];
  const excluded = (...names: string[]) => new Set(names.map((n) => n.toLowerCase()));
  const make = (initialOrder?: { custom: readonly string[]; generated: readonly string[] }) =>
    new NameDeckClass([], POOL, initialOrder);

  it('deals every name exactly once before reshuffling', () => {
    const deck = make();
    const rng = mulberry(7);
    const drawn: (string | undefined)[] = [];
    for (let i = 0; i < POOL.length; i++) drawn.push(deck.draw(excluded(), rng));
    expect(drawn.filter((n): n is string => n !== undefined).sort()).toEqual([...POOL]);
    // Cycle depleted -> reshuffle deals again.
    const next = deck.draw(excluded(), rng);
    expect(next).toBeDefined();
    expect(POOL).toContain(next);
  });

  it('skips excluded names without blocking the bag', () => {
    const deck = make();
    const rng = mulberry(1);
    const skip = excluded('aldric', 'brigid', 'cedric', 'dierna');
    expect(deck.draw(skip, rng)).toBe('Eamon');
    // Everything excluded -> undefined instead of an infinite loop.
    expect(deck.draw(excluded(...POOL), rng)).toBeUndefined();
  });

  it('restores a serialized remaining order verbatim', () => {
    const rngA = mulberry(3);
    const rngB = mulberry(3);
    const first = make();
    for (let i = 0; i < 2; i++) first.draw(excluded(), rngA);
    const serialized = first.serialize();
    const restored = make(serialized);

    // Same rng sequence -> identical continuation.
    const a = [first.draw(excluded(), rngA), first.draw(excluded(), rngA)];
    const b = [restored.draw(excluded(), rngB), restored.draw(excluded(), rngB)];
    expect(b).toEqual(a);
  });

  it('rejects corrupt restore orders and reshuffles fresh', () => {
    const deck = make({ custom: [], generated: ['Aldric', 'Ghost'] }); // wrong size/name
    const rng = mulberry(4);
    const drawn: (string | undefined)[] = [];
    for (let i = 0; i < POOL.length; i++) drawn.push(deck.draw(excluded(), rng));
    expect(drawn.filter((n): n is string => n !== undefined).sort()).toEqual([...POOL]);
  });
});

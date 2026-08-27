import { pickLine } from './battleFlavor';
import type { UnitTag, UnitType } from './unitTypes';

/**
 * Generic combat ability foundation, shared by Commander Tactics today and
 * Hero Skills later.
 *
 * An ability is pure data: a trigger condition, optional composable
 * conditions, an availability cooldown, an optional duration, an effect the
 * engine interprets, and the player-facing prose for its activation.
 * Nothing here reads or mutates combat state directly — the simulation
 * feeds the runtime a per-tick context snapshot plus two small resolvers
 * (unit counting, effect execution) and receives active power modifiers
 * back through `sideMultiplier`. No combat formula lives in this file.
 *
 * Durations and cooldowns are counted internally in combat ticks; that unit
 * never reaches player-facing text (see emitActivation below).
 */

// ---------------------------------------------------------------------------
// Tiers — metadata only. Higher tiers are rarer and more impactful; the tier
// drives presentation (dramatic multi-line log beats) and gives future
// balancing a stable key. Rename labels here; nothing else changes.
// ---------------------------------------------------------------------------

export const ABILITY_TIERS = {
  basic: 'basic',
  advanced: 'advanced',
  high: 'high',
  veryHigh: 'very-high',
} as const;

export type AbilityTier = (typeof ABILITY_TIERS)[keyof typeof ABILITY_TIERS];

export interface AbilityTierMeta {
  /** Display label ("Very High"). */
  readonly label: string;
  /** True = activation gets the dramatic multi-line presentation. */
  readonly dramatic: boolean;
  /** CSS class appended to battle-log entries for this tier. */
  readonly cssClass: string;
}

export const ABILITY_TIER_META: Readonly<Record<AbilityTier, AbilityTierMeta>> = {
  [ABILITY_TIERS.basic]: { label: 'Basic', dramatic: false, cssClass: 'is-tier-basic' },
  [ABILITY_TIERS.advanced]: { label: 'Advanced', dramatic: false, cssClass: 'is-tier-advanced' },
  [ABILITY_TIERS.high]: { label: 'High', dramatic: true, cssClass: 'is-tier-high' },
  [ABILITY_TIERS.veryHigh]: { label: 'Very High', dramatic: true, cssClass: 'is-tier-very-high' },
};

/** Metadata for an event's tier, defaulting to Basic when unspecified. */
export function tierMeta(tier?: AbilityTier): AbilityTierMeta {
  return ABILITY_TIER_META[tier ?? ABILITY_TIERS.basic];
}

// ---------------------------------------------------------------------------
// Triggers — WHEN an eligible ability wants to fire. Deliberately small;
// richer gating belongs to the composable conditions below.
// ---------------------------------------------------------------------------

/** Whose strength a trigger watches, relative to the ability's owner. */
export type AbilityWatchSide = 'own' | 'opposing';

export type AbilityTrigger =
  | { readonly kind: 'battle-start' }
  /**
   * One side's surviving headcount falls below `fraction` of what it
   * deployed (and that side still has someone standing).
   */
  | { readonly kind: 'strength-below'; side: AbilityWatchSide; fraction: number }
  | { readonly kind: 'heavy-casualties'; fraction: number }
  /**
   * Every tick, while conditions/chance/policy allow it. Chance-driven
   * skills use this so their probability curve is the real gate.
   */
  | { readonly kind: 'always' };

// ---------------------------------------------------------------------------
// Conditions — composable AND-list on top of triggers. All listed conditions
// must hold before the trigger is even considered. Explicit sides (never
// owner-relative) keep them readable as data.
// ---------------------------------------------------------------------------

export type ConditionSide = 'attacker' | 'defender';

/** Data-driven unit matcher applied to a stack's identity fields. */
export interface UnitSelector {
  /** Exact player/enemy unit id (e.g. 'wraith'). */
  unitId?: string;
  type?: UnitType;
  /** Group carries this tag. */
  tag?: UnitTag;
  /** Group does NOT carry this tag (armored exclusions). */
  excludeTag?: UnitTag;
  /** Display noun used in casualty reports ("Wraiths", "units"). */
  noun?: string;
  /** Maximum combat power; used by abilities like Rapid Fire to target low-CP units. */
  maxCombatPower?: number;
  /** Minimum combat power, for high-value target effects such as Railgun. */
  minCombatPower?: number;
}

/** Minimal stack identity the matcher and group-power folding need. */
export interface UnitSelectorTarget {
  readonly unitId?: string;
  readonly type?: UnitType;
  readonly tags?: readonly UnitTag[];
  readonly combatPower?: number;
}

/** True when `target` satisfies every provided selector field (AND). */
export function selectorMatches(selector: Partial<UnitSelector>, target: UnitSelectorTarget): boolean {
  if (selector.unitId !== undefined && target.unitId !== selector.unitId) return false;
  if (selector.type !== undefined && target.type !== selector.type) return false;
  const tags = target.tags ?? [];
  if (selector.tag !== undefined && !tags.includes(selector.tag)) return false;
  if (selector.excludeTag !== undefined && tags.includes(selector.excludeTag)) return false;
  if (selector.maxCombatPower !== undefined && (target.combatPower ?? Infinity) > selector.maxCombatPower) return false;
  if (selector.minCombatPower !== undefined && (target.combatPower ?? -Infinity) < selector.minCombatPower) return false;
  return true;
}

export type AbilityCondition =
  | ({ readonly kind: 'min-units'; readonly side: ConditionSide; readonly count: number } &
      Partial<UnitSelector>)
  | { readonly kind: 'age-in'; readonly ageIds: readonly string[] }
  | { readonly kind: 'stage-last' }
  | { readonly kind: 'strength-below'; readonly side: ConditionSide; readonly fraction: number }
  | { readonly kind: 'strength-above'; readonly side: ConditionSide; readonly fraction: number }
  | { readonly kind: 'fallen-heroes-exist' };

/** Per-tick snapshot of both sides, taken by the engine after attrition. */
export interface AbilityTickContext {
  attackerSurviving: number;
  attackerDeployed: number;
  defenderSurviving: number;
  defenderDeployed: number;
  /** Campaign context for age/stage conditions; undefined outside battles. */
  ageId?: string;
  /** 1-based target position inside its Age. */
  stage?: number;
  totalStages?: number;
  /** Number of dead (fallen) heroes that could be revived. */
  fallenHeroCount?: number;
}

/** Counts living units on one side matching a selector (engine-supplied). */
export type UnitCountResolver = (
  side: ConditionSide,
  selector: Partial<UnitSelector>,
) => number;

/**
 * Pure condition predicate. ALL conditions in the list must pass. When no
 * `countUnits` resolver is supplied, min-units conditions fail closed
 * (safe: gated abilities simply stay dormant).
 */
export function evaluateConditions(
  conditions: readonly AbilityCondition[] | undefined,
  ctx: AbilityTickContext,
  countUnits?: UnitCountResolver,
): boolean {
  if (conditions === undefined || conditions.length === 0) return true;
  return conditions.every((condition) => {
    switch (condition.kind) {
      case 'min-units': {
        if (countUnits === undefined) return false;
        const { kind: _kind, side, count, ...selector } = condition;
        return countUnits(side, selector) >= Math.max(1, count);
      }
      case 'age-in':
        return ctx.ageId !== undefined && condition.ageIds.includes(ctx.ageId);
      case 'stage-last':
        return (
          ctx.stage !== undefined &&
          ctx.totalStages !== undefined &&
          ctx.stage === ctx.totalStages
        );
      case 'strength-below':
      case 'strength-above': {
        const surviving =
          condition.side === 'attacker' ? ctx.attackerSurviving : ctx.defenderSurviving;
        const deployed =
          condition.side === 'attacker' ? ctx.attackerDeployed : ctx.defenderDeployed;
        if (!(deployed > 0)) return false;
        const fraction = surviving / deployed;
        return condition.kind === 'strength-below'
          ? surviving > 0 && fraction <= condition.fraction
          : fraction >= condition.fraction;
      }
      case 'fallen-heroes-exist':
        return (ctx.fallenHeroCount ?? 0) > 0;
    }
  });
}

// ---------------------------------------------------------------------------
// Effects — what an activation DOES. Interpreted by the engine; unknown kinds
// are impossible to silently ignore thanks to exhaustive switches upstream.
// ---------------------------------------------------------------------------

export type CombatEffect =
  | {
      readonly kind: 'side-power';
      readonly side: 'attacker' | 'defender';
      readonly multiplier: number;
      /**
       * Optional scope: only stacks matching this selector get the
       * multiplier ("ranged only"). Omitted = the whole side.
       */
      readonly selector?: Partial<UnitSelector>;
    }
  /**
   * Kills a share of the TARGET side's current survivors matching `filter`.
   * `mode` percent (default): floor(eligible × percent). `mode` flat:
   * uniform-integer roll across `range`, clamped to eligibility and `cap`.
   */
  | {
      readonly kind: 'casualties';
      readonly side: ConditionSide;
      readonly mode?: 'percent' | 'flat';
      readonly percent?: number;
      readonly range?: { readonly min: number; readonly max: number };
      readonly cap?: number;
      /** Random variance applied to cap per activation (±fraction). e.g. 0.08 → cap varies ±8%. */
      readonly capVariance?: number;
      /**
       * Attacker-army-size cap tiers, judged against the DEPLOYED count at
       * battle start (immune to mid-battle plague merges). First satisfied
       * threshold wins; order the list descending. When no threshold is met
       * (or this is omitted) the flat `cap` applies.
       */
      readonly scalingCap?: readonly {
        readonly minUnits: number;
        readonly cap: number;
      }[];
      /** Selector list; AND-composed unless filterMode is 'any'. */
      readonly filter?: readonly Partial<UnitSelector>[];
      readonly filterMode?: 'all' | 'any';
      /**
       * Player-facing report with a {count} token
       * ("The first volley kills {count} ranged units."). Falls back to the
       * generic "<noun> DESTROYED." line when omitted.
       */
      readonly reportTemplate?: string;
    }
  | {
      readonly kind: 'hero-revive';
    }
  | {
      readonly kind: 'hero-protect';
    };

/** All effect pieces an activation executes (single `effect` = one entry). */
export function effectsOf(def: CombatAbilityDefinition): readonly CombatEffect[] {
  if (def.effects !== undefined) return def.effects;
  return def.effect !== undefined ? [def.effect] : [];
}

/**
 * Pure casualty math shared by tests and the engine interpreter:
 * distributes floor(total × percent), clamped to `cap`, across stacks by
 * largest-remainder so rounding never loses or invents bodies. Guarantees:
 * sum(result) ≤ cap, each result ≥ 0 and ≤ that stack's survivors, and zero
 * eligible stacks yield an empty/zero result.
 */
export function computeCasualtyDistribution(
  survivors: readonly number[],
  percent: number,
  cap?: number,
): number[] {
  if (!Number.isFinite(percent) || percent <= 0) return survivors.map(() => 0);
  const total = survivors.reduce((sum, n) => sum + Math.max(0, n), 0);
  if (!(total > 0)) return survivors.map(() => 0);

  let killed = Math.floor(total * Math.min(1, percent));
  if (cap !== undefined) killed = Math.min(killed, Math.max(0, Math.floor(cap)));
  if (killed <= 0) return survivors.map(() => 0);

  const quotas = survivors.map((n) => (n > 0 ? (killed * n) / total : 0));
  const result = quotas.map((quota, i) =>
    Math.min(survivors[i]!, Math.floor(quota)),
  );
  // Largest-remainder pass hands leftover bodies to the biggest fractional
  // parts with remaining capacity, keeping the total exact.
  let assigned = result.reduce((sum, n) => sum + n, 0);
  const order = quotas
    .map((quota, i) => ({ i, frac: quota - Math.floor(quota) }))
    .sort((a, b) => b.frac - a.frac);
  while (assigned < killed) {
    let progressed = false;
    for (const { i } of order) {
      if (assigned >= killed) break;
      if (result[i]! < survivors[i]!) {
        result[i] = result[i]! + 1;
        assigned += 1;
        progressed = true;
      }
    }
    if (!progressed) break; // capacity exhausted (cannot happen with percent ≤ 1)
  }
  return result;
}

/** Result of an engine-executed effect; reportLine feeds the log beat. */
export interface AbilityEffectResult {
  /** False = nothing happened; the activation is suppressed silently. */
  readonly applied: boolean;
  /** Player-facing exact-count line ("The first volley kills 812 ranged units."). */
  readonly reportLine?: string;
}

/** Engine callback executing one effect at activation time. */
export type EffectExecutor = (
  effect: CombatEffect,
  owner: AbilityOwnerGroup,
  rng: () => number,
) => AbilityEffectResult;

// ---------------------------------------------------------------------------
// Configurable chance scaling — probability curves live in data, not code.
// ---------------------------------------------------------------------------

export interface ScalingChanceConfig extends Partial<UnitSelector> {
  readonly side: ConditionSide;
  /** Chance once the minimum conditions already passed. */
  readonly baseChance: number;
  /** Count where interval scaling begins (below it: just baseChance). */
  readonly thresholdUnits: number;
  /** Interval size for scaling steps. */
  readonly intervalUnits: number;
  /** Chance added per full interval beyond the threshold. */
  readonly chancePerInterval: number;
  /** Hard ceiling on the resulting chance. */
  readonly maxChance: number;
}

/** Resolves a configured curve to a concrete 0..1 chance for `count`. */
export function resolveScalingChance(config: ScalingChanceConfig, count: number): number {
  if (!Number.isFinite(count) || count <= 0) return 0;
  const intervals = Math.floor(
    Math.max(0, count - config.thresholdUnits) / Math.max(1, config.intervalUnits),
  );
  const chance = config.baseChance + intervals * config.chancePerInterval;
  return Math.min(Math.max(0, config.maxChance), Math.max(0, chance));
}

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

/** Definition of one reusable combat ability (tactic/skill). */
export interface CombatAbilityDefinition {
  /** Stable registry key referenced by unit definitions. */
  readonly id: string;
  /** Display name, e.g. "Press the Assault". */
  readonly name: string;
  /** Design/flavor description (UI lists, tooltips). */
  readonly description: string;
  /** Rarity/power band; drives dramatic presentation for high tiers. */
  readonly tier?: AbilityTier;
  readonly trigger: AbilityTrigger;
  /**
   * Composable requirements that must ALL hold before the trigger applies.
   */
  readonly conditions?: readonly AbilityCondition[];
  /**
     * Configurable probability curve rolled once per sweep tick after all
     * deterministic gates pass. A failed roll consumes nothing (no cooldown,
     * no budget).
     */
  readonly scalingChance?: ScalingChanceConfig;
  /**
   * INTERNAL availability gate in combat ticks after an activation ends.
   * Never rendered anywhere player-facing.
   */
  readonly cooldownTicks: number;
  /**
   * INTERNAL effect length in combat ticks; null = until battle end.
   * Instant effects ignore this entirely.
   * Never rendered anywhere player-facing.
   */
  readonly durationTicks: number | null;
  /** Hard limit on activations per battle (default unlimited). */
  readonly maxUsesPerBattle?: number;
  /**
   * Once-per-battle lock: unavailable immediately after its single use,
   * regardless of any cooldown. Resets naturally with each new battle.
   */
  readonly oncePerBattle?: boolean;
  /**
   * Fire only on the tick the trigger FIRST holds (rising edge) instead of
   * continuously while it stays true. Anti-repetition tool.
   */
  readonly risingEdgeOnly?: boolean;
  /** Selection bias among simultaneous candidates (default 1). */
  readonly weight?: number;
  /**
   * Primary effect. Sugar for a single-entry `effects` list; one of the two
   * must be provided.
   */
  readonly effect?: CombatEffect;
  /**
   * Full effect list executed atomically per activation: every instant piece
   * must succeed or the whole activation is suppressed; passive pieces share
   * the definition's duration window.
   */
  readonly effects?: readonly CombatEffect[];
  /** Activation flavor pool; supports the {commander} token. */
  readonly activationLines: readonly string[];
  /**
   * Natural-language statement of the mechanical effect for standard-tier
   * presentations. Written as complete sentences with no timing vocabulary.
   */
  readonly effectLines: readonly string[];
}

// ---------------------------------------------------------------------------
// Activation policy — battle-wide anti-spam guardrails.
// ---------------------------------------------------------------------------

export interface ActivationPolicy {
  /** Minimum ticks between ANY two activations in the battle. */
  readonly minGapTicks: number;
  /** Maximum total activations per battle, all abilities combined. */
  readonly maxPerBattle: number;
}

/** Real-battle density limits; keeps even huge skill pools presentational. */
export const ACTIVATION_POLICY_DEFAULTS: ActivationPolicy = {
  minGapTicks: 4,
  maxPerBattle: 4,
};

/** No limits — used directly-constructed runtimes and precision unit tests. */
export const ACTIVATION_POLICY_UNLIMITED: ActivationPolicy = {
  minGapTicks: 0,
  maxPerBattle: Number.POSITIVE_INFINITY,
};

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

/** Minimal shape the runtime needs from an owning stack (SimGroup fits). */
export interface AbilityOwnerGroup {
  readonly name: string;
  /** Current living headcount; mutated by the engine between ticks. */
  surviving: number;
  /** Fleeing stacks no longer command anything. */
  retreated?: boolean;
  /** Registry ids of abilities this stack carries. */
  readonly tactics?: readonly string[];
}

interface RuntimeEntry {
  readonly def: CombatAbilityDefinition;
  /** Ticks until which the passive effect stays applied (exclusive); null = idle. */
  activeUntilTick: number | null;
  /** Tick at which the ability becomes available again (inclusive). */
  availableFromTick: number;
  usesThisBattle: number;
  /** Trigger state last sweep, for risingEdgeOnly comparisons. */
  wasTrue: boolean;
  /** The owning group name this entry belongs to. */
  readonly ownerName: string;
  /** Last tick this entry was activated (per-owner gap tracking). */
  lastActivationTick: number | null;
}

/** Structured activation handed to the presentation sink. */
export interface AbilityActivation {
  readonly def: CombatAbilityDefinition;
  readonly ownerName: string;
  /** Exact-count line from the effect executor, if it produced one. */
  readonly reportLine?: string;
}

export interface AbilityRuntimeOptions {
  /** Battle-wide anti-spam policy (defaults to unlimited for bare runtimes). */
  readonly policy?: ActivationPolicy;
  /** Executes effects at activation time (required for non-passive kinds). */
  readonly applyEffect?: EffectExecutor;
  /** Counts living units for selectors (min-units/scaling-chance filters). */
  readonly countUnits?: UnitCountResolver;
}

/**
 * Per-battle ability runner. Owns activation/duration/cooldown bookkeeping,
 * anti-spam policy enforcement and candidate selection; produces log lines
 * through the injected sink. The engine consults `sideMultiplier` when
 * computing effective powers.
 */
export class AbilityRuntime {
  private readonly entries = new Map<string, RuntimeEntry>();
  private readonly ownerGroups: readonly AbilityOwnerGroup[];
  private readonly rng: () => number;
  private readonly log: (message: string, tier?: AbilityTier) => void;
  private readonly policy: ActivationPolicy;
  private readonly options: AbilityRuntimeOptions;

  constructor(
    ownerGroups: readonly AbilityOwnerGroup[],
    registry: Readonly<Record<string, CombatAbilityDefinition>>,
    rng: () => number,
    log: (message: string, tier?: AbilityTier) => void,
    options: AbilityRuntimeOptions = {},
  ) {
    this.ownerGroups = ownerGroups;
    this.rng = rng;
    this.log = log;
    this.policy = options.policy ?? ACTIVATION_POLICY_UNLIMITED;
    this.options = options;
    for (const group of ownerGroups) {
      for (const id of group.tactics ?? []) {
        const def = registry[id];
        if (def !== undefined) {
          const key = `${group.name}|${id}`;
          if (!this.entries.has(key)) {
            this.entries.set(key, {
              def,
              activeUntilTick: null,
              availableFromTick: 0,
              usesThisBattle: 0,
              wasTrue: false,
              ownerName: group.name,
              lastActivationTick: null,
            });
          }
        }
      }
    }
  }

  /**
   * Combined active multiplier for one battle side this instant (1 when
   * nothing is active). Legacy scalar view: only UNSCOPED power pieces
   * count. The engine folds scoped pieces per group via `groupPower`.
   * Also retires passive effects whose duration has elapsed.
   */
  sideMultiplier(side: AbilityOwnerSide, tick: number): number {
    let multiplier = 1;
    for (const entry of this.entries.values()) {
      if (entry.activeUntilTick === null) continue;
      if (tick >= entry.activeUntilTick) {
        entry.activeUntilTick = null; // natural expiry
        continue;
      }
      for (const effect of effectsOf(entry.def)) {
        if (
          effect.kind === 'side-power' &&
          effect.side === side &&
          effect.selector === undefined
        ) {
          multiplier *= effect.multiplier;
        }
      }
    }
    return multiplier;
  }

  /**
   * Per-group passive power multiplier: the product of every active power
   * piece on `side` whose selector (if any) matches the stack's identity.
   * Unscoped pieces apply to every group, making them exactly equivalent to
   * the legacy whole-side scalar.
   */
  groupPower(
    side: AbilityOwnerSide,
    target: UnitSelectorTarget,
    tick: number,
  ): number {
    let multiplier = 1;
    for (const entry of this.entries.values()) {
      if (entry.activeUntilTick === null) continue;
      if (tick >= entry.activeUntilTick) {
        entry.activeUntilTick = null; // natural expiry
        continue;
      }
      for (const effect of effectsOf(entry.def)) {
        if (effect.kind !== 'side-power' || effect.side !== side) continue;
        if (effect.selector !== undefined && !selectorMatches(effect.selector, target)) {
          continue;
        }
        multiplier *= effect.multiplier;
      }
    }
    return multiplier;
  }

  /** Total activations so far this battle (sum across all entries). */
  get activationCount(): number {
    let total = 0;
    for (const entry of this.entries.values()) {
      total += entry.usesThisBattle;
    }
    return total;
  }

  /**
   * One eligibility sweep + at most ONE activation. Call once per combat
   * tick AFTER attrition so triggers judge current headcounts.
   */
  processTick(tick: number, ctx: AbilityTickContext): void {
    // Retire elapsed passive windows first so cooldown math stays honest.
    for (const entry of this.entries.values()) {
      if (entry.activeUntilTick !== null && tick >= entry.activeUntilTick) {
        entry.activeUntilTick = null;
      }
    }

    // 1. Build candidates — trigger/edge/condition evaluation happens EVERY
    //    tick (even while gap-gated) so edge state never goes stale.
    const candidates: { entry: RuntimeEntry; owner: AbilityOwnerGroup }[] = [];
    for (const entry of this.entries.values()) {
      const def = entry.def;

      if (this.useLimitReached(def, entry.usesThisBattle)) {
        entry.wasTrue = false;
        continue;
      }
      if (entry.activeUntilTick !== null) continue; // busy (no edge update needed)
      if (tick < entry.availableFromTick) continue; // cooling down

      const holds = def.trigger.kind !== 'battle-start'
        ? evaluateTrigger(def.trigger, ctx)
        : tick === 0;
      const edgeOk = !def.risingEdgeOnly || (holds && !entry.wasTrue);
      entry.wasTrue = holds;
      if (!holds || !edgeOk) continue;

      if (!evaluateConditions(def.conditions, ctx, this.options.countUnits)) continue;

      // Probabilistic gate: rolled only after every deterministic check; a
      // miss consumes nothing.
      if (def.scalingChance !== undefined && this.options.countUnits !== undefined) {
        const { side, ...selectorOnly } = def.scalingChance;
        const count = this.options.countUnits(side, selectorOnly);
        const chance = resolveScalingChance(def.scalingChance, count);
        if (chance <= 0 || this.rng() >= chance) continue;
      }

      const owner = this.ownerGroups.find(
        (g) => g.name === entry.ownerName && g.surviving > 0 && g.retreated !== true,
      );
      if (owner === undefined) continue;

      // Per-entry gap check: each entry (hero/commander) has its own last-activation tick.
      if (
        entry.lastActivationTick !== null &&
        tick - entry.lastActivationTick < this.policy.minGapTicks
      ) {
        continue;
      }

      // Per-entry budget: maxPerBattle applies to each individual entry.
      if (entry.usesThisBattle >= this.policy.maxPerBattle) continue;

      candidates.push({ entry, owner });
    }

    // 2. At least one candidate required.
    if (candidates.length === 0) return;

    // 3. Weighted selection: exactly one activation per tick.
    const chosen = this.pickWeighted(candidates);
    if (chosen === null) return;

    this.activate(chosen.entry, chosen.owner, tick);
  }

  private pickWeighted(
    candidates: { entry: RuntimeEntry; owner: AbilityOwnerGroup }[],
  ): { entry: RuntimeEntry; owner: AbilityOwnerGroup } | null {
    if (candidates.length === 1) return candidates[0]!;
    const weights = candidates.map(({ entry }) => Math.max(0, entry.def.weight ?? 1));
    const total = weights.reduce((sum, w) => sum + w, 0);
    if (!(total > 0)) return null;
    let roll = this.rng() * total;
    for (let i = 0; i < candidates.length; i++) {
      roll -= weights[i]!;
      if (roll <= 0) return candidates[i]!;
    }
    return candidates[candidates.length - 1]!;
  }

  private activate(entry: RuntimeEntry, owner: AbilityOwnerGroup, tick: number): void {
    const def = entry.def;
    const pieces = effectsOf(def);
    const hasPassive = pieces.some((piece) => piece.kind === 'side-power');

    // Execute every instant piece FIRST; a single refusal suppresses the
    // whole activation atomically — no cooldown, budget or use consumed.
    const reportLines: string[] = [];
    if (this.options.applyEffect !== undefined) {
      for (const piece of pieces) {
        if (piece.kind === 'side-power') continue; // passive, applied via groupPower
        const result = this.options.applyEffect(piece, owner, this.rng);
        if (!result.applied) return;
        if (result.reportLine !== undefined) reportLines.push(result.reportLine);
      }
    } else if (pieces.some((piece) => piece.kind !== 'side-power')) {
      return; // cannot execute instant pieces → dormant
    }

    entry.usesThisBattle += 1;
    entry.lastActivationTick = tick;

    if (def.oncePerBattle || entry.usesThisBattle >= (def.maxUsesPerBattle ?? Infinity)) {
      entry.availableFromTick = Number.POSITIVE_INFINITY; // locked out
    } else if (hasPassive && def.durationTicks !== null) {
      entry.activeUntilTick =
        def.durationTicks === null ? Number.POSITIVE_INFINITY : tick + def.durationTicks;
      entry.availableFromTick = tick + def.durationTicks + def.cooldownTicks;
    } else {
      // Pure instant activation: no passive window; cooldown still runs.
      entry.availableFromTick = tick + def.cooldownTicks;
    }

    this.emitActivation(def, owner.name, reportLines);
  }

  private useLimitReached(def: CombatAbilityDefinition, uses: number): boolean {
    if (def.oncePerBattle) return uses >= 1;
    const limit = def.maxUsesPerBattle;
    return limit !== undefined && uses >= limit;
  }

  /**
   * Player-facing activation text, shaped purely by TIER:
   * - basic/advanced: flavor line + "NAME USES …" announcement.
   * - high/very-high: dramatic three-line beat (flavor scream, name banner,
   *   exact-count report) rendered in the tier's distinct style.
   * Deliberately free of internal timing vocabulary.
   */
  private emitActivation(
    def: CombatAbilityDefinition,
    commanderName: string,
    reportLines: readonly string[] = [],
  ): void {
    const meta = tierMeta(def.tier);
    const flavor = pickLine(def.activationLines, this.rng)
      .split('{commander}')
      .join(commanderName);

    if (meta.dramatic) {
      this.log(flavor.toUpperCase(), def.tier);
      this.log(def.name.toUpperCase(), def.tier);
      if (reportLines.length > 0) {
        for (const line of reportLines) this.log(line.toUpperCase(), def.tier);
      } else {
        this.log(pickLine(def.effectLines, this.rng).toUpperCase(), def.tier);
      }
      return;
    }

    this.log(flavor, def.tier);
    const effectLine = pickLine(def.effectLines, this.rng);
    this.log(
      `${commanderName.toUpperCase()} USES ${def.name.toUpperCase()} — ${effectLine}`,
      def.tier,
    );
    // Exact-count reports follow the announcement in natural phrasing.
    for (const line of reportLines) this.log(line, def.tier);
  }
}

/** Pure trigger predicate over headcounts (owner-relative vocabulary). */
export function evaluateTrigger(
  trigger: AbilityTrigger,
  ctx: AbilityTickContext,
  ownerSide: AbilityOwnerSide = 'defender',
): boolean {
  const ownSurviving = ownerSide === 'attacker' ? ctx.attackerSurviving : ctx.defenderSurviving;
  const ownDeployed = ownerSide === 'attacker' ? ctx.attackerDeployed : ctx.defenderDeployed;
  const foeSurviving = ownerSide === 'attacker' ? ctx.defenderSurviving : ctx.attackerSurviving;
  const foeDeployed = ownerSide === 'attacker' ? ctx.defenderDeployed : ctx.attackerDeployed;

  switch (trigger.kind) {
    case 'battle-start':
    case 'always':
      return true;
    case 'strength-below': {
      const surviving = trigger.side === 'own' ? ownSurviving : foeSurviving;
      const deployed = trigger.side === 'own' ? ownDeployed : foeDeployed;
      return surviving > 0 && surviving <= deployed * trigger.fraction;
    }
    case 'heavy-casualties':
      return ownSurviving > 0 && ownDeployed > 0 && ownSurviving <= ownDeployed * (1 - trigger.fraction);
  }
}

/** Battle side owning an ability ('defender' for enemy commanders/heroes today). */
export type AbilityOwnerSide = 'attacker' | 'defender';

import {
  casualtyFraction,
  heroDamageTakenFraction,
  heroIncomingFraction,
  heroSwarmMass,
  heroVictimDamageMultiplier,
} from './formulas';
import { computeEffectivePower } from './interactions';
import type { PowerGroup } from './interactions';
import type { HeroClass } from './heroClasses';
import type { BattlePacing } from './pacing';
import {
  HERO_COMBAT_TUNING,
  HERO_RESOLVE_BASE,
  RETREAT_CHANCE_PER_TICK,
  RETREAT_MOMENTUM_BONUS,
  RETREAT_RANGED_BONUS,
  RETREAT_THRESHOLD,
  SUPPORT_REVIVAL_BASE_CHANCE,
  SUPPORT_REVIVAL_MAX_PER_TICK,
  TANK_DEATH_BURST_FRACTION,
  ZOMBIE_PLAGUE_ENEMY_SHARE_CAP,
  ZOMBIE_PLAGUE_RAISE_EVERY,
} from './pacing';
import { ABILITY_KINDS } from './enemyUnits';
import type { EnemyUnitAbility } from './enemyUnits';
import { AbilityRuntime, computeCasualtyDistribution, selectorMatches } from './abilities';
import { ACTIVATION_POLICY_DEFAULTS } from './abilities';
import type {
  AbilityEffectResult,
  AbilityTickContext,
  AbilityTier,
  ActivationPolicy,
  CombatAbilityDefinition,
  CombatEffect,
  ConditionSide,
  UnitSelector,
} from './abilities';
import { COMBAT_TACTICS } from './tactics';
import { HERO_SKILLS } from './heroSkills';
import { formatExact } from './battleFlavor';

/** Shipped ability registry: Commander Tactics + Hero Skills. */
const ALL_ABILITIES: Readonly<Record<string, CombatAbilityDefinition>> = {
  ...COMBAT_TACTICS,
  ...HERO_SKILLS,
};
import {
  DEFENSE_COLLAPSING_LINES,
  FIRST_BLOOD_LINES,
  formatFlavor,
  HERO_ARRIVAL_LINES,
  HERO_ARRIVAL_OVERFLOW_LINES,
  HERO_BLOODED_LINES,
  HERO_ESCALATION_LINES,
  HERO_LAST_STAND_LINES,
  HERO_REINFORCEMENT_LINES,
  HERO_RETREAT_LINES,
  HERO_SLAIN_LINES,
  LEGION_WAVERING_LINES,
  MOMENTUM_LINES,
  NEMESIS_RETURN_LINES,
  pickLine,
  RANK_LOSS_LINES,
  RANK_WIPE_LINES,
  RESISTANCE_WEAKENED_LINES,
  RETURN_DEFENDER_LINES,
  TANK_DEATH_BURST_LINES,
  TERRAIN_OPENINGS,
  ZOMBIE_PLAGUE_CAP_LINES,
  ZOMBIE_PLAGUE_LINES,
  ZOMBIE_PLAGUE_RAISE_LINES,
} from './battleFlavor';
import { getTerrainModifiers } from './terrain';
import type { TerrainType } from './terrain';
import type { UnitTag, UnitType } from './unitTypes';
import type {
  BattleEventView,
  BattleForceView,
  BattleOutcomeType,
  Momentum,
} from './types';

/** Individual Hero arrivals pinned by name before the aggregate line kicks in. */
const MAX_NAMED_ARRIVALS = 3;

/** The Necromancy Plague converts kills on this attacker unit id only. */
const ZOMBIE_UNIT_ID = 'zombie';

/**
 * External multiplicative modifiers injected at construction time.
 * Terrain stays internal; anything run-external (Prestige, future meta
 * bonuses) arrives here so combat math never reads other systems.
 */
export interface BattleSimulationOptions {
  /** Attacker-side effective power multiplier (1 when no bonus applies). */
  externalAttackerModifier?: number;
  /** Randomness source for hero retreat rolls (defaults to Math.random). */
  rng?: () => number;
  /**
   * Last Stand reinforcement: called AT MOST ONCE when only Heroes remain on
   * the defense and the (pacing-configured) chance roll succeeds. Builds the
   * arriving Hero stack — identity/scaling stay the caller's concern so the
   * simulation never reads name pools or target economics.
   */
  reinforcement?: { buildHero: () => BattleGroupInput };
  /**
   * Final-stand rule: when true (an Age's last target), Heroes never roll to
   * flee mid-battle — there is nowhere left to run and no later Age to
   * retreat into.
   */
  noRetreat?: boolean;
  /**
   * Ability registry for stacks carrying `tactics` ids (Commander Tactics
   * and Hero Skills). Defaults to the shipped registry; injectable so tests
   * and future consumers can bring their own definitions.
   */
  abilityRegistry?: Readonly<Record<string, CombatAbilityDefinition>>;
  /**
   * Battle-wide anti-spam policy for ability activations. Defaults to the
   * shipped limits (minimum gap + per-battle budget).
   */
  activationPolicy?: ActivationPolicy;
  /**
   * Zombie Plague (Necromancy research): zombie kill-credit converts into
   * fresh attacker-side Zombies mid-battle, capped at a fraction of the
   * enemy garrison. Purely deterministic — no extra RNG is consumed.
   */
  zombiePlague?: boolean;
}

/** Side-agnostic battle input for one unit stack. */
export interface BattleGroupInput {
  unitId: string;
  name: string;
  count: number;
  combatPowerEach: number;
  type?: UnitType;
  tags?: readonly UnitTag[];
  isHero?: boolean;
  /** True for fled veterans returning through the grudge system. */
  isReturningNemesis?: boolean;
  /**
   * True for Heroes that survived a previous failed assault on this same
   * target — they hold the field again and arrive on the defender beat.
   */
  isReturningDefender?: boolean;
  ability?: EnemyUnitAbility;
  /**
   * Combat-ability ids (tactics/skills) this stack carries into battle,
   * resolved against the simulation's ability registry.
   */
  tactics?: readonly string[];
  /**
   * Hero effective-HP pool. Defaults to HERO_RESOLVE_BASE when omitted so
   * every Hero gets guaranteed stage time; regular units never set it.
   */
  resolve?: number;
  /** Hidden hero class; only set for enemy hero stacks. */
  heroClass?: HeroClass;
}

export interface BattleTargetMeta {
  id: string;
  name: string;
  terrain: TerrainType;
  /**
   * Campaign context for ability conditions (age/stage gating); optional so
   * synthetic battles in tests can omit it.
   */
  ageId?: string;
  /** 1-based target position inside its Age. */
  order?: number;
  totalTargets?: number;
}

interface SimGroup {
  unitId: string;
  name: string;
  combatPowerEach: number;
  deployed: number;
  surviving: number;
  /** Fractional loss buffer so tiny rates still make progress. */
  carry: number;
  /** Hero-only remaining effective HP; regular stacks ignore it. */
  resolve: number;
  /** Resolve at full; the wounded (escalation) threshold keys off half of it. */
  maxResolve: number;
  lossEventEmitted: boolean;
  wipeEventEmitted: boolean;
  type?: UnitType;
  tags?: readonly UnitTag[];
  isHero: boolean;
  isReturningNemesis: boolean;
  readonly isReturningDefender: boolean;
  ability: EnemyUnitAbility | null;
  readonly tactics: readonly string[];
  heroThreatAnnounced: boolean;
  heroThreatEscalated: boolean;
  heroBloodiedAnnounced: boolean;
  retreated: boolean;
  diedThisTick: boolean;
  readonly heroClass: HeroClass | null;
}

function toSimGroup(input: BattleGroupInput): SimGroup {
  const maxResolve = input.isHero === true ? Math.max(0, input.resolve ?? HERO_RESOLVE_BASE) : 0;
  return {
    unitId: input.unitId,
    name: input.name,
    combatPowerEach: input.combatPowerEach,
    deployed: input.count,
    surviving: input.count,
    carry: 0,
    resolve: maxResolve,
    maxResolve,
    lossEventEmitted: false,
    wipeEventEmitted: false,
    type: input.type,
    tags: input.tags,
    isHero: input.isHero === true,
    isReturningNemesis: input.isReturningNemesis === true,
    isReturningDefender: input.isReturningDefender === true,
    ability: input.ability ?? null,
    tactics: input.tactics ?? [],
    heroThreatAnnounced: false,
    heroThreatEscalated: false,
    heroBloodiedAnnounced: false,
    retreated: false,
    diedThisTick: false,
    heroClass: input.heroClass ?? null,
  };
}

export interface BattleSnapshot {
  targetId: string;
  targetName: string;
  /** Current effective power for each side. */
  attackerPower: number;
  defenderPower: number;
  /** Effective power at first contact; the UI scales power bars against these. */
  initialAttackerPower: number;
  initialDefenderPower: number;
  attackerForces: BattleForceView[];
  defenderForces: BattleForceView[];
  attackerCasualties: number;
  defenderCasualties: number;
  momentum: Momentum;
  elapsedSeconds: number;
  heroCount: number;
  complete: boolean;
  outcome: BattleOutcomeType | null;
  events: BattleEventView[];
}

/**
 * Live battle engine: pure state + math, no EventBus/SaveManager/DOM.
 *
 * Both sides are real armies of typed/tagged unit stacks. Per tick:
 *   1. Effective powers: raw CP → terrain → type/tag interactions
 *      (plus the injected external attacker multiplier).
 *   2. Attrition: each side loses a fraction of current strength scaled by
 *      the opposing effective power. The OUTGUNNED side's loss rate is
 *      clamped (keeps hopeless battles watchable); the dominant side is
 *      uncapped (overkills finish promptly). Every living stack loses at
 *      least 1 per tick, so stragglers never stall the endgame — except
 *      Heroes, who bleed a resolve pool with a per-tick ceiling instead,
 *      guaranteeing their story arc real stage time before they can die.
 *   3. Heroic Threat: each living enemy Hero strips an extra percentage of
 *      the player's remaining troops, split proportionally.
 *   4. Last Stand: once ONLY Heroes remain on the defense, their combined
 *      threat is multiplied (pacing config) and one reinforcement Hero may
 *      join them mid-battle via the injected provider.
 *
 * The side whose strength reaches zero loses; ties favor the attacker.
 */
export class BattleSimulation {
  private readonly pacing: BattlePacing;
  private readonly rng: () => number;
  private readonly terrainModifiers: { attacker: number; defender: number };
  private readonly externalAttackerModifier: number;
  private readonly reinforcementProvider: BattleSimulationOptions['reinforcement'];
  private readonly noRetreat: boolean;
  private readonly attackerGroups: SimGroup[];
  private readonly defenderGroups: SimGroup[];
  private readonly fledHeroNames: string[] = [];

  /**
   * What landed the killing blow when the ATTACKER was wiped out: the
   * standing Heroes (heroic threat) or the garrison itself (attrition).
   * First writer wins; reset implicitly per battle instance.
   */
  private fatalBlow: { type: 'heroes'; names: string[] } | { type: 'garrison' } | null = null;

  private readonly initialAttackerPower: number;
  private readonly initialDefenderPower: number;
  /** Player units deployed at first contact — drives ability scalingCap tiers. */
  private readonly initialAttackerDeployed: number;
  private momentum: Momentum = 'even';

  /** Names of heroes that fled mid-battle, for the nemesis system. */
  getFledHeroNames(): string[] {
    return this.fledHeroNames;
  }

  private elapsedSeconds = 0;
  private clockSeconds = 0;
  /** Combat ticks processed so far; drives ability durations/cooldowns. */
  private tickCount = 0;
  private eventCounter = 0;
  /** Opening beats (battle start / Hero arrivals), ordered first in snapshots. */
  private readonly pinnedEvents: BattleEventView[] = [];
  private readonly events: BattleEventView[] = [];
  private resistanceWeakened = false;
  private defenseCollapsing = false;
  private legionWavering = false;
  private firstBloodEmitted = false;
  private lastStandEmitted = false;
  /** True from the tick "only Heroes remain" first holds until battle end. */
  private lastStandActive = false;
  private heroProtectActive = false;
  /**
   * Snapshot of livingHeroes() taken at the start of each defender attrition
   * pass. Prevents a death cascade where heroes dying mid-loop amplifies
   * the drain on remaining heroes (heroDamageTakenFraction increases as
   * livingHeroes drops), which would otherwise cause all heroes to die in
   * the same tick regardless of resolve differences.
   */
  private livingHeroesSnapshot = 0;
  private readonly revivedHeroNames = new Set<string>();
  /**
   * Commander Tactics (and future Hero Skills) runner. Inert unless some
   * stack on the field carries tactic ids — battles without abilities pay
   * nothing and behave exactly as before.
   */
  private readonly abilities: AbilityRuntime;

  complete = false;
  outcome: BattleOutcomeType | null = null;

  // --- Zombie Plague state (inert unless the option is set) ---
  private readonly zombiePlagueActive: boolean;
  /** Spawns still allowed this battle: 25% of the enemy garrison at start. */
  private plagueSpawnBudget = 0;
  /** Fractional zombie kill-credit awaiting conversion into a spawn. */
  private plagueKillCredit = 0;
  private plagueAnnounced = false;
  /** Spawn ticks since the initial rising (drives replenishment beats). */
  private plagueRaiseEvents = 0;
  /** The conversion cap beat fires exactly once, when the budget empties. */
  private plagueCapAnnounced = false;

  constructor(
    private readonly target: BattleTargetMeta,
    attackerArmy: readonly BattleGroupInput[],
    defenderArmy: readonly BattleGroupInput[],
    pacing: BattlePacing,
    options: BattleSimulationOptions = {},
  ) {
    this.pacing = pacing;
    this.rng = options.rng ?? Math.random;
    this.reinforcementProvider = options.reinforcement;
    this.noRetreat = options.noRetreat === true;
    this.terrainModifiers = getTerrainModifiers(target.terrain);
    const requestedModifier = options.externalAttackerModifier ?? 1;
    this.externalAttackerModifier =
      Number.isFinite(requestedModifier) && requestedModifier > 0 ? requestedModifier : 1;

    this.attackerGroups = attackerArmy.map(toSimGroup);
    this.defenderGroups = defenderArmy.map(toSimGroup);

    // Battle-start deployment snapshot: Zombie Plague merges spawns into
    // `deployed` mid-battle, so scalingCap tiers must read THIS, not the
    // live field. Captured before any tick can mutate anything.
    this.initialAttackerDeployed = this.attackerGroups.reduce(
      (sum, group) => sum + group.deployed,
      0,
    );

    this.zombiePlagueActive = options.zombiePlague === true;
    if (this.zombiePlagueActive) {
      const enemyUnits = this.totalDeployed(this.defenderGroups);
      this.plagueSpawnBudget = Math.floor(enemyUnits * ZOMBIE_PLAGUE_ENEMY_SHARE_CAP);
    }

    // Ability activations speak through the shared battle log ('tactic'
    // beats, tier-styled); instant effects execute against the live groups
    // through the interpreter below. The runner never touches combat math.
    this.abilities = new AbilityRuntime(
      [...this.attackerGroups, ...this.defenderGroups],
      options.abilityRegistry ?? ALL_ABILITIES,
      this.rng,
      (message, tier) => this.pushEvent('tactic', message, false, tier),
      {
        policy: options.activationPolicy ?? ACTIVATION_POLICY_DEFAULTS,
        applyEffect: (effect, owner, rng) => this.executeAbilityEffect(effect, owner, rng),
        countUnits: (side, selector) => this.countUnitsFor(side, selector),
      },
    );

    const initial = this.computePowers();
    this.initialAttackerPower = initial.attacker;
    this.initialDefenderPower = initial.defender;
    this.momentum = this.momentumFrom(initial.attacker, initial.defender);

    this.pushEvent(
      'start',
      formatFlavor(pickLine(TERRAIN_OPENINGS[target.terrain], this.rng), { target: target.name }),
      true,
    );
    // Hero arrivals render in gold ('hero' kind) and are pinned; beyond
    // MAX_NAMED_ARRIVALS they collapse into one aggregate line so a final
    // target crowded with grudges cannot flood the log.
    const heroArrivals = this.defenderGroups.filter((g) => g.isHero && g.surviving > 0);
    for (const heroGroup of heroArrivals.slice(0, MAX_NAMED_ARRIVALS)) {
      const template = heroGroup.isReturningDefender
        ? pickLine(RETURN_DEFENDER_LINES, this.rng)
        : heroGroup.isReturningNemesis
          ? pickLine(NEMESIS_RETURN_LINES, this.rng)
          : pickLine(HERO_ARRIVAL_LINES, this.rng);
      this.pushEvent('hero', formatFlavor(template, { hero: heroGroup.name }), true);
    }
    if (heroArrivals.length > MAX_NAMED_ARRIVALS) {
      this.pushEvent(
        'hero',
        formatFlavor(pickLine(HERO_ARRIVAL_OVERFLOW_LINES, this.rng), {
          count: String(heroArrivals.length - MAX_NAMED_ARRIVALS),
        }),
        true,
      );
    }
  }

  get targetName(): string {
    return this.target.name;
  }

  get targetId(): string {
    return this.target.id;
  }

  /**
   * Feed elapsed time into the engine. Returns true when at least one
   * combat tick was processed (i.e. observable state changed).
   */
  advance(deltaSeconds: number): boolean {
    if (this.complete || deltaSeconds <= 0) return false;

    let ticked = false;
    this.clockSeconds += deltaSeconds;
    const interval = this.pacing.tickIntervalMs / 1000;
    while (!this.complete && this.clockSeconds >= interval) {
      this.clockSeconds -= interval;
      this.processTick();
      ticked = true;
    }
    return ticked;
  }

  /** Resolves the whole battle synchronously (used when restoring a save). */
  runToCompletion(maxTicks = 100000): void {
    let guard = 0;
    while (!this.complete && guard < maxTicks) {
      this.processTick();
      guard += 1;
    }
  }

  snapshot(): BattleSnapshot {
    const powers = this.computePowers();
    return {
      targetId: this.target.id,
      targetName: this.target.name,
      attackerPower: powers.attacker,
      defenderPower: powers.defender,
      initialAttackerPower: this.initialAttackerPower,
      initialDefenderPower: this.initialDefenderPower,
      attackerForces: this.groupsToForces(this.attackerGroups),
      defenderForces: this.groupsToForces(this.defenderGroups),
      attackerCasualties: this.totalDeployed(this.attackerGroups) - this.totalSurviving(this.attackerGroups),
      defenderCasualties: this.totalDeployed(this.defenderGroups) - this.totalSurviving(this.defenderGroups),
      momentum: this.momentum,
      elapsedSeconds: this.elapsedSeconds,
      heroCount: this.livingHeroes(),
      complete: this.complete,
      outcome: this.outcome,
      events: [...this.pinnedEvents, ...this.events],
    };
  }

  /** Player survivors in DeployedGroup form (victory returns them home). */
  survivingArmy(): BattleGroupInput[] {
    return this.attackerGroups
      .filter((group) => group.surviving > 0 && !group.retreated)
      .map((group) => ({
        unitId: group.unitId,
        name: group.name,
        count: group.surviving,
        combatPowerEach: group.combatPowerEach,
        type: group.type,
        tags: group.tags,
      }));
  }

  /** Player losses in DeployedGroup form. */
  casualtyArmy(): BattleGroupInput[] {
    return this.attackerGroups
      .filter(
        (group) =>
          group.deployed - group.surviving > 0 && !group.retreated,
      )
      .map((group) => ({
        unitId: group.unitId,
        name: group.name,
        count: group.deployed - group.surviving,
        combatPowerEach: group.combatPowerEach,
        type: group.type,
        tags: group.tags,
      }));
  }

  /**
   * Every Hero that took part (one entry per individual Hero, expanded from
   * stacks) — CombatSystem rolls each one's fate separately.
   */
  heroRoster(): { name: string; heroClass: HeroClass | null }[] {
    const roster: { name: string; heroClass: HeroClass | null }[] = [];
    for (const group of this.defenderGroups) {
      if (!group.isHero || group.deployed <= 0) continue;
      for (let index = 0; index < group.deployed; index += 1) {
        roster.push({
          name: group.deployed > 1 ? `${group.name} ${index === 0 ? 'I' : 'II'}` : group.name,
          heroClass: group.heroClass,
        });
      }
    }
    return roster;
  }

  /**
   * Names of Heroes physically holding the field right now (alive, not
   * fled). On DEFEAT these are the defenders that broke the assault and
   * should hold this target again next time.
   */
  standingDefenderHeroNames(): string[] {
    return this.defenderGroups
      .filter((group) => group.isHero && group.surviving > 0 && !group.retreated)
      .map((group) => group.name);
  }

  /**
   * Why the player's legion was wiped — Heroes (with their names) or the
   * garrison itself. Null while any attacker still stands.
   */
  getWipeAttribution(): { type: 'heroes' | 'garrison'; names?: string[] } | null {
    return this.fatalBlow;
  }

  private groupsToForces(groups: readonly SimGroup[]): BattleForceView[] {
    return groups
      .filter((group) => !group.retreated)
      .map((group) => ({
        unitId: group.unitId,
        name: group.name,
        deployed: group.deployed,
        surviving: group.surviving,
        casualties: group.deployed - group.surviving,
      }));
  }

  private computePowers(): { attacker: number; defender: number } {
    return {
      attacker:
        computeEffectivePower(
          this.asPowerGroups('attacker', this.attackerGroups),
          this.asPowerGroups('defender', this.defenderGroups),
        ) *
        this.terrainModifiers.attacker *
        this.externalAttackerModifier,
      defender:
        computeEffectivePower(
          this.asPowerGroups('defender', this.defenderGroups),
          this.asPowerGroups('attacker', this.attackerGroups),
        ) * this.terrainModifiers.defender,
    };
  }

  /**
   * Adapts live stacks to the pure interaction calculator's input shape.
   * Active ability power pieces are folded into each stack's CP here —
   * unscoped pieces multiply every group (exactly the old whole-side scalar,
   * by linearity), scoped ones touch only matching stacks ("ranged only").
   */
  private asPowerGroups(side: ConditionSide, groups: readonly SimGroup[]): PowerGroup[] {
    return groups.map((group) => ({
      count: group.retreated ? 0 : group.surviving,
      combatPower:
        group.combatPowerEach *
        this.abilities.groupPower(
          side,
          { unitId: group.unitId, type: group.type, tags: group.tags },
          this.tickCount,
        ),
      type: group.type,
      tags: group.tags,
    }));
  }

  private momentumFrom(attackerPower: number, defenderPower: number): Momentum {
    const total = attackerPower + defenderPower;
    if (total <= 0) return 'even';
    const share = attackerPower / total;
    if (share >= 0.6) return 'attacker';
    if (share <= 0.4) return 'defender';
    return 'even';
  }

  private processTick(): void {
    if (this.complete) return;

    this.heroProtectActive = false;
    for (const g of [...this.defenderGroups, ...this.attackerGroups]) {
      g.diedThisTick = false;
    }

    const tick = this.tickCount;
    const before = this.computePowers();
    const interval = this.pacing.tickIntervalMs / 1000;
    this.elapsedSeconds += interval;

    // Only the OUTGUNNED side is clamped: hopeless defenses/attacks stay
    // watchable while overkill finishes promptly. Exact ties cap both.
    const attackerCap =
      before.attacker > before.defender
        ? Number.POSITIVE_INFINITY
        : this.pacing.maxCasualtyRatePerTick;
    const defenderCap =
      before.defender > before.attacker
        ? Number.POSITIVE_INFINITY
        : this.pacing.maxCasualtyRatePerTick;

    const attackerFraction = casualtyFraction(
      this.pacing.baseCasualtyRatePerTick,
      before.attacker,
      before.defender,
      attackerCap,
    );
    const defenderFraction = casualtyFraction(
      this.pacing.baseCasualtyRatePerTick,
      before.defender,
      before.attacker,
      defenderCap,
    );

    const defendersBeforeAttrition = this.totalSurviving(this.defenderGroups);

    this.applyAttrition(this.attackerGroups, attackerFraction);

    // Garrison-attributed wipe: attrition just erased the last attacker.
    if (this.fatalBlow === null && this.totalSurviving(this.attackerGroups) <= 0) {
      this.fatalBlow = { type: 'garrison' };
    }

    // First blood: every living stack loses at least 1/tick by design, so a
    // living defense is guaranteed to bleed this tick. Emitted before the
    // defender attrition pass so it precedes any slain-hero line.
    if (!this.firstBloodEmitted && defendersBeforeAttrition > 0) {
      this.firstBloodEmitted = true;
      this.pushEvent(
        'casualties',
        formatFlavor(pickLine(FIRST_BLOOD_LINES, this.rng), { target: this.target.name }),
      );
    }

    this.livingHeroesSnapshot = this.livingHeroes();
    this.applyAttrition(this.defenderGroups, defenderFraction);
    if (this.zombiePlagueActive) {
      this.processZombiePlague(defendersBeforeAttrition, before.attacker);
    }
    this.applyHeroicThreat();

    // Support Passive: living Support heroes have a chance to revive fallen allies
    this.processSupportPassive();

    // Tank Death Burst: when a Tank hero dies this tick, they take a share of the attackers with them
    this.processTankDeathBurst();

    // Retreat check: Heroes abandon a nearly-broken ARMY (not their own
    // stack — lone Heroes can never individually cross a stack threshold).
    // Age-final battles disable the roll entirely: the last stand of an Age
    // has no rear left to withdraw through.
    const armyBroken =
      !this.noRetreat &&
      defendersBeforeAttrition > 0 &&
      defendersBeforeAttrition <= this.totalDeployed(this.defenderGroups) * RETREAT_THRESHOLD;
    if (armyBroken) {
      for (const group of this.defenderGroups) {
        if (group.retreated) continue;
        if (!group.isHero || group.surviving <= 0) continue;
        if (group.heroClass === 'tank') continue; // Tanks never flee
        const chance =
          RETREAT_CHANCE_PER_TICK +
          (group.heroClass === 'ranged' ? RETREAT_RANGED_BONUS : 0) +
          (this.momentum === 'attacker'
            ? RETREAT_MOMENTUM_BONUS
            : 0);
        if (this.rng() < chance) {
          group.retreated = true;
          this.fledHeroNames.push(group.name);
          this.pushEvent(
            'climax',
            formatFlavor(pickLine(HERO_RETREAT_LINES, this.rng), { hero: group.name }),
          );
        }
      }
    }

    // Last stand: every surviving defender is a Hero. The survivors dig in
    // (threat multiplier) and may be reinforced ONCE by a late arrival.
    if (!this.lastStandEmitted && this.livingHeroes() > 0) {
      const mortalDefendersRemain = this.defenderGroups.some(
        (group) => !group.isHero && group.surviving > 0 && !group.retreated,
      );
      if (!mortalDefendersRemain) {
        this.lastStandEmitted = true;
        this.lastStandActive = true;
        const lastHero = this.defenderGroups.find(
          (group) => group.isHero && group.surviving > 0 && !group.retreated,
        );
        if (lastHero !== undefined) {
          this.pushEvent(
            'climax',
            formatFlavor(pickLine(HERO_LAST_STAND_LINES, this.rng), { hero: lastHero.name }),
          );
        }

        // One reinforcement roll per battle, at the moment the stand begins.
        // A success physically joins a new Hero stack — it bleeds, retreats
        // and rolls fates exactly like any other Hero from here on.
        if (
          this.reinforcementProvider !== undefined &&
          this.rng() < this.pacing.lastStandReinforceChance
        ) {
          const arriving = toSimGroup(this.reinforcementProvider.buildHero());
          this.defenderGroups.push(arriving);
          this.pushEvent(
            'hero',
            formatFlavor(pickLine(HERO_REINFORCEMENT_LINES, this.rng), { hero: arriving.name }),
            true,
          );
        }
      }
    }

    this.emitAttritionEvents();

    // Commander Tactics (and future ability owners) get their sweep once
    // attrition has settled, so triggers judge current headcounts and any
    // fresh activation is reflected in this tick's closing powers.
    this.abilities.processTick(tick, this.abilityContext());
    this.tickCount += 1;

    const after = this.computePowers();
    const nextMomentum = this.momentumFrom(after.attacker, after.defender);
    if (nextMomentum !== this.momentum) {
      this.momentum = nextMomentum;
      this.pushEvent('momentum', pickLine(MOMENTUM_LINES[nextMomentum], this.rng));
    }

    if (this.totalSurviving(this.defenderGroups) <= 0) {
      this.finish('victory');
    } else if (this.totalSurviving(this.attackerGroups) <= 0) {
      this.finish('defeat');
    }
  }

  /**
   * Integer losses with fractional carry-over for mortal stacks; Heroes
   * instead bleed a resolve pool (see applyHeroResolveAttrition) and can
   * only die once it empties.
   */
  private applyAttrition(groups: SimGroup[], fraction: number): void {
    for (const group of groups) {
      if (group.surviving <= 0) continue;

      if (group.isHero) {
        this.applyHeroResolveAttrition(group);
        continue;
      }

      const desired = group.surviving * fraction + group.carry;
      // The min-1 rule exists to break geometric tails on MASS stacks, so
      // stragglers never stall the final ticks of a battle.
      const lost = Math.min(group.surviving, Math.max(1, Math.floor(desired)));
      group.carry = Math.max(0, desired - lost);
      group.surviving -= lost;

      if (lost > 0 && !group.lossEventEmitted) {
        group.lossEventEmitted = true;
        this.pushEvent(
          'casualties',
          formatFlavor(pickLine(RANK_LOSS_LINES, this.rng), { unit: group.name }),
        );
      }
      if (group.surviving === 0 && !group.wipeEventEmitted) {
        group.wipeEventEmitted = true;
        this.pushEvent(
          'casualties',
          formatFlavor(pickLine(RANK_WIPE_LINES, this.rng), { unit: group.name }),
        );
      }
    }
  }

  /**
   * Zombie Plague: defenders lost THIS TICK are credited across the
   * attacker's stacks by effective-power share, and whole credits on
   * Zombie stacks rise as fresh Zombies mid-battle — merged into the
   * living stack so the forces panel shows one growing rank. Capped at a
   * quarter of the enemy garrison for the entire battle.
   *
   * Deliberately consumes NO RNG: with the plague off (or in seeded
   * regression battles) combat outcomes stay byte-identical.
   */
  private processZombiePlague(defendersBefore: number, attackerPowerBefore: number): void {
    if (this.plagueSpawnBudget <= 0) return;

    const losses = defendersBefore - this.totalSurviving(this.defenderGroups);
    if (!(losses > 0)) return;

    let zombiePower = 0;
    for (const group of this.attackerGroups) {
      if (group.unitId !== ZOMBIE_UNIT_ID || group.surviving <= 0 || group.retreated) continue;
      zombiePower +=
        group.surviving *
        group.combatPowerEach *
        this.abilities.groupPower(
          'attacker',
          { unitId: group.unitId, type: group.type, tags: group.tags },
          this.tickCount,
        );
    }
    if (!(zombiePower > 0)) {
      // No living carriers left: the plague dies with them.
      this.plagueKillCredit = 0;
      return;
    }

    const share =
      attackerPowerBefore > 0 ? Math.min(1, zombiePower / attackerPowerBefore) : 0;
    this.plagueKillCredit += losses * share;

    const stack = this.attackerGroups.find(
      (group) => group.unitId === ZOMBIE_UNIT_ID && group.surviving > 0 && !group.retreated,
    );
    if (stack === undefined) {
      this.plagueKillCredit = 0;
      return;
    }

    let spawns = Math.floor(this.plagueKillCredit);
    if (spawns <= 0) return;
    if (spawns > this.plagueSpawnBudget) spawns = this.plagueSpawnBudget;

    this.plagueKillCredit -= spawns;
    this.plagueSpawnBudget -= spawns;
    stack.deployed += spawns;
    stack.surviving += spawns;
    this.plagueRaiseEvents += 1;

    if (!this.plagueAnnounced) {
      // First rising of the battle: the classic conversion beat.
      this.plagueAnnounced = true;
      this.pushEvent('casualties', formatFlavor(pickLine(ZOMBIE_PLAGUE_LINES, this.rng), {}));
    } else if (this.plagueSpawnBudget <= 0 && !this.plagueCapAnnounced) {
      // The quarter-of-garrison tithe is complete — a milestone worth its
      // own dramatic beat.
      this.plagueCapAnnounced = true;
      this.pushEvent('climax', formatFlavor(pickLine(ZOMBIE_PLAGUE_CAP_LINES, this.rng), {}));
    } else if (this.plagueRaiseEvents % ZOMBIE_PLAGUE_RAISE_EVERY === 0) {
      // Recurring replenishment: ranks refilled from fresh enemy corpses.
      this.pushEvent(
        'casualties',
        formatFlavor(pickLine(ZOMBIE_PLAGUE_RAISE_LINES, this.rng), {}),
      );
    }
  }

  /**
   * Hero attrition drains RESOLVE instead of bodies: the stack stays at
   * full strength until the pool empties, so arrival → carve → bloodied →
   * escalation → last stand always gets stage time. Incoming drain follows
   * the swarm-mass curve (heroSwarmMass/heroIncomingFraction): attacker
   * headcount has strongly diminishing returns and individual unit quality
   * compounds, so hordes of chaff cannot schedule a Hero's death while a
   * genuinely powerful army grinds one down. The per-tick ceiling prevents
   * burst vaporization. Casualties are counted only on actual death — a
   * wounded Hero is still one whole Hero.
   *
   * Heroes currently only defend, so the opposing swarm is always the
   * attacker side.
   */
  private applyHeroResolveAttrition(group: SimGroup): void {
    if (this.heroProtectActive) return; // Shield of Protection blocks all damage
    if (group.maxResolve <= 0 || group.resolve <= 0 || group.retreated) return;
    if (group.heroClass === 'tank' && !this.lastStandActive) return; // Tanks can only die in last stand

    const drain = Math.min(
      heroIncomingFraction(heroSwarmMass(this.attackerGroups)) *
        heroDamageTakenFraction(this.livingHeroesSnapshot),
      this.pacing.maxHeroResolveLossPerTick,
    );
    if (!(drain > 0)) return;

    group.resolve -= drain;
    group.carry = 0;

    // First wound while still standing gets its own beat. A hero that dies
    // outright skips straight to the slain line.
    if (group.resolve > 0 && !group.heroBloodiedAnnounced) {
      group.heroBloodiedAnnounced = true;
      this.pushEvent(
        'casualties',
        formatFlavor(pickLine(HERO_BLOODED_LINES, this.rng), { hero: group.name }),
      );
    }

    if (group.resolve <= 0) {
      group.resolve = 0;
      group.surviving = 0;
      group.diedThisTick = true;
      if (!group.wipeEventEmitted) {
        group.wipeEventEmitted = true;
        this.pushEvent(
          'climax',
          formatFlavor(pickLine(HERO_SLAIN_LINES, this.rng), { hero: group.name }),
        );
      }
    }
  }

  /** Reference combat power for weighting — lowers weights for high-CP units. */
  private static readonly REFERENCE_CP = 20;

  /**
   * Each living Hero strips a percentage of the PLAYER'S CURRENT ARMY per
   * tick (the ability `strength`), split across the player's stacks by
   * inverse-CP weights so low‑combat‑power units (Wraiths, Skeletons) take
   * disproportionate damage. This is the documented contract from
   * ABILITY_KINDS.heroicThreat — an earlier implementation dropped the
   * ×-army-size factor, reducing Hero threat to a near-zero flat trickle.
   */
  private applyHeroicThreat(): void {
    const attackerTotal = this.totalSurviving(this.attackerGroups);
    if (!(attackerTotal > 0)) return;

    // Fraction of the player army bled this tick, summed over living Heroes.
    let threatShare = 0;
    let threateningHeroes = 0;
    for (const group of this.defenderGroups) {
      if (!group.isHero || group.surviving <= 0) continue;
      if (group.ability?.kind !== ABILITY_KINDS.heroicThreat) continue;
      threatShare += group.surviving * (group.ability.strength ?? 0);
      threateningHeroes += 1;
    }
    if (!(threatShare > 0)) return;

    // Last Stand: cornered Heroes carve deeper the fewer of them remain.
    if (this.lastStandActive) {
      threatShare *= Math.max(1, this.pacing.lastStandThreatMultiplier);
    }

    // Compute inverse-CP weights for each attacker group.
    const weights: number[] = [];
    let weightSum = 0;
    for (const group of this.attackerGroups) {
      if (group.surviving <= 0) {
        weights.push(0);
        continue;
      }
      const w = BattleSimulation.REFERENCE_CP / Math.max(group.combatPowerEach, 1);
      weightSum += w;
      weights.push(w);
    }
    if (weightSum <= 0) return;

    // Per-Hero kill budget for this resolution, in pre-tier swing units
    // (HERO_COMBAT_TUNING): caps total slaughter so mega-swarms get a
    // sustained war instead of an instant melt, while the tier multiplier
    // makes low-tier victims spend the budget faster in BODIES. Scales
    // with threat intensity (nemesis ramp, Last Stand) so stronger Heroes
    // also swing harder even once the budget binds.
    const threatAmp = Math.max(1, threatShare / HERO_COMBAT_TUNING.budgetThreatBaseline);
    let swingBudget =
      HERO_COMBAT_TUNING.swingUnitsPerResolutionPerHero *
      Math.max(1, threateningHeroes) *
      threatAmp;

    // Track the group with the highest weight for event text.
    const maxWeightIdx = weights.indexOf(Math.max(...weights));

    for (let i = 0; i < this.attackerGroups.length; i++) {
      const group = this.attackerGroups[i];
      if (group.retreated) continue;
      if (group.surviving <= 0) continue;
      const weightShare = weights[i] / weightSum;
      // Hero anti-chaff damage: low-tier victim stacks lose proportionally
      // more (tier inferred from combat power; high tiers get no bonus).
      // The proportional share carve is joined by a flat cleave swing so a
      // Hero deletes hundreds of chaff per resolution at ANY army size.
      const tierMult = heroVictimDamageMultiplier(group.combatPowerEach);
      const desired =
        (attackerTotal * threatShare +
          HERO_COMBAT_TUNING.cleaveBodiesPerResolution) *
          tierMult *
          weightShare +
        group.carry;
      const allowed = Math.min(desired, swingBudget * tierMult);
      swingBudget -= allowed / tierMult;
      const lost = Math.min(group.surviving, Math.floor(allowed));
      group.carry = Math.max(0, allowed - lost);
      group.surviving -= lost;
    }

    // Hero-attributed wipe: heroic threat just erased the last attacker.
    if (this.fatalBlow === null && this.totalSurviving(this.attackerGroups) <= 0) {
      this.fatalBlow = {
        type: 'heroes',
        names: this.defenderGroups
          .filter((group) => group.isHero && group.surviving > 0 && !group.retreated)
          .map((group) => group.name),
      };
    }

    // Every living Hero gets its own beats: a first carve-through, then a
    // one-time escalation when ground down past half resolve or cornered.
    for (const livingHero of this.defenderGroups) {
      if (!livingHero.isHero || livingHero.surviving <= 0) continue;
      if (!livingHero.heroThreatAnnounced) {
        livingHero.heroThreatAnnounced = true;
        const hardest = this.attackerGroups[maxWeightIdx].name;
        this.pushEvent(
          'climax',
          `${livingHero.name} carves through your ${hardest}!`,
        );
      } else if (!livingHero.heroThreatEscalated) {
        const halfGone =
          livingHero.maxResolve > 0
            ? livingHero.resolve > 0 && livingHero.resolve <= livingHero.maxResolve / 2
            : livingHero.deployed > 1 && livingHero.surviving <= livingHero.deployed / 2;
        if ((halfGone || this.defenseCollapsing) && livingHero.surviving > 0) {
          livingHero.heroThreatEscalated = true;
          this.pushEvent(
            'climax',
            formatFlavor(pickLine(HERO_ESCALATION_LINES, this.rng), { hero: livingHero.name }),
          );
        }
      }
    }
  }

  private emitAttritionEvents(): void {
    const defenderDeployed = this.totalDeployed(this.defenderGroups);
    const defenderSurviving = this.totalSurviving(this.defenderGroups);
    if (
      !this.resistanceWeakened &&
      defenderSurviving > 0 &&
      defenderSurviving < defenderDeployed * 0.5
    ) {
      this.resistanceWeakened = true;
      this.pushEvent('attrition', formatFlavor(pickLine(RESISTANCE_WEAKENED_LINES, this.rng), { target: this.target.name }));
    }
    if (
      !this.defenseCollapsing &&
      defenderSurviving > 0 &&
      defenderSurviving <= defenderDeployed * 0.25
    ) {
      this.defenseCollapsing = true;
      this.pushEvent('attrition', pickLine(DEFENSE_COLLAPSING_LINES, this.rng));
    }
    const attackerTotal = this.totalSurviving(this.attackerGroups);
    const attackerDeployed = this.totalDeployed(this.attackerGroups);
    if (
      !this.legionWavering &&
      attackerTotal > 0 &&
      attackerTotal <= attackerDeployed * 0.25
    ) {
      this.legionWavering = true;
      this.pushEvent('climax', pickLine(LEGION_WAVERING_LINES, this.rng));
    }
  }

  private totalSurviving(groups: readonly SimGroup[]): number {
    return groups.reduce(
      (sum, group) => sum + (group.retreated ? 0 : group.surviving),
      0,
    );
  }

  /** Headcount snapshot ability triggers judge, taken after attrition. */
  private abilityContext(): AbilityTickContext {
    return {
      attackerSurviving: this.totalSurviving(this.attackerGroups),
      attackerDeployed: this.totalDeployed(this.attackerGroups),
      defenderSurviving: this.totalSurviving(this.defenderGroups),
      defenderDeployed: this.totalDeployed(this.defenderGroups),
      ageId: this.target.ageId,
      stage: this.target.order,
      totalStages: this.target.totalTargets,
      fallenHeroCount: this.defenderGroups.filter(
        (g) => g.isHero && g.resolve <= 0 && g.surviving <= 0 && !g.retreated && !this.revivedHeroNames.has(g.name),
      ).length,
    };
  }

  /** True when a living stack matches the selector (shared pure matcher). */
  private static groupMatches(group: SimGroup, selector: Partial<UnitSelector>): boolean {
    return selectorMatches(selector, {
      unitId: group.unitId,
      type: group.type,
      tags: group.tags,
    });
  }

  /** Living headcount on one side matching a data-driven unit selector. */
  private countUnitsFor(side: ConditionSide, selector: Partial<UnitSelector>): number {
    const groups = side === 'attacker' ? this.attackerGroups : this.defenderGroups;
    let total = 0;
    for (const group of groups) {
      if (group.surviving <= 0 || group.retreated === true) continue;
      if (!BattleSimulation.groupMatches(group, selector)) continue;
      total += group.surviving;
    }
    return total;
  }

  /** Living stacks on one side matching the effect's filter composition. */
  private eligibleGroupsFor(effect: Extract<CombatEffect, { kind: 'casualties' }>): SimGroup[] {
    const groups = effect.side === 'attacker' ? this.attackerGroups : this.defenderGroups;
    const filter = effect.filter ?? [];
    const anyMode = effect.filterMode === 'any';
    return groups.filter((group) => {
      if (group.surviving <= 0 || group.retreated === true) return false;
      if (filter.length === 0) return true;
      return anyMode
        ? filter.some((selector) => BattleSimulation.groupMatches(group, selector))
        : filter.every((selector) => BattleSimulation.groupMatches(group, selector));
    });
  }

  /**
   * Executes an ability effect at activation time. Casualties are computed
   * from CURRENT survivors — never below zero, never above what exists,
   * filters and caps respected, rounding via floor + largest remainder. A
   * refused effect (zero eligible / zero kills) suppresses the activation
   * silently instead of logging a no-op.
   */
  private executeAbilityEffect(
    effect: CombatEffect,
    _owner: unknown,
    rng: () => number,
  ): AbilityEffectResult {
    switch (effect.kind) {
      case 'side-power':
        // Passive multipliers flow through computePowers(); nothing to do here.
        return { applied: true };
      case 'casualties': {
        const eligible = this.eligibleGroupsFor(effect);
        if (eligible.length === 0) return { applied: false };
        const eligibleTotal = eligible.reduce((sum, group) => sum + group.surviving, 0);

        let targetKilled: number;
        // Resolve the base cap: flat value, or the first scalingCap tier
        // satisfied by the battle-start deployment (list ordered descending).
        // Variance then applies on top of whichever tier won.
        let baseCap = effect.cap;
        if (effect.scalingCap !== undefined) {
          const step = effect.scalingCap.find(
            (tier) => this.initialAttackerDeployed >= tier.minUnits,
          );
          if (step !== undefined) baseCap = step.cap;
        }
        const effectiveCap =
          baseCap !== undefined && (effect.capVariance ?? 0) > 0
            ? baseCap * (1 + (rng() * 2 - 1) * effect.capVariance!)
            : baseCap;
        if (effect.mode === 'flat') {
          // Uniform integer across the configured range, clamped to what
          // actually exists and any cap.
          const min = Math.max(0, Math.floor(effect.range?.min ?? 0));
          const max = Math.max(min, Math.floor(effect.range?.max ?? min));
          targetKilled = min + Math.floor(rng() * (max - min + 1));
          targetKilled = Math.min(targetKilled, eligibleTotal);
          if (effectiveCap !== undefined) {
            targetKilled = Math.min(targetKilled, Math.floor(effectiveCap));
          }
        } else {
          targetKilled = Math.floor(eligibleTotal * Math.min(1, Math.max(0, effect.percent ?? 0)));
          if (effectiveCap !== undefined) {
            targetKilled = Math.min(targetKilled, Math.floor(effectiveCap));
          }
        }
        if (!(targetKilled > 0)) return { applied: false };

        // Convert the exact body count into an equivalent per-stack share so
        // distribution/rounding stays in ONE code path.
        const distribution = computeCasualtyDistribution(
          eligible.map((group) => group.surviving),
          targetKilled / eligibleTotal,
        );
        let killedTotal = 0;
        eligible.forEach((group, index) => {
          const killed = Math.min(group.surviving, Math.max(0, distribution[index] ?? 0));
          group.surviving -= killed;
          killedTotal += killed;
        });
        if (!(killedTotal > 0)) return { applied: false };

        const line =
          effect.reportTemplate !== undefined
            ? effect.reportTemplate.split('{count}').join(formatExact(killedTotal))
            : `${formatExact(killedTotal)} ${
                (effect.filter?.find((selector) => selector.noun !== undefined)?.noun ?? 'units').toUpperCase()
              } DESTROYED.`;
        return { applied: true, reportLine: line };
      }
      case 'hero-revive': {
        // Revive one fallen hero (lowest resolve first)
        const revived = this.reviveHero();
        if (!revived) return { applied: false };
        return { applied: true, reportLine: `${revived} rises from the grave!` };
      }
      case 'hero-protect': {
        // Temporary invulnerability — mark all living heroes as protected this tick
        this.heroProtectActive = true;
        return { applied: true, reportLine: 'A ward of protection envelops the defenders.' };
      }
    }
  }

  private totalDeployed(groups: readonly SimGroup[]): number {
    return groups.reduce((sum, group) => sum + group.deployed, 0);
  }

  private livingHeroes(): number {
    return this.defenderGroups.reduce(
      (sum, group) => sum + (group.isHero && group.surviving > 0 && !group.retreated ? group.surviving : 0),
      0,
    );
  }

  /**
   * Revives a single fallen Hero (resolve = 0, surviving = 0, not retreated).
   * Returns the hero's name on success, null if nobody can be revived.
   * A hero may only be revived ONCE per battle — tracked via a Set.
   */
  private reviveHero(): string | null {
    for (const group of this.defenderGroups) {
      if (!group.isHero) continue;
      if (group.resolve > 0 || group.surviving > 0) continue;
      if (group.retreated) continue;
      if (this.revivedHeroNames.has(group.name)) continue;

      // Revive with half max resolve
      const reviveResolve = Math.floor(group.maxResolve / 2);
      group.resolve = reviveResolve;
      group.surviving = 1;
      group.heroBloodiedAnnounced = false;
      group.heroThreatEscalated = false;
      this.revivedHeroNames.add(group.name);
      return group.name;
    }
    return null;
  }

  /**
   * Support Passive: each living Support hero has a base chance to revive
   * one fallen ally per tick. Multiple Support heroes increase the chance
   * with diminishing returns. Cap: SUPPORT_REVIVAL_MAX_PER_TICK per tick.
   */
  private processSupportPassive(): void {
    let revivals = 0;
    const supportHeroes = this.defenderGroups.filter(
      (g) => g.isHero && g.heroClass === 'support' && g.surviving > 0 && !g.retreated,
    );
    if (supportHeroes.length === 0) return;

    for (const hero of supportHeroes) {
      if (revivals >= SUPPORT_REVIVAL_MAX_PER_TICK) break;
      // Diminishing returns: each additional Support hero has reduced chance
      const chanceBonus = SUPPORT_REVIVAL_BASE_CHANCE / Math.sqrt(revivals + 1);
      if (this.rng() < chanceBonus) {
        const revived = this.reviveHero();
        if (revived !== null) {
          revivals += 1;
          this.pushEvent(
            'hero',
            formatFlavor(`${hero.name} channels healing light, restoring ${revived} to the fight!`, {}),
          );
        }
      }
    }
  }

  private processTankDeathBurst(): void {
    for (const group of this.defenderGroups) {
      if (!group.isHero || group.heroClass !== 'tank' || !group.diedThisTick) continue;

      // Casualties only land if the Tank stayed down — a same-tick Support
      // revival pulls them back up before this check, and the blast spares
      // the attacker when its source is standing again.
      if (group.surviving <= 0) {
        const attackerTotal = this.totalSurviving(this.attackerGroups);
        if (attackerTotal > 0) {
          const burstCasualties = Math.max(1, Math.floor(attackerTotal * TANK_DEATH_BURST_FRACTION));

          // Distribute casualties across attacker stacks by proportional share
          let remaining = burstCasualties;
          for (const attacker of this.attackerGroups) {
            if (attacker.surviving <= 0 || remaining <= 0) continue;
            const share =
              attackerTotal > 0 ? (attacker.surviving / attackerTotal) * burstCasualties : 0;
            const loss = Math.min(attacker.surviving, Math.max(1, Math.round(share)));
            attacker.surviving -= loss;
            remaining -= loss;
          }

          // If rounding left anything, subtract from the largest remaining stack
          if (remaining > 0) {
            const biggest = this.attackerGroups.reduce((best, a) =>
              a.surviving > (best?.surviving ?? 0) ? a : best,
            undefined as SimGroup | undefined);
            if (biggest) biggest.surviving = Math.max(0, biggest.surviving - remaining);
          }
        }
      }

      // The detonation happened either way — the beat always lands.
      this.pushEvent(
        'climax',
        formatFlavor(pickLine(TANK_DEATH_BURST_LINES, this.rng), { hero: group.name }),
      );
    }
  }

  private finish(outcome: BattleOutcomeType): void {
    this.complete = true;
    this.outcome = outcome;
    this.pushEvent(
      'climax',
      outcome === 'victory'
        ? `The ${this.target.name} falls. The field is yours.`
        : `Your legion is broken at ${this.target.name}.`,
    );
  }

  private pushEvent(
    kind: BattleEventView['kind'],
    message: string,
    pin = false,
    tier?: AbilityTier,
  ): void {
    this.eventCounter += 1;
    const event: BattleEventView = {
      id: this.eventCounter,
      kind,
      message,
      ...(tier !== undefined ? { tier } : {}),
    };
    if (pin) {
      // Pinned beats (battle start, Hero arrivals, reinforcements) are kept
      // in their own list purely so the snapshot can order them first; they
      // are never at risk of eviction — nothing is.
      this.pinnedEvents.push(event);
      return;
    }
    // Full transcript: every beat is kept. The battle log is scrollable and
    // the defeat transcript re-reads the whole fight, so lines must never
    // disappear. Battles are bounded (a few hundred beats worst case), so
    // retaining them all is cheap and per-instance.
    this.events.push(event);
  }
}

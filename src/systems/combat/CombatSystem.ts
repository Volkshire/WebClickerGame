import { AppEvents } from '../../core/Application';
import type { UpdatePayload } from '../../core/Application';
import type { EventBus } from '../../core/EventBus';
import { isSupportedSchemaVersion, SAVE_SCHEMA_VERSION } from '../../core/SaveManager';
import type { SaveManager } from '../../core/SaveManager';
import {
  MAX_HEROES_PER_TARGET,
  NEMESIS_HIJACK_CHANCE,
  createHeroForTarget,
  getEnemyUnit,
  rollTargetArmy,
} from './enemyUnits';
import type { RolledArmyGroup } from './enemyUnits';
import { DEFAULT_BATTLE_PACING } from './pacing';
import type { BattlePacing } from './pacing';
import { BattleSimulation } from './simulation';
import type {
  BattleGroupInput,
  BattleSimulationOptions,
  BattleSnapshot,
  BattleTargetMeta,
} from './simulation';
import { rollHeroFates as resolveHeroFates } from './heroFates';
import { pickUnique } from './heroNames';
import { NameDeck } from './heroNames';
import type { HeroNamePools } from './heroNames';
import { CombatEvents } from './types';
import type {
  ActiveBattleView,
  BattleHeroOutcome,
  BattleResult,
  CombatChangedPayload,
  CombatTargetView,
  DeployedGroup,
} from './types';
import { AGES, TOTAL_AGES, getAgeForTarget } from './world';
import type { AgeDefinition, TargetDefinition } from './world';

interface SavedBattle {
  /** Age the battle belongs to (informational; ids are globally unique). */
  ageId: string;
  targetId: string;
  deployedArmy: DeployedGroup[];
  attackerPower: number;
  startedAtMs: number;
}

/**
 * Share of the target's loot table granted on DEFEAT (victory always pays
 * 100%). Tunable economy knob: losing an assault still pays for the damage
 * dealt, at half rate.
 */
export const DEFEAT_LOOT_MULTIPLIER = 0.5;

interface ParsedProgress {
  ageIndex: number;
  clearedInAge: number;
}

interface WorldBlob {
  battle: SavedBattle | null;
  /** Current Age id (new saves). */
  ageId?: string;
  /** Targets cleared inside the current Age (new saves). */
  clearedInAge?: number;
  /**
   * Legacy single-Age keys: how many targets were reachable / defeated in
   * order, interpreted against Age of Ash. Read for migration only.
   */
  unlockedTargets?: number;
  defeatedTargets?: number;
  /** Set when an old save was interpreted so the migration can be persisted. */
  migratedFromLegacy?: boolean;
  /** Heroes that fled mid-battle and are owed a return in later targets. */
  fledHeroes?: { name: string; fledOrder: number }[];
  /** Remaining hero-name deck order (shuffle-bag persistence). Legacy flat array or new split format. */
  heroDeck?: string[] | { custom: string[]; generated: string[]; recent?: string[] };
  /** Heroes that survived failed assaults, keyed by target id. */
  survivingDefenders?: Record<string, string[]>;
}

function isValidGroups(raw: unknown): raw is DeployedGroup[] {
  if (!Array.isArray(raw) || raw.length === 0) return false;
  return raw.every(
    (group) =>
      group !== null &&
      typeof group === 'object' &&
      typeof group.unitId === 'string' &&
      group.unitId !== '' &&
      typeof group.name === 'string' &&
      group.name !== '' &&
      Number.isSafeInteger(group.count) &&
      group.count > 0 &&
      typeof group.combatPowerEach === 'number' &&
      Number.isFinite(group.combatPowerEach) &&
      group.combatPowerEach >= 0,
  );
}

function parseSavedBattle(raw: unknown): SavedBattle | null {
  if (raw === null || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  if (typeof record['targetId'] !== 'string') return null;
  // Target ids are unique across Ages, so the battle resolves to exactly one
  // target wherever it was saved from.
  const resolved = getAgeForTarget(record['targetId']);
  if (resolved === null) return null;
  if (!isValidGroups(record['deployedArmy'])) return null;
  const attackerPower = record['attackerPower'];
  if (typeof attackerPower !== 'number' || !Number.isFinite(attackerPower) || attackerPower <= 0) {
    return null;
  }
  const startedAtMs = record['startedAtMs'];
  if (typeof startedAtMs !== 'number' || !Number.isFinite(startedAtMs) || startedAtMs <= 0) {
    return null;
  }
  return {
    ageId: resolved.age.id,
    targetId: record['targetId'],
    deployedArmy: record['deployedArmy'].map((group) => ({ ...group })),
    attackerPower,
    startedAtMs,
  };
}

/**
 * Progress parsing for both blob generations:
 * - Current format: `ageId` + `clearedInAge`.
 * - Legacy single-Age format: `unlockedTargets`/`defeatedTargets` counts,
 *   interpreted against Age of Ash and migrated on the next persist.
 */
function parseProgress(record: Record<string, unknown>): ParsedProgress | null {
  const rawAgeId = record['ageId'];
  if (typeof rawAgeId === 'string') {
    const ageIndex = AGES.findIndex((age) => age.id === rawAgeId);
    if (ageIndex < 0) return null;
    const length = AGES[ageIndex].targets.length;
    const rawCleared = record['clearedInAge'];
    if (
      typeof rawCleared !== 'number' ||
      !Number.isSafeInteger(rawCleared) ||
      rawCleared < 0 ||
      rawCleared > length
    ) {
      return null;
    }
    return { ageIndex, clearedInAge: rawCleared };
  }

  // Legacy saves only tracked the reachable count; newer ones also track
  // how many were defeated in order. Missing defeatedTargets migrates as
  // "everything reachable except the current frontier is cleared".
  const ashLength = AGES[0].targets.length;
  let unlockedCount = 1;
  if (record['unlockedTargets'] !== undefined) {
    const rawUnlocked = record['unlockedTargets'];
    if (
      typeof rawUnlocked !== 'number' ||
      !Number.isSafeInteger(rawUnlocked) ||
      rawUnlocked < 1 ||
      rawUnlocked > ashLength
    ) {
      return null;
    }
    unlockedCount = rawUnlocked;
  }

  let defeatedCount = unlockedCount - 1;
  if (record['defeatedTargets'] !== undefined) {
    const rawDefeated = record['defeatedTargets'];
    if (
      typeof rawDefeated !== 'number' ||
      !Number.isSafeInteger(rawDefeated) ||
      rawDefeated < 0 ||
      rawDefeated > ashLength
    ) {
      return null;
    }
    defeatedCount = rawDefeated;
  }
  return { ageIndex: 0, clearedInAge: Math.min(defeatedCount, ashLength) };
}

function parseWorldBlob(raw: unknown): WorldBlob | null {
  if (raw === null || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  if (!isSupportedSchemaVersion(record)) return null;

  const progress = parseProgress(record);
  if (progress === null) return null;

  const battle = parseSavedBattle(record['battle']);

  const fledHeroes = record['fledHeroes'];
  let parsedFledHeroes: { name: string; fledOrder: number }[] = [];
  if (Array.isArray(fledHeroes)) {
    parsedFledHeroes = fledHeroes.filter(
      (f: unknown) =>
        typeof f === 'object' &&
        f !== null &&
        typeof (f as Record<string, unknown>)['name'] === 'string' &&
        typeof (f as Record<string, unknown>)['fledOrder'] === 'number',
    ) as { name: string; fledOrder: number }[];
  }

  const heroDeck = record['heroDeck'];
  let parsedHeroDeck: { custom: string[]; generated: string[]; recent?: string[] } | string[] | undefined;
  if (Array.isArray(heroDeck)) {
    // Legacy flat array format — treat as generated pool order.
    const flat = heroDeck.filter((n): n is string => typeof n === 'string' && n.length > 0);
    if (flat.length > 0) parsedHeroDeck = flat;
  } else if (heroDeck !== null && typeof heroDeck === 'object' && !Array.isArray(heroDeck)) {
    // New split format: { custom, generated, recent? }
    const obj = heroDeck as Record<string, unknown>;
    const custom = Array.isArray(obj['custom'])
      ? (obj['custom'] as unknown[]).filter((n): n is string => typeof n === 'string' && n.length > 0)
      : [];
    const generated = Array.isArray(obj['generated'])
      ? (obj['generated'] as unknown[]).filter((n): n is string => typeof n === 'string' && n.length > 0)
      : [];
    const recent = Array.isArray(obj['recent'])
      ? (obj['recent'] as unknown[]).filter((n): n is string => typeof n === 'string' && n.length > 0)
      : undefined;
    if (custom.length > 0 || generated.length > 0) {
      parsedHeroDeck = { custom, generated, recent };
    }
  }

  // Standing-defender rosters: targetId -> Hero names, parsed leniently so
  // a corrupt entry can only drop one roster — never break the boot.
  const rawSurviving = record['survivingDefenders'];
  let survivingDefenders: Record<string, string[]> | undefined;
  if (rawSurviving !== null && typeof rawSurviving === 'object' && !Array.isArray(rawSurviving)) {
    for (const [targetId, roster] of Object.entries(rawSurviving as Record<string, unknown>)) {
      if (!Array.isArray(roster)) continue;
      const names = roster.filter((n): n is string => typeof n === 'string' && n.length > 0);
      if (names.length === 0) continue;
      (survivingDefenders ??= {})[targetId] = names;
    }
  }

  return {
    battle,
    ageId: AGES[progress.ageIndex].id,
    clearedInAge: progress.clearedInAge,
    migratedFromLegacy: typeof record['ageId'] !== 'string',
    fledHeroes: parsedFledHeroes,
    ...(parsedHeroDeck !== undefined ? { heroDeck: parsedHeroDeck as WorldBlob['heroDeck'] } : {}),
    ...(survivingDefenders !== undefined ? { survivingDefenders } : {}),
  };
}

/**
 * Injection points for the combat system. Kept as an options object so new
 * integrations (e.g. meta-progression modifiers) do not grow the positional
 * parameter list.
 */
export interface CombatSystemOptions {
  pacingOverride?: Partial<BattlePacing>;
  now?: () => number;
  /**
   * Live attacker-side effective power multiplier (Prestige bonuses, ...).
   * Queried when each battle is created, including restored ones.
   */
  getAttackerModifier?: () => number;
  /**
   * Zombie Plague (Necromancy research) gate. Queried when each battle is
   * created, including restored ones.
   */
  isZombiePlagueActive?: () => boolean;
  /** RNG for enemy army/Hero rolls (injectable for deterministic tests). */
  rng?: () => number;
  /** Hero name pool (built-ins merged with public/hero-names.txt). */
  heroNames?: readonly string[];
}

/** Enemy garrison stack -> simulation input shape. */
function enemyGroupToInput(group: RolledArmyGroup): BattleGroupInput {
  return {
    unitId: group.id,
    name: group.name,
    count: group.count,
    combatPowerEach: group.combatPower,
    type: group.type,
    tags: group.tags,
    isHero: group.isHero === true,
    isReturningNemesis: group.isReturningNemesis === true,
    isReturningDefender: group.isReturningDefender === true,
    ability: group.ability,
    tactics: group.tactics,
    heroClass: group.heroClass,
  };
}

/** Player stack -> simulation input shape. */
function deployedToInput(group: DeployedGroup): BattleGroupInput {
  return {
    unitId: group.unitId,
    name: group.name,
    count: group.count,
    combatPowerEach: group.combatPowerEach,
    type: group.type,
    tags: group.tags,
  };
}

/**
 * Owns battle persistence + timing and mediates between the event bus and
 * the live BattleSimulation, which holds all combat math.
 */
export class CombatSystem {
  private readonly events: EventBus;
  private readonly saves: SaveManager;
  private readonly pacing: BattlePacing;
  private readonly now: () => number;
  private readonly getAttackerModifier: () => number;
  private readonly isZombiePlagueActive: (() => boolean) | null;
  private readonly rng: () => number;
  private heroNames: readonly string[] = [];
  private customNamePool: readonly string[] = [];
  private generatedNamePool: readonly string[] = [];
  /** Shuffle-bag over hero name pools; rebuilt lazily, persisted across reloads. */
  private nameDeck: NameDeck | null = null;
  private pendingDeckOrder:
    | { custom: readonly string[]; generated: readonly string[]; recent?: readonly string[] }
    | undefined;
  private simulation: BattleSimulation | null = null;
  private deployment: DeployedGroup[] | null = null;
  private lastResult: BattleResult | null = null;
  private lastSnapshot: BattleSnapshot | null = null;
  /** Prefix of the current Age's targets defeated in order; the unlock frontier. */
  private clearedInAge = 0;
  /** Index into AGES of the Age currently being played. */
  private ageIndex = 0;
  /** Heroes that fled mid-battle and are owed a return in later targets. */
  private fledHeroes: { name: string; fledOrder: number }[] = [];
  /**
   * Heroes that survived failed assaults, keyed by target id. They hold the
   * field until the target is cleared; repeat attacks face exactly them.
   */
  private standingDefenders = new Map<string, string[]>();

  constructor(events: EventBus, saves: SaveManager, options: CombatSystemOptions = {}) {
    this.events = events;
    this.saves = saves;
    this.pacing = { ...DEFAULT_BATTLE_PACING, ...options.pacingOverride };
    this.now = options.now ?? Date.now;
    this.getAttackerModifier = options.getAttackerModifier ?? (() => 1);
    this.isZombiePlagueActive = options.isZombiePlagueActive ?? null;
    this.rng = options.rng ?? Math.random;
    this.heroNames = options.heroNames ?? [];

    events.on<UpdatePayload>(AppEvents.Update, ({ deltaSeconds }) => {
      this.tick(deltaSeconds);
    });

    // Page hidden (tab switch, minimize, mobile app background): persist now,
    // so a mid-battle deployment survives the tab being discarded.
    events.on(AppEvents.Flush, () => {
      this.persist();
    });
  }

  get activeBattle(): boolean {
    return this.simulation !== null;
  }

  /** The Age currently being played. */
  private get age(): AgeDefinition {
    return AGES[this.ageIndex] ?? AGES[AGES.length - 1];
  }

  /** The next target to beat, or null when the Age is fully conquered. */
  private get frontierTarget(): TargetDefinition | null {
    const targets = this.age.targets;
    return this.clearedInAge < targets.length ? targets[this.clearedInAge] : null;
  }

  /** Ages fully conquered so far, including one awaiting the advance action. */
  get conqueredAges(): number {
    return this.ageIndex + (this.frontierTarget === null ? 1 : 0);
  }

  /**
   * Conquered-Age lull: the current Age is cleared, a next Age exists and
   * no battle is resolving — only the advance action moves forward now.
   */
  private get awaitingAdvance(): boolean {
    return this.frontierTarget === null && this.ageIndex < TOTAL_AGES - 1 && this.simulation === null;
  }

  /**
   * The player-facing Age transition: leaves the conquered lull, loads the
   * next Age's ladder/enemy pool and sets its first target as the frontier.
   * Generic for every Age; refused on the final Age (completion state) or
   * while a battle resolves.
   */
  advanceAge(): boolean {
    if (!this.awaitingAdvance) return false;
    this.ageIndex += 1;
    this.clearedInAge = 0;
    this.lastResult = null;
    // The grudge ledger is per-Age: fleeing veterans never cross an Age
    // boundary into the next era's ladder.
    this.fledHeroes = [];
    // Standing-defender rosters for conquered-Age targets are unreachable
    // (target ids never repeat) — prune them so persistence stays lean.
    for (const targetId of [...this.standingDefenders.keys()]) {
      const resolved = getAgeForTarget(targetId);
      if (resolved === null || resolved.ageIndex < this.ageIndex) {
        this.standingDefenders.delete(targetId);
      }
    }
    this.persist();
    this.publish();
    return true;
  }

  /**
   * Installs the hero name pools (custom from hero-names.txt, generated built-ins).
   * Loaded asynchronously at boot, before the first battle can start.
   */
  setHeroNames(pools: HeroNamePools): void {
    this.customNamePool = pools.custom;
    this.generatedNamePool = pools.generated;
    this.heroNames = [...pools.custom, ...pools.generated];
    this.nameDeck = new NameDeck(pools.custom, pools.generated, this.pendingDeckOrder);
    this.pendingDeckOrder = undefined;
  }

  /**
   * Draws the next fresh hero name from the weighted shuffle-bag, excluding
   * anything already claimed (field heroes, grudge ledger). Falls back to
   * uniform picking when no pool/deck exists yet.
   */
  private drawHeroName(excluded: ReadonlySet<string>): string | undefined {
    if (this.nameDeck === null && this.heroNames.length > 0) {
      this.nameDeck = new NameDeck(this.customNamePool, this.generatedNamePool);
    }
    return this.nameDeck?.draw(excluded, this.rng);
  }

  /** Prestige support: wipes the campaign frontier and any live battle. */
  resetRun(): void {
    this.simulation = null;
    this.deployment = null;
    this.lastResult = null;
    this.lastSnapshot = null;
    this.ageIndex = 0;
    this.clearedInAge = 0;
    this.fledHeroes = [];
    this.standingDefenders.clear();
    this.nameDeck = null; // fresh cycle for the new run
    this.persist();
    this.publish();
  }

  restore(): void {
    const parsed = parseWorldBlob(this.saves.load());
    if (parsed !== null) {
      const restoredIndex =
        parsed.ageId !== undefined ? AGES.findIndex((age) => age.id === parsed.ageId) : 0;
      this.ageIndex = Math.max(restoredIndex, 0);
      // The unlock frontier can never trail the cleared prefix.
      this.clearedInAge = Math.max(parsed.clearedInAge ?? 0, 0);
      this.fledHeroes = parsed.fledHeroes ?? [];
      this.standingDefenders = new Map(Object.entries(parsed.survivingDefenders ?? {}));
      // Deck depletion survives reloads; if the pool isn't installed yet,
      // setHeroNames applies it on arrival.
      if (parsed.heroDeck !== undefined) {
        const deck = parsed.heroDeck;
        if (Array.isArray(deck)) {
          // Legacy flat array: treat as generated pool order.
          if (this.heroNames.length > 0) {
            this.nameDeck = new NameDeck(this.customNamePool, this.generatedNamePool, {
              custom: [],
              generated: deck,
            });
          } else {
            this.pendingDeckOrder = { custom: [], generated: deck };
          }
        } else {
          // New split format.
          if (this.heroNames.length > 0) {
            this.nameDeck = new NameDeck(this.customNamePool, this.generatedNamePool, deck);
          } else {
            this.pendingDeckOrder = deck;
          }
        }
      }
      // A saved battle resolves instantly on reload; live battles do not
      // survive the tab closing yet.
      if (this.simulation === null && parsed.battle !== null) {
        this.resolveSavedBattle(parsed.battle);
      }
      if (parsed.migratedFromLegacy === true && this.simulation === null) {
        this.persist(); // make the legacy migration durable
      }
    }
    this.publish();
  }

  startBattle(targetId: string, deployedArmy: DeployedGroup[], attackerPower: number): boolean {
    if (this.simulation !== null) return false;
    const targets = this.age.targets;
    const targetIndex = targets.findIndex((entry) => entry.id === targetId);
    // The frontier target plus every cleared target stays attackable.
    if (targetIndex < 0 || targetIndex > this.clearedInAge) return false;
    if (!isValidGroups(deployedArmy)) return false;
    if (!Number.isFinite(attackerPower) || attackerPower <= 0) return false;

    const basePower = deployedArmy.reduce((sum, g) => sum + g.count * g.combatPowerEach, 0);
    if (basePower <= 0) return false;

    const target = targets[targetIndex];
    const isAgeFinal = target.order === targets.length;
    this.deployment = deployedArmy.map((group) => ({ ...group }));
    // The garrison (and any Heroes) is rolled fresh for every battle —
    // except Heroes that survived a previous failed assault HERE: they hold
    // the field again, locking the roster outside Age finales.
    const defenderArmy = rollTargetArmy(
      target.army,
      target.heroChance,
      this.rng,
      this.heroNames,
      target.order,
      this.fledHeroes,
      isAgeFinal,
      target.combatPower,
      (excluded) => this.drawHeroName(excluded),
      this.standingDefenders.get(target.id),
    );
    const meta: BattleTargetMeta = {
      id: target.id,
      name: target.name,
      terrain: target.terrain,
      // Campaign context feeds ability conditions (age/stage gating).
      ageId: this.age.id,
      order: target.order,
      totalTargets: targets.length,
    };
    this.simulation = new BattleSimulation(
      meta,
      this.deployment.map(deployedToInput),
      defenderArmy.map(enemyGroupToInput),
      this.pacing,
      // Re-applies the current permanent modifiers and installs the Last
      // Stand reinforcement provider for this battlefield.
      this.makeSimulationOptions(target, defenderArmy, isAgeFinal),
    );
    this.lastSnapshot = this.simulation.snapshot();
    this.persist();
    this.publish();
    return true;
  }

  private tick(deltaSeconds: number): void {
    const simulation = this.simulation;
    if (simulation === null || deltaSeconds <= 0) return;

    const changed = simulation.advance(deltaSeconds);
    if (!changed) return;

    this.lastSnapshot = simulation.snapshot();
    if (simulation.complete) {
      this.finishBattle();
    } else {
      this.publish();
    }
  }

  private resolveSavedBattle(saved: SavedBattle): void {
    // Target ids are globally unique; the battle re-resolves against its own
    // target wherever it was saved from.
    const resolved = getAgeForTarget(saved.targetId);
    if (resolved === null) return;
    const target = resolved.target;

    this.deployment = saved.deployedArmy.map((group) => ({ ...group }));
    // Defenders are not persisted; restored battles resolve against a fresh roll.
    const isAgeFinal = target.order === resolved.age.targets.length;
    const defenderArmy = rollTargetArmy(
      target.army,
      target.heroChance,
      this.rng,
      this.heroNames,
      target.order,
      this.fledHeroes,
      isAgeFinal,
      target.combatPower,
      (excluded) => this.drawHeroName(excluded),
      this.standingDefenders.get(target.id),
    );
    const meta: BattleTargetMeta = {
      id: target.id,
      name: target.name,
      terrain: target.terrain,
      // Campaign context feeds ability conditions (age/stage gating).
      ageId: resolved.age.id,
      order: target.order,
      totalTargets: resolved.age.targets.length,
    };
    this.simulation = new BattleSimulation(
      meta,
      this.deployment.map(deployedToInput),
      defenderArmy.map(enemyGroupToInput),
      this.pacing,
      // Re-applies permanent modifiers and Last Stand reinforcement to
      // restored battles.
      this.makeSimulationOptions(target, defenderArmy, isAgeFinal),
    );
    this.lastSnapshot = this.simulation.snapshot();
    this.simulation.runToCompletion();
    this.lastSnapshot = this.simulation.snapshot();
    this.finishBattle();
  }

  private finishBattle(): void {
    const simulation = this.simulation;
    const snapshot = this.lastSnapshot;
    const deployment = this.deployment;
    if (
      simulation === null ||
      snapshot === null ||
      snapshot.outcome === null ||
      deployment === null
    ) {
      return;
    }

    const outcome = snapshot.outcome;
    const resolved = getAgeForTarget(simulation.targetId);
    const target = resolved?.target ?? null;
    const attackerBasePower = deployment.reduce(
      (sum, group) => sum + group.count * group.combatPowerEach,
      0,
    );

    // Defeating the current frontier target clears it. The Age transition
    // itself is player-driven (advanceAge) once the whole Age stands
    // conquered. Replay victories never move the campaign.
    if (
      outcome === 'victory' &&
      resolved !== null &&
      resolved.ageIndex === this.ageIndex &&
      resolved.targetIndex === this.clearedInAge &&
      this.clearedInAge < this.age.targets.length
    ) {
      this.clearedInAge += 1;
    }

    // Defeat destroys 100% of the deployed troops; victory returns survivors
    // and reports exactly what fell.
    const survivingArmy = outcome === 'victory' ? simulation.survivingArmy() : [];
    const casualties =
      outcome === 'victory'
        ? simulation.casualtyArmy()
        : deployment.map((group) => ({ ...group }));

    // Loot = target table × enemy casualties, awarded on BOTH outcomes.
    // Defeats pay a reduced share (rounded UP so the grant is always a
    // whole unit ResourceSystem can accept), victories the full rate.
    // CombatSystem only REPORTS amounts; the wiring layer performs the
    // actual grants.
    const lootRate = outcome === 'victory' ? 1 : DEFEAT_LOOT_MULTIPLIER;
    const roundLoot = (value: number) =>
      outcome === 'victory' ? value : Math.ceil(value);
    const lootGained =
      target !== null && snapshot.defenderCasualties > 0
        ? {
            bone: roundLoot((target.loot.bone ?? 0) * snapshot.defenderCasualties * lootRate),
            flesh: roundLoot((target.loot.flesh ?? 0) * snapshot.defenderCasualties * lootRate),
            iron: roundLoot((target.loot.iron ?? 0) * snapshot.defenderCasualties * lootRate),
          }
        : null;

    // Hero fate is rolled once per battle END, separate from attrition:
    // lopsided victories kill Heroes more reliably; defeats rarely do.
    // An Age's final target has no escape: survivors are cut down and no
    // grudge is recorded (there is no later target in this Age to return to).
    const ageFinalBattle =
      resolved !== null && resolved.targetIndex === resolved.age.targets.length - 1;
    const heroOutcome = this.rollHeroFates(simulation, outcome === 'victory', snapshot, ageFinalBattle);

    // Wipe attribution: who landed the killing blow on a DEFEAT.
    const wipeAttribution =
      outcome === 'defeat' ? simulation.getWipeAttribution() : null;
    const wipedByHeroes =
      wipeAttribution?.type === 'heroes' ? wipeAttribution.names : undefined;

    // Terminal survival shares for the defeat transcript's bars. Raw powers
    // are meaningless once a side is empty (effective-power math returns 0
    // against an empty opposition), so bars use surviving/deployed shares
    // taken from the terminal force lists.
    const shareOf = (forces: readonly { deployed: number; surviving: number }[]) => {
      const deployed = forces.reduce((sum, force) => sum + force.deployed, 0);
      if (deployed <= 0) return 0;
      const surviving = forces.reduce((sum, force) => sum + Math.max(0, force.surviving), 0);
      return Math.min(1, Math.max(0, surviving / deployed));
    };
    const finalAttackerStrength = shareOf(snapshot.attackerForces);
    const finalDefenderStrength = shareOf(snapshot.defenderForces);

    // Standing defenders: on DEFEAT the Heroes that held the field keep this
    // target and return under the same names next assault (fled Heroes are
    // excluded — the grudge ledger already owns them). VICTORY clears the
    // roster: every defender fell, fled beyond recall, or was cut down.
    let standingHeroCount = 0;
    if (outcome === 'defeat') {
      const survivors = [
        ...new Map(
          simulation.standingDefenderHeroNames().map((name) => [name.toLowerCase(), name] as const),
        ).values(),
      ].slice(0, MAX_HEROES_PER_TARGET);
      standingHeroCount = survivors.length;
      if (survivors.length > 0) this.standingDefenders.set(simulation.targetId, survivors);
      else this.standingDefenders.delete(simulation.targetId);
    } else {
      this.standingDefenders.delete(simulation.targetId);
    }

    // Track heroes that fled mid-battle so they can return in later targets.
    // fledOrder stores the target's 1-based order: veterans may only return
    // at strictly later targets, never the one they fled (or its replays).
const fledThisBattle = simulation.getFledHeroNames();
for (const name of fledThisBattle) {
  if (ageFinalBattle) break; // nowhere to flee to; nothing to hold a grudge with
  if (!this.fledHeroes.some((f) => f.name === name)) {
    this.fledHeroes.push({
      name,
      fledOrder: target !== null ? target.order : (resolved?.targetIndex ?? 0) + 1,
    });
  }
}

const result: BattleResult = {
      targetId: simulation.targetId,
      targetName: simulation.targetName,
      outcome,
      attackerBasePower,
      defenderBasePower: target?.combatPower ?? 0,
      attackerEffectivePower: snapshot.initialAttackerPower,
      defenderEffectivePower: snapshot.initialDefenderPower,
      defenderCasualties: snapshot.defenderCasualties,
      lootGained,
      standingHeroCount,
      finalAttackerStrength,
      finalDefenderStrength,
      wipedByHeroes,
      heroOutcome,
      deployedArmy: deployment.map((group) => ({ ...group })),
      survivingArmy,
      casualties,
      durationSeconds: snapshot.elapsedSeconds,
      transcriptEvents: snapshot.events,
    };

    this.simulation = null;
    this.deployment = null;
    this.lastResult = result;
    this.persist();

    this.events.emit<BattleResult>(CombatEvents.BattleEnded, result);
    this.publish();
  }

  /**
   * Thin adapter: feeds the pure fate resolver the live battle's roster,
   * grudge set, and odds. All rules (defeat omission, kill ramp, fled
   * auto-survival, no-escape finales) live in heroFates.ts.
   */
  private rollHeroFates(
    simulation: BattleSimulation,
    victory: boolean,
    snapshot: BattleSnapshot,
    noEscape: boolean,
  ): BattleHeroOutcome[] {
    return resolveHeroFates({
      roster: simulation.heroRoster(),
      fledNames: new Set<string>(simulation.getFledHeroNames()),
      victory,
      advantageRatio:
        snapshot.initialAttackerPower / Math.max(1, snapshot.initialDefenderPower),
      ...(noEscape ? { noEscape: true } : {}),
      rng: this.rng,
    });
  }

  /**
   * Simulation options shared by live and restored battles. The Last Stand
   * reinforcement provider picks a Hero identity the same way normal slots
   * do — an owed fled veteran may answer the call (hijack chance), otherwise
   * a fresh name joins — never duplicating anyone already on this field.
   */
  private makeSimulationOptions(
    target: TargetDefinition,
    rolledDefenderArmy: readonly RolledArmyGroup[],
    noRetreat: boolean,
  ): BattleSimulationOptions {
    const usedNames = new Set<string>(
      rolledDefenderArmy
        .filter((group) => group.isHero === true)
        .map((group) => group.name.toLowerCase()),
    );
    for (const fled of this.fledHeroes) usedNames.add(fled.name.toLowerCase());

    // Grudges old enough to answer at THIS target (never the one they fled).
    let eligibleFled = this.fledHeroes.filter((fled) => fled.fledOrder < target.order);

    return {
      externalAttackerModifier: this.getAttackerModifier(),
      rng: this.rng,
      // Zombie Plague (Necromancy research) is consulted per battle so a
      // mid-run research purchase applies from the next assault onward.
      ...(this.isZombiePlagueActive !== null && this.isZombiePlagueActive()
        ? { zombiePlague: true }
        : {}),
      // Age-final battles lock the retreat valve: Heroes cannot flee a
      // battlefield that has nowhere beyond it.
      ...(noRetreat ? { noRetreat: true } : {}),
      reinforcement: {
        buildHero: () => {
          if (
            eligibleFled.length > 0 &&
            this.rng() < NEMESIS_HIJACK_CHANCE &&
            !usedNames.has(eligibleFled[0].name.toLowerCase())
          ) {
            const veteran = eligibleFled[0];
            eligibleFled = eligibleFled.slice(1);
            return enemyGroupToInput({
              ...createHeroForTarget(
                { combatPower: target.combatPower, order: target.order },
                veteran.name,
                true,
              ),
              count: 1,
              isReturningNemesis: true,
            });
          }
          const freshName =
            this.drawHeroName(usedNames) ??
            pickUnique(this.heroNames, usedNames, this.rng) ??
            'Hero';
          usedNames.add(freshName.toLowerCase());
          return enemyGroupToInput({
            ...createHeroForTarget(
              { combatPower: target.combatPower, order: target.order },
              freshName,
              false,
            ),
            count: 1,
          });
        },
      },
    };
  }

  /** Builds the standing-garrison preview shown on target cards. */
  private armyPreview(targetId: string): CombatTargetView['army'] {
    const target = this.age.targets.find((entry) => entry.id === targetId);
    if (target === undefined) return [];
    return target.army
      .map((entry) => {
        const def = getEnemyUnit(entry.unitId);
        return { name: def !== null ? def.name : entry.unitId, count: entry.quantity };
      })
      .filter((entry) => entry.count > 0);
  }

  private persist(): void {
    let battle: SavedBattle | null = null;
    if (this.simulation !== null && this.deployment !== null && this.lastSnapshot !== null) {
      battle = {
        ageId: this.age.id,
        targetId: this.simulation.targetId,
        deployedArmy: this.deployment.map((group) => ({ ...group })),
        attackerPower: this.deployment.reduce(
          (sum, group) => sum + group.count * group.combatPowerEach,
          0,
        ),
        startedAtMs: this.now(),
      };
    }
    this.saves.save({
      v: SAVE_SCHEMA_VERSION,
      ageId: this.age.id,
      clearedInAge: this.clearedInAge,
      battle,
      fledHeroes: this.fledHeroes,
      heroDeck: this.nameDeck?.serialize() ?? [],
      survivingDefenders: Object.fromEntries(this.standingDefenders),
    });
  }

  private publish(): void {
    const age = this.age;
    const targets: CombatTargetView[] = age.targets.map((target, index) => ({
      id: target.id,
      name: target.name,
      enemyPower: target.combatPower,
      status:
        index < this.clearedInAge
          ? 'cleared'
          : index === this.clearedInAge
            ? 'current'
            : 'locked',
      loot: {
        bone: target.loot.bone ?? 0,
        flesh: target.loot.flesh ?? 0,
        iron: target.loot.iron ?? 0,
      },
      army: this.armyPreview(target.id),
      terrain: target.terrain,
      flavorText: target.flavorText,
    }));

    const frontier = this.frontierTarget;
    const currentTargetId = frontier !== null ? frontier.id : null;
    const conquered = this.awaitingAdvance;

    let activeBattleView: ActiveBattleView | null = null;
    if (
      this.simulation !== null &&
      this.lastSnapshot !== null &&
      !this.lastSnapshot.complete
    ) {
      const snapshot = this.lastSnapshot;
      activeBattleView = {
        targetId: snapshot.targetId,
        targetName: snapshot.targetName,
        attackerPower: snapshot.attackerPower,
        defenderPower: snapshot.defenderPower,
        initialAttackerPower: snapshot.initialAttackerPower,
        initialDefenderPower: snapshot.initialDefenderPower,
        attackerForces: [...snapshot.attackerForces],
        defenderForces: [...snapshot.defenderForces],
        attackerCasualties: snapshot.attackerCasualties,
        defenderCasualties: snapshot.defenderCasualties,
        momentum: snapshot.momentum,
        elapsedSeconds: snapshot.elapsedSeconds,
        heroCount: snapshot.heroCount,
        complete: snapshot.complete,
        events: [...snapshot.events],
      };
    }

    const payload: CombatChangedPayload = {
      phase:
        this.simulation !== null ? 'battle' : this.lastResult !== null ? 'result' : 'idle',
      eraName: age.name,
      eraId: age.id,
      eraConquered: conquered,
      nextEraName: conquered ? (AGES[this.ageIndex + 1]?.name ?? null) : null,
      conqueredAges: this.conqueredAges,
      totalAges: TOTAL_AGES,
      targets,
      currentTargetId,
      clearedCount: this.clearedInAge,
      battle: activeBattleView,
      result: this.lastResult,
    };

    this.events.emit<CombatChangedPayload>(CombatEvents.Changed, payload);
  }
}

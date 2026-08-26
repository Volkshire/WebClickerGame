export type BattleOutcomeType = 'victory' | 'defeat';

export type Momentum = 'attacker' | 'defender' | 'even';

import type { AbilityTier } from './abilities';
import type { UnitTag, UnitType } from './unitTypes';

export interface DeployedGroup {
  unitId: string;
  name: string;
  count: number;
  combatPowerEach: number;
  /** Unit classification used by weakness interactions. */
  type?: UnitType;
  tags?: readonly UnitTag[];
}

export interface BattleEventView {
  id: number;
  /**
   * 'hero' marks Hero arrival beats (rendered in gold); 'tactic' marks
   * Commander Tactics / ability activations.
   */
  kind: 'start' | 'momentum' | 'casualties' | 'attrition' | 'climax' | 'hero' | 'tactic';
  message: string;
  /** Ability rarity band; high tiers get distinct log styling. */
  tier?: AbilityTier;
}

/** Surviving/loss counts for one unit type on one side. */
export interface BattleForceView {
  unitId: string;
  name: string;
  deployed: number;
  surviving: number;
  casualties: number;
}

/**
 * Live battle state while combat is running. The UI reads this directly;
 * no fake progress bar is used.
 */
export interface ActiveBattleView {
  targetId: string;
  targetName: string;
  /** Current effective power for each side. */
  attackerPower: number;
  defenderPower: number;
  /** Effective power at first contact; power bars scale against these. */
  initialAttackerPower: number;
  initialDefenderPower: number;
  attackerForces: BattleForceView[];
  defenderForces: BattleForceView[];
  attackerCasualties: number;
  defenderCasualties: number;
  momentum: Momentum;
  elapsedSeconds: number;
  /** Living enemy Heroes right now. */
  heroCount: number;
  complete: boolean;
  events: BattleEventView[];
}

/** End-of-battle fate of one enemy Hero. */
export interface BattleHeroOutcome {
  name: string;
  killed: boolean;
  fled?: boolean;
}

export interface BattleResult {
  targetId: string;
  targetName: string;
  outcome: BattleOutcomeType;
  attackerBasePower: number;
  defenderBasePower: number;
  attackerEffectivePower: number;
  defenderEffectivePower: number;
  /** Enemies destroyed (abstract defense points). */
  defenderCasualties: number;
  /**
   * Resources awarded by this battle's outcome: loot table × enemy casualties
   * on victory, null on defeat or when nothing was earned. Reporting only —
   * the wiring layer performs the actual grants.
   */
  lootGained: LootAmounts | null;
  /**
   * Heroes physically standing at battle end (0 on victory). Drives the
   * defeat-transcript presence banner so it can never contradict the
   * hero-fate lines beside it.
   */
  standingHeroCount: number;
  /**
   * Share of each side's DEPLOYED force still standing at battle end
   * (0..1). Powers collapse to zero once a side is wiped, so the defeat
   * transcript's bars use survival shares instead.
   */
  finalAttackerStrength: number;
  finalDefenderStrength: number;
  /**
   * Hero names attributed with wiping the legion on DEFEAT (empty/absent
   * when the garrison itself landed the final blow, or on victory).
   */
  wipedByHeroes?: readonly string[];
  /** Fate of every enemy Hero that took part in this battle. */
  heroOutcome: BattleHeroOutcome[];
  deployedArmy: DeployedGroup[];
  survivingArmy: DeployedGroup[];
  casualties: DeployedGroup[];
  durationSeconds: number;
  /**
   * Full battle transcript INCLUDING the terminal tick's beats (the decisive
   * climax line and any same-tick hero/burst lines). The simulation's last
   * publish carries `battle === null`, so without this carried snapshot the
   * frozen log would end one tick early and never show the punchline.
   */
  transcriptEvents?: BattleEventView[];
}

export interface LootAmounts {
  bone: number;
  flesh: number;
  iron: number;
}

/** Campaign status of one combat target. */
export type TargetStatus = 'current' | 'cleared' | 'locked';

export type TerrainType = 
  | 'plains' 
  | 'forest' 
  | 'hills' 
  | 'mountains' 
  | 'settlement'
  | 'walled-settlement'
  | 'fortress';

/** One stack of a target's standing garrison, for the UI preview. */
export interface TargetArmyEntry {
  name: string;
  count: number;
}

export interface CombatTargetView {
  id: string;
  name: string;
  /** Defender combat power. */
  enemyPower: number;
  status: TargetStatus;
  /** Resources granted per enemy casualty (0 when none). */
  loot: { bone: number; flesh: number; iron: number };
  /** The target's standing garrison (Heroes roll per battle, not shown). */
  army: TargetArmyEntry[];
  /** Target terrain type. */
  terrain?: TerrainType;
  /** Optional flavor text about the target. */
  flavorText?: string;
}

export interface CombatChangedPayload {
  phase: 'idle' | 'battle' | 'result';
  /** Display name of the current Age. */
  eraName: string;
  /** Stable id of the current Age (save/lookup key). */
  eraId: string;
  /**
   * True when every target of the current Age is cleared but a next Age
   * still exists — the player must press the advance action to proceed.
   */
  eraConquered: boolean;
  /** Display name of the following Age while `eraConquered` (null otherwise). */
  nextEraName: string | null;
  /** How many Ages have been fully conquered so far. */
  conqueredAges: number;
  /** Total number of implemented Ages. */
  totalAges: number;
  /** Every campaign target of the CURRENT Age, in progression order. */
  targets: CombatTargetView[];
  /** Id of the frontier target the campaign advances through; null when conquered. */
  currentTargetId: string | null;
  /** How many targets of the current Age have been cleared vs its length. */
  clearedCount: number;
  battle: ActiveBattleView | null;
  result: BattleResult | null;
}

export const CombatEvents = {
  Changed: 'combat:changed',
  BattleEnded: 'combat:battle-ended',
} as const;

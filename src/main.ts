import './style.css';
import { AppEvents, Application } from './core/Application';
import type { UpdatePayload } from './core/Application';
import { SaveManager, isSupportedSchemaVersion, SAVE_SCHEMA_VERSION, suspendPersistence } from './core/SaveManager';
import { SessionGuard } from './core/SessionGuard';
import { probeStorage, requestPersistentStorage } from './core/StorageHealth';
import { PersistenceCoordinator, PROFILE_STORAGE_KEY } from './core/PersistenceCoordinator';
import { AlertBanner } from './ui/AlertBanner';
import { InitScreen } from './ui/InitScreen';
import { ClickerSystem } from './systems/clicker/ClickerSystem';
import { ClickerView } from './systems/clicker/ClickerView';
import { ClickerEvents } from './systems/clicker/types';
import type { ClickerChangedPayload } from './systems/clicker/types';
import { LegionSystem } from './systems/legion/LegionSystem';
import { LegionView } from './systems/legion/LegionView';
import { LegionEvents } from './systems/legion/types';
import type { ArmyUnitGroup, LegionChangedPayload } from './systems/legion/types';
import { getUnitDef, UNIT_DEFS } from './systems/legion/units';
import type { UnitDefinition } from './systems/legion/units';
import { payableCount, scaledUnitCost } from './systems/legion/afford';
import { takeFromArmy } from './systems/legion/deployment';
import { ResourceSystem } from './systems/resources/ResourceSystem';
import { ResourceEvents } from './systems/resources/types';
import type { ResourceChangedPayload, ResourceId } from './systems/resources/types';
import { PrestigeSystem } from './systems/prestige/PrestigeSystem';
import { PrestigeView } from './systems/prestige/PrestigeView';
import { PrestigeShopView } from './systems/prestige/PrestigeShopView';
import { PrestigeEvents } from './systems/prestige/types';
import type { PrestigeChangedPayload } from './systems/prestige/types';
import { AGE_MILESTONE_POINTS, achievementSourceId, ageMilestoneSourceId } from './systems/prestige/sources';
import { AchievementSystem } from './systems/achievements/AchievementSystem';
import { AchievementView } from './systems/achievements/AchievementView';
import { AchievementEvents } from './systems/achievements/types';
import type {
  AchievementsChangedPayload,
  AchievementCompletedPayload,
  GameStatsSnapshot,
} from './systems/achievements/types';
import { CombatSystem } from './systems/combat/CombatSystem';
import { CombatView } from './systems/combat/CombatView';
import { CombatEvents } from './systems/combat/types';
import type { BattleResult, CombatChangedPayload } from './systems/combat/types';
import { BUILT_IN_HERO_NAMES, mergeNamesFile } from './systems/combat/heroNames';
import type { HeroNamePools } from './systems/combat/heroNames';
import { BUILT_IN_MECH_NAMES, mergeMechNamesFile } from './systems/combat/mechNames';
import { AGES, getAgeByIndex } from './systems/combat/world';
import { TabController } from './ui/Tabs';
import { BuildingSystem } from './systems/buildings/BuildingSystem';
import type { BuildingCurrency, BuildingCosts } from './systems/buildings/types';
import { BuildingEvents } from './systems/buildings/types';
import type { BuildingsChangedPayload } from './systems/buildings/types';
import { BuildingView } from './systems/buildings/BuildingView';
import { NecromancySystem } from './systems/necromancy/NecromancySystem';
import { NecromancyView } from './systems/necromancy/NecromancyView';
import { NecromancyEvents } from './systems/necromancy/types';
import type { NecromancyChangedPayload } from './systems/necromancy/types';
import {
  KNIGHT_SQUIRE_UPGRADE_ID,
  NECROMANCY_UNLOCK_CLEARS,
  ZOMBIE_PLAGUE_UPGRADE_ID,
  squiresFor,
} from './systems/necromancy/necromancy';
import { formatNumber } from './ui/format';

const appRoot = document.querySelector<HTMLElement>('#app');
if (appRoot === null) throw new Error('#app root element not found');

const screen = new InitScreen(appRoot);
const app = new Application();
const tabs = new TabController(appRoot);

// Visible warnings for save-threatening conditions. Console errors alone are
// how progress loss stayed invisible for players.
const banner = new AlertBanner(document.body);

// Boot-time storage health: private windows / blocked site data make every
// save fail silently — say so up front instead.
const storageProbe = probeStorage();
screen.setInfo('origin', `Origin · ${location.origin}`);
screen.setInfo(
  'storage',
  storageProbe.available ? 'Storage · OK' : `Storage · BLOCKED (${storageProbe.reason})`,
  storageProbe.available,
);
if (!storageProbe.available) {
  banner.show(
    'storage-blocked',
    'Browser storage is unavailable, so progress will NOT be saved this session.',
    'error',
  );
}
// Best-effort request so browsers deprioritize evicting our saves.
void requestPersistentStorage().then((persisted) => {
  if (persisted === null) return;
  screen.setInfo('persist', persisted ? 'Persistence · granted' : 'Persistence · best-effort');
});

/** Shared SaveManager hook: any failed write raises the visible banner. */
function onStorageWriteError(): void {
  banner.show(
    'storage-write',
    'Saving FAILED — recent progress may not persist. Check storage permissions or free space.',
    'error',
  );
}

// Detects a second live instance writing to the same storage (stray tab),
// which previously resurrected pre-Prestige saves over reset ones.
const sessionGuard = new SessionGuard(
  new SaveManager('webclickergame.session'),
  Date.now,
  () => {
    banner.show(
      'multi-instance',
      'Another game tab/window is running and may overwrite saves. Close extra tabs.',
      'warning',
      15000,
    );
  },
);

// Systems keep their existing local save/readback contracts, but these
// managers are memory-backed. PersistenceCoordinator writes their complete
// snapshot as the application's single durable profile.
const managedSaveOptions = { persistent: false };
const clickerSaves = new SaveManager('webclickergame.clicker', onStorageWriteError, managedSaveOptions);
const legionSaves = new SaveManager('webclickergame.legion', onStorageWriteError, managedSaveOptions);
const resourceSaves = new SaveManager('webclickergame.resources', onStorageWriteError, managedSaveOptions);
const prestigeSaves = new SaveManager('webclickergame.prestige', onStorageWriteError, managedSaveOptions);
const achievementSaves = new SaveManager('webclickergame.achievements', onStorageWriteError, managedSaveOptions);
const combatSaves = new SaveManager('webclickergame.combat', onStorageWriteError, managedSaveOptions);
const buildingSaves = new SaveManager('webclickergame.buildings', onStorageWriteError, managedSaveOptions);
const necromancySaves = new SaveManager('webclickergame.necromancy', onStorageWriteError, managedSaveOptions);
const uiPrefs = new SaveManager('webclickergame.ui', onStorageWriteError, managedSaveOptions);

const view = new ClickerView(appRoot);
const clicker = new ClickerSystem(app.events, clickerSaves, Date.now, {
  // Permanent Prestige Shop boons flow into the economy through these
  // providers; the clicker system never knows the shop exists.
  // (Closures are lazy: `prestige` below is initialized before any read.)
  getClickPowerFlat: () => prestige.effects.soulsPerClickFlat,
  getSoulHarvestMultiplier: () => prestige.effects.soulHarvestMultiplier,
  getSoulGenerationMultiplier: () => prestige.effects.soulGenerationMultiplier,
  getStartingGeneratorOwned: () => prestige.effects.startingGeneratorOwned,
});

const legionView = new LegionView(appRoot);
const legion = new LegionSystem(app.events, legionSaves);

const resources = new ResourceSystem(app.events, resourceSaves);

const prestigeView = new PrestigeView(appRoot);
const prestige = new PrestigeSystem(app.events, prestigeSaves);
const prestigeShopView = new PrestigeShopView(appRoot);

const achievementSystem = new AchievementSystem(
  app.events,
  achievementSaves,
);
const achievementView = new AchievementView(appRoot);

const combatView = new CombatView(appRoot);
const combat = new CombatSystem(app.events, combatSaves, {
  // Permanent Prestige bonuses flow into combat through this provider;
  // the combat system itself never knows Prestige exists.
  getAttackerModifier: () => prestige.effects.attackerDamageMultiplier,
  // Zombie Plague (Necromancy research) is read per battle; lazy closure
  // because `necromancy` below is created after the combat system.
  isZombiePlagueActive: () => necromancy.isOwned(ZOMBIE_PLAGUE_UPGRADE_ID),
});

// UI preferences (QOL toggles) — not gameplay state, so parsing is lenient:
// a missing or corrupt blob just falls back to the defaults.
interface UiPrefsBlob {
  switchToWorldOnAttack?: boolean;
}
function restoreUiPrefs(): void {
  const raw = uiPrefs.load();
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return;
  if (!isSupportedSchemaVersion(raw as Record<string, unknown>)) return;
  const prefs = raw as UiPrefsBlob;
  if (typeof prefs.switchToWorldOnAttack === 'boolean') {
    combatView.setAutoSwitchToWorld(prefs.switchToWorldOnAttack);
  }
}

// Authoritative balances for building purchases; the BuildingSystem itself
// never touches currency storage directly.
function stockOf(currency: BuildingCurrency): number {
  return currency === 'souls' ? clicker.souls : resources.getAmount(currency);
}

function currentStocks() {
  return {
    souls: clicker.souls,
    bone: resources.getAmount('bone'),
    flesh: resources.getAmount('flesh'),
    iron: resources.getAmount('iron'),
  };
}

const buildings = new BuildingSystem(app.events, buildingSaves, {
  transactor: {
    canAfford(costs) {
      return Object.entries(costs).every(
        ([currency, amount]) => stockOf(currency as BuildingCurrency) >= (amount ?? 0),
      );
    },
    spend(costs) {
      return debitCosts(costs);
    },
  },
});

combatView.setBuildings(buildings);

function debitCosts(costs: BuildingCosts): boolean {
  for (const [currency, amount] of Object.entries(costs)) {
    if (stockOf(currency as BuildingCurrency) < (amount ?? 0)) return false;
  }
  for (const [currency, amount] of Object.entries(costs)) {
    const cost = amount ?? 0;
    if (cost <= 0) continue;
    if (currency === 'souls') clicker.spendSouls(cost);
    else resources.spend(currency as ResourceId, cost);
  }
  return true;
}

const buildingView = new BuildingView(appRoot);

// Necromancy research shares the buildings transactor: authoritative
// balances are read from their owning systems at purchase time.
const necromancy = new NecromancySystem(
  app.events,
  necromancySaves,
  {
    transactor: {
      canAfford(costs) {
        return Object.entries(costs).every(
          ([currency, amount]) => stockOf(currency as BuildingCurrency) >= (amount ?? 0),
        );
      },
      spend(costs) {
        return debitCosts(costs);
      },
    },
  },
);
const necromancyView = new NecromancyView(appRoot);

const persistence = new PersistenceCoordinator(
  new SaveManager(PROFILE_STORAGE_KEY, onStorageWriteError),
  {
    'webclickergame.clicker': clickerSaves,
    'webclickergame.legion': legionSaves,
    'webclickergame.resources': resourceSaves,
    'webclickergame.prestige': prestigeSaves,
    'webclickergame.achievements': achievementSaves,
    'webclickergame.necromancy': necromancySaves,
    'webclickergame.combat': combatSaves,
    'webclickergame.buildings': buildingSaves,
    'webclickergame.ui': uiPrefs,
  },
);

for (const saves of [
  clickerSaves,
  legionSaves,
  resourceSaves,
  prestigeSaves,
  achievementSaves,
  combatSaves,
  buildingSaves,
  necromancySaves,
  uiPrefs,
]) {
  saves.setMemorySaveListener(() => persistence.requestSave());
}

combatView.onAutoSwitchChange((enabled) => {
  uiPrefs.save({ v: SAVE_SCHEMA_VERSION, switchToWorldOnAttack: enabled });
  persistence.requestSave();
});

view.onBuyUpgrade((upgradeId) => {
  if (!clicker.buyUpgrade(upgradeId)) view.notifyDenied(upgradeId);
});

view.onBuyGenerator((generatorId) => {
  if (!clicker.buyGenerator(generatorId)) view.notifyDenied(generatorId);
});

/** Debits one unit's per-unit costs `count` times (all-or-nothing by caller). */
function debitUnitCosts(def: UnitDefinition, count: number): void {
  // The Prestige Shop's recruitment discount applies to every per-unit
  // cost; scaledUnitCost is shared with payableCount so previews and
  // actual debits always agree.
  const discount = prestige.effects.recruitCostMultiplier;
  for (const [resourceId, cost] of Object.entries(def.resourceCosts)) {
    const perUnit = cost ?? 0;
    if (perUnit > 0) resources.spend(resourceId as ResourceId, count * scaledUnitCost(perUnit, discount));
  }
  if (def.soulCost > 0) clicker.spendSouls(count * scaledUnitCost(def.soulCost, discount));
}

legionView.onRaise((unitId, amount) => {
  const def = getUnitDef(unitId);
  if (def === null || !legion.isTierUnlocked(unitId)) return;
  if (!Number.isSafeInteger(amount) || amount < 1) return;

  // Read authoritative balances straight from the owning systems so the
  // transaction can never act on stale display values.
  const count = Math.min(amount, payableCount(def, currentStocks(), prestige.effects.recruitCostMultiplier));
  if (count < 1) {
    legionView.notifyRaiseDenied(unitId);
    return;
  }

  debitUnitCosts(def, count);
  const raised = legion.addUnits(unitId, count);

  // A Knight and his Squire (Necromancy): every Death Knight raised brings
  // `level` free Skeletons along, applied bulk-safe on multi-raises.
  if (raised && unitId === 'death_knight') {
    const squires = squiresFor(necromancy.levelOf(KNIGHT_SQUIRE_UPGRADE_ID), count);
    if (squires > 0) legion.addUnits('skeleton', squires);
  }
});

/** Raises exactly one unit while affordable; returns false when not possible. */
function raiseOnce(unitId: string): boolean {
  const def = getUnitDef(unitId);
  if (def === null || !legion.isTierUnlocked(unitId)) return false;
  if (payableCount(def, currentStocks(), prestige.effects.recruitCostMultiplier) < 1) return false;

  debitUnitCosts(def, 1);
  legion.addUnits(unitId, 1);
  return true;
}

buildings.setAutoRaise((count) => {
  for (let raised = 0; raised < count; raised += 1) {
    if (!raiseOnce('wraith')) break;
  }
});

// Ossuary Auto-Raiser: raises Skeletons as production output — no per-unit
// resource cost, same pattern as Ossuary bone / Fleshworks flesh income.
buildings.setSkeletonAutoRaise((count) => {
  legion.addUnits('skeleton', count);
});

// Ossuary bone income: whole units flow into the resource system, whose
// Changed publish refreshes every dependent display.
buildings.setProduction((amounts) => {
  for (const [resourceId, amount] of Object.entries(amounts)) {
    const whole = amount ?? 0;
    if (whole > 0) resources.grant(resourceId as ResourceId, whole);
  }
});

buildingView.onBuy((buildingId) => {
  if (!buildings.buy(buildingId)) buildingView.notifyDenied(buildingId);
});

necromancyView.onBuy((upgradeId) => {
  if (!necromancy.buy(upgradeId)) necromancyView.notifyDenied(upgradeId);
});

combatView.onAttack((percent, targetId) => {
  if (combat.activeBattle) return;

  const totalUnits = armySnapshot.reduce((sum, group) => sum + group.count, 0);
  const amount = Math.floor(totalUnits * percent);
  if (amount < 1) return;

  // Preview the deployment with pure math and let the combat system accept
  // the battle BEFORE debiting the garrison — a rejected start can never
  // leak troops again (the rework's null-target bug vaporized armies this way).
  const deployed = takeFromArmy(armySnapshot, amount);
  if (deployed.length === 0) return;

  let power = 0;
  for (const group of deployed) power += group.count * group.combatPowerEach;

  if (!combat.startBattle(targetId, deployed, power)) return;

  // Same synchronous snapshot as the preview, so the committed groups are
  // identical to the ones the battle was seeded with.
  legion.deployUnits(amount);

  // QOL: jump to the battle itself (World pane) unless opted out via the
  // toggle below ATTACK. Safe unconditionally — an accepted attack requires
  // garrison > 0, so the World tab's run latch is already open.
  if (combatView.autoSwitchToWorld) tabs.select('world');
});

// QOL: after a battle resolves, recruitment lives in the Legion pane.
combatView.onReturnToLegion(() => tabs.select('legion'));

// Conquered-Age lull: any advance button loads the next Age's ladder and
// enemy pool; the combat system refuses the transition while it is not in
// the exact conquered state, so this is safe to fire freely.
combatView.onAdvanceAge(() => {
  combat.advanceAge();
});

// Prestige: persist the permanent counter first (with a read-back gate), then
// wipe every run-scoped system. A failed/quietly-losing storage aborts the
// whole action instead of destroying the run, and the modal explains why.
prestigeView.onConfirm(() => {
  // Prestige is one logical profile transition: do not persist the permanent
  // counter between its verification and the run-state resets.
  persistence.beginBatch();
  const result = prestige.perform();
  if (!result.ok) {
    persistence.endBatch(false);
    prestigeView.showFailure(result.reason ?? 'not-available');
    return;
  }

  // Run-scoped latches re-arm BEFORE the resets publish: the World tab must
  // hide again and be re-earned (first undead) in the next run.
  worldTabUnlocked = false;
  necromancyUnlockLatched = false;

  clicker.resetRun();
  resources.resetRun();
  legion.resetRun();
  combat.resetRun();
  buildings.resetRun();
  necromancy.resetRun();

  // The one-shot Flesh reveal must re-arm for the next run.
  previousFlesh = 0;

  // Purchased starting boons apply to the fresh run immediately. Their
  // publishes re-open the World tab when troops are granted — intended:
  // a legion that starts stocked has world business from the start.
  const effectsAfterReset = prestige.effects;
  if (effectsAfterReset.startingSouls > 0) clicker.grantSouls(effectsAfterReset.startingSouls);

  prestigeShopView.open();
  persistence.endBatch();
});

screen.markReady('typescript');
screen.markReady('vite');

let frames = 0;
let elapsedSeconds = 0;
let armySnapshot: ArmyUnitGroup[] = [];
let lastCombatPayload: CombatChangedPayload | null = null;
let lastLegionPayload: LegionChangedPayload | null = null;
let lastBuildingsPayload: BuildingsChangedPayload | null = null;
let lastNecromancyPayload: NecromancyChangedPayload | null = null;
let previousFlesh = 0;

// Single writer for document.title (the clicker view no longer writes it):
// composes the soul counter with a ⚔ prefix while a battle resolves.
let battleActiveForTitle = false;

// Run-scoped World-tab latch: once the player raises any undead the tab
// stays visible for the rest of the run — even while every troop is away
// in an active battle and the garrison is momentarily empty. Prestige
// resets it so a fresh run must re-earn the unlock.
let worldTabUnlocked = false;
/** Necromancy stays unlocked for the rest of the run once earned (see below). */
let necromancyUnlockLatched = false;

function applyTitle(souls: number): void {
  document.title = `${battleActiveForTitle ? '⚔ ' : ''}${formatNumber(souls)} Souls · Endless Souls`;
}

function refreshCombatPanel(): void {
  if (lastCombatPayload !== null) combatView.render(lastCombatPayload, armySnapshot);
}

function renderLegionPanel(): void {
  if (lastLegionPayload !== null) {
    // Balances are read from their owning systems, so affordability previews
    // and actual purchases always share one source of truth.
    legionView.render(
      lastLegionPayload,
      clicker.souls,
      resources.getAmount('bone'),
      resources.getAmount('flesh'),
      resources.getAmount('iron'),
    );
  }
}

/**
 * Necromancy panel unlocks at 4 campaign clears. Latched per run: the
 * current-Age clear counter resets when a new Age begins, and purchased
 * research must never vanish mid-run because of it. Fully conquered Ages
 * keep counting toward the gate via their run-total ladders.
 */
function necromancyUnlocked(): boolean {
  const payload = lastCombatPayload;
  if (necromancyUnlockLatched) return true;
  if (payload === null) return false;
  if (
    payload.clearedCount >= NECROMANCY_UNLOCK_CLEARS ||
    clearedTargetsThisRun() >= NECROMANCY_UNLOCK_CLEARS
  ) {
    necromancyUnlockLatched = true;
    return true;
  }
  return false;
}

function renderNecromancyPanel(): void {
  if (lastNecromancyPayload !== null) {
    necromancyView.render(lastNecromancyPayload, currentStocks(), necromancyUnlocked(), {
      current: clearedTargetsThisRun(),
      goal: NECROMANCY_UNLOCK_CLEARS,
    });
  }
}

/**
 * Campaign targets cleared during the current run across ALL Ages: fully
 * conquered Ages contribute their whole ladder, plus the current Age's
 * cleared prefix.
 */
function clearedTargetsThisRun(): number {
  const payload = lastCombatPayload;
  if (payload === null) return 0;

  let cleared = 0;
  for (let ageIndex = 0; ageIndex < payload.conqueredAges; ageIndex += 1) {
    const age = getAgeByIndex(ageIndex);
    if (age !== null) cleared += age.targets.length;
  }
  // A frontier target exists → the current Age is not counted as conquered
  // yet, so its partial clears must be added on top.
  if (payload.currentTargetId !== null) cleared += payload.clearedCount;
  return cleared;
}

/** Feeds the achievement evaluator a snapshot of authoritative system state. */
function evaluateAchievements(): void {
  const snapshot: GameStatsSnapshot = {
    lifetimeClicks: clicker.totalClicks,
    souls: clicker.souls,
    targetsCleared: clearedTargetsThisRun(),
    legionSize: armySnapshot.reduce((sum, group) => sum + group.count, 0),
    conqueredAges: lastCombatPayload?.conqueredAges ?? combat.conqueredAges,
    prestigeCount: prestige.count,
  };
  achievementSystem.evaluate(snapshot);
}

app.events.on<UpdatePayload>(AppEvents.Update, ({ deltaSeconds }) => {
  sessionGuard.beat();
  frames += 1;
  elapsedSeconds += deltaSeconds;

  if (elapsedSeconds >= 0.5) {
    const fps = Math.round(frames / elapsedSeconds);
    screen.setDetail(`running at ${fps} fps`);
    frames = 0;
    elapsedSeconds = 0;
  }
});

app.events.on<ClickerChangedPayload>(ClickerEvents.Changed, (payload) => {
  applyTitle(payload.souls);
  view.render(payload);
  renderLegionPanel();
  buildingView.render(lastBuildingsPayload ?? { buildings: [] }, currentStocks());
  renderNecromancyPanel();
  legion.checkGeneratorUnlock(
    Object.fromEntries(payload.generators.map((generator) => [generator.id, generator.owned])),
  );
  evaluateAchievements();
});

app.events.on<BuildingsChangedPayload>(BuildingEvents.Changed, (payload) => {
  lastBuildingsPayload = payload;
  buildingView.render(payload, currentStocks());
});

app.events.on<NecromancyChangedPayload>(NecromancyEvents.Changed, (payload) => {
  lastNecromancyPayload = payload;
  renderNecromancyPanel();
});

app.events.on<LegionChangedPayload>(LegionEvents.Changed, (payload) => {
  lastLegionPayload = payload;
  armySnapshot = legion.getArmySnapshot();
  renderLegionPanel();
  refreshCombatPanel();
  // The tab bar reflects the unlock gate; pane visibility itself stays
  // owned by the TabController.
  // Tab visibility is progression-driven and derived from authoritative
  // system state (no separate unlock store): Legion needs its unlock latch,
  // World latches open on the first raised undead (deployments must not
  // re-lock it), Crypt opens after the first cleared target. Hidden tabs
  // leave the layout entirely.
  tabs.setHidden('legion', !payload.unlocked);
  let totalUnits = 0;
  for (const count of Object.values(payload.units)) {
    totalUnits += Number(count) ?? 0;
  }
  if (totalUnits > 0) worldTabUnlocked = true;
  tabs.setHidden('world', !worldTabUnlocked);
  // A result may have landed while World was still hidden (notify() no-ops
  // on hidden buttons). Re-apply the glow now that the tab exists so a
  // boot-restored or first-run victory isn't silently missed.
  if (
    worldTabUnlocked &&
    !tabs.isActive('world') &&
    lastCombatPayload?.phase === 'result'
  ) {
    tabs.notify('world');
  }
  evaluateAchievements();
});

app.events.on<ResourceChangedPayload>(ResourceEvents.Changed, (payload) => {
  renderLegionPanel();
  renderNecromancyPanel();

  // First receipt of Flesh reveals the Zombie in the Undead Legion.
  if (previousFlesh === 0 && payload.flesh > 0) legion.unlockUnit('zombie');
  previousFlesh = payload.flesh;
});

app.events.on<CombatChangedPayload>(CombatEvents.Changed, (payload) => {
  lastCombatPayload = payload;
  refreshCombatPanel();
  renderNecromancyPanel();

  // Tab-title battle flag; souls text refreshes on the next clicker tick.
  const nowBattling = payload.battle !== null;
  if (nowBattling !== battleActiveForTitle) {
    battleActiveForTitle = nowBattling;
    applyTitle(clicker.souls);
  }

  // World-tab glow: when a battle finishes while the player is on another
  // tab, the World tab pulses gently so they know a result awaits. Any
  // non-result publish (new battle started, etc.) clears a stale glow —
  // "a result awaits" is only true while phase is actually 'result'.
  if (!tabs.isActive('world')) {
    if (payload.phase === 'result') {
      tabs.notify('world');
    } else {
      tabs.clearNotification('world');
    }
  }

  // Prestige unlocks once ANY Age has been conquered and stays available;
  // performing it still resets the whole run to the first Age.
  prestige.setCampaignCompleted(payload.conqueredAges >= 1);
  // A resolving battle blocks the Prestige action (visible in the modal).
  prestige.setBattleActive(payload.battle !== null);

  // First-conquest Prestige milestones: every fully conquered Age of THIS
  // run reports a reward. The permanent claimed-ledger inside the prestige
  // system makes repeats (re-conquering an Age in later runs) no-ops.
  for (let ageIndex = 0; ageIndex < payload.conqueredAges; ageIndex += 1) {
    const age = getAgeByIndex(ageIndex);
    if (age !== null) {
      prestige.reportReward(ageMilestoneSourceId(age.id), AGE_MILESTONE_POINTS);
    }
  }

  evaluateAchievements();

  updateDebugAgeUI();

  // The Crypt opens once the player has proven themselves in battle and
  // stays open across Age transitions (clearedCount restarts per Age).
  tabs.setHidden('crypt', payload.conqueredAges < 1 && payload.clearedCount < 1);

  // Campaign ladder unlocks: clearing enough targets latches the next tier.
  // Idempotent, so it also catches up players who are already past a gate.
  for (const def of UNIT_DEFS) {
    const required = def.unlockAfterClears;
    if (required !== undefined && payload.clearedCount >= required) {
      legion.unlockUnit(def.id);
    }
  }
});

app.events.on<PrestigeChangedPayload>(PrestigeEvents.Changed, (payload) => {
  prestigeView.render(payload);
  prestigeShopView.render(payload);
  // 'Ascended' must react to the Prestige itself, not wait for the next
  // unrelated publish.
  evaluateAchievements();
  // The shop is always accessible from the debug panel for development.
  if (debugShopButton !== null) {
    debugShopButton.disabled = false;
    debugShopButton.title = 'Open the Prestige Shop';
  }
  if (debugPrestigeButton !== null) {
    const ready = payload.campaignCompleted && !payload.battleActive;
    debugPrestigeButton.disabled = !ready;
    debugPrestigeButton.title = ready
      ? 'Open the Prestige confirmation'
      : 'Reach the end of the world to unlock';
  }
});

app.events.on<AchievementsChangedPayload>(AchievementEvents.Changed, (payload) => {
  achievementView.render(payload);
});

// Reward routing: achievements declare rewards; this wiring layer delivers
// them. Prestige Points enter the pending pool and are banked by the next
// Prestige — the claimed ledger prevents any double payout.
app.events.on<AchievementCompletedPayload>(AchievementEvents.Completed, ({ id, reward }) => {
  if (reward.type === 'prestige-points') {
    prestige.reportReward(achievementSourceId(id), reward.amount);
  }
});

// Optional flavor config: one name per line, # comments. A missing or broken
// file is a silent fallback to the built-in pool — never a boot failure.
async function loadHeroNames(): Promise<HeroNamePools> {
  try {
    const response = await fetch('/hero-names.txt');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return mergeNamesFile(await response.text());
  } catch {
    return { custom: [], generated: BUILT_IN_HERO_NAMES };
  }
}

async function loadMechNames(): Promise<HeroNamePools> {
  try {
    const response = await fetch('/mech-names.txt');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return mergeMechNamesFile(await response.text());
  } catch {
    return { custom: [], generated: BUILT_IN_MECH_NAMES };
  }
}

app.events.on<BattleResult>(CombatEvents.BattleEnded, (result) => {
  if (result.outcome === 'victory') {
    for (const group of result.survivingArmy) {
      legion.addUnits(group.unitId, group.count);
    }
  }

  // Loot flows on BOTH outcomes (defeats pay the reduced share computed by
  // the combat system). Amounts were computed by combat; older targets keep
  // producing forever. The campaign itself advances inside it too.
  // The Bone Sorting House adds +1 Bone per Bone looted.
  if (result.lootGained !== null) {
    const sortingHouseBuilt = buildings.isBuilt('bone-sorting-house');
    for (const [resourceId, amount] of Object.entries(result.lootGained)) {
      let gained = amount ?? 0;
      if (sortingHouseBuilt && resourceId === 'bone') gained *= 2;
      if (gained > 0) resources.grant(resourceId as ResourceId, gained);
    }
  }

  // Soul Net: every enemy kill feeds the house one soul — wins and losses.
  if (buildings.isBuilt('soul-net') && result.defenderCasualties > 0) {
    clicker.grantSouls(result.defenderCasualties);
  }
});

// Flush listeners registered by systems update their memory-backed blobs
// first; this final listener then commits their one coherent profile.
app.events.on(AppEvents.Flush, () => persistence.requestSave());

/** One system's boot-restore outcome, for the failure summary. */
interface RestoreOutcome {
  system: string;
  ok: boolean;
}

/**
 * Restores one system in isolation. A throwing system (e.g. a broken view
 * handler during its publish) used to abort the WHOLE cascade — every later
 * system then stayed at zero and its next save wiped real progress. Now each
 * system loads or fails independently.
 *
 * A restore() returning false (parse failure) is also treated as a failed
 * restore. Failed critical restores must never cause default in-memory state
 * to overwrite the last known-good canonical save.
 * Some systems return void (always succeed); others return boolean.
 */
function guardedRestore(outcomes: RestoreOutcome[], name: string, restore: () => boolean | void): void {
  try {
    const result = restore();
    const ok = result !== false; // void -> true, false -> false, true -> true
    outcomes.push({ system: name, ok });
    if (!ok) {
      console.error(`Boot: restoring "${name}" FAILED — parse returned false, state reset to defaults.`);
    }
  } catch (error) {
    outcomes.push({ system: name, ok: false });
    console.error(`Boot: restoring "${name}" FAILED — its save was left untouched on disk.`, error);
  }
}

function reportRestoreFailures(outcomes: RestoreOutcome[]): void {
  const failed = outcomes.filter((entry) => !entry.ok).map((entry) => entry.system);
  if (failed.length === 0) return;
  banner.show(
    'restore-failed',
    `${failed.join(', ')} failed to load. Their saves were NOT deleted — reload the page; do NOT prestige until everything loads.`,
    'error',
  );
}

app.events.on(AppEvents.Start, async () => {
  screen.markReady('loop');
  sessionGuard.checkOnBoot();

  // Hydrate every memory-backed system save before the existing, deliberately
  // ordered system restores run. Legacy deployed blobs are accepted once and
  // converted to the canonical profile after a successful restore.
  persistence.beginBatch();
  const profileRestore = persistence.restore();
  restoreUiPrefs();
  if (profileRestore.source === 'invalid') {
    banner.show('profile-invalid', `Profile failed to load: ${profileRestore.problem}`, 'error');
  }

  const outcomes: RestoreOutcome[] = [];
  // The permanent ledgers MUST restore before EVERYTHING else: every
  // system's restore publishes changes whose handlers can report rewards
  // into prestige (legion -> First Recruit, clicker -> Soul Hoard,
  // combat -> Age milestones). Against a default-state prestige such a
  // report SAVES a {count: 0, points: 0} blob OVER the real one —
  // permanently wiping Prestige progress on reload. Restored first, the
  // claimed-ledger/pending dedupe makes those same reports harmless
  // no-ops or correct pending re-adds.
  guardedRestore(outcomes, 'prestige', () => prestige.restore());
  guardedRestore(outcomes, 'achievements', () => achievementSystem.restore());

  // Catch-up routing: achievements completed in earlier sessions re-report
  // their Prestige Point rewards. The prestige claimed-ledger ignores
  // anything already paid out, so this can never double-bank a reward.
  for (const entry of achievementSystem.getCompletedPrestigePointRewards()) {
    prestige.reportReward(achievementSourceId(entry.id), entry.amount);
  }

  // Necromancy MUST restore before combat: a saved battle resolves
  // instantly at boot and consults the Zombie Plague flag.
  guardedRestore(outcomes, 'necromancy', () => necromancy.restore());

  // Legion MUST restore before the clicker: clicker.restore() can fire the
  // Soul Siphon generator gate (checkGeneratorUnlock), which saves legion
  // state. If the legion hasn't loaded yet, that save wipes the player's
  // troops while keeping the unlock — permanently disabling ATTACK.
  guardedRestore(outcomes, 'legion', () => legion.restore());
  guardedRestore(outcomes, 'clicker', () => clicker.restore());
  guardedRestore(outcomes, 'resources', () => resources.restore());
  guardedRestore(outcomes, 'buildings', () => buildings.restore());

  // Names must be installed before combat restores: a saved battle resolves
  // instantly and rolls its Heroes against the pool.
  combat.setHeroNames(await loadHeroNames());
  combat.setMechNames(await loadMechNames());
  // Combat restores LAST so its publish reports Age milestones onto the
  // fully restored permanent ledgers (see ordering note above).
  guardedRestore(outcomes, 'combat', () => combat.restore());

  updateDebugAgeUI();

  reportRestoreFailures(outcomes);

  try {
    const offlineGain = clicker.claimOfflineProgress();
    if (offlineGain > 0) view.showOfflineGain(offlineGain);
  } catch (error) {
    console.error('Boot: claiming offline progress failed.', error);
  }

  if (profileRestore.source === 'legacy') {
    persistence.migrateLegacy();
  }
  // Canonical restores may have normalized a legacy system sub-blob during
  // restore. Save that coherent final snapshot once, after all systems ran.
  // Only persist if ALL critical systems restored successfully — a failed
  // critical restore leaving default state must never overwrite the canonical
  // profile with zeros.
  const criticalSystems = [
    'prestige',
    'achievements',
    'necromancy',
    'legion',
    'clicker',
    'resources',
    'buildings',
    'combat',
  ] as const;
  const allCriticalOk = criticalSystems.every((sys) =>
    outcomes.find((o) => o.system === sys)?.ok ?? false
  );
  persistence.endBatch(profileRestore.source !== 'legacy' && allCriticalOk);
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    // Tab hidden (switch, minimize, mobile background): persist immediately.
    // beforeunload alone is unreliable on mobile — the OS can discard the
    // tab without firing it.
    app.events.emit(AppEvents.Flush);
    return;
  }

  const offlineGain = clicker.claimOfflineProgress();
  if (offlineGain > 0) view.showOfflineGain(offlineGain);
});

// Complements beforeunload: fires when the document is being unloaded even
// on mobile navigation away.
window.addEventListener('pagehide', () => {
  app.events.emit(AppEvents.Flush);
});

clicker.attach(view.button);

// ======== Manual save backups (Export / Import) ========
const exportButton = document.querySelector<HTMLButtonElement>('#save-export');
const importButton = document.querySelector<HTMLButtonElement>('#save-import');
const importFileInput = document.querySelector<HTMLInputElement>('#save-import-file');

exportButton?.addEventListener('click', () => {
  const filename = persistence.downloadBackup();
  banner.show('backup-export', `Backup saved as ${filename}`, 'info', 6000);
});

importButton?.addEventListener('click', () => importFileInput?.click());

importFileInput?.addEventListener('change', async () => {
  const file = importFileInput.files?.[0];
  importFileInput.value = ''; // allow re-selecting the same file later
  if (file === undefined) return;

  let text: string;
  try {
    text = await file.text();
  } catch (error) {
    console.error('Save import: reading the selected file failed.', error);
    banner.show('backup-import', 'Import failed: could not read the file.', 'error');
    return;
  }

  const parsed = persistence.parseImport(text);
  if (!parsed.ok || parsed.profile === null) {
    banner.show('backup-import', `Import failed: ${parsed.problem}`, 'error');
    return;
  }

  // Ask BEFORE writing: a cancel must leave the current saves untouched.
  const confirmed = window.confirm(
    `Restore the complete profile from "${file.name}"?\n\n` +
      'This OVERWRITES your current progress with the backup.',
  );
  if (!confirmed) return;

  if (!persistence.commitImport(parsed.profile)) {
    banner.show('backup-import', 'Import failed: storage refused the writes.', 'error');
    return;
  }

  // The imported canonical profile is now authoritative. Block the unload cascade
  // (Flush/Stop saves) from overwriting them with this session's stale
  // state, then reload so the normal boot-restore path takes over.
  suspendPersistence();
  banner.show(
    'backup-import',
    'Restored the complete profile. Reloading…',
    'info',
    6000,
  );
  location.reload();
});

// ======== Debug: Prestige Shop (post-Prestige only) ========
const debugShopButton = document.querySelector<HTMLButtonElement>('#debug-prestige-shop');

// ======== Debug: Prestige (opens confirmation modal) ========
const debugPrestigeButton = document.querySelector<HTMLButtonElement>('#debug-prestige');

// ======== Debug: Age Navigation ========
const debugAgeAdvance = document.querySelector<HTMLButtonElement>('#debug-age-advance');
const debugAgeRegress = document.querySelector<HTMLButtonElement>('#debug-age-regress');
const debugAgeReset = document.querySelector<HTMLButtonElement>('#debug-age-reset');
const debugAgeStatus = document.querySelector<HTMLElement>('#debug-age-status');

function updateDebugAgeUI(): void {
  const payload = lastCombatPayload;
  if (!payload) return;
  const atFirst = payload.conqueredAges === 0 && payload.clearedCount === 0;
  const atLast = payload.conqueredAges >= payload.totalAges - 1 && payload.eraConquered;

  debugAgeAdvance!.disabled = atLast;
  debugAgeRegress!.disabled = atFirst;
  debugAgeAdvance!.title = atLast ? 'Already at final age' : `Advance to ${AGES[payload.conqueredAges + 1]?.name ?? 'next age'}`;
  debugAgeRegress!.title = atFirst ? 'Already at first age' : `Regress to ${AGES[payload.conqueredAges - 1]?.name ?? 'previous age'}`;

  if (debugAgeStatus) {
    debugAgeStatus.textContent = `Age: ${payload.eraName} (${payload.conqueredAges} / ${payload.totalAges - 1})`;
  }
}

debugShopButton?.addEventListener('click', () => {
  prestigeShopView.open();
});

debugPrestigeButton?.addEventListener('click', () => {
  prestigeView.open();
});

debugAgeAdvance?.addEventListener('click', () => {
  combat.debugAdvanceAge();
  updateDebugAgeUI();
});

debugAgeRegress?.addEventListener('click', () => {
  combat.debugRegressAge();
  updateDebugAgeUI();
});

debugAgeReset?.addEventListener('click', () => {
  combat.debugResetAge();
  updateDebugAgeUI();
});

prestigeShopView.onBuy((itemId) => {
  prestige.buyShopItem(itemId); // publish re-renders counter + row states
});

// ======== Debug: total reset (every save, incl. Prestige) ========
const totalResetButton = document.querySelector<HTMLButtonElement>('#save-total-reset');

totalResetButton?.addEventListener('click', () => {
  // Deliberately brutal debug tool: run saves, Prestige counter, UI prefs
  // and the session heartbeat all go. The confirm is the only guard —
  // players are expected to Export first if they care about the state.
  const confirmed = window.confirm(
    'TOTAL RESET\n\n' +
      'This wipes EVERY saved progress:\n' +
      'souls, upgrades, legion, resources, buildings,\n' +
      'necromancy research, the whole campaign, achievements,\n' +
      'Prestige points AND your Prestige Shop purchases.\n\n' +
      'Export a backup first if you want to keep anything. Continue?',
  );
  if (!confirmed) return;

  // Block the unload cascade (Flush/Stop saves on pagehide) from
  // resurrecting the just-wiped keys with this session's stale state.
  suspendPersistence();

  const removed = persistence.reset();
  banner.show(
    'backup-reset',
    `Total reset: ${removed.length} save section(s) wiped. Reloading…`,
    'warning',
    6000,
  );
  location.reload();
});

window.addEventListener('beforeunload', () => app.stop());

app.start();

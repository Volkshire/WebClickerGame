import { AppEvents } from '../../core/Application';
import type { UpdatePayload } from '../../core/Application';
import type { EventBus } from '../../core/EventBus';
import { isSupportedSchemaVersion, SAVE_SCHEMA_VERSION } from '../../core/SaveManager';
import type { SaveManager } from '../../core/SaveManager';
import { ClickerEvents } from './types';
import type {
  ClickerChangedPayload,
  ClickerState,
  GeneratorView,
  UpgradeView,
} from './types';
import { UPGRADES, calculateExponentialCost } from './upgrades';
import { GENERATORS } from './generators';
import { formatNumber } from '../../ui/format';

const BASE_SOULS_PER_CLICK = 1;
const PASSIVE_SAVE_INTERVAL_SECONDS = 5;
const OFFLINE_CAP_MS = 8 * 60 * 60 * 1000;

/**
 * Provider seam for permanent multipliers (Prestige Shop boons), mirroring
 * how combat receives its Prestige modifier: this system never learns
 * where the numbers come from.
 */
export interface ClickerSystemOptions {
  /** Flat Souls added to every click before multipliers. */
  getClickPowerFlat?: () => number;
  /** Multiplier applied to the final per-click gain. */
  getSoulHarvestMultiplier?: () => number;
  /** Multiplier applied to passive Souls per second. */
  getSoulGenerationMultiplier?: () => number;
  /** Bonus owned count applied to every Soul Generator at 0. */
  getStartingGeneratorOwned?: () => number;
}

const INITIAL_STATE: ClickerState = {
  souls: 0,
  totalClicks: 0,
  upgrades: {},
  generators: {},
  lastSeen: null,
};

function isValidCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function parseCountMap(raw: unknown): Record<string, number> | null {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const map: Record<string, number> = {};
  for (const [id, value] of Object.entries(raw)) {
    if (!isValidCount(value)) return null;
    map[id] = value;
  }
  return map;
}

function parseSavedState(raw: unknown): ClickerState | null {
  if (raw === null || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  if (!isSupportedSchemaVersion(record)) return null;
  if (!isValidCount(record['souls']) || !isValidCount(record['totalClicks'])) return null;
  const upgrades = parseCountMap(record['upgrades']);
  if (upgrades === null) return null;
  const generators = parseCountMap(record['generators']);
  if (generators === null) return null;

  let lastSeen: number | null = null;
  const rawLastSeen = record['lastSeen'];
  if (rawLastSeen !== undefined && rawLastSeen !== null) {
    if (typeof rawLastSeen !== 'number' || !Number.isFinite(rawLastSeen) || rawLastSeen <= 0) {
      return null;
    }
    lastSeen = rawLastSeen;
  }

  return {
    souls: record['souls'],
    totalClicks: record['totalClicks'],
    upgrades,
    generators,
    lastSeen,
  };
}

export class ClickerSystem {
  private readonly events: EventBus;
  private readonly saves: SaveManager;
  private state: ClickerState = { ...INITIAL_STATE };
  private button: HTMLButtonElement | null = null;
  private pendingSouls = 0;
  private secondsSincePassiveSave = 0;
  private readonly now: () => number;
  private readonly getClickPowerFlat: () => number;
  private readonly getSoulHarvestMultiplier: () => number;
  private readonly getSoulGenerationMultiplier: () => number;
  private readonly getStartingGeneratorOwned: () => number;

  constructor(
    events: EventBus,
    saves: SaveManager,
    now: () => number = Date.now,
    options: ClickerSystemOptions = {},
  ) {
    this.events = events;
    this.saves = saves;
    this.now = now;
    this.getClickPowerFlat = options.getClickPowerFlat ?? (() => 0);
    this.getSoulHarvestMultiplier = options.getSoulHarvestMultiplier ?? (() => 1);
    this.getSoulGenerationMultiplier = options.getSoulGenerationMultiplier ?? (() => 1);
    this.getStartingGeneratorOwned = options.getStartingGeneratorOwned ?? (() => 0);

    events.on<UpdatePayload>(AppEvents.Update, ({ deltaSeconds }) => {
      this.tick(deltaSeconds);
    });

    events.on(AppEvents.Stop, () => {
      this.save();
    });

    // Page hidden (tab switch, minimize, mobile app background): persist now.
    events.on(AppEvents.Flush, () => {
      this.save();
    });
  }

  get soulsPerClick(): number {
    let gain = BASE_SOULS_PER_CLICK;
    for (const definition of UPGRADES) {
      const bonus = definition.effects.soulsPerClick ?? 0;
      if (bonus !== 0) gain += bonus * this.getLevel(definition.id);
    }
    // Permanent flat click power applies before the harvest multiplier.
    gain += Math.max(0, this.getClickPowerFlat());
    const multiplier = Math.max(0, this.getSoulHarvestMultiplier());
    return Math.max(0, Math.round(gain * multiplier));
  }

  /** Authoritative current balance for cross-system transactions. */
  get souls(): number {
    return this.state.souls;
  }

  /** Lifetime click stat; survives run resets (achievement tracking). */
  get totalClicks(): number {
    return this.state.totalClicks;
  }

  get soulsPerSecond(): number {
    let rate = 0;
    for (const definition of GENERATORS) {
      const owned = this.getOwned(definition.id);
      if (owned > 0) rate += definition.productionPerSecond * owned;
    }
    const multiplier = Math.max(0, this.getSoulGenerationMultiplier());
    return Math.max(0, Math.round(rate * multiplier));
  }

  attach(button: HTMLButtonElement): void {
    if (this.button === button) return;
    this.detach();
    this.button = button;
    button.addEventListener('click', this.harvest);
  }

  detach(): void {
    if (this.button === null) return;
    this.button.removeEventListener('click', this.harvest);
    this.button = null;
  }

  buyUpgrade(upgradeId: string): boolean {
    const definition = UPGRADES.find((entry) => entry.id === upgradeId);
    if (definition === undefined) return false;

    const level = this.getLevel(definition.id);
    const cost = calculateExponentialCost(definition, level);
    if (this.state.souls < cost) return false;

    this.state.souls -= cost;
    this.state.upgrades[definition.id] = level + 1;
    this.save();
    this.publish();
    return true;
  }

  buyGenerator(generatorId: string): boolean {
    const definition = GENERATORS.find((entry) => entry.id === generatorId);
    if (definition === undefined) return false;

    const owned = this.getOwned(definition.id);
    const cost = calculateExponentialCost(definition, owned);
    if (this.state.souls < cost) return false;

    this.state.souls -= cost;

    const diActive = this.getStartingGeneratorOwned() > 0;
    if (diActive && owned === 0) {
      this.state.generators[definition.id] = 2;
    } else {
      this.state.generators[definition.id] = owned + 1;
    }

    this.save();
    this.publish();
    return true;
  }

  spendSouls(amount: number): boolean {
    if (!Number.isFinite(amount) || amount <= 0) return false;
    if (this.state.souls < amount) return false;
    this.state.souls -= amount;
    this.save();
    this.publish();
    return true;
  }

  /** Grants souls from external systems (e.g. the Soul Net kill conversion). */
  grantSouls(amount: number): boolean {
    if (!Number.isFinite(amount) || amount <= 0) return false;
    this.state.souls += Math.floor(amount);
    this.save();
    this.publish();
    return true;
  }

  restore(): boolean {
    const parsed = parseSavedState(this.saves.load());
    if (parsed !== null) {
      this.state = parsed;
      this.pendingSouls = 0;
    }
    this.publish();
    return parsed !== null;
  }

  /** Prestige support: wipes souls, upgrades and generators; totalClicks is a lifetime stat. */
  resetRun(): void {
    this.state = {
      souls: 0,
      totalClicks: this.state.totalClicks,
      upgrades: {},
      generators: {},
      // Anchors offline progress to the reset moment.
      lastSeen: this.now(),
    };
    this.pendingSouls = 0;
    // New run, new baseline: whatever is visible at run start (the
    // first-unowned tier) is grandfathered, never auto-granted.
    this.save();
    this.publish();
  }

  claimOfflineProgress(): number {
    const lastSeen = this.state.lastSeen;
    if (lastSeen === null) return 0;

    const elapsedMs = this.now() - lastSeen;
    if (elapsedMs <= 0) return 0;

    const cappedSeconds = Math.min(elapsedMs, OFFLINE_CAP_MS) / 1000;
    const gained = Math.floor(this.soulsPerSecond * cappedSeconds);
    if (gained <= 0) return 0;

    this.state.souls += gained;
    this.state.lastSeen = this.now();
    this.save();
    this.publish();
    return gained;
  }

  private getLevel(upgradeId: string): number {
    return this.state.upgrades[upgradeId] ?? 0;
  }

  private getOwned(generatorId: string): number {
    // Raw owned counts ONLY. Dark Infrastructure no longer overlays a
    // virtual count — that made every tier visible/producing and instantly
    // satisfied the Legion's Soul Siphon gate.
    return this.state.generators[generatorId] ?? 0;
  }

  private tick(deltaSeconds: number): void {
    const rate = this.soulsPerSecond;
    if (rate <= 0 || deltaSeconds <= 0) return;

    this.pendingSouls += rate * deltaSeconds;
    this.secondsSincePassiveSave += deltaSeconds;
    this.state.lastSeen = this.now();

    const gained = Math.floor(this.pendingSouls);
    if (gained > 0) {
      this.pendingSouls -= gained;
      this.state.souls += gained;
      this.publish();
    }

    if (this.secondsSincePassiveSave >= PASSIVE_SAVE_INTERVAL_SECONDS) {
      this.secondsSincePassiveSave = 0;
      this.save();
    }
  }

  private save(): void {
    this.secondsSincePassiveSave = 0;
    this.saves.save({
      v: SAVE_SCHEMA_VERSION,
      souls: this.state.souls,
      totalClicks: this.state.totalClicks,
      upgrades: { ...this.state.upgrades },
      generators: { ...this.state.generators },
      lastSeen: this.now(),
    });
  }

  private publish(): void {
    const upgrades: UpgradeView[] = UPGRADES.map((definition) => {
      const level = this.getLevel(definition.id);
      return {
        id: definition.id,
        name: definition.name,
        level,
        cost: calculateExponentialCost(definition, level),
        effectText: definition.describe(level),
        flavor: definition.flavor,
      };
    });

    const generators: GeneratorView[] = GENERATORS.map((definition) => {
      const owned = this.getOwned(definition.id);
      return {
        id: definition.id,
        name: definition.name,
        owned,
        cost: calculateExponentialCost(definition, owned),
        effectText: `+${formatNumber(definition.productionPerSecond)} Souls per second`,
        flavor: definition.flavor,
      };
    });

    const payload: ClickerChangedPayload = {
      souls: this.state.souls,
      totalClicks: this.state.totalClicks,
      soulsPerClick: this.soulsPerClick,
      soulsPerSecond: this.soulsPerSecond,
      harvestMultiplier: this.getSoulHarvestMultiplier(),
      upgrades,
      generators,
    };

    this.events.emit<ClickerChangedPayload>(ClickerEvents.Changed, payload);
  }

  private harvest = (): void => {
    this.state.souls += this.soulsPerClick;
    this.state.totalClicks += 1;
    this.save();
    this.publish();
  };
}

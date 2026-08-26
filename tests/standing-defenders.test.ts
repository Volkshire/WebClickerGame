import { beforeEach, describe, expect, it } from 'vitest';
import { AppEvents } from '../src/core/Application';
import type { UpdatePayload } from '../src/core/Application';
import { EventBus } from '../src/core/EventBus';
import { SaveManager } from '../src/core/SaveManager';
import { CombatSystem } from '../src/systems/combat/CombatSystem';
import { CombatEvents } from '../src/systems/combat/types';
import type { CombatChangedPayload } from '../src/systems/combat/types';
import { rollTargetArmy } from '../src/systems/combat/enemyUnits';
import { AGES } from '../src/systems/combat/world';
import {
  HERO_ARRIVAL_LINES,
  RETURN_DEFENDER_LINES,
  formatFlavor,
} from '../src/systems/combat/battleFlavor';
import { mulberry } from './helpers';
import { installMemoryStorage } from './support/storage';

/**
 * Standing Defenders: Heroes that survive a failed assault hold the SAME
 * target under the SAME names until they are finally cleared. Outside Age
 * finales the roster is locked to exactly those Heroes.
 */

const ASH = AGES[0];
const HERO_TARGET_INDEX = 1; // heroChance > 0 from the second target onward
const heroTarget = ASH.targets[HERO_TARGET_INDEX];

const wraiths = (count: number) => ({
  unitId: 'wraith',
  name: 'Wraiths',
  count,
  combatPowerEach: 1,
  type: 'melee' as const,
  tags: ['spirit' as const],
});

const doomKnights = (count: number) => ({
  unitId: 'death_knight',
  name: 'Death Knights',
  count,
  combatPowerEach: 75,
  type: 'melee' as const,
  tags: ['armored' as const],
});

let storage: ReturnType<typeof installMemoryStorage>;

/** Boots a system on a fresh shim with Ash progression up to `cleared`. */
function boot(seed: number, cleared = HERO_TARGET_INDEX) {
  storage = installMemoryStorage();
  storage.seed(
    'webclickergame.combat',
    JSON.stringify({ v: 1, ageId: 'age-of-ash', clearedInAge: cleared }),
  );
  const events = new EventBus();
  const system = new CombatSystem(events, new SaveManager('webclickergame.combat'), {
    rng: mulberry(seed),
  });
  let last: CombatChangedPayload | null = null;
  events.on<CombatChangedPayload>(CombatEvents.Changed, (payload) => {
    last = payload;
  });
  // Loads the seeded progression (clearedInAge) into the system.
  system.restore();
  return {
    events,
    system,
    last: () => last,
    driveToResult: () => {
      for (let i = 0; i < 4000; i++) {
        events.emit<UpdatePayload>(AppEvents.Update, { deltaSeconds: 0.7 });
        if ((last as CombatChangedPayload | null)?.phase === 'result') return;
      }
      throw new Error('battle never reached result phase');
    },
  };
}

interface HeroSnapshot {
  /** Single-body defender stacks whose names are NOT part of the base roster. */
  names: string[];
  /** Pinned hero-kind arrival beats for this battle. */
  arrivalMessages: string[];
}

/** Starts an assault and captures which named Heroes took the field. */
function scoutHeroes(
  seed: number,
  targetIndex = HERO_TARGET_INDEX,
): { harness: ReturnType<typeof boot>; heroes: HeroSnapshot } {
  const harness = boot(seed);
  const target = ASH.targets[targetIndex];
  harness.system.startBattle(target.id, [wraiths(60)], 60);

  const battle = harness.last()?.battle;
  if (battle === null || battle === undefined) {
    return { harness, heroes: { names: [], arrivalMessages: [] } };
  }
  const rosterNames = new Set(target.army.map((entry) => entry.name));
  const names = battle.defenderForces
    .filter(
      (force) =>
        force.deployed === 1 && force.surviving === 1 && !rosterNames.has(force.name),
    )
    .map((force) => force.name);
  const arrivalMessages = battle.events
    .filter((event) => event.kind === 'hero')
    .map((event) => event.message);
  return { harness, heroes: { names, arrivalMessages } };
}

/** Finds a seed where the target's garrison rolls at least one named Hero. */
function findSeedWithHero(): number {
  for (let seed = 1; seed < 600; seed++) {
    const { harness, heroes } = scoutHeroes(seed);
    if (heroes.names.length > 0) {
      // Leave this battle UNRESOLVED: discard the harness, caller reseeds.
      void harness;
      return seed;
    }
    harness.events.emit(AppEvents.Stop);
  }
  throw new Error('no seed produced a named Hero within 600 tries');
}

const GENERIC_ARRIVALS = new Set(
  HERO_ARRIVAL_LINES.flatMap((template) =>
    ['Aldric', 'Brigid', 'Cedric'].map((hero) => formatFlavor(template, { hero })),
  ),
);

function isReturnDefenderBeat(message: string, heroName: string): boolean {
  return RETURN_DEFENDER_LINES.some(
    (template) => template.split('{hero}')[0] === message.split(heroName)[0],
  );
}

function readBlob(): { survivingDefenders?: Record<string, string[]> } {
  return JSON.parse(localStorage.getItem('webclickergame.combat') ?? '{}');
}

describe('standing defenders — roster logic (pure)', () => {
  it('lock mode places exactly the survivors, nobody else', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const army = rollTargetArmy(
        [],
        0.95,
        mulberry(seed),
        undefined,
        3,
        [],
        false,
        1000,
        undefined,
        ['Aldric'],
      );
      const heroes = army.filter((group) => group.isHero === true);
      expect(heroes.map((h) => h.name)).toEqual(['Aldric']);
      expect(heroes[0]?.isReturningDefender).toBe(true);
    }
  });

  it('caps rosters at two and dedupes case-insensitively', () => {
    const army = rollTargetArmy(
      [],
      0,
      mulberry(1),
      undefined,
      3,
      [],
      false,
      1000,
      undefined,
      ['aldric', 'ALDRIC', 'Brigid', 'Cedric'],
    );
    const heroes = army.filter((group) => group.isHero === true);
    expect(heroes.map((h) => h.name)).toEqual(['Aldric', 'Brigid']);
  });

  it('final targets keep escalation: survivors first, grudge veterans still arrive', () => {
    const army = rollTargetArmy(
      [],
      0, // no chance rolls at all
      mulberry(2),
      undefined,
      5,
      [{ name: 'Grudgeholder', fledOrder: 2 }],
      true, // Age-final: pipeline stays open
      1000,
      undefined,
      ['Aldric'],
    );
    const heroes = army.filter((group) => group.isHero === true);
    expect(heroes.map((h) => h.name)).toEqual(['Aldric', 'Grudgeholder']);
    expect(heroes[0]?.isReturningDefender).toBe(true);
    expect(heroes[1]?.isReturningNemesis).toBe(true);
  });
});

describe('standing defenders — live campaign', () => {
  beforeEach(() => {
    storage = installMemoryStorage();
  });

  it('defeat -> repeat attack faces the SAME named Hero on the defender beat', () => {
    const seed = findSeedWithHero();
    const { harness, heroes } = scoutHeroes(seed);
    const heroName = heroes.names[0]!;
    expect(heroName).toBeTruthy();

    // Lose on purpose: 60 wraiths cannot break a garrison with a Hero.
    harness.driveToResult();
    expect(harness.last()?.result?.outcome).toBe('defeat');

    // The survivor is recorded under THIS target.
    const blob = JSON.parse(localStorage.getItem('webclickergame.combat') ?? '{}') as {
      survivingDefenders?: Record<string, string[]>;
    };
    expect(blob.survivingDefenders?.[heroTarget.id]).toEqual([heroName]);

    // Repeat assault: the SAME Hero holds the field, announced on the
    // dedicated "they were waiting" beat (never generic arrival prose).
    harness.system.startBattle(heroTarget.id, [wraiths(60)], 60);
    const battle = harness.last()?.battle;
    expect(battle).toBeDefined();
    const names = battle!.defenderForces
      .filter((force) => force.deployed === 1 && force.surviving === 1)
      .map((force) => force.name);
    expect(names).toContain(heroName);
    const arrivals = battle!.events.filter((event) => event.kind === 'hero').map((e) => e.message);
    expect(arrivals.length).toBeGreaterThanOrEqual(1);
    for (const message of arrivals) {
      expect(isReturnDefenderBeat(message, heroName)).toBe(true);
      expect(GENERIC_ARRIVALS.has(message)).toBe(false);
    }

    // Roster LOCK: chained defeats keep the exact same roster.
    harness.driveToResult();
    expect(harness.last()?.result?.outcome).toBe('defeat');
    harness.system.startBattle(heroTarget.id, [wraiths(60)], 60);
    const namesThird = harness
      .last()
      ?.battle?.defenderForces.filter((force) => force.deployed === 1 && force.surviving === 1)
      .map((force) => force.name);
    expect(namesThird).toEqual(names);
  });

  it('victory clears the roster', () => {
    const seed = findSeedWithHero();
    const { harness } = scoutHeroes(seed);
    harness.driveToResult(); // defeat -> survivors recorded
    expect(harness.last()?.result?.outcome).toBe('defeat');

    // Overwhelming retaliation wipes the defenders for good. (Big enough to
    // shrug off the Hero's per-tick threat budget while resolve drains.)
    harness.system.startBattle(heroTarget.id, [doomKnights(20000)], 20000 * 75);
    harness.driveToResult();
    expect(harness.last()?.result?.outcome).toBe('victory');

    const blob = JSON.parse(localStorage.getItem('webclickergame.combat') ?? '{}') as {
      survivingDefenders?: Record<string, string[]>;
    };
    expect(blob.survivingDefenders?.[heroTarget.id]).toBeUndefined();
  });

  it('persists across a reload (new system instance restores the roster)', () => {
    const seed = findSeedWithHero();
    const first = scoutHeroes(seed);
    const heroName = first.heroes.names[0]!;
    first.harness.driveToResult(); // defeat

    // Fresh system, same storage: boot-restore must carry the roster.
    const events = new EventBus();
    const restored = new CombatSystem(events, new SaveManager('webclickergame.combat'), {
      rng: mulberry(77),
    });
    restored.restore();

    let last: CombatChangedPayload | null = null;
    events.on<CombatChangedPayload>(CombatEvents.Changed, (payload) => {
      last = payload;
    });
    restored.startBattle(heroTarget.id, [wraiths(60)], 60);
    const names = last?.battle?.defenderForces
      .filter((force) => force.deployed === 1 && force.surviving === 1)
      .map((force) => force.name);
    expect(names).toContain(heroName);
  });

  it('prestige resetRun wipes every roster', () => {
    const seed = findSeedWithHero();
    const { harness } = scoutHeroes(seed);
    harness.driveToResult(); // defeat records survivors

    harness.system.resetRun();
    const blob = JSON.parse(localStorage.getItem('webclickergame.combat') ?? '{}') as {
      survivingDefenders?: Record<string, string[]>;
    };
    expect(blob.survivingDefenders ?? {}).toEqual({});
  });
});

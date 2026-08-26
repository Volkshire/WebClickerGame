import { describe, expect, it } from 'vitest';
import {
  HERO_CLASSES,
  HERO_CLASS_LOADOUTS,
  pickHeroClass,
} from '../src/systems/combat/heroClasses';
import type { HeroClass } from '../src/systems/combat/heroClasses';
import { createHeroForTarget } from '../src/systems/combat/enemyUnits';
import { rollTargetArmy } from '../src/systems/combat/enemyUnits';
import { mulberry } from './helpers';

describe('pickHeroClass', () => {
  it('returns a class from HERO_CLASSES', () => {
    const rng = mulberry(1);
    const result = pickHeroClass([], rng);
    expect(HERO_CLASSES).toContain(result);
  });

  it('avoids classes already present in the existing array', () => {
    const rng = mulberry(2);
    for (let i = 0; i < 100; i++) {
      const result = pickHeroClass(['caster', 'ranged'], rng);
      expect(result).not.toBe('caster');
      expect(result).not.toBe('ranged');
    }
  });

  it('falls back to uniform selection when all classes are exhausted', () => {
    const rng = mulberry(3);
    const allClasses: readonly HeroClass[] = [...HERO_CLASSES];
    const counts = new Map<HeroClass, number>();
    for (let i = 0; i < 1000; i++) {
      const c = pickHeroClass(allClasses, rng);
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    for (const cls of HERO_CLASSES) {
      expect(counts.get(cls)).toBeGreaterThan(0);
    }
  });

  it('works with an empty existing array', () => {
    const rng = mulberry(4);
    for (let i = 0; i < 50; i++) {
      const result = pickHeroClass([], rng);
      expect(HERO_CLASSES).toContain(result);
    }
  });
});

describe('HERO_CLASS_LOADOUTS', () => {
  it('has a loadout for each of the 4 classes', () => {
    expect(Object.keys(HERO_CLASS_LOADOUTS)).toHaveLength(4);
    for (const cls of HERO_CLASSES) {
      expect(HERO_CLASS_LOADOUTS[cls]).toBeDefined();
    }
  });

  it('every loadout is non-empty', () => {
    for (const cls of HERO_CLASSES) {
      expect(HERO_CLASS_LOADOUTS[cls].length).toBeGreaterThan(0);
    }
  });

  it('all loadout ids are strings', () => {
    for (const cls of HERO_CLASSES) {
      for (const id of HERO_CLASS_LOADOUTS[cls]) {
        expect(typeof id).toBe('string');
        expect(id.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('no-dupe spawning in rollTargetArmy', () => {
  it('two heroes rolled with deterministic RNG receive different classes', () => {
    const rng = mulberry(42);
    const result = rollTargetArmy(
      [
        { unitId: 'recruit-melee', quantity: 10 },
        { unitId: 'recruit-ranged', quantity: 10 },
      ],
      1,
      rng,
      ['Alpha', 'Beta'],
    );
    const heroes = result.filter((g) => g.isHero === true);
    expect(heroes).toHaveLength(2);
    expect(heroes[0].heroClass).toBeDefined();
    expect(heroes[1].heroClass).toBeDefined();
    expect(heroes[0].heroClass).not.toBe(heroes[1].heroClass);
  });
});

describe('createHeroForTarget', () => {
  const target = { combatPower: 1000, order: 5 };

  it('returns a hero with the specified class', () => {
    const hero = createHeroForTarget(target, 'Test', false, 'ranged');
    expect(hero.heroClass).toBe('ranged');
  });

  it('falls back to caster when no class is specified', () => {
    const hero = createHeroForTarget(target, 'Test');
    expect(hero.heroClass).toBe('caster');
  });

  it('loadout matches the assigned class', () => {
    for (const cls of HERO_CLASSES) {
      const hero = createHeroForTarget(target, 'Test', false, cls);
      expect(hero.tactics).toBe(HERO_CLASS_LOADOUTS[cls]);
      expect(hero.tactics?.length).toBeGreaterThan(0);
    }
  });

  it('is marked as a hero with correct base properties', () => {
    const hero = createHeroForTarget(target, 'Aldric');
    expect(hero.isHero).toBe(true);
    expect(hero.tier).toBe('hero');
    expect(hero.name).toBe('Aldric');
    expect(hero.combatPower).toBeGreaterThanOrEqual(200);
    expect(hero.resolve).toBeGreaterThan(0);
  });
});

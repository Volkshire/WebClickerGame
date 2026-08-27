import { describe, expect, it } from 'vitest';
import { rollTargetArmy } from '../src/systems/combat/enemyUnits';
import { MECH_SKILLS } from '../src/systems/combat/mechSkills';
import { mergeMechNamesFile, MECH_CUSTOM_NAME_WEIGHT } from '../src/systems/combat/mechNames';
import { NameDeck } from '../src/systems/combat/heroNames';
import { AGES } from '../src/systems/combat/world';

const machineAge = AGES.find((age) => age.id === 'age-of-machines')!;
const ashAge = AGES[0]!;

describe('Age of Machines Mech special entities', () => {
  it('uses the configured Mech pool and respects its cap', () => {
    const target = machineAge.targets[9]!;
    const army = rollTargetArmy(
      target.army, 1, () => 0, ['Aldric'], target.order, [], false, target.combatPower,
      undefined, undefined, machineAge.specialEntitySpawn,
      (_pool, excluded) => ['Titan-01', 'Atlas', 'Aegis'].find((name) => !excluded.has(name.toLowerCase())),
    );
    const mechs = army.filter((group) => group.specialEntityKind === 'mech');
    expect(mechs).toHaveLength(machineAge.specialEntitySpawn!.maxPerTarget);
    expect(mechs.every((mech) => mech.name === 'Titan-01')).toBe(false); // duplicates are rejected by real decks
    expect(mechs.every((mech) => mech.tactics?.every((id) => id in MECH_SKILLS))).toBe(true);
  });

  it('keeps earlier Ages on the existing human Hero configuration', () => {
    const target = ashAge.targets[1]!;
    const army = rollTargetArmy(target.army, 1, () => 0, ['Aldric'], target.order, [], false, target.combatPower);
    expect(army.filter((group) => group.specialEntityKind === 'mech')).toHaveLength(0);
    expect(army.filter((group) => group.isHero).every((group) => group.tactics?.some((id) => id in MECH_SKILLS) !== true)).toBe(true);
  });

  it('parses custom Mech names independently and strongly prefers custom names', () => {
    const pools = mergeMechNamesFile('# comment\n\nTitan-01\ntitan-01\nAtlas\n');
    expect(pools.custom).toEqual(['Titan-01', 'Atlas']);
    expect(pools.generated).not.toContain('Aldric');
    const deck = new NameDeck(['Custom'], ['Fallback'], undefined, { customWeight: MECH_CUSTOM_NAME_WEIGHT });
    expect(deck.draw(new Set(), () => 0)).toBe('Custom');
  });
});

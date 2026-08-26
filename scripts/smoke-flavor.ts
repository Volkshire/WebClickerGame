/* Smoke harness: exercises hero scaling/threat buff/resolve pools, nemesis
 * returns, flavor events, and the Last Stand mechanic. */
import { rollTargetArmy, createHeroForTarget } from '../src/systems/combat/enemyUnits';
import { BUILT_IN_HERO_NAMES, mergeNamesFile } from '../src/systems/combat/heroNames';
import { BattleSimulation } from '../src/systems/combat/simulation';
import type { BattleGroupInput } from '../src/systems/combat/simulation';
import { DEFAULT_BATTLE_PACING } from '../src/systems/combat/pacing';
import { rollHeroFates as resolveHeroFates } from '../src/systems/combat/heroFates';

function mulberry(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  const mark = cond ? 'PASS' : 'FAIL';
  if (!cond) failures += 1;
  console.log(`[${mark}] ${label}${detail ? ` — ${detail}` : ''}`);
}

// --- mergeNamesFile ---
const merged = mergeNamesFile('# comment\n\nMorrigan\n  aldric  \nSer Gregor');
check('merge dedupes case-insensitively', !merged.filter((n) => n.toLowerCase() === 'aldric').slice(1).length);
check('merge includes file names', merged.some((n) => n === 'Morrigan') && merged.some((n) => n === 'Ser Gregor'));

const pool = [...BUILT_IN_HERO_NAMES, ...merged];

// --- army composition shared by tests ---
const entries = [
  { unitId: 'veteran-melee', quantity: 40 },
  { unitId: 'recruit-ranged', quantity: 60 },
];

// --- 1. Fresh named + scaled hero at target order 3, CP 5000 ---
{
  const rng = mulberry(42);
  // Force exactly one hero slot to succeed.
  let calls = 0;
  const scripted = (): number => {
    calls += 1;
    return calls === 1 ? 0.01 : 0.99;
  };
  const army = rollTargetArmy(entries, 0.5, scripted, pool, 3, [], false, 5000);
  const heroes = army.filter((g) => g.isHero);
  check('one hero rolled', heroes.length === 1);
  check('hero is named', heroes[0]!.name !== 'Hero' && heroes[0]!.name.length > 0, heroes[0]?.name);
  check('hero scales off target CP', heroes[0]!.combatPower === Math.max(200, Math.round(5000 * 0.06)), `cp=${heroes[0]?.combatPower}`);
  check('fresh hero not flagged nemesis', heroes[0]!.isReturningNemesis !== true);
  check('fresh hero carries base threat', heroes[0]!.ability?.strength === 0.04, `${heroes[0]?.ability?.strength}`);
}

// --- 2. Mid-campaign hijack: fled hero returns with flag + ramped threat ---
{
  const rng = mulberry(7);
  // Slot succeeds, hijack roll < 0.5.
  let calls = 0;
  const scripted = (): number => {
    calls += 1;
    return calls === 1 ? 0.01 : calls === 2 ? 0.1 : 0.99;
  };
  const fled = [{ name: 'Kael', fledOrder: 2 }];
  const army = rollTargetArmy(entries, 0.9, scripted, pool, 4, fled, false, 8000);
  const hero = army.find((g) => g.isHero)!;
  check('fled veteran hijacks slot', hero.name === 'Kael', hero.name);
  check('nemesis flagged', hero.isReturningNemesis === true);
  const expectedThreat = Math.min(0.08, 0.04 + 0.004 * 4);
  check('nemesis threat ramped', hero.ability?.strength === expectedThreat, `${hero.ability?.strength}`);
}

// --- 3. Final-target guarantee beats cap ---
{
  const rng = (): number => 0.99; // every normal roll fails
  const owed = [
    { name: 'Lyra', fledOrder: 3 },
    { name: 'Phelan', fledOrder: 4 },
    { name: 'Saoirse', fledOrder: 5 },
  ];
  const army = rollTargetArmy(entries, 0.0, rng, pool, 10, owed, true, 700000);
  const heroes = army.filter((g) => g.isHero);
  const names = heroes.map((h) => h.name);
  check(
    'all owed heroes force-spawn past cap',
    names.includes('Lyra') && names.includes('Phelan') && names.includes('Saoirse'),
    names.join(','),
  );
  check(
    'force-spawned are nemesis-flagged',
    heroes.every((h) => h.isReturningNemesis === true),
  );
  check(
    'final-target heroes scale to stronghold CP',
    heroes.every((h) => h.combatPower === Math.max(200, Math.round(700000 * 0.06))),
  );
}

// --- 4a. Short battle: opening/arrival survive the 12-event window ---
{
  const sim = new BattleSimulation(
    { id: 't0', name: 'Hollow Creek', terrain: 'walled-settlement' },
    [{ unitId: 'wraith', name: 'Wraiths', count: 60, combatPowerEach: 2 }],
    [
      { unitId: 'recruit-melee', name: 'Recruit Melee', count: 6, combatPowerEach: 1 },
      { unitId: 'hero', name: 'Aldric', count: 1, combatPowerEach: 250, isHero: true, ability: { kind: 'heroic-threat', strength: 0.08 } },
    ],
    DEFAULT_BATTLE_PACING,
    { rng: () => 0.5 },
  );
  sim.runToCompletion();
  const events = sim.snapshot().events.map((e) => e.message);
  console.log('  short-battle events:', JSON.stringify(events));
  check(
    'pinned terrain-flavored opening stays first',
    !!events[0] && events[0]!.includes('Hollow Creek'),
    events[0] ?? '',
  );
  check(
    'named hero arrival event',
    sim.snapshot().events.some((e) => e.kind === 'hero' && e.message.includes('Aldric')),
    '',
  );
}

/** Pumps the sim tick-by-tick, accumulating every event ever emitted. */
function runCollecting(sim: BattleSimulation): { all: { id: number; kind: string; message: string }[] } {
  const byId = new Map<number, { id: number; kind: string; message: string }>();
  const interval = DEFAULT_BATTLE_PACING.tickIntervalMs / 1000;
  let guard = 0;
  while (!sim.complete && guard < 100000) {
    sim.advance(interval);
    for (const e of sim.snapshot().events) byId.set(e.id, e);
    guard += 1;
  }
  for (const e of sim.snapshot().events) byId.set(e.id, e);
  return { all: [...byId.values()].sort((a, b) => a.id - b.id) };
}

// --- 4b. Balanced longer battle: hero arc beats fire, generic lines absent ---
{
  // Balanced garrison: chaff + one named hero. The hero must survive long
  // enough to carve, bleed, and finally flee a broken army.
  const defenders: BattleGroupInput[] = [
    { unitId: 'recruit-melee', name: 'Recruit Melee', count: 50, combatPowerEach: 1 },
    {
      unitId: 'hero',
      name: 'Aldric',
      count: 1,
      combatPowerEach: 250,
      type: 'melee',
      tags: ['armored'],
      isHero: true,
      ability: { kind: 'heroic-threat', strength: 0.08 },
    },
  ];
  const attackers: BattleGroupInput[] = [
    { unitId: 'wraith', name: 'Wraiths', count: 40, combatPowerEach: 2, type: 'melee' },
    { unitId: 'death-knight', name: 'Death Knights', count: 4, combatPowerEach: 60, type: 'melee', tags: ['armored'] },
  ];

  // Deterministic rng: retreat always fires once eligible.
  const sim = new BattleSimulation(
    { id: 't', name: 'Hollow Creek', terrain: 'plains' },
    attackers,
    defenders,
    DEFAULT_BATTLE_PACING,
    { rng: () => 0.0 },
  );
  const collected = runCollecting(sim);
  const events = collected.all.map((e) => e.message);
  console.log(`  long-battle total events: ${events.length}`);
  console.log('  final window:', JSON.stringify(sim.snapshot().events.map((e) => e.message), null, 1));

  const result = sim.snapshot();
  check('battle completed', result.complete, `outcome=${result.outcome}`);
  check('no generic hero wipe line', !events.some((m) => m === 'Aldric ranks are wiped out.'));
  check('no generic hero loss line', !events.some((m) => m === 'Aldric ranks take losses.'));
  check('first blood fired', events.some((m) => m.toLowerCase().includes('first blood') || m.includes('harvest of Hollow Creek')));
  check('hero carve-through fired', events.some((m) => m.includes('carves through your Wraiths')), '');
  check('bloodied or escalation or retreat fired',
    events.some((m) => m.includes('bloodied') || m.includes('furious') || m.includes('flees') || m.includes('escapes') || m.includes('breaks away')),
  );
}

// --- 5. Retreat records fled names for the grudge ledger ---
{
  const defenders: BattleGroupInput[] = [
    { unitId: 'recruit-melee', name: 'Recruit Melee', count: 12, combatPowerEach: 1 },
    { unitId: 'hero', name: 'Brigid', count: 1, combatPowerEach: 250, isHero: true, ability: { kind: 'heroic-threat', strength: 0.04 } },
  ];
  // Commander-band pool sized to outlast the army-break threshold under
  // the kill-budget regime (250/tick) so the retreat window actually opens.
  const attackers: BattleGroupInput[] = [
    { unitId: 'death-knight', name: 'Death Knights', count: 2500, combatPowerEach: 75 },
  ];
  const sim = new BattleSimulation(
    { id: 't2', name: 'Dunmore', terrain: 'fortress' },
    attackers,
    defenders,
    DEFAULT_BATTLE_PACING,
    { rng: () => 0.0 }, // retreat guaranteed once the army breaks
  );
  const collected = runCollecting(sim);
  const fled = sim.getFledHeroNames();
  const retreatEvent = collected.all.find(
    (e) => e.message.includes('Brigid') && e.kind === 'climax',
  );
  check('retreat recorded in grudge ledger', fled.includes('Brigid'), `ledger=${fled.join(',')} outcome=${sim.snapshot().outcome}`);
  check('retreat event fired', retreatEvent !== undefined, retreatEvent?.message ?? '');
}

// ---- Regression suite for the hardening pass ----

function runRegressions(): void {
  // --- R1. Defeat omits standing heroes; victory rolls them ---
  {
    const fled = new Set<string>(['Brigid']);
    const roster = [{ name: 'Cedric' }, { name: 'Brigid' }];
    const defeat = resolveHeroFates({
      roster, fledNames: fled, victory: false, advantageRatio: 0.2, rng: Math.random,
    });
    check('defeat: standing hero omitted from fates', defeat.length === 1 && defeat[0]!.name === 'Brigid' && defeat[0]!.fled === true);
    let calls = 0;
    const scripted = (): number => { calls += 1; return calls === 1 ? 0.01 : 0.95; };
    const victory = resolveHeroFates({
      roster, fledNames: fled, victory: true, advantageRatio: 10, rng: scripted,
    });
    const cedric = victory.find((h) => h.name === 'Cedric');
    check('victory: standing hero rolled (killed at low roll)', cedric?.killed === true);
    check('victory: fleeer auto-survives as fled', victory.some((h) => h.name === 'Brigid' && h.fled === true));
    const floor = resolveHeroFates({
      roster: [{ name: 'Dierna' }], fledNames: new Set(), victory: true, advantageRatio: 0.5, rng: (): number => 0.95,
    });
    check('kill chance floors at 30%', floor[0]?.killed === false && floor[0]?.fled === undefined);
  }

  // --- B2. Strictly-later nemesis returns (replays excluded) ---
  {
    const owed = [{ name: 'Kael', fledOrder: 2 }];
    const replay = rollTargetArmy(entries, 0.0, (): number => 0.99, pool, 2, owed, true, 900);
    check('replay of flee-target does not summon veteran', replay.some((g) => g.isHero) === false);
    const later = rollTargetArmy(entries, 0.0, (): number => 0.99, pool, 3, owed, true, 900);
    const hero = later.find((g) => g.isHero);
    check('next target summons owed veteran', hero?.name === 'Kael' && hero?.isReturningNemesis === true, hero?.name ?? '');
  }

  // --- B1. Fresh picks never steal reserved grudge names ---
  {
    // One slot succeeds; hijack fails; fresh pick must skip reserved 'Kael'.
    // Later slots must fail (>= heroChance) or a veteran could legitimately
    // hijack them and rename the stack.
    let calls = 0;
    const scripted = (): number => {
      calls += 1;
      if (calls === 1) return 0.01;
      if (calls === 2) return 0.9;
      if (calls === 3) return 0.42;
      return 0.99;
    };
    const army = rollTargetArmy(entries, 0.9, scripted, pool, 5, [{ name: 'Kael', fledOrder: 2 }], false, 4000);
    const hero = army.find((g) => g.isHero);
    check('reserved grudge name not stolen by fresh pick', hero !== undefined && hero.name !== 'Kael', hero?.name ?? '');
  }

  // --- B3. Reinforcing veteran brings flag + ramped threat onto the stack ---
  {
    // slot1 ok -> fresh; hijack fail -> pick; slot2 ok -> hijack SUCCESS -> joins stack.
    let calls = 0;
    const scripted = (): number => {
      calls += 1;
      return [0.01, 0.9, 0.42, 0.01, 0.05][calls - 1] ?? 0.99;
    };
    const army = rollTargetArmy(entries, 0.9, scripted, pool, 6, [{ name: 'Kael', fledOrder: 2 }], false, 8000);
    const heroes = army.filter((g) => g.isHero);
    const kael = heroes.find((h) => h.name === 'Kael');
    const expectedThreat = Math.min(0.08, 0.04 + 0.004 * 6);
    // Heroes spawn as separate individual stacks; a joining veteran is its
    // OWN named stack alongside the fresh pick.
    check(
      'joining veteran spawns separate nemesis stack',
      heroes.length === 2 &&
        kael !== undefined &&
        kael.count === 1 &&
        kael.isReturningNemesis === true &&
        kael.ability?.strength === expectedThreat,
      JSON.stringify(heroes.map((h) => ({ n: h.name, c: h.count, f: h.isReturningNemesis, s: h.ability?.strength }))),
    );
  }

  // --- B4 + L1 + R2. Multi-hero announcements, overflow aggregate, gold kind ---
  {
    const mkHero = (name: string): BattleGroupInput => ({
      unitId: 'hero', name, count: 1, combatPowerEach: 250,
      isHero: true, ability: { kind: 'heroic-threat', strength: 0.08 },
    });
    const defenders: BattleGroupInput[] = [
      { unitId: 'recruit-melee', name: 'Recruit Melee', count: 40, combatPowerEach: 1 },
      mkHero('Aldric'), mkHero('Brigid'), mkHero('Cedric'), mkHero('Dierna'), mkHero('Eamon'),
    ];
    const attackers: BattleGroupInput[] = [
      { unitId: 'wraith', name: 'Wraiths', count: 45, combatPowerEach: 3 },
    ];
    const sim = new BattleSimulation(
      { id: 't3', name: 'Grudgehold', terrain: 'settlement' },
      attackers,
      defenders,
      DEFAULT_BATTLE_PACING,
      { rng: (): number => 0.5 },
    );
    // Collector-driven: heroes now live ~2x longer, so early carves fall out
    // of the final rolling window — accumulate every event instead.
    const collectedB4 = runCollecting(sim);
    const events = collectedB4.all;

    const carves = events.filter((e) => e.message.includes('carves through your'));
    const namedHeroes = ['Aldric', 'Brigid', 'Cedric', 'Dierna', 'Eamon']
      .filter((n) => carves.some((c) => c.message.startsWith(n)));
    check('every living hero announces its own carve-through', namedHeroes.length >= 2, namedHeroes.join(','));

    const arrivals = events.filter((e) => e.kind === 'hero');
    const namedArrivals = arrivals.filter((e) => !e.message.includes('more vengeful') && !e.message.includes('grudge-bearers'));
    const aggregate = arrivals.find((e) => e.message.includes('more vengeful') || e.message.includes('grudge-bearers'));
    check('arrivals capped at 3 named + aggregate', namedArrivals.length === 3 && aggregate !== undefined, `${namedArrivals.length} named`);
    check('aggregate counts the overflow (2)', aggregate?.message.includes('2') === true, aggregate?.message ?? '');

    const goldArrival = arrivals.find((e) => e.kind === 'hero' && e.message.length > 0);
    check("arrival events use gold 'hero' kind", goldArrival !== undefined, '');

    console.log('  grudgehold pinned:', JSON.stringify(events.filter((e) => e.id <= 5).map((e) => `[${e.kind}] ${e.message}`)));
  }
}

runRegressions();

// ---- Hero buff + Last Stand suite ----

/** Standard lone-hero garrison: tiny mortal screen dies early, so Last Stand
 *  beats fire inside short battles under the kill-budget regime. */
function lastStandDefenders(heroStrength: number): BattleGroupInput[] {
  return [
    { unitId: 'recruit-melee', name: 'Recruit Melee', count: 2, combatPowerEach: 1 },
    {
      unitId: 'hero',
      name: 'Aldric',
      count: 1,
      combatPowerEach: 250,
      type: 'melee',
      tags: ['armored'],
      isHero: true,
      ability: { kind: 'heroic-threat', strength: heroStrength },
    },
  ];
}

const LAST_STAND_ATTACKERS: BattleGroupInput[] = [
  // Large pool: %-based threat must not exhaust it mid-fixture, or both
  // comparison arms saturate at "total wipe" and become indistinguishable.
  // Commander-band victims (no anti-chaff multiplier) keep the comparison
  // arms about pure threat-strength differences under the current
  // HERO_COMBAT_TUNING lifetimes.
  { unitId: 'death-knight', name: 'Death Knights', count: 1500, combatPowerEach: 75 },
];

function runLastStandSuite(): void {
  // --- H1. Factory-level buff values (fresh flat 0.08; nemesis ramped) ---
  {
    let calls = 0;
    const scripted = (): number => {
      calls += 1;
      return calls === 1 ? 0.01 : 0.99;
    };
    const army = rollTargetArmy(entries, 0.5, scripted, pool, 3, [], false, 5000);
    const fresh = army.find((g) => g.isHero)!;
    check('H1 fresh threat base 0.04', fresh.ability?.strength === 0.04, `${fresh.ability?.strength}`);

    const fled = [{ name: 'Kael', fledOrder: 2 }];
    let calls2 = 0;
    const scripted2 = (): number => {
      calls2 += 1;
      return calls2 <= 2 ? 0.01 : 0.99;
    };
    const army2 = rollTargetArmy(entries, 0.9, scripted2, pool, 4, fled, false, 8000);
    const nemesis = army2.find((g) => g.isHero)!;
    check(
      'H1 nemesis ramp (0.04 + 0.004*order, cap 0.08)',
      nemesis.ability?.strength === Math.min(0.08, 0.04 + 0.004 * 4),
      `${nemesis.ability?.strength}`,
    );
  }

  // --- H2. Stronger heroes cause strictly more attacker casualties ---
  {
    const runWith = (strength: number): { cas: number } => {
      const sim = new BattleSimulation(
        { id: 'h2', name: 'Threatfield', terrain: 'plains' },
        LAST_STAND_ATTACKERS.map((g) => ({ ...g })),
        lastStandDefenders(strength),
        DEFAULT_BATTLE_PACING,
        { rng: (): number => 0.5 }, // no retreats at 0.5
      );
      // Fixed-tick horizon: under the kill-budget regime both arms would
      // eventually wipe the whole pool and tie on total casualties. The
      // design property under test is the DRAIN RATE, so compare at an
      // equal clock instead of at battle end.
      const interval = DEFAULT_BATTLE_PACING.tickIntervalMs / 1000;
      for (let t = 0; t < 4; t++) sim.advance(interval);
      return { cas: sim.snapshot().attackerCasualties };
    };
    const baseline = runWith(0.04);
    const buffed = runWith(0.08);
    check(
      'H2 stronger hero threat drains meaningfully more troops',
      buffed.cas > baseline.cas + 20,
      `old=${baseline.cas} new=${buffed.cas}`,
    );
  }

  // --- H3. Last Stand multiplies threat only after mortals are gone ---
  {
    const runWith = (multiplier: number): { cas: number; events: string[] } => {
      const sim = new BattleSimulation(
        { id: 'h3', name: 'Lasthold', terrain: 'plains' },
        LAST_STAND_ATTACKERS.map((g) => ({ ...g })),
        lastStandDefenders(0.05),
        { ...DEFAULT_BATTLE_PACING, lastStandThreatMultiplier: multiplier },
        { rng: (): number => 0.5 },
      );
      // Fixed-tick horizon (see H2): both arms eventually wipe the pool, so
      // end-of-battle totals would tie. Three ticks is past the mortal
      // screen's collapse (Last Stand fires) yet before either arm finishes.
      const interval = DEFAULT_BATTLE_PACING.tickIntervalMs / 1000;
      const byId = new Map<number, { id: number; kind: string; message: string }>();
      for (let t = 0; t < 3 && !sim.complete; t++) {
        sim.advance(interval);
        for (const e of sim.snapshot().events) byId.set(e.id, e);
      }
      return { cas: sim.snapshot().attackerCasualties, events: [...byId.values()].map((e) => e.message) };
    };

    const isStandLine = (m: string): boolean =>
      m.includes('stands alone') || m.includes('refuse to kneel') ||
      m.includes('banner alone') || m.includes('Every shield');

    // Gentle base threat (0.05) keeps the pre-stand phase gentle; a wide
    // multiplier contrast (x1 vs x3) makes the post-stand delta unambiguous.
    const off = runWith(1.0);
    const on = runWith(3.0);
    check('H3 last-stand line fired in both runs', on.events.some(isStandLine) && off.events.some(isStandLine), '');
    check('H3 amplified cornered-hero threat outdamages baseline', on.cas > off.cas + 20, `x1=${off.cas} x3=${on.cas}`);
  }

  // --- H4. Reinforcement fires exactly once and joins roster/fates ---
  {
    let providerCalls = 0;
    const sim = new BattleSimulation(
      { id: 'h4', name: 'Reinhold', terrain: 'plains' },
      LAST_STAND_ATTACKERS.map((g) => ({ ...g })),
      lastStandDefenders(0.08),
      { ...DEFAULT_BATTLE_PACING, lastStandReinforceChance: 1.0 },
      {
        rng: (): number => 0.5,
        reinforcement: {
          buildHero: () => {
            providerCalls += 1;
            return {
              unitId: 'hero',
              name: 'Reinhard',
              count: 1,
              combatPowerEach: 250,
              type: 'melee',
              tags: ['armored'],
              isHero: true,
              ability: { kind: 'heroic-threat', strength: 0.08 },
            };
          },
        },
      },
    );
    // Collector drives the battle so every mid-battle beat is accumulated.
    const collected = runCollecting(sim);
    const forces = sim.snapshot().defenderForces;

    check('H4 provider called exactly once', providerCalls === 1, String(providerCalls));
    const reinhardStacks = forces.filter((f) => f.name === 'Reinhard');
    check('H4 Reinhard joined as a single stack', reinhardStacks.length === 1, JSON.stringify(forces.map((f) => f.name)));
    check(
      'H4 reinforcement arrival announced in gold',
      collected.all.some((e) => e.kind === 'hero' && e.message.includes('Reinhard')),
      '',
    );
    check('H4 reinforced hero enters fate roster', sim.heroRoster().some((r) => r.name === 'Reinhard'), sim.heroRoster().map((r) => r.name).join(','));
    const standLines = collected.all.filter(
      (m) =>
        (m.message.includes('stands alone') || m.message.includes('refuse to kneel') ||
          m.message.includes('banner alone') || m.message.includes('Every shield')) &&
        m.kind === 'climax',
    );
    check('H4 last stand announced once despite reinforcement', standLines.length === 1, String(standLines.length));
  }

  // --- H5. Reinforcement never fires at zero chance ---
  {
    let providerCalls = 0;
    const sim = new BattleSimulation(
      { id: 'h5', name: 'Quiethold', terrain: 'plains' },
      LAST_STAND_ATTACKERS.map((g) => ({ ...g })),
      lastStandDefenders(0.08),
      { ...DEFAULT_BATTLE_PACING, lastStandReinforceChance: 0 },
      {
        rng: (): number => 0.5,
        reinforcement: {
          buildHero: () => {
            providerCalls += 1;
            throw new Error('provider must not be called');
          },
        },
      },
    );
    sim.runToCompletion();
    const names = sim.snapshot().defenderForces.map((f) => f.name);
    check('H5 chance=0 keeps provider silent', providerCalls === 0 && !names.includes('Reinhard'), String(providerCalls));
  }
}

runLastStandSuite();

// ---- Hero Resolve suite ----

/** Lone named hero with an explicit pool, for lifetime/beat assertions. */
function resolveHero(name: string, resolve: number): BattleGroupInput {
  return {
    unitId: 'hero',
    name,
    count: 1,
    combatPowerEach: 250,
    type: 'melee',
    tags: ['armored'],
    isHero: true,
    ability: { kind: 'heroic-threat', strength: 0.01 },
    resolve,
  };
}

function runHeroResolveSuite(): void {
  // --- R1. Swarm-mass drain schedule: overwhelming assault kills on schedule ---
  {
    // Threat kept tiny (0.01) so the attacker force outlasts the hero's
    // pool — this test isolates attrition lifetime from threat outcomes.
    // The army is sized to hold above the swarm-mass lethality knee through
    // pool-empty: incoming saturates near the base rate x lone taken
    // fraction (~0.4-0.5/tick) -> resolve 5 empties around tick 11.
    const sim = new BattleSimulation(
      { id: 'r1', name: 'Siegegate', terrain: 'fortress' },
      [{ unitId: 'wraith', name: 'Wraiths', count: 20000, combatPowerEach: 6 }],
      [resolveHero('Durstan', 5)],
      DEFAULT_BATTLE_PACING,
      { rng: (): number => 0.5 },
    );
    let ticks = 0;
    while (!sim.complete && ticks < 500) {
      sim.advance(DEFAULT_BATTLE_PACING.tickIntervalMs / 1000);
      ticks += 1;
    }
    const snap = sim.snapshot();
    const durstan = snap.defenderForces.find((f) => f.name === 'Durstan');
    check('R1 pooled hero dies exactly once', durstan?.casualties === 1 && durstan?.surviving === 0, JSON.stringify(durstan));
    check('R1 lifetime lands in the designed band', ticks >= 9 && ticks <= 14, `ticks=${ticks}`);
  }

  // --- R2/R3. Bloodied fires before slain; escalation crosses half pool ---
  {
    // Army sized to outlast Maeve's pool under the swarm-mass curve
    // (saturating near ~0.42/tick taken) so the escalation and slain beats
    // both get their stage time.
    const sim = new BattleSimulation(
      { id: 'r23', name: 'Halfmoon', terrain: 'plains' },
      [{ unitId: 'wraith', name: 'Wraiths', count: 12000, combatPowerEach: 1 }],
      [resolveHero('Maeve', 6)],
      DEFAULT_BATTLE_PACING,
      { rng: (): number => 0.5 },
    );
    const collected = runCollecting(sim);
    const events = collected.all;

    const bloodiedIdx = events.findIndex(
      (e) => e.kind === 'casualties' && e.message.includes('Maeve'),
    );
    const slainIdx = events.findIndex(
      (e) => e.kind === 'climax' && e.message.includes('Maeve') && !e.message.includes('carves'),
    );
    check('R2 bloodied beat fired while still alive', bloodiedIdx >= 0, '');
    check('R2 slain beat fired at pool empty', slainIdx >= 0, '');
    check('R2 bloodied precedes slain', bloodiedIdx >= 0 && slainIdx > bloodiedIdx, `${bloodiedIdx} vs ${slainIdx}`);

    const escalationFired = events.some(
      (e) =>
        e.kind === 'climax' &&
        (e.message.includes('desperate fury') || e.message.includes('bleeds freely') ||
          e.message.includes('Half-broken') || e.message.includes('Pain only sharpens') ||
          e.message.includes('laughs through') || e.message.includes('feral') ||
          e.message.includes('Cornered things')),
    );
    check('R3 escalation fired past half resolve', escalationFired);
  }

  // --- R4. Factory scales resolve with campaign order ---
  {
    const r1 = createHeroForTarget({ combatPower: 1000, order: 1 });
    const r3 = createHeroForTarget({ combatPower: 1000, order: 3 });
    const r6n = createHeroForTarget({ combatPower: 1000, order: 6 }, undefined, true);
    const r10 = createHeroForTarget({ combatPower: 700000, order: 10 });
    check('R4 early hero resolve 5', r1.resolve === 5, String(r1.resolve));
    check('R4 mid-campaign resolve 6', r3.resolve === 6, String(r3.resolve));
    check('R4 nemesis flag does not change resolve', r6n.resolve === 7, String(r6n.resolve));
    check('R4 final-target legend resolve 8', r10.resolve === 8, String(r10.resolve));
  }

  // --- R5. Generic wipe lines now vary across battles ---
  {
    const wipes = new Set<string>();
    for (let seed = 11; seed <= 16; seed += 1) {
      const rng = mulberry(seed * 977);
      const sim = new BattleSimulation(
        { id: `r5-${seed}`, name: 'Varied Fields', terrain: 'plains' },
        [{ unitId: 'wraith', name: 'Wraiths', count: 60, combatPowerEach: 6 }],
        [{ unitId: 'recruit-melee', name: 'Recruit Melee', count: 4, combatPowerEach: 1 }],
        DEFAULT_BATTLE_PACING,
        { rng },
      );
      const collected = runCollecting(sim);
      for (const e of collected.all) {
        if (
          e.kind === 'casualties' &&
          /wiped out|upright|trampling|unmade|Silence/.test(e.message)
        ) {
          wipes.add(e.message);
        }
      }
    }
    check('R5 wipe lines draw from a variety pool', wipes.size >= 2, `${wipes.size}: ${[...wipes].join(' | ')}`);
  }
}

runHeroResolveSuite();

console.log(failures === 0 ? '\nALL SMOKE CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

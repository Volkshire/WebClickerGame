/* Hero-tuning smoke harness: measures Hero survivability and anti-chaff
 * damage across the design-intent scenarios. Intentionally imports ONLY
 * pre-existing APIs so the exact same file produces comparable numbers
 * before and after tuning changes (S6 must be byte-identical).
 *
 * S5 uses near-zero hero threat (0.001) against a commander-band army so
 * the pack-survivability curve is measured in isolation, unpolluted by
 * the anti-chaff multiplier and never censored by an army wipe. */
import { BattleSimulation } from '../src/systems/combat/simulation';
import type { BattleGroupInput } from '../src/systems/combat/simulation';
import { DEFAULT_BATTLE_PACING } from '../src/systems/combat/pacing';

function mulberry(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hero(name: string, over: Partial<BattleGroupInput> = {}): BattleGroupInput {
  return {
    unitId: 'hero',
    name,
    count: 1,
    combatPowerEach: 200,
    type: 'melee',
    tags: ['armored'],
    isHero: true,
    ability: { kind: 'heroic-threat', strength: 0.04 },
    resolve: 5,
    ...over,
  };
}

const DEATH_KNIGHTS = (count: number): BattleGroupInput => ({
  unitId: 'death-knight',
  name: 'Death Knights',
  count,
  combatPowerEach: 75,
});

interface RunResult {
  outcome: string | null;
  ticks: number;
  attackerCasualties: number;
  defenderCasualties: number;
  heroLifetimes: Record<string, number>;
  heroRetreated: string[];
  finalForces: unknown[];
}

/** Pumps one tick at a time; records when each named stack dies/flees. */
function run(
  label: string,
  attackers: BattleGroupInput[],
  defenders: BattleGroupInput[],
  seed: number,
): RunResult {
  const sim = new BattleSimulation(
    { id: label.toLowerCase(), name: label, terrain: 'plains' },
    attackers.map((g) => ({ ...g })),
    defenders.map((g) => ({ ...g })),
    DEFAULT_BATTLE_PACING,
    { rng: mulberry(seed) },
  );
  const interval = DEFAULT_BATTLE_PACING.tickIntervalMs / 1000;
  const lifetimes: Record<string, number> = {};
  const retreated: string[] = [];
  let ticks = 0;
  while (!sim.complete && ticks < 5000) {
    sim.advance(interval);
    ticks += 1;
    for (const f of sim.snapshot().defenderForces) {
      if (f.surviving === 0 && !(f.name in lifetimes)) lifetimes[f.name] = ticks;
    }
    for (const name of sim.getFledHeroNames()) {
      if (!retreated.includes(name)) retreated.push(name);
    }
  }
  const snap = sim.snapshot();
  return {
    outcome: snap.outcome,
    ticks,
    attackerCasualties: snap.attackerCasualties,
    defenderCasualties: snap.defenderCasualties,
    heroLifetimes: lifetimes,
    heroRetreated: retreated,
    finalForces: [
      ...snap.attackerForces.map((f) => ({ n: f.name, dead: f.casualties })),
      ...snap.defenderForces.map((f) => ({ n: f.name, dead: f.casualties })),
    ],
  };
}

// --- S1: lone Hero vs many Recruit-band undead (Wraiths CP1) ---
{
  const r = run('S1 Field of Chaff',
    [{ unitId: 'wraith', name: 'Wraiths', count: 3000, combatPowerEach: 1 }],
    [hero('Harkon')],
    101);
  console.log(`=== S1 hero-vs-recruit-band ===\n${JSON.stringify(r)}`);
}

// --- S2: mixed army — Recruit-band vs Commander-band victims split ---
{
  const r = run('S2 Split Field',
    [
      { unitId: 'wraith', name: 'Wraiths', count: 2000, combatPowerEach: 1 },
      DEATH_KNIGHTS(300),
    ],
    [hero('Harkon')],
    102);
  console.log(`=== S2 recruit-vs-commander-victim-split ===\n${JSON.stringify(r)}`);
}

// --- S3: lone Hero vs Elite-band undead (Flesh Golems CP25) ---
{
  const r = run('S3 Golem Line',
    [{ unitId: 'flesh-golem', name: 'Flesh Golems', count: 400, combatPowerEach: 25, tags: ['armored'] }],
    [hero('Harkon')],
    103);
  console.log(`=== S3 hero-vs-elite-band ===\n${JSON.stringify(r)}`);
}

// --- S4: high-tier attackers storming a tougher Hero ---
{
  const r = run('S4 Knight Storm',
    [
      { unitId: 'skeleton', name: 'Skeletons', count: 2500, combatPowerEach: 2 },
      DEATH_KNIGHTS(200),
    ],
    [hero('Vaelric', { resolve: 8 })],
    104);
  console.log(`=== S4 hero-vs-high-tier-army ===\n${JSON.stringify(r)}`);
}

// --- S5: pack survivability curve (threat ~0, commander-band victims) ---
for (const n of [1, 2, 3, 5]) {
  const heroes = Array.from({ length: n }, (_, i) =>
    hero(`Hero ${i + 1}`, { ability: { kind: 'heroic-threat', strength: 0.001 } }));
  const r = run(`S5 Pack of ${n}`, [DEATH_KNIGHTS(20000)], heroes, 200 + n);
  console.log(`=== S5 heroes=${n} ===\n${JSON.stringify(r)}`);
}

// --- S7: chaff horde vs lone Hero — swarm-mass curve keeps the Hero off
// any death clock while the battle still terminates by attacker wipe ---
{
  const r = run('S7 Chaff Cannot Kill',
    [{ unitId: 'wraith', name: 'Wraiths', count: 5000, combatPowerEach: 1 }],
    [hero('Harkon')],
    107);
  console.log(`=== S7 tiny-force-vs-hero ===\n${JSON.stringify(r)}`);
  const pass =
    r.outcome === 'defeat' &&
    !('Harkon' in r.heroLifetimes) &&
    r.heroRetreated.length === 0 &&
    r.ticks < 500;
  console.log(pass ? 'S7 PASS' : 'S7 FAIL');
  if (!pass) process.exitCode = 1;
}

// --- S8: BALANCE GATES — the four design targets as hard assertions ---
function gate(name: string, pass: boolean, detail: string): void {
  console.log(`${pass ? 'GATE PASS' : 'GATE FAIL'} ${name} — ${detail}`);
  if (!pass) process.exitCode = 1;
}
{
  const wraiths = (n: number): BattleGroupInput[] => [
    { unitId: 'wraith', name: 'Wraiths', count: n, combatPowerEach: 1 },
  ];
  const soloHero = (): BattleGroupInput[] => [hero('Harkon')];

  // Target 1: 1 Hero vs 100 Wraiths — comfortable survive + kill most/all.
  const a = run('S8a', wraiths(100), soloHero(), 301);
  console.log(`=== S8a hero-vs-100-wraiths ===\n${JSON.stringify(a)}`);
  gate(
    'S8a 100 wraiths wiped fast',
    a.outcome === 'defeat' && a.ticks <= 6 && a.attackerCasualties >= 90,
    `outcome=${a.outcome} ticks=${a.ticks} kills=${a.attackerCasualties}`,
  );

  // Target 2: 1 Hero vs 1,000 Wraiths — extremely dangerous, Hero unharmed.
  const b = run('S8b', wraiths(1000), soloHero(), 302);
  console.log(`=== S8b hero-vs-1k-wraiths ===\n${JSON.stringify(b)}`);
  gate(
    'S8b 1k wraiths die, hero survives',
    b.outcome === 'defeat' && !('Harkon' in b.heroLifetimes) && b.ticks <= 12,
    `outcome=${b.outcome} ticks=${b.ticks} kills=${b.attackerCasualties}`,
  );

  // Target 3: 1 Hero vs 10,000 Wraiths — the lethality knife-edge: fight
  // must be sustained (never an instant melt) whichever side prevails.
  const c = run('S8c', wraiths(10000), soloHero(), 303);
  console.log(`=== S8c hero-vs-10k-wraiths ===\n${JSON.stringify(c)}`);
  gate(
    'S8c 10k wraiths = sustained war',
    c.ticks >= 10 && c.outcome !== null,
    `outcome=${c.outcome} ticks=${c.ticks} kills=${c.attackerCasualties} heroLifetimes=${JSON.stringify(c.heroLifetimes)}`,
  );

  // Crossover probe (informational): where does chaff mass start beating a
  // lone Hero? Prints the outcome curve for the report.
  for (const n of [5000, 15000, 20000]) {
    const p = run(`S8e-${n}`, wraiths(n), soloHero(), 306);
    console.log(
      `=== S8e n=${n} outcome=${p.outcome} ticks=${p.ticks} heroDied=${JSON.stringify(p.heroLifetimes)} kills=${p.attackerCasualties} ===`,
    );
  }

  // Targets 4+5: per-RESOLUTION tier contrast — Wraith-band stacks lose
  // more bodies per swing than Skeleton-band, both in the hundreds.
  const firstStrike = (victims: BattleGroupInput[], seed: number): number => {
    const sim = new BattleSimulation(
      { id: 's8d', name: 'Firststrike', terrain: 'plains' },
      victims.map((g) => ({ ...g })),
      soloHero(),
      DEFAULT_BATTLE_PACING,
      { rng: mulberry(seed) },
    );
    sim.advance(DEFAULT_BATTLE_PACING.tickIntervalMs / 1000);
    return sim.snapshot().attackerCasualties;
  };
  const wrFirst = firstStrike(wraiths(2000), 305);
  const skFirst = firstStrike(
    [{ unitId: 'skeleton', name: 'Skeletons', count: 2000, combatPowerEach: 2 }],
    304,
  );
  console.log(`=== S8d skeleton-vs-wraith contrast ===\nfirst resolution — wraiths=${wrFirst} skeletons=${skFirst}`);
  gate(
    'S8d skeletons outlast wraiths, both shredded',
    wrFirst > skFirst * 1.2 && skFirst >= 60,
    `wraiths=${wrFirst}/tick skeletons=${skFirst}/tick`,
  );
}

// --- S9: armor-resistance wiring — identical armies where ONLY the
// defender stacks carry an `armored` tag. Pins the exact contract the
// resistances add to hero-field battles: (1) attacker effective power is
// scaled by exactly the melee-vs-armored modifier times the armored share,
// (2) that scaling is strong enough to flip the clamp regime around parity
// — the tagged field turns the tables on the same attacker. Deliberately
// deterministic: asserts t0 powers, not RNG-sensitive end states. ---
{
  const attackers: BattleGroupInput[] = [
    { unitId: 'skeleton', name: 'Skeletons', count: 3000, combatPowerEach: 2, type: 'melee' },
    { unitId: 'wraith', name: 'Wraiths', count: 20000, combatPowerEach: 1, type: 'melee' },
  ];
  const defendersFor = (armored: boolean): BattleGroupInput[] => [
    {
      unitId: 'elite-melee',
      name: 'Elite Guard',
      count: 1000,
      combatPowerEach: 20,
      ...(armored ? { tags: ['armored'] as const } : {}),
    },
    hero('Hero 1'),
    hero('Hero 2'),
  ];
  const probe = (
    label: string,
    armored: boolean,
    seed: number,
  ): { initAtt: number; initDef: number } & RunResult => {
    const sim = new BattleSimulation(
      { id: label.toLowerCase(), name: label, terrain: 'plains' },
      attackers.map((g) => ({ ...g })),
      defendersFor(armored).map((g) => ({ ...g })),
      DEFAULT_BATTLE_PACING,
      { rng: mulberry(seed) },
    );
    const t0 = sim.snapshot();
    const interval = DEFAULT_BATTLE_PACING.tickIntervalMs / 1000;
    let ticks = 0;
    while (!sim.complete && ticks < 5000) {
      sim.advance(interval);
      ticks += 1;
    }
    return {
      initAtt: t0.attackerPower,
      initDef: t0.defenderPower,
      outcome: sim.snapshot().outcome,
      ticks,
      attackerCasualties: sim.snapshot().attackerCasualties,
      defenderCasualties: sim.snapshot().defenderCasualties,
      heroLifetimes: {},
      heroRetreated: [],
      finalForces: [],
    };
  };
  const bare = probe('S9a Bare Elites', false, 401);
  const tagged = probe('S9b Armored Elites', true, 401);
  console.log(
    `=== S9a bare: initAtt=${bare.initAtt} initDef=${bare.initDef} outcome=${bare.outcome} ticks=${bare.ticks} defenderKills=${bare.defenderCasualties} ===`,
  );
  console.log(
    `=== S9b armored: initAtt=${tagged.initAtt} initDef=${tagged.initDef} outcome=${tagged.outcome} ticks=${tagged.ticks} defenderKills=${tagged.defenderCasualties} ===`,
  );
  const close = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));
  // Raw attacker power is 26000; defender CP totals 20400 of which only the
  // two Heroes (2x200) are armored in the bare field — so even that run
  // carries a small armored share through the same rule.
  const RAW_ATT = 3000 * 2 + 20000;
  const DEF_CP = 1000 * 20 + 2 * 200;
  const HERO_ARMORED = 2 * 200;
  const bareMult = 1 - 0.25 * (HERO_ARMORED / DEF_CP);
  gate(
    'S9 armor resistance wiring (scaling + regime flip)',
    bare.outcome !== null &&
      tagged.outcome !== null &&
      // Full armored share => attacker power scaled by exactly 0.75.
      close(tagged.initAtt, RAW_ATT * 0.75) &&
      // Bare field keeps the heroes' own armored share only.
      close(bare.initAtt, RAW_ATT * bareMult) &&
      close(tagged.initDef, DEF_CP) &&
      // The cut is decisive at parity: bare attackers are favored, tagged
      // attackers are outgunned — the clamp regime flips with the tag.
      bare.initAtt > bare.initDef &&
      tagged.initAtt < tagged.initDef &&
      tagged.ticks < 500,
    `bare ${bare.initAtt} vs ${bare.initDef} | armored ${tagged.initAtt} vs ${tagged.initDef} (expect x0.75)`,
  );
}

// --- S6: NO-Hero regression battle — series must be byte-identical ---
{
  const sim = new BattleSimulation(
    { id: 's6', name: 'Quiet Village', terrain: 'settlement' },
    [{ unitId: 'skeleton', name: 'Skeletons', count: 500, combatPowerEach: 2 }],
    [
      { unitId: 'recruit-melee', name: 'Recruit Melee', count: 60, combatPowerEach: 1 },
      { unitId: 'recruit-ranged', name: 'Recruit Ranged', count: 40, combatPowerEach: 1 },
    ],
    DEFAULT_BATTLE_PACING,
    { rng: mulberry(900) },
  );
  const interval = DEFAULT_BATTLE_PACING.tickIntervalMs / 1000;
  const series: string[] = [];
  let guard = 0;
  while (!sim.complete && guard < 5000) {
    sim.advance(interval);
    series.push(JSON.stringify(sim.snapshot()));
    guard += 1;
  }
  series.push(JSON.stringify(sim.snapshot()));
  const text = series.join('\n');
  console.log(`=== S6 no-hero-regression ticks=${series.length - 1} outcome=${sim.snapshot().outcome} chars=${text.length} ===`);
  const out = process.env['S6_OUT'];
  if (out) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(out, text, 'utf8');
    console.log(`S6 series written to ${out}`);
  }
}

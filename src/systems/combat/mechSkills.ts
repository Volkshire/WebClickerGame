import { ABILITY_TIERS, type CombatAbilityDefinition } from './abilities';

export const MECH_SKILLS: Readonly<Record<string, CombatAbilityDefinition>> = {
  'machine-gun-barrage': {
    id: 'machine-gun-barrage', name: 'Machine Gun Barrage', description: 'Targets lower-power undead ranks.',
    tier: ABILITY_TIERS.advanced, trigger: { kind: 'always' }, cooldownTicks: 5, durationTicks: null,
    scalingChance: { side: 'attacker', baseChance: 0.35, thresholdUnits: 1, intervalUnits: 1, chancePerInterval: 0, maxChance: 0.35 },
    effect: { kind: 'casualties', side: 'attacker', mode: 'percent', percent: 0.02, cap: 987654321, capVariance: 0.12, filter: [{ maxCombatPower: 10, noun: 'lower-power troops' }], reportTemplate: '{count} LOWER-POWER TROOPS DESTROYED.' },
    activationLines: ['Hydraulics scream as {commander} sweeps the undead host.'], effectLines: ['Rotary cannons rake the front ranks.'],
  },
  'missile-salvo': {
    id: 'missile-salvo', name: 'Missile Salvo', description: 'Launches a heavy guided strike.', tier: ABILITY_TIERS.high,
    trigger: { kind: 'always' }, cooldownTicks: 9, durationTicks: null,
    scalingChance: { side: 'attacker', baseChance: 0.22, thresholdUnits: 1, intervalUnits: 1, chancePerInterval: 0, maxChance: 0.22 },
    effect: { kind: 'casualties', side: 'attacker', percent: 0.15, cap: 2500000000, capVariance: 0.15, filter: [{ noun: 'undead' }], reportTemplate: '{count} UNDEAD DESTROYED.' },
    activationLines: ['Targeting systems lock; {commander} opens its missile bays.'], effectLines: ['Guided warheads tear through the legion.'],
  },
  'armor-plating': {
    id: 'armor-plating', name: 'Armor Plating', description: 'Reinforces the Mech defensive envelope.', tier: ABILITY_TIERS.advanced,
    trigger: { kind: 'strength-below', side: 'own', fraction: 0.7 }, cooldownTicks: 12, durationTicks: 5, oncePerBattle: true,
    effect: { kind: 'side-power', side: 'defender', multiplier: 1.25 }, activationLines: ['{commander} seals its armor plates with a grinding roar.'], effectLines: ['Reactor shielding reinforces the defense.'],
  },
  overdrive: {
    id: 'overdrive', name: 'Overdrive', description: 'Pushes reactor output beyond safe limits.', tier: ABILITY_TIERS.high,
    trigger: { kind: 'strength-below', side: 'own', fraction: 0.55 }, cooldownTicks: 14, durationTicks: 4, oncePerBattle: true,
    effect: { kind: 'side-power', side: 'defender', multiplier: 1.55 }, activationLines: ['Cooling alarms howl as {commander} enters overdrive.'], effectLines: ['Servo systems surge with reactor power.'],
  },
  railgun: {
    id: 'railgun', name: 'Railgun', description: 'Fires a kinetic penetrator at elite undead.', tier: ABILITY_TIERS.high,
    trigger: { kind: 'always' }, cooldownTicks: 15, durationTicks: null,
    scalingChance: { side: 'attacker', baseChance: 0.16, thresholdUnits: 1, intervalUnits: 1, chancePerInterval: 0, maxChance: 0.16 },
    effect: { kind: 'casualties', side: 'attacker', mode: 'flat', range: { min: 100, max: 250 }, cap: 250, filter: [{ minCombatPower: 20, noun: 'elite troops' }], reportTemplate: '{count} ELITE TROOPS DESTROYED.' },
    activationLines: ['{commander} charges its railgun; magnetic coils flare white.'], effectLines: ['A kinetic lance punches through elite ranks.'],
  },
  'nuclear-payload': {
    id: 'nuclear-payload', name: 'Nuclear Payload', description: 'A once-per-battle reactor-scale detonation.', tier: ABILITY_TIERS.veryHigh,
    trigger: { kind: 'strength-below', side: 'own', fraction: 0.4 }, cooldownTicks: 0, durationTicks: null, oncePerBattle: true,
    effect: { kind: 'casualties', side: 'attacker', percent: 0.35, cap: 1000000000000, filter: [{ noun: 'undead' }], reportTemplate: '{count} UNDEAD DESTROYED.' },
    activationLines: ['{commander} breaches containment. A reactor alarm eclipses the battlefield.'], effectLines: ['The blast consumes a vast section of the legion.'],
  },
  'spirit-disruptor': {
    id: 'spirit-disruptor', name: 'Spirit Disruptor', description: 'Shatters the spiritual cohesion of all Wraiths on the field.', tier: ABILITY_TIERS.veryHigh,
    trigger: { kind: 'always' }, cooldownTicks: 0, durationTicks: null, oncePerBattle: true,
    scalingChance: { side: 'attacker', baseChance: 0.18, thresholdUnits: 1, intervalUnits: 1, chancePerInterval: 0, maxChance: 0.18 },
    effect: { kind: 'casualties', side: 'attacker', mode: 'percent', percent: 0.30, cap: undefined, filter: [{ unitId: 'wraith' }], reportTemplate: '{count} WRAITHS DISRUPTED.' },
    activationLines: ['{commander} pulses its spirit disruptor array.'], effectLines: ['Wraiths shriek as their essence unravels.'],
  },
};

export const MECH_SKILL_IDS = Object.keys(MECH_SKILLS);
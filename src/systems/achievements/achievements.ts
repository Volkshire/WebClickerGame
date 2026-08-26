/**
 * Achievement catalog — pure data. Every reward amount is editable per
 * definition (all current achievements grant exactly 1 Prestige Point).
 * New achievements are appended here with zero changes to the engine,
 * persistence or UI.
 */

import type { AchievementDefinition } from './types';

export const ACHIEVEMENTS: readonly AchievementDefinition[] = [
  {
    id: 'first-harvest',
    name: 'First Harvest',
    description: 'Harvest Souls 100 times by hand.',
    condition: { kind: 'lifetime-clicks', amount: 100 },
    reward: { type: 'prestige-points', amount: 1 },
  },
  {
    id: 'soul-hoard',
    name: 'Soul Hoard',
    description: 'Hold 10,000 Souls at once.',
    condition: { kind: 'souls-current', amount: 10000 },
    reward: { type: 'prestige-points', amount: 1 },
  },
  {
    id: 'blood-price',
    name: 'Blood Price',
    description: 'Clear your first campaign target.',
    condition: { kind: 'targets-cleared', amount: 1 },
    reward: { type: 'prestige-points', amount: 1 },
    spoiler: true,
  },
  {
    id: 'first-recruit',
    name: 'First Recruit',
    description: 'Raise your first undead.',
    condition: { kind: 'legion-size', amount: 1 },
    reward: { type: 'prestige-points', amount: 1 },
    spoiler: true,
  },
  {
    id: 'era-breaker',
    name: 'Era Breaker',
    description: 'Conquer an entire Age.',
    condition: { kind: 'conquered-ages', amount: 1 },
    reward: { type: 'prestige-points', amount: 1 },
    spoiler: true,
  },
  {
    id: 'double-conquest',
    name: 'Double Conquest',
    description: 'Conquer two Ages in a single run.',
    condition: { kind: 'conquered-ages', amount: 2 },
    reward: { type: 'prestige-points', amount: 1 },
    spoiler: true,
  },
  {
    id: 'ascended',
    name: 'Ascended',
    description: 'Perform your first Prestige.',
    condition: { kind: 'prestige-count', amount: 1 },
    reward: { type: 'prestige-points', amount: 1 },
  },
];

export function getAchievementDef(achievementId: string): AchievementDefinition | null {
  return ACHIEVEMENTS.find((entry) => entry.id === achievementId) ?? null;
}

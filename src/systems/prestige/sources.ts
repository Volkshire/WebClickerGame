/**
 * Prestige reward source registry.
 *
 * Any system can grant Prestige Points by reporting a stable source id to
 * PrestigeSystem.reportReward(). The permanent claimed-ledger inside the
 * prestige system makes every source id pay out at most once — ever.
 *
 * Age first-conquest milestones are GENERATED from world data below, so
 * adding an Age automatically adds its milestone with zero changes here
 * or in the prestige core. Future sources (combat achievements, special
 * milestones, systems that do not exist yet) only need their own id
 * helper plus a reportReward() call from their wiring layer.
 */

import { AGES } from '../combat/world';

export function ageMilestoneSourceId(ageId: string): string {
  return `age:${ageId}`;
}

export function achievementSourceId(achievementId: string): string {
  return `achievement:${achievementId}`;
}

/** Points granted for the FIRST conquest of any single Age. */
export const AGE_MILESTONE_POINTS = 1;

export interface AgeMilestoneDefinition {
  id: string;
  sourceId: string;
  ageId: string;
  ageName: string;
  points: number;
}

export const AGE_MILESTONES: readonly AgeMilestoneDefinition[] = AGES.map((age) => ({
  id: `milestone-${age.id}`,
  sourceId: ageMilestoneSourceId(age.id),
  ageId: age.id,
  ageName: age.name,
  points: AGE_MILESTONE_POINTS,
}));

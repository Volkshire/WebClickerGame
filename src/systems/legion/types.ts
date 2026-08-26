import type { UnitTag, UnitType } from '../combat/unitTypes';

export interface LegionState {
  unlocked: boolean;
  /** Troop counts keyed by unit id; absent ids are zero. */
  units: Record<string, number>;
  /** Tier latches for units whose reveal is 'concealed' or 'teaser'. */
  unlockedUnits: Record<string, boolean>;
}

export interface LegionChangedPayload {
  unlocked: boolean;
  /** Troop counts keyed by unit id; absent ids are zero. */
  units: Record<string, number>;
  /** Tier latches for units whose reveal is 'concealed' or 'teaser'. */
  unlockedUnits: Record<string, boolean>;
}

export interface ArmyUnitGroup {
  unitId: string;
  name: string;
  count: number;
  combatPowerEach: number;
  /** Combat taxonomy carried into battles for type/tag interactions. */
  type?: UnitType;
  tags?: readonly UnitTag[];
}

export const LegionEvents = {
  Changed: 'legion:changed',
} as const;

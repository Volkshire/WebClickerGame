export type TerrainType = 
  | 'plains' 
  | 'forest' 
  | 'hills' 
  | 'mountains' 
  | 'settlement'
  | 'walled-settlement'
  | 'fortress';

/**
 * Multiplicative Effective Power modifiers per side.
 *
 * This table is the single extension point for future combat modifiers
 * (research, technology, commanders, weather, ...): add a field here and
 * include it in the resolver's modifier product. Nothing else changes.
 */
export const TERRAIN_MODIFIERS: Record<TerrainType, { attacker: number; defender: number }> = {
  plains: { attacker: 1.0, defender: 1.0 },
  forest: { attacker: 0.9, defender: 1.1 },
  hills: { attacker: 0.85, defender: 1.15 },
  mountains: { attacker: 0.65, defender: 1.35 },
  settlement: { attacker: 0.85, defender: 1.2 },
  'walled-settlement': { attacker: 0.8, defender: 1.25 },
  'fortress': { attacker: 0.7, defender: 1.35 },
};

export function getTerrainModifiers(terrain: TerrainType): {
  attacker: number;
  defender: number;
} {
  return TERRAIN_MODIFIERS[terrain];
}

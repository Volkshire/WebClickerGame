export type UpgradeLevelMap = Record<string, number>;
export type GeneratorOwnedMap = Record<string, number>;

export interface ClickerState {
  souls: number;
  totalClicks: number;
  upgrades: UpgradeLevelMap;
  generators: GeneratorOwnedMap;
  lastSeen: number | null;
}

export interface UpgradeView {
  id: string;
  name: string;
  level: number;
  cost: number;
  effectText: string;
  flavor?: string;
}

export interface GeneratorView {
  id: string;
  name: string;
  owned: number;
  cost: number;
  effectText: string;
  flavor?: string;
}

export interface ClickerChangedPayload {
  souls: number;
  totalClicks: number;
  soulsPerClick: number;
  soulsPerSecond: number;
  harvestMultiplier: number;
  upgrades: readonly UpgradeView[];
  generators: readonly GeneratorView[];
}

export const ClickerEvents = {
  Changed: 'clicker:changed',
} as const;

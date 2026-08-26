export type ResourceId = 'bone' | 'flesh' | 'iron';

export const RESOURCE_IDS: ResourceId[] = ['bone', 'flesh', 'iron'];

export interface ResourceAmounts {
  bone: number;
  flesh: number;
  iron: number;
}

export interface ResourceChangedPayload {
  bone: number;
  flesh: number;
  iron: number;
}

export const ResourceEvents = {
  Changed: 'resources:changed',
} as const;

export function isResourceId(value: unknown): value is ResourceId {
  return typeof value === 'string' && RESOURCE_IDS.includes(value as ResourceId);
}

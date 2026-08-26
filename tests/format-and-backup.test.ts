import { describe, expect, it } from 'vitest';
import { formatNumber } from '../src/ui/format';
import {
  BACKUP_FORMAT,
  GAME_SAVE_KEYS,
  parseImport,
} from '../src/core/SaveBackup';
import { SAVE_SCHEMA_VERSION } from '../src/core/SaveManager';

describe('formatNumber abbreviation tiers', () => {
  it('formats small numbers with locale separators', () => {
    expect(formatNumber(999_999)).toBe('999,999');
    expect(formatNumber(0)).toBe('0');
  });

  it('abbreviates through the suffix table', () => {
    expect(formatNumber(1_500_000)).toBe('1.50M');
    expect(formatNumber(2_500_000_000)).toBe('2.50B');
    expect(formatNumber(3_200_000_000_000)).toBe('3.20T');
  });

  it('keeps correct tiers past Qi (old bug pinned everything at Qi)', () => {
    expect(formatNumber(1e21)).toBe('1.00Sx');
    expect(formatNumber(1e24)).toBe('1.00Sp');
    expect(formatNumber(1.5e27)).toBe('1.50Oc');
    expect(formatNumber(1e33)).toBe('1.00Dc');
  });

  it('falls back to scientific notation past the suffix table', () => {
    expect(formatNumber(1e36)).toBe('1.00e36');
    expect(formatNumber(1.2345e40)).toBe('1.23e40');
  });

  it('handles negative values', () => {
    expect(formatNumber(-2_500_000)).toBe('-2.50M');
  });
});

function backupPayload(schemaVersion: number): string {
  return JSON.stringify({
    app: 'endless-souls',
    format: BACKUP_FORMAT,
    schemaVersion,
    exportedAt: new Date().toISOString(),
    origin: 'test://',
    data: { [GAME_SAVE_KEYS[0]]: { v: SAVE_SCHEMA_VERSION, souls: 10 } },
  });
}

describe('parseImport schema gate', () => {
  it('accepts a backup matching the current schema', () => {
    const parsed = parseImport(backupPayload(SAVE_SCHEMA_VERSION));
    expect(parsed.ok).toBe(true);
    expect(parsed.problem).toBeNull();
    expect(parsed.entries.length).toBe(1);
  });

  it('rejects backups from a NEWER schema before any confirm dialog', () => {
    const parsed = parseImport(backupPayload(SAVE_SCHEMA_VERSION + 1));
    expect(parsed.ok).toBe(false);
    expect(parsed.entries.length).toBe(0);
    expect(parsed.problem).toMatch(/newer game version/i);
  });

  it('rejects backups from an OLDER schema', () => {
    const parsed = parseImport(backupPayload(SAVE_SCHEMA_VERSION - 1));
    expect(parsed.ok).toBe(false);
    expect(parsed.entries.length).toBe(0);
    expect(parsed.problem).toMatch(/older game version/i);
  });

  it('rejects backups missing a schema version entirely', () => {
    const raw = JSON.parse(backupPayload(SAVE_SCHEMA_VERSION));
    delete (raw as Record<string, unknown>)['schemaVersion'];
    const parsed = parseImport(JSON.stringify(raw));
    expect(parsed.ok).toBe(false);
    expect(parsed.entries.length).toBe(0);
    expect(parsed.problem).toMatch(/schema version/i);
  });
});

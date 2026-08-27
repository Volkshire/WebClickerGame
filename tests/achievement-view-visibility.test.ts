// @vitest-environment jsdom
/**
 * Regression: achievement reveal/mask presentation in the DOM panel.
 *
 * The system layer (AchievementSystem.buildViews) always returns the real
 * name/description for a completed spoiler achievement. The previous bug
 * lived in the VIEW: a row created while hidden ("???" / "Hidden
 * achievement") was reused across renders and updateRow never refreshed its
 * static name/description/reward text, so it kept showing "???" even after
 * the achievement completed (chip said "✓ Done", text stayed redacted).
 *
 * These tests pin AchievementView to always mirror the payload's current
 * text, covering immediate reveal, Prestige permanence, save/load, legacy
 * "already completed in an existing save" reveal, and that genuinely
 * incomplete spoilers stay hidden.
 */
import { describe, expect, it } from 'vitest';
import { AchievementView } from '../src/systems/achievements/AchievementView';
import type { AchievementsChangedPayload } from '../src/systems/achievements/types';

type ViewData = AchievementsChangedPayload['achievements'][number];

function hiddenSpoiler(id: string): ViewData {
  return {
    id,
    name: '???',
    description: 'Hidden achievement',
    completed: false,
    progress: null,
    rewardText: '',
    masked: true,
  };
}

function completedSpoiler(id: string): ViewData {
  const defs: Record<string, { name: string; desc: string }> = {
    'blood-price': { name: 'Blood Price', desc: 'Clear your first campaign target.' },
    'first-recruit': { name: 'First Recruit', desc: 'Raise your first undead.' },
    'era-breaker': { name: 'Era Breaker', desc: 'Conquer an entire Age.' },
    'double-conquest': { name: 'Double Conquest', desc: 'Conquer two Ages in a single run.' },
  };
  const d = defs[id];
  return {
    id,
    name: d.name,
    description: d.desc,
    completed: true,
    progress: { current: 1, goal: 1 },
    rewardText: '+1 Prestige Point',
    masked: false,
  };
}

/** Builds the DOM fixture the AchievementView constructor requires. */
function buildFixture(): { view: AchievementView; list: HTMLElement; summary: HTMLElement } {
  document.body.innerHTML =
    '<button data-achievements="toggle"></button>' +
    '<div data-achievements="panel" hidden></div>' +
    '<span data-achievements="summary"></span>' +
    '<div data-achievements="list"></div>' +
    '<button data-achievements="close"></button>';
  const root = document.body;
  const list = root.querySelector<HTMLElement>('[data-achievements="list"]')!;
  const summary = root.querySelector<HTMLElement>('[data-achievements="summary"]')!;
  const view = new AchievementView(root);
  return { view, list, summary };
}

function rowText(list: HTMLElement, index: number) {
  const row = list.children[index] as HTMLElement;
  const nameEl = row.querySelector<HTMLElement>('.item-name span')!;
  const descEl = row.querySelector<HTMLElement>('.achievement-desc')!;
  const rewardEl = row.querySelector<HTMLElement>('.achievement-reward')!;
  const chip = row.querySelector<HTMLElement>('.achievement-status')!;
  return {
    name: nameEl.textContent,
    description: descEl.textContent,
    reward: rewardEl.textContent,
    chip: chip.textContent,
    rowClass: row.className,
  };
}

function payload(achievements: ViewData[]): AchievementsChangedPayload {
  return {
    achievements,
    completedCount: achievements.filter((a) => a.completed).length,
  };
}

describe('AchievementView reveal/mask', () => {
  it('complete a hidden achievement before any Prestige -> immediately visible + Done', () => {
    const { view, list } = buildFixture();

    // Fresh game: blood-price (spoiler) is undiscovered -> redacted row.
    view.render(payload([hiddenSpoiler('blood-price')]));
    expect(rowText(list, 0).name).toBe('???');
    expect(rowText(list, 0).description).toBe('Hidden achievement');
    expect(rowText(list, 0).chip).toBe('Hidden');
    expect(rowText(list, 0).rowClass).toContain('is-masked');

    // The same row completes -> must reveal its real identity immediately.
    view.render(payload([completedSpoiler('blood-price')]));

    const revealed = rowText(list, 0);
    expect(revealed.name).toBe('Blood Price');
    expect(revealed.description).toBe('Clear your first campaign target.');
    expect(revealed.reward).toBe('+1 Prestige Point');
    expect(revealed.chip).toBe('✓ Done');
    expect(revealed.rowClass).toContain('is-completed');
    expect(revealed.rowClass).not.toContain('is-masked');
  });

  it('Prestige afterward -> achievement remains visible and Done', () => {
    const { view, list } = buildFixture();

    view.render(payload([completedSpoiler('first-recruit')]));
    expect(rowText(list, 0).name).toBe('First Recruit');

    // Simulate the post-Prestige re-evaluation publishing the same latched
    // completed row (run state reset does not un-complete the achievement).
    view.render(payload([completedSpoiler('first-recruit')]));

    const after = rowText(list, 0);
    expect(after.name).toBe('First Recruit');
    expect(after.chip).toBe('✓ Done');
    expect(after.rowClass).toContain('is-completed');
    expect(after.rowClass).not.toContain('is-masked');
  });

  it('save/load -> achievement remains visible and Done', () => {
    const { view, list } = buildFixture();

    // Boot restore of a save that completed era-breaker: the fresh view must
    // render the real identity (no stale hidden row anywhere).
    view.render(payload([completedSpoiler('era-breaker')]));

    const restored = rowText(list, 0);
    expect(restored.name).toBe('Era Breaker');
    expect(restored.chip).toBe('✓ Done');
    expect(restored.rowClass).not.toContain('is-masked');
  });

  it('incomplete hidden achievements remain ???', () => {
    const { view, list } = buildFixture();
    view.render(payload([hiddenSpoiler('double-conquest')]));
    const hidden = rowText(list, 0);
    expect(hidden.name).toBe('???');
    expect(hidden.description).toBe('Hidden achievement');
    expect(hidden.chip).toBe('Hidden');
    expect(hidden.rowClass).toContain('is-masked');
  });

  it('migrates a completed hidden achievement from an existing save to visible + Done', () => {
    const { view, list } = buildFixture();

    // A legacy save whose blob lists first-recruit as completed: the row must
    // render revealed even though it was previously described as hidden.
    view.render(payload([completedSpoiler('first-recruit')]));

    const migrated = rowText(list, 0);
    expect(migrated.name).toBe('First Recruit');
    expect(migrated.description).toBe('Raise your first undead.');
    expect(migrated.chip).toBe('✓ Done');
    expect(migrated.rowClass).not.toContain('is-masked');
  });
});
import { describe, expect, it } from 'vitest';
import { MAX_RECRUIT_AMOUNT, payableCount } from '../src/systems/legion/afford';
import { WRAITH_UNIT, SKELETON_UNIT } from '../src/systems/legion/units';

describe('Legion MAX recruitment hotfix', () => {
  it('caps MAX recruitment at exactly 1Qa', () => {
    const count = payableCount(WRAITH_UNIT, {
      souls: 9_999_999_999_999_999,
      bone: 0,
      flesh: 0,
      iron: 0,
    });

    expect(MAX_RECRUIT_AMOUNT).toBe(1_000_000_000_000_000);
    expect(count).toBe(MAX_RECRUIT_AMOUNT);
  });

  it('still respects affordability below the 1Qa cap', () => {
    expect(
      payableCount(WRAITH_UNIT, {
        souls: 500_000,
        bone: 0,
        flesh: 0,
        iron: 0,
      }),
    ).toBe(500_000);
  });

  it('caps multi-resource units at the first limiting resource', () => {
    expect(
      payableCount(SKELETON_UNIT, {
        souls: 2_000_000_000_000_000,
        bone: 250_000_000_000_000,
        flesh: 0,
        iron: 0,
      }),
    ).toBe(250_000_000_000_000);
  });

  it('allows a MAX amount to remain a safe integer for the current Number path', () => {
    expect(Number.isSafeInteger(MAX_RECRUIT_AMOUNT)).toBe(true);
  });
});

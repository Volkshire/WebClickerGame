/**
 * Test-only in-memory localStorage shim (vitest runs in node env, which
 * has no storage). Stored keys are exposed as enumerable own properties,
 * matching real localStorage semantics that `Object.keys(localStorage)`
 * relies on. Supports scripted write failures for testing persistence
 * read-back gates.
 */

export interface MemoryStorage {
  /** Seeds storage through the shim path so reads/enumeration see it. */
  seed: (key: string, value: string) => void;
  /** Makes the next N setItem calls throw (simulated quota failure). */
  failNextWrites: (count: number) => void;
}

export function installMemoryStorage(): MemoryStorage {
  let failuresRemaining = 0;

  // Storage data lives as enumerable own props on the shim itself, so
  // Object.keys(localStorage) sees exactly the stored keys (real-storage
  // behavior SaveBackup's prefix sweep depends on). Methods are defined
  // non-enumerable so they never pollute that view.
  const shim = {} as Record<string | symbol, unknown> & { length: number };

  const methods = {
    getItem: (key: string): string | null =>
      Object.prototype.hasOwnProperty.call(shim, key) ? (shim[key] as string) : null,
    setItem: (key: string, value: string): void => {
      if (failuresRemaining > 0) {
        failuresRemaining -= 1;
        throw new Error('simulated quota failure');
      }
      shim[key] = String(value);
    },
    removeItem: (key: string): void => {
      delete shim[key];
    },
    clear: (): void => {
      for (const key of Object.keys(shim)) delete shim[key];
    },
    key: (index: number): string | null => Object.keys(shim)[index] ?? null,
    length: 0, // replaced by a live getter below
  };

  for (const [name, fn] of Object.entries(methods)) {
    Object.defineProperty(shim, name, {
      value: fn,
      enumerable: false,
      configurable: true,
      writable: true,
    });
  }
  Object.defineProperty(shim, 'length', {
    get: () => Object.keys(shim).length,
    enumerable: false,
    configurable: true,
  });

  (globalThis as unknown as { localStorage: unknown }).localStorage = shim;

  return {
    seed: (key: string, value: string) => {
      shim[key] = String(value);
    },
    failNextWrites: (count: number) => {
      failuresRemaining = count;
    },
  };
}

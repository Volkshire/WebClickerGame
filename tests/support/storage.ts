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

function createStorageShim(failuresRef: { count: number }) {
  const shim = {} as Record<string | symbol, unknown> & { length: number };

  const methods = {
    getItem: (key: string): string | null =>
      Object.prototype.hasOwnProperty.call(shim, key) ? (shim[key] as string) : null,
    setItem: (key: string, value: string): void => {
      if (failuresRef.count > 0) {
        failuresRef.count -= 1;
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

  return shim;
}

export function installMemoryStorage(): MemoryStorage {
  const failuresRef = { count: 0 };

  const localShim = createStorageShim(failuresRef);
  const sessionShim = createStorageShim(failuresRef);

  (globalThis as unknown as { localStorage: unknown }).localStorage = localShim;
  (globalThis as unknown as { sessionStorage: unknown }).sessionStorage = sessionShim;

  return {
    seed: (key: string, value: string) => {
      localShim[key] = String(value);
    },
    failNextWrites: (count: number) => {
      failuresRef.count = count;
    },
  };
}

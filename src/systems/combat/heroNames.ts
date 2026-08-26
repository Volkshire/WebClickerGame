export const BUILT_IN_HERO_NAMES: ReadonlyArray<string> = [
  'Aldric',
  'Brigid',
  'Cedric',
  'Dierna',
  'Eamon',
  'Fiona',
  'Gareth',
  'Hilde',
  'Ivor',
  'Jora',
  'Kael',
  'Lyra',
  'Marian',
  'Niall',
  'Orla',
  'Phelan',
  'Quinn',
  'Roisin',
  'Saoirse',
  'Tadhg',
  'Úna',
  'Ailis',
  'Blaithín',
  'Caoimhe',
  'Daire',
  'Eireann',
  'Fiachra',
  'Grainne',
  'Aodhan',
  'Bláthnaid',
  'Cian',
  'Deirdre',
  'Eoghan',
  'Fionn',
  'Ailbhe',
  'Liath',
];

export function mergeNamesFile(rawContent: string): string[] {
  const entries = rawContent
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
  const deduped = [...new Set(entries.map((n) => n.toLowerCase()))].map(
    (n) => n.replace(/(^|\s)\S/g, (c) => c.toUpperCase()),
  );
  const merged = [...new Set([...BUILT_IN_HERO_NAMES, ...deduped])];
  return merged;
}

export function pickUnique(
  pool: ReadonlyArray<string>,
  alreadySeen: ReadonlySet<string>,
  rng: () => number,
): string | undefined {
  const available = pool.filter((name) => !alreadySeen.has(name.toLowerCase()));
  if (available.length === 0) return undefined;
  return available[Math.floor(rng() * available.length)];
}

/**
 * Shuffle-bag over the hero name pool: every name appears exactly ONCE per
 * cycle; only when the whole list has been dealt does it reshuffle and start
 * a new cycle. Names in the exclusion set are skipped (and stay burned —
 * they were drawn before), so grudge-locked identities never block the bag.
 */
export class NameDeck {
  private queue: string[] = [];

  constructor(
    private readonly pool: ReadonlyArray<string>,
    /** Restores a previously serialized remaining order (save blobs). */
    initialOrder?: readonly string[],
  ) {
    const clean = pool.map((n) => n.trim()).filter((n) => n.length > 0);
    if (
      initialOrder !== undefined &&
      NameDeck.isValidRemaining(clean, initialOrder)
    ) {
      this.queue = [...initialOrder];
    } else {
      this.reshuffle(() => 0);
    }
  }

  /**
   * A persisted order is valid when it holds unique, known names and is not
   * longer than the pool — dealt names are intentionally ABSENT (they were
   * burned this cycle), so length < pool.length is normal.
   */
  private static isValidRemaining(pool: readonly string[], order: readonly string[]): boolean {
    if (order.length > pool.length) return false;
    const key = (s: string) => s.toLowerCase();
    const poolSet = new Set(pool.map(key));
    const seen = new Set<string>();
    for (const name of order) {
      const k = key(name);
      if (!poolSet.has(k) || seen.has(k)) return false;
      seen.add(k);
    }
    return true;
  }

  private reshuffle(rng: () => number): void {
    this.queue = [...this.pool];
    for (let i = this.queue.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = this.queue[i]!;
      this.queue[i] = this.queue[j]!;
      this.queue[j] = tmp;
    }
  }

  /** Remaining names in deal order (for persistence). */
  serialize(): string[] {
    return [...this.queue];
  }

  /**
   * Pops the next non-excluded name, reshuffling when the cycle depletes.
   * Returns undefined only when every name in the pool is excluded.
   */
  draw(excluded: ReadonlySet<string>, rng: () => number): string | undefined {
    let safety = this.pool.length + 1;
    while (true) {
      if (this.queue.length === 0) {
        if (this.pool.length === 0 || safety <= 0) return undefined;
        this.reshuffle(rng);
      }
      const name = this.queue.shift();
      if (name === undefined) return undefined;
      safety -= 1;
      if (!excluded.has(name.toLowerCase())) return name;
      // Excluded names were already seen somewhere — burned, keep popping.
    }
  }
}
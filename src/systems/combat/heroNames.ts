/**
 * Hero name pools and selection logic.
 *
 * Two pools feed the NameDeck:
 *  - **custom**: names from `hero-names.txt` (user-supplied, strong priority).
 *  - **generated**: built-in names (variety filler).
 *
 * The deck uses a weighted shuffle-bag: each pool is dealt exhaustively before
 * reshuffling, but every draw attempt picks from the custom pool with
 * {@link CUSTOM_NAME_WEIGHT} probability.  This keeps custom names prominent
 * while the large generated pool prevents repetition from feeling stale.
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Probability (0–1) that a fresh name draw attempts the custom pool first.
 * The remainder falls through to the generated pool.  Both pools still
 * guarantee no intra-cycle repeats via the shuffle-bag.
 */
export const CUSTOM_NAME_WEIGHT = 0.75;

/** Maximum number of recently-dealt names remembered across cycles to
 *  discourage the same hero from appearing twice in quick succession. */
export const MAX_RECENT_NAMES = 20;

// ---------------------------------------------------------------------------
// Built-in generated name pool (dark-fantasy / Celtic / Norse variety)
// ---------------------------------------------------------------------------

export const BUILT_IN_HERO_NAMES: ReadonlyArray<string> = [
  // ── Original Celtic core ──
  'Aldric', 'Brigid', 'Cedric', 'Dierna', 'Eamon', 'Fiona', 'Gareth',
  'Hilde', 'Ivor', 'Jora', 'Kael', 'Lyra', 'Marian', 'Niall', 'Orla',
  'Phelan', 'Quinn', 'Roisin', 'Saoirse', 'Tadhg', 'Úna', 'Ailis',
  'Blaithín', 'Caoimhe', 'Daire', 'Eireann', 'Fiachra', 'Grainne',
  'Aodhan', 'Bláthnaid', 'Cian', 'Deirdre', 'Eoghan', 'Fionn', 'Ailbhe',
  'Liath',
  // ── Extended Celtic / Gaelic ──
  'Alaric', 'Brenna', 'Cormac', 'Dervla', 'Ennis', 'Gormlaith', 'Hamish',
  'Iseult', 'Keiran', 'Lorcan', 'Maeve', 'Naoise', 'Oisín', 'Padraig',
  'Riordan', 'Sorcha', 'Tadgh', 'Uallach', 'Aengus', 'Bébhinn', 'Cathal',
  'Donnchadh', 'Eithne', 'Fergal', 'Gormflaith', 'Laoise', 'Muirgen',
  'Oscar', 'Rónán', 'Séamus', 'Tríona', 'Ailill', 'Brónach', 'Colmán',
  'Dubhghlas', 'Eimhir', 'Fearghal', 'Gráinne', 'Libbh', 'Meabh',
  'Nóra', 'Pádraig', 'Ríonach', 'Síofra', 'Turlough',
  // ── Norse / Scandinavian ──
  'Bjorn', 'Freya', 'Sigurd', 'Astrid', 'Erik', 'Ingrid', 'Leif', 'Solveig',
  'Gunhild', 'Halvard', 'Iduna', 'Jorund', 'Kari', 'Lagertha', 'Magnus',
  'Njord', 'Odin', 'Ragnar', 'Skuld', 'Thyra', 'Ulf', 'Vidar', 'Yrsa',
  'Astridr', 'Birger', 'Eirik', 'Freydis', 'Gunnar', 'Helga', 'Ivar',
  'Jarl', 'Kolbjorn', 'Liv', 'Mord', 'Nanna', 'Orm', 'Rune', 'Stellan',
  'Torsten', 'Ulfheid', 'Valgar', 'Yngvar',
  // ── Dark fantasy / Anglo-Saxon / Germanic ──
  'Ash', 'Ember', 'Raven', 'Thorne', 'Briar', 'Cinder', 'Dusk', 'Fell',
  'Grim', 'Harrow', 'Iren', 'Keel', 'Mourn', 'Nether', 'Obsidian', 'Pyre',
  'Quill', 'Shade', 'Vael', 'Wren', 'Bane', 'Corvus', 'Dread', 'Eclipse',
  'Fang', 'Ghast', 'Hollow', 'Jinx', 'Krest', 'Lurk', 'Malice', 'Noctis',
  'Omen', 'Pall', 'Rift', 'Spine', 'Umbral', 'Vex', 'Wraith', 'Zephyr',
  'Ashfall', 'Blackthorn', 'Crowley', 'Darkhollow', 'Evenmist', 'Flint',
  'Grave', 'Ironclad', 'Jet', 'Kohl', 'Lich', 'Moondrake', 'Nightshade',
  'Onyx', 'Pyrebane', 'Quiet', 'Ruin', 'Steelgrip', 'Tenebris', 'Void',
  'Wyrm', 'Yew',
  // ── Eastern / mixed-cultural variety ──
  'Akira', 'Zara', 'Kaito', 'Mei', 'Ren', 'Sora', 'Yuki', 'Hiro',
  'Takeshi', 'Amara', 'Bodhi', 'Chandra', 'Durga', 'Enki', 'Farid',
  'Gita', 'Hana', 'Isolde', 'Jiro', 'Kira', 'Lian', 'Mika', 'Nuru',
  'Omari', 'Priya', 'Ravi', 'Shiro', 'Tala', 'Usha', 'Veda', 'Wren',
  'Xia', 'Yara', 'Zuri',
  // ── Additional variety fillers ──
  'Anvil', 'Barrow', 'Cadence', 'Dagger', 'Escott', 'Fenn', 'Garrett',
  'Hal', 'Irons', 'Joss', 'Kane', 'Leora', 'Mace', 'Nell', 'Osric',
  'Penn', 'Rook', 'Sable', 'Tarn', 'Ulric', 'Vance', 'Wulf', 'Yves',
  'Zeke', 'Ashton', 'Brock', 'Callum', 'Dane', 'Everett', 'Falk',
  'Grant', 'Heath', 'Isaac', 'Jasper', 'Kit', 'Linden', 'Milo',
  'Nash', 'Orion', 'Pierce', 'Quinn', 'Reed', 'Silas', 'Theron',
  'Urian', 'Vale', 'Ward',
];

// ---------------------------------------------------------------------------
// Merge external custom names file
// ---------------------------------------------------------------------------

export interface HeroNamePools {
  /** Names the user added via hero-names.txt (high priority). */
  custom: readonly string[];
  /** Built-in generated names (variety filler). */
  generated: readonly string[];
}

/**
 * Parses `hero-names.txt` content, deduplicates case-insensitively, and
 * returns the split pools.  Built-in names are always available in the
 * generated pool regardless of whether they also appear in the file.
 */
export function mergeNamesFile(rawContent: string): HeroNamePools {
  const entries = rawContent
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));

  const seen = new Set<string>();
  const custom: string[] = [];
  for (const raw of entries) {
    const key = raw.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    // Title-case: first letter (and first letter after whitespace) uppercase.
    custom.push(raw.replace(/(^|\s)\S/g, (c) => c.toUpperCase()));
  }

  return { custom, generated: [...BUILT_IN_HERO_NAMES] };
}

// ---------------------------------------------------------------------------
// Uniform-random fallback (used when no NameDeck is available)
// ---------------------------------------------------------------------------

export function pickUnique(
  pool: ReadonlyArray<string>,
  alreadySeen: ReadonlySet<string>,
  rng: () => number,
): string | undefined {
  const available = pool.filter((name) => !alreadySeen.has(name.toLowerCase()));
  if (available.length === 0) return undefined;
  return available[Math.floor(rng() * available.length)];
}

// ---------------------------------------------------------------------------
// Weighted shuffle-bag deck
// ---------------------------------------------------------------------------

/**
 * Two-pool weighted shuffle-bag: each sub-pool is dealt exhaustively before
 * reshuffling, but every draw attempt picks from the custom pool with
 * {@link CUSTOM_NAME_WEIGHT} probability first.  This guarantees:
 *
 *  - No intra-cycle repeats within a pool.
 *  - Custom names appear prominently (~75 % of draws when pool has stock).
 *  - Recently-dealt names are excluded across cycles until the pool
 *    recycles.
 */
export class NameDeck {
  private customQueue: string[] = [];
  private generatedQueue: string[] = [];
  /** Ring-buffer of recently dealt lowercased names (cross-cycle exclusion). */
  private recent: string[] = [];

  constructor(
    private readonly customPool: ReadonlyArray<string>,
    private readonly generatedPool: ReadonlyArray<string>,
    /** Restores a previously serialized deck state (save blobs). */
    initialOrder?: { custom: readonly string[]; generated: readonly string[]; recent?: readonly string[] },
  ) {
    const cleanCustom = customPool.map((n) => n.trim()).filter((n) => n.length > 0);
    const cleanGenerated = generatedPool.map((n) => n.trim()).filter((n) => n.length > 0);

    if (
      initialOrder !== undefined &&
      NameDeck.isValidRemaining(cleanCustom, initialOrder.custom) &&
      NameDeck.isValidRemaining(cleanGenerated, initialOrder.generated)
    ) {
      this.customQueue = [...initialOrder.custom];
      this.generatedQueue = [...initialOrder.generated];
      if (initialOrder.recent !== undefined) {
        this.recent = [...initialOrder.recent].slice(-MAX_RECENT_NAMES);
      }
    } else {
      this.reshuffle(() => 0);
    }
  }

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
    this.fisherYatesShuffle((this.customQueue = [...this.customPool]), rng);
    this.fisherYatesShuffle((this.generatedQueue = [...this.generatedPool]), rng);
  }

  private fisherYatesShuffle(arr: string[], rng: () => number): void {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = arr[i]!;
      arr[i] = arr[j]!;
      arr[j] = tmp;
    }
  }

  /** Serializable state for persistence (save blobs). */
  serialize(): { custom: string[]; generated: string[]; recent: string[] } {
    return {
      custom: [...this.customQueue],
      generated: [...this.generatedQueue],
      recent: [...this.recent],
    };
  }

  /** Total names across both pools (for diagnostics). */
  get size(): number {
    return this.customPool.length + this.generatedPool.length;
  }

  /**
   * Draws the next fresh hero name.  With probability
   * {@link CUSTOM_NAME_WEIGHT} the custom pool is tried first; otherwise the
   * generated pool.  If the chosen pool is exhausted it reshuffles; if
   * both are exhausted `undefined` is returned.
   *
   * Names in `excluded` are skipped (burned) just as before, and recently
   * dealt names are excluded until the pool cycles past them.
   */
  draw(excluded: ReadonlySet<string>, rng: () => number): string | undefined {
    const tryCustomFirst = rng() < CUSTOM_NAME_WEIGHT;

    if (tryCustomFirst) {
      const name = this.drawFromQueue(this.customQueue, this.customPool, excluded, rng);
      if (name !== undefined) return name;
      // Custom pool fully exhausted or excluded — fall through to generated.
      return this.drawFromQueue(this.generatedQueue, this.generatedPool, excluded, rng);
    }

    const name = this.drawFromQueue(this.generatedQueue, this.generatedPool, excluded, rng);
    if (name !== undefined) return name;
    return this.drawFromQueue(this.customQueue, this.customPool, excluded, rng);
  }

  private drawFromQueue(
    queue: string[],
    pool: ReadonlyArray<string>,
    excluded: ReadonlySet<string>,
    rng: () => number,
  ): string | undefined {
    let safety = pool.length + 1;
    while (true) {
      if (queue.length === 0) {
        if (pool.length === 0 || safety <= 0) return undefined;
        queue.push(...pool);
        this.fisherYatesShuffle(queue, rng);
        // Clear recent list on reshuffle so small pools can cycle freely.
        this.recent = [];
      }
      const name = queue.shift();
      if (name === undefined) return undefined;
      safety -= 1;
      const lower = name.toLowerCase();
      if (excluded.has(lower)) continue;
      if (this.recent.includes(lower)) continue;
      this.pushRecent(lower);
      return name;
    }
  }

  private pushRecent(lower: string): void {
    this.recent.push(lower);
    if (this.recent.length > MAX_RECENT_NAMES) this.recent.shift();
  }
}

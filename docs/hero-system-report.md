# Hero System — Comprehensive Report

> Generated from codebase analysis. Covers all hero-related mechanics, data flow, and constants.

---

## Table of Contents

1. [Identity & Name System](#1-identity--name-system)
2. [Hero Army Generation](#2-hero-army-generation)
3. [Combat Mechanics](#3-combat-mechanics)
4. [Hero Skills & Abilities](#4-hero-skills--abilities)
5. [Hero Fates (Post-Battle)](#5-hero-fates-post-battle)
6. [Persistence & Grudge System](#6-persistence--grudge-system)
7. [Display & UI](#7-display--ui)
8. [All Constants Reference](#8-all-constants-reference)
9. [Data Flow Diagram](#9-data-flow-diagram)
10. [File Index](#10-file-index)

---

## 1. Identity & Name System

### 1.3 Mech special entities (Age of Machines)

Age configuration can replace the default human-Hero slots with a special-entity
pool. `age-of-machines` selects `{ kind: 'mech', namePool: 'mech',
maxPerTarget: 3 }`; no combat-engine Age-name check is used. Mechs remain
individual Hero-style defender stacks, so each has independent ability cooldowns
and once-per-battle state, but they draw only `MECH_SKILLS` and never consume the
human name deck. `public/mech-names.txt` is the editable custom source; comments
and blank lines are ignored, and its names receive a configurable 90% first-pick
weight over the built-in Mech fallback. Existing standing defender names are
already persisted by target; an Age of Machines target therefore recreates its
persisted name as a Mech even if the editable pool later changes.

The proof-of-concept Mech pool includes Machine Gun Barrage, Missile Salvo,
Armor Plating, Overdrive, Railgun, and once-per-battle Nuclear Payload. All use
the shared ability runtime, conditions, cooldowns, exact casualty reporting, and
dramatic high-tier battle-log presentation. Mechanical arrival, damage, and
destruction flavor is supplied by the shared battle flavor module.

### 1.1 Name Pool Sources

| Source | Location | Names |
|--------|----------|-------|
| Built-in pool | `src/systems/combat/heroNames.ts:1-38` | 37 Celtic/Gaelic-themed names |
| External file | `public/hero-names.txt` | Same 37 + custom additions |

Lines starting with `#` in the text file are comments; blank lines are ignored.

### 1.2 Pool Merging & Deduplication

**`mergeNamesFile()`** (`heroNames.ts:40-50`):
- Splits raw file content on newlines, trims, filters blanks/comments.
- Deduplicates by lowercasing all entries via `new Set()`.
- Title-cases each surviving name.
- Merges with `BUILT_IN_HERO_NAMES` via another `new Set()`.

### 1.3 Name Picking — Two Strategies

**Strategy A: Uniform random (`pickUnique`)** (`heroNames.ts:52-60`)
- Filters pool to exclude names in `alreadySeen`.
- Picks one uniformly at random.
- Returns `undefined` if pool exhausted.

**Strategy B: Shuffle-bag deck (`NameDeck`)** (`heroNames.ts:68-138`)
- Fisher-Yates shuffle of the full pool.
- Every name drawn exactly once per cycle before reshuffling.
- `draw()` skips names in `excluded` set (burned — not returned to pool).
- `serialize()` / constructor with `initialOrder` for save/restore.
- Fallback: if no deck, `pickUnique()` is used.

### 1.4 Integration in CombatSystem

| Method | Location | Purpose |
|--------|----------|---------|
| `setHeroNames(pool)` | `CombatSystem.ts:400-405` | Installs pool, creates/updates `NameDeck` |
| `drawHeroName(excluded)` | `CombatSystem.ts:412-417` | Lazily creates deck, calls `deck.draw()` |
| `pendingDeckOrder` | `CombatSystem.ts:303` | Stores serialized deck from save before pool loads |

---

## 2. Hero Army Generation

### 2.1 Core Function: `rollTargetArmy`

**File:** `src/systems/combat/enemyUnits.ts:255-383`

| Parameter | Type | Purpose |
|-----------|------|---------|
| `entries` | `ArmyCompositionEntry[]` | Base garrison composition |
| `heroChance` | `number` | Per-slot independent roll chance |
| `rng` | `() => number` | RNG source |
| `names` | `string[]` | Hero name pool |
| `currentTargetOrder` | `number` | 1-based target position |
| `fledHeroes` | `{name, fledOrder}[]` | Grudge ledger |
| `isFinalTarget` | `boolean` | Age finale flag |
| `targetCombatPower` | `number` | Target CP for scaling |
| `drawHeroName` | callback | Shuffle-bag draw function |
| `standingHeroes` | `string[]` | Survivors from previous defeat |

### 2.2 Hero Slots and Chance

- **`MAX_HEROES_PER_TARGET = 2`** — every target yields 0–2 hero slots.
- Each slot rolled **independently** (`line 367`).
- Slot filled only if `rng() < heroChance` (`line 368`).

**`heroChance` ladder** (defined in `world.ts:64`):
```
[0, 0.1, 0.18, 0.3, 0.42, 0.55, 0.7, 0.82, 0.92, 0.95]
```
Position 1 = 0% (never), Position 10 = 95% (nearly guaranteed).

### 2.3 Standing Defenders

Heroes from a **previous failed assault** on the SAME target persist.

- Stored via `standingDefenders` map (keyed by target id) in `CombatSystem.ts:318`.
- Deduplication via `survivorByKey` Map (`enemyUnits.ts:342-350`).
- Capped at `MAX_HEROES_PER_TARGET` (`line 351`).
- **Roster lock:** When standing defenders exist and it is NOT a finale, `rosterLocked = true` (`line 352`), function returns early (`line 364`). Repeat attacks face exactly these heroes.
- On a finale, standing defenders claim slots first, remaining slots filled by normal escalation pipeline (`line 366`).
- On **victory**: `standingDefenders.delete(targetId)` (`CombatSystem.ts:681`).
- On **defeat**: surviving hero names recorded (`CombatSystem.ts:671-679`).

### 2.4 Grudge / Fled Veteran System

**`NEMESIS_HIJACK_CHANCE = 0.5`** (`enemyUnits.ts:245`)

**`pickHeroIdentity()`** (`enemyUnits.ts:312-323`):
- Fled hero eligible when `fledOrder < currentTargetOrder` (`line 288`) — must be at a strictly later target.
- On the **final target**, every owed fled hero guaranteed to claim a slot (`line 313`).
- `fledIndex` tracks which fled hero is next in queue.
- If no fled hero claims slot, **fresh name** drawn from shuffle-bag.
- Fresh names exclude all names on the battlefield PLUS all grudge identities (`usedNames()`, lines 296-305).

### 2.5 The Guarantee Loop (Final Targets)

**Lines 377-380:**
After all normal slots processed, if final target and owed fled heroes remain, they are ALL forced onto the field one by one — **beating the MAX_HEROES cap**.

### 2.6 Hero Unit Scaling: `createHeroForTarget`

**File:** `enemyUnits.ts:193-220`

| Property | Formula | Source |
|----------|---------|--------|
| Combat Power | `max(200, round(target.combatPower * 0.06))` | `line 198` |
| Resolve | `heroResolveForOrder(order) + classBonus` | `lines 171-189` |
| Threat (fresh) | `HERO_THREAT_FRESH = 0.04` | `line 30` |
| Threat (nemesis) | `min(0.08, 0.04 + 0.004 * target.order)` | `lines 199-202` |
| Tags | `['armored']` | always |
| Type | `'melee'` | always |
| Tier | `'hero'` | always |
| Tactics | `HERO_CLASS_LOADOUTS[heroClass]` | class-based |
| heroClass | `'caster'\|'ranged'\|'support'\|'tank'` | random assignment |

---

## 3. Combat Mechanics

### 3.1 SimGroup Internal State

**File:** `src/systems/combat/simulation.ts:172-198`

Each hero becomes a `SimGroup` with:

| Field | Purpose |
|-------|---------|
| `resolve` | Remaining effective HP (starts at `maxResolve`) |
| `maxResolve` | Resolve at full health |
| `isHero` | Boolean flag |
| `isReturningNemesis` | Fled veteran returning via grudge |
| `isReturningDefender` | Standing defender from previous defeat |
| `heroThreatAnnounced` | One-shot event flag |
| `heroThreatEscalated` | One-shot event flag |
| `heroBloodiedAnnounced` | One-shot event flag |
| `retreated` | Whether hero fled |
| `ability` | The heroic threat descriptor |
| `tactics` | Ability id array |
| `heroClass` | Hidden class (`'caster'\|'ranged'\|'support'\|'tank'\|null`) |

**`toSimGroup()`** (`simulation.ts:200-226`): Converts `BattleGroupInput` to `SimGroup`. For heroes, `maxResolve` = `input.resolve ?? HERO_RESOLVE_BASE`.

### 3.2 Hero Resolve System

**`applyAttrition()`** (`simulation.ts:747-778`):
- For every group, if `isHero` is true, the normal attrition path is **skipped** (`line 751`).
- Instead, `applyHeroResolveAttrition(group)` is called.

**`applyHeroResolveAttrition()`** (`simulation.ts:862-897`):
```
drain = min(
  heroIncomingFraction(heroSwarmMass(attackerGroups)) *
    heroDamageTakenFraction(livingHeroesSnapshot),
  pacing.maxHeroResolveLossPerTick
)
```
- `livingHeroesSnapshot` is taken once before the defender attrition pass (`simulation.ts:651`) to prevent a death cascade where heroes dying mid-loop amplifies drain on survivors.
- **Tank Immortality:** Tanks return early when `heroClass === 'tank' && !lastStandActive`.
- `group.resolve -= drain` (`line 874`).
- **First wound** (resolve > 0 but first time): emits `HERO_BLOODED_LINES`.
- **Death** (resolve <= 0): sets `resolve = 0`, `surviving = 0`, emits `HERO_SLAIN_LINES`.
- A wounded hero still counts as one whole hero (surviving not reduced until death).

**Class-Based Resolve Bonuses** (`enemyUnits.ts`):
- All heroes start with base resolve from `heroResolveForOrder(order)` = `5 + floor(order/3)`.
- Class bonuses are added on top: Tank +2, Support +3, Caster +0, Ranged +0.
- This ensures Support and Tank heroes survive several ticks longer than Caster/Ranged, giving the Support passive time to revive fallen allies before the Support hero itself dies.

### 3.3 Hero Damage Formulas

**File:** `src/systems/combat/formulas.ts`

**`heroSwarmMass(stacks)`** (`formulas.ts:55-65`):
```
mass = SUM( pow(surviving, 0.85) * pow(max(cpEach, 1), 0.3) )
```
Exponent 0.85 = strong diminishing returns on headcount. Exponent 0.3 = unit quality compounds.

**`heroIncomingFraction(swarmMass)`** (`formulas.ts:72-75`):
```
fraction = (1.35 * mass) / (mass + 800)
```
Saturating curve: approaches 1.35 as mass grows.

**`heroDamageTakenFraction(livingHeroes)`** (`formulas.ts:36-41`):
```
count = clamp(livingHeroes, 1, 5)
packBonus = 0.18 * sqrt(count - 1)
fraction = 1 - min(0.6 + packBonus, 0.85)
```
- Lone hero: takes 40% of incoming (60% reduction).
- Pack of 5: takes 15% (85% reduction, cap).

### 3.4 Heroic Threat (Hero Damage Dealing)

**`applyHeroicThreat()`** (`simulation.ts:903-1010`):

Each living hero with the `heroic-threat` ability adds `surviving * ability.strength` to cumulative `threatShare`.

**Last Stand multiplier:** If `lastStandActive`, `threatShare *= max(1, pacing.lastStandThreatMultiplier)` (default 1.75x, `line 920`).

**Inverse-CP weight distribution:** Each attacker group gets weight `REFERENCE_CP / max(cpEach, 1)` where `REFERENCE_CP = 20` (`line 931`).

**Kill budget system** (`lines 943-973`):
```
threatAmp = max(1, threatShare / 0.04)
swingBudget = 180 * threateningHeroes * threatAmp
```
For each attacker group:
```
tierMult = heroVictimDamageMultiplier(group.combatPowerEach)
desired = (attackerTotal * threatShare + 300) * tierMult * weightShare + carry
allowed = min(desired, swingBudget * tierMult)
```

**Hero anti-chaff multiplier** (`heroVictimDamageMultiplier`, `pacing.ts:138-145`):

| Tier | CP Range | Multiplier |
|------|----------|------------|
| Recruit | <= 1 | 3.0x |
| Trained | <= 10 | 2.0x |
| Veteran | <= 40 | 1.5x |
| Elite | <= 100 | 1.25x |
| Commander | > 100 | 1.0x |
| Hero | -- | 1.0x |

**Wipe attribution:** If heroic threat kills all attackers, `fatalBlow = { type: 'hero', names: [...] }` (`lines 976-983`).

### 3.5 Hero Retreat Mechanics

**`simulation.ts:659-681`**

**Trigger condition** (`lines 659-662`):
```
armyBroken = !noRetreat && defendersBeforeAttrition > 0 &&
  defendersBeforeAttrition <= totalDeployed(defenderGroups) * RETREAT_THRESHOLD
```

**Per-hero roll** (`lines 664-680`):
- Only living, non-retreated heroes.
- **Tank heroes are skipped** (`line 667`) — Tanks never flee; they always last stand.
- **Ranged heroes get +8% bonus** (`RETREAT_RANGED_BONUS`) — backline skirmishers flee faster.
- `chance = RETREAT_CHANCE_PER_TICK + (ranged ? RETREAT_RANGED_BONUS : 0) + (momentum === 'attacker' ? RETREAT_MOMENTUM_BONUS : 0)`
- If `rng() < chance`: `group.retreated = true`, name pushed to `fledHeroNames`.
- Emits `HERO_RETREAT_LINES`.

**`noRetreat` flag:** Set for Age-final battles (`CombatSystem.ts:781`).

### 3.6 Last Stand Mechanic

**`simulation.ts:685-718`**

**Trigger:** When `livingHeroes() > 0` AND no mortal defenders remain alive (`lines 686-688`).
- Sets `lastStandActive = true`.
- Emits `HERO_LAST_STAND_LINES` using first surviving hero's name.

**Effect:** While active, heroic threat multiplied by `lastStandThreatMultiplier` (default 1.75x).

### 3.7 Reinforcement Mechanic

**`simulation.ts:702-717`**

Rolled **once** at the moment Last Stand begins.
- `if (rng() < pacing.lastStandReinforceChance)` — default **10%**.
- The `reinforcementProvider.buildHero()` callback builds the arriving hero.
- New hero pushed into `defenderGroups`, behaves like any other hero from that point on.
- Emits `HERO_REINFORCEMENT_LINES`.

**Reinforcement hero identity** (`CombatSystem.ts:756-816`):
- First tries a fled veteran (with `NEMESIS_HIJACK_CHANCE = 0.5` chance).
- Falls back to fresh name from shuffle-bag.
- Avoids duplicating anyone already on field.

### 3.8 Zombie Plague Interaction

**`simulation.ts:790-839`**

- Converts defender casualties into attacker-side Zombies.
- **Heroes are immune to conversion.** But hero deaths contribute to zombie spawn credit (their losses count in the general casualty pool).
- Spawn budget: 25% of initial enemy garrison (`ZOMBIE_PLAGUE_ENEMY_SHARE_CAP = 0.25`).

### 3.9 Death Attribution (Fatal Blow)

**`fatalBlow`** (`simulation.ts:286`): tracks whether attacker was wiped by heroic threat or garrison attrition.

`getWipeAttribution()` (`lines 526-528`): returns `{type:'heroes', names:[...]}` or `{type:'garrison'}`.

On defeat, CombatSystem extracts this for `wipedByHeroes` result field (`CombatSystem.ts:648-651`).

### 3.10 Hero Arrival Display

**`simulation.ts:385-402`**

Hero arrivals are pinned events (rendered first).
- `MAX_NAMED_ARRIVALS = 3` (`line 80`): first 3 heroes get individual arrival lines.
- Beyond 3, aggregate overflow line emitted (`HERO_ARRIVAL_OVERFLOW_LINES`).
- Line type depends on origin:
  - `isReturningDefender` -> `RETURN_DEFENDER_LINES`
  - `isReturningNemesis` -> `NEMESIS_RETURN_LINES`
  - Fresh -> `HERO_ARRIVAL_LINES`

### 3.11 Standing Defender Detection at Battle End

**`standingDefenderHeroNames()`** (`simulation.ts:516-520`):
Returns names of hero groups where `isHero && surviving > 0 && !retreated`.
Used on defeat to record standing defenders for future battles.

### 3.12 Hero Class System

**File:** `src/systems/combat/heroClasses.ts`

Each hero is assigned exactly one hidden class at creation time. Classes determine which skills the hero can use. Classes are NOT shown to the player.

**4 classes:**

| Class | Skill Loadout |
|-------|---------------|
| `caster` | Spirit Devastator, Meteor Storm, Chain Lightning, Fireball |
| `ranged` | Rapid Fire, Projectile Rain |
| `support` | Shield of Protection, Phoenix Down |
| `tank` | Whirlwind Slash, Shield Bash |

**`pickHeroClass(existing, rng)`** (`heroClasses.ts:44-51`):
- Filters `HERO_CLASSES` to avoid duplicating classes already present in `existing`.
- When all classes are exhausted, falls back to uniform random.
- Used during fresh hero spawning; returning grudge heroes default to `caster`.

**`HERO_CLASS_LOADOUTS`** (`heroClasses.ts:18-37`): Maps each class to its array of skill ids. This is the single source of truth for which skills each class brings to battle.

### 3.13 Passive Abilities

Passives run outside the ability framework -- they are implemented directly in the simulation tick loop.

**Support Passive — Passive Revival:**
- Each living Support hero has a base chance per tick to revive one fallen ally.
- Base chance: `SUPPORT_REVIVAL_BASE_CHANCE = 0.12`.
- Diminishing returns with multiple Support heroes: chance per hero decreases as `baseChance / sqrt(revivals + 1)`.
- Hard cap: `SUPPORT_REVIVAL_MAX_PER_TICK = 1` (max 1 revival per tick across all Supports).
- Once-per-battle per hero: tracked via `revivedHeroNames` Set -- a hero may only be revived once.
- Implementation: `processSupportPassive()` in `simulation.ts:1217-1239`.

**Tank Passive — Immortality & Death Burst:**
- **Tank Immortality:** Tank heroes never flee (skipped in retreat roll) and can only die during Last Stand. Their resolve does not drain outside of `lastStandActive`, making them effectively immortal until all mortal defenders are gone.
- **Tank Death Burst:** When a Tank hero dies (during Last Stand), they deal `TANK_DEATH_BURST_FRACTION` (5%) of the current attacker army as casualties. This is distributed proportionally across all attacker stacks. The burst fires once per Tank death, tracked via `diedThisTick` flag on the SimGroup. **Same-tick revival exception:** if a Support hero revives the Tank in the same tick it died, the casualties are skipped — but the burst flavor line still fires (the detonation happened either way).
- Implementation: `processTankDeathBurst()` in `simulation.ts`, retreat skip at `simulation.ts:676`, resolve drain guard at `simulation.ts:875`.

### 3.14 Shield of Protection (hero-protect)

**Ability:** Shield of Protection (`heroSkills.ts:239-260`)
- Effect kind: `hero-protect` -- temporary invulnerability for ALL living heroes.
- When active, `heroProtectActive = true` in the simulation, which causes `applyHeroResolveAttrition()` to return immediately (`line 856`), blocking all resolve damage.
- Trigger: `strength-below` (own side strength below 60%).
- Duration: 15 ticks.
- Cooldown: 20 ticks.
- Resets each tick (`heroProtectActive = false` at `line 592`), applied fresh by ability activation.

### 3.15 Phoenix Down (hero-revive)

**Ability:** Phoenix Down (`heroSkills.ts:262-283`)
- Effect kind: `hero-revive` -- revives one fallen hero at half resolve.
- Trigger: `always`, condition: `fallen-heroes-exist` (at least one hero with resolve <= 0 and surviving <= 0).
- Once per battle (per Support hero).
- Cooldown: 30 ticks.
- Revived hero: `resolve = floor(maxResolve / 2)`, `surviving = 1`, bloodied/escalation flags reset.
- A hero may only be revived once per battle -- tracked via `revivedHeroNames` Set.
- Implementation: `reviveHero()` in `simulation.ts:1193-1210`.

### 3.16 Per-Hero Ability Independence

Each hero has its own `RuntimeEntry` in the `AbilityRuntime`, keyed by `${group.name}|${id}` (`abilities.ts:501`).

- **Own cooldown:** `lastActivationTick` is per-entry, so each hero's gap since last activation is independent.
- **Own budget:** `usesThisBattle` is per-entry; the `maxPerBattle` policy applies per hero, not globally.
- **No global minGap:** Two different heroes may activate on the same tick. The `minGapTicks` policy is checked per-entry against that hero's own `lastActivationTick`.
- **Own rising edge:** `wasTrue` state is per-entry.

This means a field with 2 heroes can have up to `2 * maxPerBattle` total activations per battle (e.g., 2 casters each using 4 = 8 total).

---

## 4. Hero Skills & Abilities

### 4.1 Hero Class System

**File:** `src/systems/combat/heroClasses.ts`

- 4 hidden classes: `caster`, `ranged`, `support`, `tank`.
- `pickHeroClass(existing, rng)` -- avoids duplicating classes already present when spawning fresh heroes.
- `HERO_CLASS_LOADOUTS` -- maps each class to its skill ids. The unit factory attaches the relevant ids via `HERO_CLASS_LOADOUTS[resolvedClass]` in `createHeroForTarget()`.
- Returning grudge heroes default to `caster` class.

### 4.2 Caster Skills

| Skill | Tier | Trigger | Cooldown | Effect | Once? |
|-------|------|---------|----------|--------|-------|
| Spirit Devastator | veryHigh | always | 20 | 20% wraith kills | Yes |
| Meteor Storm | veryHigh | always | 20 | 30% unarmored kills (cap 1.08M) | Yes |
| Chain Lightning | advanced | always | 15 | 500-1000 flat kills | No |
| Fireball | basic | always | 8 | 200-500 flat flesh kills | No |

**Spirit Devastator** (`heroSkills.ts:49-82`):
- Conditions: at least 50 wraiths on attacker side.
- Scaling chance: base 0.02, threshold 1M units, 0.03 per interval, max 0.35.
- Effect: kills 20% of current living wraiths.

**Meteor Storm** (`heroSkills.ts:84-113`):
- Conditions: stage-last, age-in (age-of-ash through age-of-castles), at least 1 unarmored attacker.
- Age restriction: blocked in gunpowder onward.
- Effect: 30% of unarmored units killed, cap 1,080,000.

**Chain Lightning** (`heroSkills.ts:115-140`):
- No conditions (always eligible).
- Effect: 500-1000 flat kills, filter: spirit OR flesh (any mode).

**Fireball** (`heroSkills.ts:142-167`):
- No conditions (always eligible).
- Effect: 200-500 flat kills, filter: flesh units.

### 4.3 Ranged Skills

| Skill | Tier | Trigger | Cooldown | Effect |
|-------|------|---------|----------|--------|
| Rapid Fire | high | always | 10 | 15% unarmored kills (tiered cap, see below), scaling chance |
| Projectile Rain | advanced | always | 12 | 300-800 flat spirit/flesh kills |

**Rapid Fire** (`heroSkills.ts:173-206`):
- Conditions: at least 1 attacker unit.
- Scaling chance: base 0.05, threshold 1000 units, 0.02 per interval, max 0.25.
- Effect: 15% of unarmored units killed. Cap is TIERED by the player's battle-start deployment (`scalingCap`), with ±8% variance on every tier:
  - < 1B deployed → cap ~15K (14,800)
  - ≥ 1B (1e9) deployed → cap ~50M
  - ≥ 1T (1e12) deployed → cap ~50B
  - Future tiers: prepend `{ minUnits: 1e15, cap: 5e13 }` etc. (×1000 troops ⇒ ×1000 cap).
  - Tier selection uses the DEPLOYED snapshot from first contact — immune to mid-battle Zombie Plague merges.

**Projectile Rain** (`heroSkills.ts:208-233`):
- No conditions.
- Effect: 300-800 flat kills, filter: spirit OR flesh (any mode).

### 4.4 Support Skills

| Skill | Tier | Trigger | Cooldown | Effect | Duration |
|-------|------|---------|----------|--------|----------|
| Shield of Protection | high | strength-below 60% | 20 | +1.5x defender power | 15 ticks |
| Phoenix Down | veryHigh | fallen-heroes-exist | 30 | hero-revive | instant |

**Shield of Protection** (`heroSkills.ts:239-260`):
- Trigger: own side strength falls below 60%.
- Effect kind: `hero-protect` -- grants temporary invulnerability to all living heroes.
- Duration: 15 ticks. Cooldown: 20 ticks.

**Phoenix Down** (`heroSkills.ts:262-283`):
- Trigger: always, condition: fallen heroes exist.
- Effect kind: `hero-revive` -- restores one fallen hero at half resolve.
- Once per battle. Cooldown: 30 ticks.

### 4.5 Tank Skills

| Skill | Tier | Trigger | Cooldown | Effect |
|-------|------|---------|----------|--------|
| Whirlwind Slash | advanced | always | 8 | 100-600 flat flesh/spirit kills |
| Shield Bash | basic | always | 6 | 50-200 flat armored kills |

**Whirlwind Slash** (`heroSkills.ts:289-314`):
- No conditions.
- Effect: 100-600 flat kills, filter: flesh OR spirit (any mode).

**Shield Bash** (`heroSkills.ts:316-341`):
- Conditions: at least 1 armored attacker.
- Effect: 50-200 flat kills, filter: armored units.

### 4.6 Passive Abilities (No Ability Framework)

The Support and Tank passives are NOT defined as `CombatAbilityDefinition` entries. They run as dedicated methods in the simulation tick loop, outside the ability framework.

**Support Passive:**
- `SUPPORT_REVIVAL_BASE_CHANCE = 0.12` -- base chance per tick per living Support hero.
- `SUPPORT_REVIVAL_MAX_PER_TICK = 1` -- hard cap on revivals per tick.
- Diminishing returns: each additional Support hero contributes `baseChance / sqrt(revivals + 1)`.
- Once-per-battle per hero: tracked via `revivedHeroNames` Set.

---

## 5. Hero Fates (Post-Battle)

### 5.1 Fate Rolling Function

**File:** `src/systems/combat/heroFates.ts:1-52`

**`rollHeroFates(input)`:**

| Input Field | Purpose |
|-------------|---------|
| `roster` | Every hero on the field (expanded from stacks, one per individual) |
| `fledNames` | Names that fled mid-battle |
| `victory` | Whether the player won |
| `advantageRatio` | `initialAttackerPower / initialDefenderPower` |
| `noEscape` | Age-final flag |

**Rules:**
1. **Fled heroes** (`lines 32-34`): Every fled name gets `{ name, killed: false, fled: true }` automatically.
2. **On defeat** (`line 36`): No further fate lines for standing heroes. Returns immediately after recording fled heroes.
3. **On victory** (`lines 39-50`):
   - If `noEscape` true: all non-fled survivors slain, no chance roll.
   - Otherwise, **kill chance ramp** (`lines 45-47`):
     ```
     killChance = clamp(0.3 + 0.18 * (advantageRatio - 1), 0.3, 0.85)
     ```
     | Advantage Ratio | Kill Chance |
     |----------------|-------------|
     | 1.0 (even) | 30% |
     | 2.0 | 48% |
     | 3.0 | 66% |
     | 4.0 | 84% |
     | 5.0+ | 85% (cap) |

### 5.2 noEscape Mechanic

- Set when: battle is on last target of an Age (`ageFinalBattle` in `CombatSystem.ts:643-644`).
- Effect: all standing survivors slain, no escape possible.
- Grudge implication: since they're dead, no grudge recorded (`CombatSystem.ts:689`).

### 5.3 Integration in CombatSystem

**`rollHeroFates()` adapter** (`CombatSystem.ts:733-748`):
Feeds `simulation.heroRoster()`, `simulation.getFledHeroNames()`, victory status, and advantage ratio.
Result goes into `BattleResult.heroOutcome`.

---

## 6. Persistence & Grudge System

### 6.1 Standing Defenders

**Storage:** `CombatSystem.standingDefenders: Map<string, string[]>` (`CombatSystem.ts:318`)
Keyed by target id, value is hero name array.

| Event | Action | Location |
|-------|--------|----------|
| Defeat | Store surviving hero names (deduped, capped at MAX_HEROES_PER_TARGET) | `CombatSystem.ts:671-679` |
| Victory | Delete roster for that target | `CombatSystem.ts:681` |
| Age advance | Prune rosters for conquered ages | `CombatSystem.ts:385-390` |
| Prestige reset | `standingDefenders.clear()` | `CombatSystem.ts:428` |

**Persistence:** Saved as `survivingDefenders` in world blob (`line 852`), loaded on `restore()` (`lines 212-221, 443`).

### 6.2 Fled Heroes (Grudge Ledger)

**Storage:** `CombatSystem.fledHeroes: { name: string; fledOrder: number }[]` (`CombatSystem.ts:313`)

**Recording** (`CombatSystem.ts:687-696`):
- Names from `simulation.getFledHeroNames()` pushed after each battle.
- `fledOrder` = target's 1-based order.
- Duplicates not recorded (`line 690`).
- On Age final battles, no entries recorded (`line 689`).

**Eligibility rule:** Fled hero can only return at targets with `order > fledOrder` (`enemyUnits.ts:288`).

**Pruning:**
| Event | Action | Location |
|-------|--------|----------|
| Age advance | `this.fledHeroes = []` — grudge ledger is per-Age | `CombatSystem.ts:382` |
| Prestige reset | Cleared | `CombatSystem.ts:427` |

**Persistence:** Saved as `fledHeroes` in world blob (`line 850`), loaded on `restore()` (`lines 193-203, 442`).

### 6.3 Hero Name Deck Persistence

- Saved as `heroDeck` in world blob (`line 851`): `this.nameDeck?.serialize() ?? []`.
- Restored on `restore()` (`lines 446-452`): reconstructs `NameDeck` with saved order, or sets `pendingDeckOrder` if pool not loaded yet.
- Reset on prestige (`line 429`): `this.nameDeck = null`.

### 6.4 Nemesis System (Returning as Enemies)

A "nemesis" is any hero flagged `isReturningNemesis: true`. This happens when:
1. Fled veteran returning via grudge (`enemyUnits.ts:333`).
2. Last Stand reinforcement from a fled veteran (`CombatSystem.ts:788-799`).

Nemesis heroes have:
- Higher heroic threat: ramps with campaign order up to `HERO_THREAT_NEMESIS_CAP = 0.08` (`enemyUnits.ts:200-203`).
- Combat power scaled same as fresh heroes.
- Default to `caster` class on return.

### 6.5 Enemy Army Preview

`CombatView.renderEnemyArmy()` (`CombatView.ts:529-545`): renders base garrison ONLY. Heroes roll per-battle and are **never listed** in the preview. Comment at `types.ts:145`: "Heroes roll per battle, not shown."

---

## 7. Display & UI

### 7.1 Battle Log Events

**File:** `src/systems/combat/battleFlavor.ts`

| Pool | Lines | Token | When |
|------|-------|-------|------|
| `HERO_ARRIVAL_LINES` | 94-102 | `{hero}` | Fresh hero enters |
| `RETURN_DEFENDER_LINES` | 108-114 | `{hero}` | Standing defender returns |
| `NEMESIS_RETURN_LINES` | 117-125 | `{hero}` | Fled veteran returns |
| `HERO_ARRIVAL_OVERFLOW_LINES` | 128-132 | `{count}` | >3 heroes arrive |
| `HERO_BLOODED_LINES` | 135-143 | `{hero}` | First resolve wound |
| `HERO_ESCALATION_LINES` | 146-154 | `{hero}` | Past half resolve |
| `HERO_SLAIN_LINES` | 157-166 | `{hero}` | Hero killed |
| `HERO_RETREAT_LINES` | 169-177 | `{hero}` | Hero flees |
| `HERO_LAST_STAND_LINES` | 180-187 | `{hero}` | Only heroes remain |
| `HERO_REINFORCEMENT_LINES` | 193-200 | `{hero}` | Last Stand reinforcement |
| `formatWipePhrase()` | 40-45 | names | Defeat attribution |

### 7.2 Hero Banner in Battle View

**File:** `src/systems/combat/CombatView.ts`

During battle (`lines 548-563`):
- `heroNote` appended to status line: `" . Enemy Hero x${battle.heroCount}"`.
- Banner element shows:
  - 1 hero: `"WARNING ENEMY HERO IS PRESENT"`
  - N heroes: `"WARNING ENEMY HEROES ARE PRESENT x${count}"`

On defeat transcript (`lines 366-376`):
- Re-derived from `standingHeroCount` in result.
- Same plural-aware text.

### 7.3 Result Screen

**File:** `CombatView.ts:672-693`

**Hero fate lines** (`lines 672-686`):
Each hero in `result.heroOutcome` gets one line:
- Fled: `"{name} fled the field -- they live to hunt you again."`
- Killed: `"{name} was slain"`
- Escaped: `"{name} escaped"`
Joined with ` . ` separator, prefixed with `Hero: `.

**Defeat attribution** (`lines 689-692`):
If `result.wipedByHeroes` has names: calls `formatWipePhrase()`:
- 1 hero: `"Aldric has wiped your forces."`
- 2+ heroes: `"Aldric and Bertrand have wiped your forces."`

### 7.4 Hero Count in Battle Snapshot

**File:** `simulation.ts:455, 1181-1186`

`heroCount` in `BattleSnapshot`: computed by `livingHeroes()` -- counts surviving, non-retreated hero units.
Displayed in status bar and banner during live combat.

### 7.5 Enemy Forces Display

**`groupsToForces()`** (`simulation.ts:530-540`):
Builds the `defenderForces` array fed to `describeForces()` in `CombatView.ts:26-37`.
Retreated heroes are filtered out (`.filter(group => !group.retreated)`), so they no longer appear in the "Enemy: ..." force text during battle.

**`describeForces()`** (`CombatView.ts:26-37`):
Renders per-unit-type breakdown: `"Enemy: 4,200 Skeletons (-300), Ser Aldric (1)"`.

---

## 8. All Constants Reference

### 8.1 Pacing & Thresholds (`pacing.ts`)

| Constant | Value | Line |
|----------|-------|------|
| `HERO_RESOLVE_BASE` | 5 | `pacing.ts:32` |
| `DEFAULT_BATTLE_PACING.lastStandThreatMultiplier` | 1.75 | `pacing.ts:40` |
| `DEFAULT_BATTLE_PACING.lastStandReinforceChance` | 0.10 | `pacing.ts:41` |
| `DEFAULT_BATTLE_PACING.maxHeroResolveLossPerTick` | 1 | `pacing.ts:42` |
| `RETREAT_THRESHOLD` | 0.35 | `pacing.ts:45` |
| `RETREAT_CHANCE_PER_TICK` | 0.12 | `pacing.ts:47` |
| `RETREAT_MOMENTUM_BONUS` | 0.06 | `pacing.ts:49` |
| `RETREAT_RANGED_BONUS` | 0.08 | `pacing.ts:51` |
| `ZOMBIE_PLAGUE_ENEMY_SHARE_CAP` | 0.25 | `pacing.ts:52` |
| `SUPPORT_REVIVAL_BASE_CHANCE` | 0.12 | `pacing.ts:58` |
| `SUPPORT_REVIVAL_MAX_PER_TICK` | 1 | `pacing.ts:61` |
| `TANK_DEATH_BURST_FRACTION` | 0.05 | `pacing.ts:75` |

### 8.2 Hero Combat Tuning (`pacing.ts`)

| Constant | Value | Line |
|----------|-------|------|
| `loneDamageReduction` | 0.60 | `pacing.ts:80` |
| `allyBonusPerSqrtStep` | 0.18 | `pacing.ts:82` |
| `allyBonusCapCount` | 5 | `pacing.ts:84` |
| `maxTotalReduction` | 0.85 | `pacing.ts:86` |
| `swarmMassExponent` | 0.85 | `pacing.ts:94` |
| `unitCpExponent` | 0.30 | `pacing.ts:99` |
| `swarmMassHalf` | 800 | `pacing.ts:105` |
| `incomingBaseRate` | 1.35 | `pacing.ts:107` |
| `cleaveBodiesPerResolution` | 300 | `pacing.ts:117` |
| `swingUnitsPerResolutionPerHero` | 180 | `pacing.ts:125` |
| `budgetThreatBaseline` | 0.04 | `pacing.ts:131` |
| `HERO_TIER_DAMAGE_MULTIPLIER` | {recruit:3, trained:2, veteran:1.5, elite:1.25, commander:1, hero:1} | `pacing.ts:138-145` |
| `HERO_VICTIM_TIER_BY_CP` | [{maxCp:1, tier:recruit}, {maxCp:10, tier:trained}, {maxCp:40, tier:elite}] | `pacing.ts:152-158` |

### 8.3 Hero Threat Constants (`enemyUnits.ts`)

| Constant | Value | Line |
|----------|-------|------|
| `HERO_THREAT_FRESH` | 0.04 | `enemyUnits.ts:30` |
| `HERO_THREAT_NEMESIS_CAP` | 0.08 | `enemyUnits.ts:32` |
| `MAX_HEROES_PER_TARGET` | 2 | `enemyUnits.ts:244` |
| `NEMESIS_HIJACK_CHANCE` | 0.5 | `enemyUnits.ts:247` |
| `HERO_CLASS_RESOLVE_BONUS` | {caster:0, ranged:0, support:3, tank:2} | `enemyUnits.ts:183-189` |

### 8.4 Simulation Constants

| Constant | Value | Line |
|----------|-------|------|
| `MAX_NAMED_ARRIVALS` | 3 | `simulation.ts:80` |
| `REFERENCE_CP` (hero weight ref) | 20 | `simulation.ts:893` |

### 8.5 Fate Constants (`heroFates.ts`)

| Metric | Value | Line |
|--------|-------|------|
| Kill chance base | 0.30 (30%) | `heroFates.ts:47` |
| Kill chance ramp rate | 0.18 per unit of advantage | `heroFates.ts:47` |
| Kill chance cap | 0.85 (85%) | `heroFates.ts:46` |

### 8.6 Campaign Hero Chance Ladder (`world.ts:64`)

```typescript
CAMPAIGN_HERO_CHANCE = [0, 0.1, 0.18, 0.3, 0.42, 0.55, 0.7, 0.82, 0.92, 0.95]
```
Position 1 through 10 in each Age.

### 8.7 Ability Policy Constants (`abilities.ts`)

**Note:** `maxPerBattle` and `minGapTicks` are now enforced per-owner (per-hero), not globally. Each `RuntimeEntry` tracks its own `lastActivationTick` and `usesThisBattle`. Two different heroes may activate on the same tick, and each hero independently exhausts its own budget.

| Constant | Value | Line |
|----------|-------|------|
| `minGapTicks` | 4 (per hero) | `abilities.ts:414` |
| `maxPerBattle` | 4 (per hero) | `abilities.ts:415` |

### 8.8 Hero Skill Specific Constants

#### Caster Skills

**Spirit Devastator** (`heroSkills.ts`):
| Property | Value | Line |
|----------|-------|------|
| min wraiths condition | 50 | `heroSkills.ts:56` |
| `scalingChance.baseChance` | 0.02 | `heroSkills.ts:59` |
| `scalingChance.thresholdUnits` | 1,000,000 | `heroSkills.ts:60` |
| `scalingChance.chancePerInterval` | 0.03 | `heroSkills.ts:62` |
| `scalingChance.maxChance` | 0.35 | `heroSkills.ts:63` |
| `cooldownTicks` | 20 | `heroSkills.ts:66` |
| `effect.percent` | 0.2 (20%) | `heroSkills.ts:73` |

**Meteor Storm** (`heroSkills.ts`):
| Property | Value | Line |
|----------|-------|------|
| conditions | stage-last + age-in + min-units unarmored | `heroSkills.ts:91-94` |
| `cooldownTicks` | 20 | `heroSkills.ts:96` |
| `effect.percent` | 0.3 (30%) | `heroSkills.ts:101` |
| `effect.cap` | 1,080,000 | `heroSkills.ts:104` |

**Chain Lightning** (`heroSkills.ts`):
| Property | Value | Line |
|----------|-------|------|
| `cooldownTicks` | 15 | `heroSkills.ts:122` |
| `effect.range` | {min: 500, max: 1000} | `heroSkills.ts:129` |
| `effect.filterMode` | 'any' | `heroSkills.ts:131` |

**Fireball** (`heroSkills.ts`):
| Property | Value | Line |
|----------|-------|------|
| `cooldownTicks` | 8 | `heroSkills.ts:149` |
| `effect.range` | {min: 200, max: 500} | `heroSkills.ts:156` |
| `effect.filterMode` | 'any' | `heroSkills.ts:157` |

#### Ranged Skills

**Rapid Fire** (`heroSkills.ts`):
| Property | Value | Line |
|----------|-------|------|
| `scalingChance.baseChance` | 0.05 | `heroSkills.ts:183` |
| `scalingChance.thresholdUnits` | 1,000 | `heroSkills.ts:184` |
| `scalingChance.chancePerInterval` | 0.02 | `heroSkills.ts:186` |
| `scalingChance.maxChance` | 0.25 | `heroSkills.ts:187` |
| `cooldownTicks` | 10 | `heroSkills.ts:189` |
| `effect.percent` | 0.15 (15%) | `heroSkills.ts:195` |
| `effect.cap` (baseline < 1B troops) | 14,800 ±8% | `heroSkills.ts:196-197` |
| `effect.scalingCap` | [{minUnits 1e12, cap 5e10}, {minUnits 1e9, cap 5e7}] | `heroSkills.ts:199-202` |

**Projectile Rain** (`heroSkills.ts`):
| Property | Value | Line |
|----------|-------|------|
| `cooldownTicks` | 12 | `heroSkills.ts:215` |
| `effect.range` | {min: 300, max: 800} | `heroSkills.ts:222` |
| `effect.filterMode` | 'any' | `heroSkills.ts:223` |

#### Support Skills

**Shield of Protection** (`heroSkills.ts`):
| Property | Value | Line |
|----------|-------|------|
| trigger | strength-below (own, 0.6) | `heroSkills.ts:245` |
| `cooldownTicks` | 20 | `heroSkills.ts:246` |
| `durationTicks` | 15 | `heroSkills.ts:247` |
| `effect.kind` | `hero-protect` | `heroSkills.ts:250` |

**Phoenix Down** (`heroSkills.ts`):
| Property | Value | Line |
|----------|-------|------|
| condition | fallen-heroes-exist | `heroSkills.ts:269` |
| `cooldownTicks` | 30 | `heroSkills.ts:270` |
| `oncePerBattle` | true | `heroSkills.ts:272` |
| `effect.kind` | `hero-revive` | `heroSkills.ts:275` |

#### Tank Skills

**Whirlwind Slash** (`heroSkills.ts`):
| Property | Value | Line |
|----------|-------|------|
| `cooldownTicks` | 8 | `heroSkills.ts:296` |
| `effect.range` | {min: 100, max: 600} | `heroSkills.ts:303` |
| `effect.filterMode` | 'any' | `heroSkills.ts:304` |

**Shield Bash** (`heroSkills.ts`):
| Property | Value | Line |
|----------|-------|------|
| condition | min-units (1 armored attacker) | `heroSkills.ts:323` |
| `cooldownTicks` | 6 | `heroSkills.ts:324` |
| `effect.range` | {min: 50, max: 200} | `heroSkills.ts:331` |

#### Passive Constants

| Constant | Value | File:Line |
|----------|-------|-----------|
| `SUPPORT_REVIVAL_BASE_CHANCE` | 0.12 | `pacing.ts:58` |
| `SUPPORT_REVIVAL_MAX_PER_TICK` | 1 | `pacing.ts:61` |
| `TANK_DEATH_BURST_FRACTION` | 0.05 | `pacing.ts:75` |

---

## 9. Data Flow Diagram

```
hero-names.txt + BUILT_IN_HERO_NAMES
        |
   mergeNamesFile()
        |
   CombatSystem.setHeroNames()
        |
   NameDeck (shuffle-bag)          fledHeroes[]          standingDefenders{}
        |                               |                       |
        └──────────rollTargetArmy()------┴───────────────────────┘
                        |
                   Hero slots (0-2 per target)
                        |
            pickHeroIdentity():
              1. Standing defenders lock roster (non-finale)
              2. Fled veteran hijack (50% or guaranteed on finale)
              3. Fresh shuffle-bag draw
                        |
              pickHeroClass(existing, rng):
                Avoids duplicating classes already on field
                Fallback to uniform random when all used
                Returns: 'caster' | 'ranged' | 'support' | 'tank'
                        |
              createHeroForTarget():
                CP = max(200, targetCP * 0.06)
                Resolve = 5 + floor(order/3)
                Threat = 0.04 (fresh) or ramp to 0.08 (nemesis)
                Tactics = HERO_CLASS_LOADOUTS[heroClass]
                heroClass = resolved class
                        |
              BattleSimulation:
                - Resolve pool instead of body count
                - Swarm-mass incoming curve
                - Cleave swing + tier multiplier
                - Retreat when army < 35%
                - Last Stand when only heroes remain
                - 10% chance of reinforcement
                - Per-Hero ability entries (own cooldown/budget)
                        |
              AbilityRuntime (per-hero entries):
                - Each hero has own RuntimeEntry keyed by name|id
                - minGapTicks enforced per-entry (not global)
                - maxPerBattle enforced per-entry
                - Weighted selection picks one activation per tick
                        |
              Class-based skill loadouts:
                Caster:  Spirit Devastator, Meteor Storm, Chain Lightning, Fireball
                Ranged:  Rapid Fire, Projectile Rain
                Support: Shield of Protection, Phoenix Down
                Tank:    Whirlwind Slash, Shield Bash
                        |
              Passives (outside ability framework):
                - Support Passive: revival chance per tick (diminishing, cap 1/tick, once per hero)
                - Tank Death Burst: 5% attacker casualties on Tank death
                        |
              Battle End:
                - rollHeroFates() for each hero
                - Standing defenders stored on defeat
                - Fled heroes added to grudge ledger
                - Names exhausted by the deck
```

---

## 10. File Index

| File | Path | Hero Relevance |
|------|------|----------------|
| heroClasses.ts | `src/systems/combat/heroClasses.ts` | Hero class definitions, loadouts, class picking |
| heroNames.ts | `src/systems/combat/heroNames.ts` | Name pool, dedup, NameDeck |
| heroSkills.ts | `src/systems/combat/heroSkills.ts` | All 10 hero skills: Caster, Ranged, Support, Tank |
| heroFates.ts | `src/systems/combat/heroFates.ts` | Post-battle fate rolling |
| enemyUnits.ts | `src/systems/combat/enemyUnits.ts` | Hero unit definition, rollTargetArmy, standing defenders, grudge, class-based loadouts |
| simulation.ts | `src/systems/combat/simulation.ts` | Hero resolve, heroic threat, retreat, last stand, reinforcement, passives, revive, per-hero ability runtime |
| CombatSystem.ts | `src/systems/combat/CombatSystem.ts` | Persistence, orchestration, name deck, grudge ledger |
| CombatView.ts | `src/systems/combat/CombatView.ts` | Hero banner, fate display, wipe attribution |
| pacing.ts | `src/systems/combat/pacing.ts` | All hero combat tuning constants, passive thresholds |
| formulas.ts | `src/systems/combat/formulas.ts` | heroSwarmMass, heroIncomingFraction, heroDamageTakenFraction |
| tactics.ts | `src/systems/combat/tactics.ts` | Commander tactics (not heroes, but shared framework) |
| abilities.ts | `src/systems/combat/abilities.ts` | Ability framework, per-hero runtime entries, activation policy |
| battleFlavor.ts | `src/systems/combat/battleFlavor.ts` | All hero flavor text pools |
| types.ts | `src/systems/combat/types.ts` | BattleHeroOutcome, heroCount, BattleEventView |
| world.ts | `src/systems/combat/world.ts` | CAMPAIGN_HERO_CHANCE ladder, heroChance per target |
| unitTypes.ts | `src/systems/combat/unitTypes.ts` | UnitTier includes 'hero' tier |
| hero-names.txt | `public/hero-names.txt` | External name file |

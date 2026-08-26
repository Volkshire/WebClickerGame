# Prestige & Achievement System — Technical Report

> **📋 AGENT MAINTENANCE INSTRUCTION — READ FIRST**
>
> This document is the authoritative reference for the Prestige (points, shop,
> rewards) and Achievement systems. It is written for humans AND AI agents.
>
> **IF YOU MODIFY ANY FILE LISTED IN §2 (File Map), YOU MUST UPDATE THIS
> REPORT IN THE SAME CHANGE.** Update the `Last updated` timestamp, bump the
> doc revision counter at the bottom, and add one line to §12 (Changelog)
> describing what changed. If you add/remove a save key, a shop item, an
> achievement, a condition kind, or change boot order / persistence semantics,
> also re-run the test suites listed in §10 and note the result in the
> changelog entry. Do not let this document drift from the code — every agent
> after you will trust it blindly.

| | |
|---|---|
| **Last updated** | 2026-08-25 · 05:34 (UTC+8) |
| **Game version** | 0.1.0 (`package.json`) |
| **Verified against build** | `dist/assets/index-BV26Os72.js` (+ `index-0oniplYJ.css`), built from source on 2026-08-25 |
| **Runtime** | Node v24.19.0 (tests), Vite 8 + TypeScript strict, vanilla DOM |
| **Status** | All suites green: vitest **131/131** · tsc clean · smoke E2E ALL PASS |

---

## 1. Overview & Design Principles

Permanent progression is split into three cooperating pieces:

1. **PrestigeSystem** (`src/systems/prestige/PrestigeSystem.ts`) — owns *all*
   permanent state: prestige count, spendable Prestige Points (PP), the
   reward-source claimed-ledger, and the shop purchase record.
2. **AchievementSystem** (`src/systems/achievements/AchievementSystem.ts`) —
   owns permanent completion latches and evaluates data-driven conditions.
   It never grants rewards itself.
3. **Wiring layer** (`src/main.ts`) — routes everything: combat publishes →
   Age milestones; achievement completions → their declared rewards; UI events
   → purchases.

Design rules that must survive future changes:

- **Idempotency everywhere.** A reward source id can pay out exactly once,
  ever (claimed ledger). Reloading, re-conquering, re-evaluating can never
  double-bank.
- **Data over code.** Shop items, achievements, condition kinds, and Age
  milestones are configuration; adding content must not require touching
  system classes or UI.
- **Opaque effects.** Neither the shop nor achievements interpret effect
  payloads beyond what consumers implement; unknown kinds ride along inertly
  so items referencing future/nonexistent systems are legal data today.
- **Persistence gates.** Critical permanent transitions verify storage
  read-back before run state is destroyed; terminal flows arm a global write
  gate so unload cascades cannot resurrect stale state.

## 2. File Map

| File | Role |
|---|---|
| `src/systems/prestige/PrestigeSystem.ts` | Permanent state, `reportReward`, `perform`, `buyShopItem` |
| `src/systems/prestige/types.ts` | `PrestigeState`, payload, events |
| `src/systems/prestige/shop.ts` | `SHOP_ITEMS` catalog, item/requirement/effect types, `checkShopRequirement` |
| `src/systems/prestige/sources.ts` | Source-id helpers (`age:…`, `achievement:…`), `AGE_MILESTONES` generated from world data |
| `src/systems/prestige/effects.ts` | `computePrestigeEffects(count, purchases)` aggregation seam |
| `src/systems/prestige/PrestigeView.ts` | Crypt badge + confirmation modal (+ pending-rewards line) |
| `src/systems/prestige/PrestigeShopView.ts` | Shop dialog (debug-window gated) |
| `src/systems/achievements/AchievementSystem.ts` | Completion latch, evaluation, persistence |
| `src/systems/achievements/achievements.ts` | `ACHIEVEMENTS` definitions (rewards editable per def) |
| `src/systems/achievements/conditionEvaluators.ts` | Condition-kind → snapshot-metric registry |
| `src/systems/achievements/types.ts` | Conditions, rewards, snapshot, view data |
| `src/systems/achievements/AchievementView.ts` | Trophy-button overlay panel |
| `src/main.ts` | All routing (see §7, §8) |
| `index.html` / `src/style.css` | Trophy button, achievements overlay, shop modal, debug shop button |
| `src/core/SaveBackup.ts` | `GAME_SAVE_KEYS` (backup/reset/import coverage) |
| `tests/prestige-points.test.ts` · `tests/achievements.test.ts` · `tests/prestige-shop.test.ts` | System tests |

## 3. Prestige State & Persistence

```ts
interface PrestigeState {
  count: number;                    // prestiges performed
  points: number;                   // spendable PP balance
  claimedRewards: string[];         // source ids that already paid out (permanent)
  purchases: Record<string, number>;// shop itemId -> purchase count
}
```

Save key `webclickergame.prestige`, blob shape:

```json
{ "v": 1, "count": 2, "points": 3,
  "claimedRewards": ["age:age-of-ash", "achievement:ascended"],
  "purchases": { "deathlords-edge": 1 },
  "pendingRewards": { "age:age-of-iron": 1 } }
```

- Missing optional fields default (`points=0`, empty ledgers) — pre-system
  legacy blobs `{v, count}` still load.
- `pendingRewards` is **persisted** so earned-but-unclaimed rewards survive
  reloads. Sources also re-report on restore publishes; dedupe makes that a
  no-op (defense in depth).
- `perform()` writes the candidate state and read-back-verifies (count +
  points + ledger membership, one retry) **before** the wiring layer wipes
  the run — failing storage aborts with `{ok:false, reason:'storage'}` and
  nothing is lost.

### Public API

| Call | Semantics |
|---|---|
| `reportReward(sourceId, points): boolean` | Idempotent eligibility report. Ignored if already claimed OR already pending. Persists pending immediately. |
| `perform(): {ok, reason?, pointsGained?}` | Claims ALL pending → `points += gained`, moves source ids to `claimedRewards`, bumps `count`. Gated by campaign-conquered flag + no active battle. |
| `buyShopItem(itemId): {ok, reason?}` | Validates existence → limit → requirement → affordability; deducts, records purchase. |
| `levelOf`-style getters | `count`, `points`, `pendingPoints`, `purchasedCount(id)`, `effects`, `canPrestige`. |

## 4. Reward Sources (how PP enters the system)

Any system can mint PP by reporting a stable source id through `main.ts`.
Current sources:

1. **Age first-conquest milestones** — generated from `AGES` world data in
   `sources.ts` (`AGE_MILESTONES`, 1 PP each). On every `CombatEvents.Changed`,
   `main.ts` reports every fully conquered Age of the current run
   (`age:<ageId>`). Adding an Age = adding world data only.
2. **Achievement completions** — routed generically: any completed
   definition whose `reward.type === 'prestige-points'` is reported as
   `achievement:<id>` with its configured amount.

Future sources (combat stats, special milestones, nonexistent systems) only
need a new id helper + one `reportReward` call from their wiring handler.

## 5. Prestige Shop

Catalog lives entirely in `shop.ts`. The shop UI renders straight from
`SHOP_ITEMS` (rows added/removed dynamically), so editing prices/content
requires zero code changes.

| Item id | Name | Cost | Effect kind | Wired consumer? |
|---|---|---|---|---|
| `endless-wellspring` | Endless Well | 1 PP | `soul-generation-multiplier` ×1.25 | ✅ Clicker |
| `reaping-crescent` | Reaping Crescent | 1 PP | `soul-harvest-multiplier` ×1.5 | ✅ Clicker |
| `grave-touch` | Grave-Touch | 1 PP | `click-power-flat` +2 | ✅ Clicker |
| `legion-drums` | Legion Drums | 1 PP | `troop-generation-multiplier` ×1.25 | ⏳ pending |
| `bone-market-pact` | Bone Market Pact | 1 PP | `recruit-cost-multiplier` ×0.9 | ✅ main.ts debits/previews |
| `crown-of-dread` | Crown of Dread | 1 PP | `army-combat-power-multiplier` ×1.15 | ⏳ pending |
| `deathlords-edge` | Deathlord's Edge | 1 PP | `attacker-damage-multiplier` ×1.2 | ✅ Combat seam |
| `buried-hoard` | Buried Hoard | 1 PP | `starting-souls` +500 | ✅ post-reset grant |
| `skeleton-crew` | Skeleton Crew | 1 PP | `starting-troops` +25 Wraiths | ✅ post-reset grant |
| `tithe-of-flesh` | Tithe of Flesh | 1 PP | `passive-resource-multiplier` ×1.25 | ⏳ pending |

All current items: `maxPurchases: 1`, `permanent: true`.

- **Effect descriptors are opaque** — `{kind, value?, params?}`. Unknown kinds
  resolve neutrally in `computePrestigeEffects`; future items may reference
  systems that don't exist yet without breaking anything.
- **Requirements** (`requires`) fail closed for unknown kinds; supported
  gates: `prestige-count`, `item` (prerequisite chains). None used yet.
- **Access**: button inside the DEBUG window (`#diagnostics`), disabled until
  `prestige.count >= 1`. No permanent main-screen entry by design.
- **UI states**: `.is-affordable` highlight, disabled when unaffordable/
  locked, "Owned" + green row when maxed. Counter updates instantly via the
  prestige publish.

## 6. Achievement System

Definition anatomy (`achievements.ts`):

```ts
{ id, name, description,
  condition: { kind, amount?, targetId? },     // open-ended kind string
  reward: { type: 'prestige-points', amount: 1 }, // per-def editable; 'none' allowed
  spoiler?: boolean }                            // masks row as ??? until done
```

Current set (all rewards +1 PP):

| id | Condition | Spoiler |
|---|---|---|
| `first-harvest` | lifetime-clicks ≥ 100 | — |
| `soul-hoard` | souls-current ≥ 10 000 | — |
| `blood-price` | targets-cleared ≥ 1 | 🙈 |
| `first-recruit` | legion-size ≥ 1 | 🙈 |
| `era-breaker` | conquered-ages ≥ 1 | 🙈 |
| `double-conquest` | conquered-ages ≥ 2 | 🙈 |
| `ascended` | prestige-count ≥ 1 | — |

**Evaluation model**

- `evaluate(snapshot)` runs on every clicker/legion/combat/prestige publish
  (snapshot built in `main.ts` from authoritative getters).
- Kinds resolve through `CONDITION_EVALUATORS` registry:
  `lifetime-clicks, souls-current, targets-cleared, legion-size, conquered-ages,
  prestige-count`. Unknown kinds never complete (warn-once) — future stat
  sources extend the registry + `GameStatsSnapshot`, nothing else.
- Completion is a permanent latch: persisted (`webclickergame.achievements`),
  emits `Completed` exactly once, re-evaluation is a no-op.
- Publishing is change-detected (view signature) so progress updates live
  without spamming identical payloads.

**Spoiler masking** — incomplete `spoiler:true` defs ship redacted view rows
(`???` / "Hidden achievement" / no progress / no reward), applied
system-side in `buildViews()` so the UI cannot leak. Unmasks permanently on
completion. Header summary counts hidden entries in the total.

## 7. Wiring Flows (`main.ts`)

```
CombatEvents.Changed ──► age-milestone loop (i < conqueredAges ──► reportReward('age:'+id))
                     └──► evaluateAchievements()
ClickerEvents.Changed ─► evaluateAchievements()
LegionEvents.Changed ──► evaluateAchievements()
PrestigeEvents.Changed ► views + shop render + debug gate + evaluateAchievements()
AchievementEvents.Completed ──► if reward.type==='prestige-points':
                                  prestige.reportReward('achievement:'+id, amount)
```

Post-Prestige reset sequence (after `perform()` succeeds): World-tab latch
re-arm → clicker/resources/legion/combat/buildings/necromancy `resetRun()`
→ starting-boon grants (Souls, Wraiths) from `prestige.effects`.

## 8. Boot Order & Save Safety

Restore sequence inside `AppEvents.Start`:

```
prestige → achievements (+PP catch-up routing) → necromancy → legion
→ clicker → resources → buildings → hero names → combat (LAST)
```

**This order is load-bearing.** Every other restore publishes changes whose
handlers can report rewards into prestige (legion → First Recruit,
clicker → Soul Hoard, combat → Age milestones). Against a default-state
ledger those reports would save a `{count:0}` blob over the real save
(permanent wipe). Restored-first, dedupe makes them harmless. Do not reorder
without reading the comments in `main.ts`.

Terminal flows (`TOTAL RESET`, save import) call `suspendPersistence()`
before mutating storage and reloading — otherwise the pagehide/
visibilitychange Flush cascade would overwrite the wiped/imported blobs
with stale session state. `commitImport`/`wipeGameSaves` use raw
localStorage and bypass the gate intentionally.

Save keys owned: `webclickergame.{clicker, legion, resources, prestige,
achievements, necromancy, combat, buildings, ui}` — all covered by backup
export/import and the TOTAL RESET prefix sweep.

## 9. Testing

| Suite | Covers |
|---|---|
| `npm test` (vitest, node env) | 131 tests total |
| `tests/prestige-points.test.ts` | Milestone awarding/dedupe, multi-Age, perform claiming, persistence across resets, storage-failure abort, legacy saves, pending-survives-reload |
| `tests/achievements.test.ts` | Complete-once latch, progress capping, reload persistence, registry extensibility, spoiler masking/unmasking |
| `tests/prestige-shop.test.ts` | Catalog integrity, purchase/limit/requirement paths, permanent-purchase survival, generic full-catalog buy, effect aggregation |
| `node scripts/smoke.mjs` | Headless E2E incl. scenario H (prestige save survives reload + shop gate) and G/I (total reset & import vs unload cascade) |

Test infra notes: memory-localStorage shim in `tests/support/storage.ts`
(keys enumerable like real storage); each test file installs it fresh.

## 10. Extension Recipes

- **Add an achievement**: append a definition in `achievements.ts` (pick a
  registered condition kind, set reward amount). Add `spoiler: true` if its
  text reveals locked content.
- **New condition kind**: add field to `GameStatsSnapshot`, fill it in
  `evaluateAchievements()` (main.ts), register metric in
  `conditionEvaluators.ts`.
- **Add/edit shop item**: edit `SHOP_ITEMS` only. New *effect kinds* need a
  case in `effects.ts::applyKnownEffect` + a consumer to matter.
- **New PP source**: create source-id helper in `sources.ts`, call
  `prestige.reportReward()` from your wiring handler.
- **New reward type**: extend `AchievementReward` union + route it in the
  Completed handler in `main.ts` (+ format in `formatAchievementReward`).

## 11. Known Limitations & Observations (report-only, no action taken)

1. **Legacy grandfathering**: saves predating this system (`count > 0`,
   empty ledgers) will pay Age milestones again on reconquest — generous,
   arguably correct, but intentional.
2. **Pending-PP discoverability**: before the first conquest, unclaimed PP
   (e.g. from First Harvest) is visible only inside the trophy panel's
   achievement rows — the prestige badge stays hidden until first conquest.
3. **Recruitment previews vs discount**: roster affordability previews use
   base costs; the Bone Market Pact discount makes real debits cheaper than
   previewed (safe direction, slight display mismatch).
4. **Starting troops unlock pacing**: Skeleton Crew's free Wraiths satisfy
   the "any undead" latch, so the World tab opens immediately at run start.
5. **Purchase durability**: shop buys persist fire-and-forget (banner on
   failure), unlike `perform()`'s read-back verification — consistent with
   codebase norms, but a failed write loses the purchase while keeping
   points on reload.
6. **Multi-tab races**: unchanged codebase-level risk; SessionGuard warns.
7. **Escape layering**: achievements panel yields Escape to open modals;
   Tab focus-trap of modals does not include underlying panel focusables.

## 12. Document Changelog

| Rev | Date | Author | Notes |
|---|---|---|---|
| r1 | 2026-08-25 | ox-alpha agent | Initial comprehensive write-up after Prestige Points + Shop + Achievements foundation, spoiler masking, boot-order fix, persistence-gate fix (build `index-BV26Os72.js`). |

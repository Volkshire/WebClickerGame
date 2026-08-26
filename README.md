# Endless Souls 👻

A dark-fantasy incremental game for the browser: **harvest souls, raise an undead
legion, and march through ten Ages of human civilization** — from the Age of Ash
to the Age of Ruin. Built with TypeScript + Vite. Zero runtime dependencies;
everything runs client-side and saves locally.

## Gameplay loop

1. **Harvest souls** by clicking, then invest in upgrades and soul generators.
2. **Raise an undead legion** paid in Souls plus looted Bone, Flesh and Iron.
3. **Attack the living world**: each Age is a ladder of settlements ending in a
   Royal Fortress. Battles are tick-based tactical simulations with deployment
   control, terrain effects, heroes on both sides and a full battle log.
4. **Grow deeper systems** along the way: Crypt buildings, Necromancy research,
   achievements that pay out Prestige Points.
5. **Prestige**: sacrifice the run for a permanent counter, permanent bonuses
   and Prestige Shop boons that make every next run faster.

## Requirements

- [Node.js](https://nodejs.org/) 20.19+ or 22.12+

## Commands

| Command                  | Description                                         |
| ------------------------ | --------------------------------------------------- |
| `npm install`            | Install all tooling (devDependencies only)          |
| `npm run dev`            | Start the dev server with hot module reload         |
| `npm run build`          | Type-check (`tsc`) and build the static site        |
| `npm run preview`        | Serve the production build locally                  |
| `npm test`               | Run the vitest unit suites                          |
| `node scripts/smoke.mjs` | Headless E2E suite over the built bundle (run `npm run build` first) |

The production output in `dist/` is fully static (relative asset paths) and can
be hosted for free on GitHub Pages, Netlify, Cloudflare Pages, or itch.io.

## What is implemented

- **Soul economy** — click power, upgrades, nine generators, offline progress
  granted on return, live document-title soul counter.
- **Undead Legion** — five unit types (Wraith, Skeleton, Zombie, Flesh Golem,
  Death Knight) unlocked through campaign progression, costing mixed currencies,
  with bulk recruitment and percentage-based deployment.
- **Campaign across 10 Ages** — Ash, Iron, Kings, Empires, Castles, Gunpowder,
  Industry, Machines, Steel, Ruin. Each Age is a ladder of seven settlement
  types (Village up to Royal Fortress) with scaling garrisons and commanders.
- **Tactical combat** — tick-simulated battles, attacker/defender power bars,
  terrain modifiers, defeat loot, survivors returning to the garrison, and a
  World-tab glow when a result lands while you are elsewhere.
- **Heroes** — procedurally named heroes with classes, skills and abilities on
  both sides, post-battle fates, and a grudge system that lets defeated enemy
  heroes come back as nemeses.
- **Resources & Crypt buildings** — Bone/Flesh/Iron production with synergies
  such as Soul Net (souls per enemy kill) and the Bone Sorting House (double
  Bone loot), plus auto-raising of Wraiths.
- **Necromancy** — dark research bought with Bone/Iron/Souls (e.g. Knight &
  Squire: Death Knights bring free Skeletons; Zombie Plague: battlefield
  infection). Resets on Prestige.
- **Prestige & Prestige Shop** — gated behind the first conquered Age, with a
  confirmation modal that explains exactly what is kept and lost, and ten
  shop items granting permanent economy/combat boons.
- **Achievements** — seven tracked achievements evaluated against authoritative
  system snapshots; completed ones bank Prestige Point rewards.
- **Persistence & safety rails** — one `localStorage` blob per system with
  schema versioning, strictly ordered boot restores (a broken system fails
  alone instead of wiping others), save export/import as JSON backup files,
  a multi-tab session guard, storage-health detection, and offline progress.

## Architecture

```
src/
├── main.ts                 # Composition root: wires every system, view and provider
├── style.css               # Global styles
├── core/                   # Engine-level infrastructure, no game concepts
│   ├── Application.ts      # Lifecycle owner: start / stop / update events
│   ├── EventBus.ts         # Minimal typed publish/subscribe hub
│   ├── GameLoop.ts         # requestAnimationFrame loop with clamped delta time
│   ├── SaveManager.ts      # Versioned localStorage save/load wrapper
│   ├── SessionGuard.ts     # Detects competing tabs writing the same storage
│   ├── StorageHealth.ts    # Boot-time probe for blocked/private storage
│   └── SaveBackup.ts       # Export/import/total-wipe of all game keys
├── systems/<domain>/       # One folder per game system
│   ├── *System.ts          # State, rules, persistence; publishes Changed events
│   ├── *View.ts            # DOM rendering only; never mutates game state
│   └── …data modules       # Unit stats, ages, shop items, hero classes, etc.
└── ui/                     # Tab controller, init/diagnostics screen, alert banner
```

Design rules that keep the codebase stable:

- Systems talk **only through the EventBus**; `main.ts` connects them with lazy
  provider closures (e.g. Prestige Shop boons flow into the economy without the
  clicker knowing Prestige exists).
- Affordability checks and debits read **authoritative balances from owning
  systems** at transaction time, so previews can never act on stale values.
- Cross-system ordering hazards (boot restore order, unload flushes) are
  guarded and covered by dedicated regression tests.

## Testing

- `tests/` — vitest unit/regression suites covering combat math, prestige,
  achievements, necromancy, hero classes/skills/passives, save persistence,
  building economies and more.
- `scripts/smoke.mjs` — headless jsdom E2E that boots the real built bundle
  against `index.html` across many seeded save states: tab unlock gates, live
  battles, prestige surviving reloads, save import, total reset semantics and
  the developer debug access below.
- `scripts/smoke-hero-tuning.ts`, `scripts/smoke-flavor.ts` — optional balance
  tuning harnesses (not wired into CI).

Deeper technical write-ups live in [`docs/`](docs/): the combat system report,
the hero system report, and the authoritative Prestige/Achievements reference.

## Developer debug access

The Debug popout (diagnostics, save export/import, debug tools, TOTAL RESET) is
**hidden from players by default** — no button is visible in the normal UI.

Developers unlock it for the current tab session in one of two ways:

- **Keyboard:** press `Ctrl` + `Shift` + `D` (`Cmd` + `Shift` + `D` on macOS)
  anywhere in the game. This unlocks debug access and toggles the popout; the
  same shortcut opens and closes it afterwards.
- **URL param:** open the game once with `?debug=1`, e.g.
  `http://localhost:5173/?debug=1`. The unlock is remembered in
  `sessionStorage`, so reloading or navigating within the same tab keeps
  access without re-appending the param. Closing the tab revokes it.

Once unlocked, the 🐞 button in the bottom-right corner reappears as a
mouse-friendly toggle. There is intentionally **no authentication or
server-side gate** — anyone who knows these keys can use the tools; they exist
for development and support, not for players.

## Current Status / Roadmap

**Status: work in progress.** The game is fully playable end-to-end (clicker →
legion → ten-Age campaign → prestige loops) and saves reliably, but it is not
feature-complete and balance is still being tuned. Expect changes.

Planned next:

- More undead units beyond the Death Knight
- Broader hero skill and ability variety
- The Relics panel in the Crypt (currently a teaser stub)
- Continued combat/economy balance passes

## Notes

- `core/` contains no game-specific concepts; it only knows about starting,
  stopping, updating, events, and persistence.
- The update loop delivers clamped delta time in seconds to anything subscribed
  via `Application.events`.

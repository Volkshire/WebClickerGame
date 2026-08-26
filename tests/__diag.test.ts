import { describe, it } from 'vitest';
import { AppEvents } from '../src/core/Application';
import type { UpdatePayload } from '../src/core/Application';
import { EventBus } from '../src/core/EventBus';
import { SaveManager } from '../src/core/SaveManager';
import { CombatSystem } from '../src/systems/combat/CombatSystem';
import { rollTargetArmy } from '../src/systems/combat/enemyUnits';
import { CombatEvents } from '../src/systems/combat/types';
import type { CombatChangedPayload } from '../src/systems/combat/types';
import { AGES } from '../src/systems/combat/world';
import { mulberry } from './helpers';
import { installMemoryStorage } from './support/storage';

describe('probe', () => {
  it('standalone roller', () => {
    const ASH = AGES[0];
    const target = ASH.targets[1];
    let withHero = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const army = rollTargetArmy(
        target.army,
        target.heroChance,
        mulberry(seed),
        ['Aldric', 'Brigid'],
        2,
        [],
        false,
        200,
      );
      const heroes = army.filter((g) => g.isHero === true);
      if (heroes.length > 0) {
        withHero++;
        if (withHero <= 3) console.log(`seed ${seed}: ${JSON.stringify(heroes.map((h) => h.name))}`);
      }
    }
    console.log('standalone heroes in 40 seeds:', withHero);
  });

  it('scout mechanics', () => {
    const ASH = AGES[0];
    const target = ASH.targets[1];
    console.log('target:', target.id, 'chance=', target.heroChance, 'army=', JSON.stringify(target.army));
    for (let seed = 1; seed <= 40; seed++) {
      installMemoryStorage();
      const storageShim = (globalThis as unknown as { localStorage: Storage }).localStorage;
      storageShim.setItem(
        'webclickergame.combat',
        JSON.stringify({ v: 1, ageId: 'age-of-ash', clearedInAge: 1 }),
      );
      const events = new EventBus();
      const system = new CombatSystem(events, new SaveManager('webclickergame.combat'), {
        rng: mulberry(seed),
      });
      let last: CombatChangedPayload | null = null;
      events.on<CombatEvents.Changed>(CombatEvents.Changed as never, (p: never) => {
        last = p as unknown as CombatChangedPayload;
      });
      system.restore();
      const started = system.startBattle(target.id, [
        { unitId: 'wraith', name: 'Wraiths', count: 60, combatPowerEach: 1, type: 'melee', tags: ['spirit'] },
      ], 60);
      const battle = last?.battle ?? null;
      const singles = battle?.defenderForces.filter((f) => f.count === 1).map((f) => f.name) ?? [];
      const heroBeats = battle?.events.filter((e) => e.kind === 'hero').length ?? 0;
      console.log(`seed ${seed}: started=${started} phase=${last?.phase} singles=${JSON.stringify(singles)} heroBeats=${heroBeats}`);
      if (!started || battle === null) continue;
      // resolve quickly
      for (let i = 0; i < 500; i++) {
        events.emit<UpdatePayload>(AppEvents.Update, { deltaSeconds: 0.7 });
        if ((last as CombatChangedPayload | null)?.phase === 'result') break;
      }
      console.log(`   outcome=${last?.result?.outcome}`);
    }
  });
});

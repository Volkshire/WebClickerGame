/**
 * Headless E2E suite: boots the real bundle against index.html for three
 * progression states and asserts navigation visibility, World-tab state,
 * the campaign-complete UI, and a live battle.
 */
import { readFile, readdir } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const html = await readFile('index.html', 'utf8');
const assets = await readdir('dist/assets');
const bundlePath = process.argv[2] ?? `dist/assets/${assets.find((f) => /^index-.*\.js$/.test(f))}`;
const bundle = await readFile(bundlePath, 'utf8');

let failed = false;
const step = (label, fn) => {
  // Sync contract: an async fn here would report OK before its awaits ran
  // (and swallow its own rejections), so fail loudly instead.
  let result;
  try {
    result = fn();
  } catch (e) {
    failed = true;
    console.log('  FAIL', label, '->', e.message);
    return;
  }
  if (result instanceof Promise) {
    failed = true;
    console.log('  FAIL', label, '-> async step: await at block level instead');
    return;
  }
  console.log('  OK  ', label);
};
const assert = (c, m) => {
  if (!c) throw new Error(m);
};

async function bootScenario(label, seeds, { url = 'http://localhost/' } = {}) {
  const dom = new JSDOM(html, {
    url,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    beforeParse(window) {
      for (const [k, v] of Object.entries(seeds)) {
        // Pre-serialized strings go in verbatim; objects get encoded once.
        window.localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
      }
      window.matchMedia = () => ({ matches: false });
      window.fetch = () => Promise.reject(new Error('no fetch'));
      window.console.error = (...a) => console.log(`[${label} console.error]`, ...a);
      window.addEventListener('error', (e) => {
        failed = true;
        console.log(`  [${label} window.error]`, String(e.error ?? e.message));
      });
    },
  });
  const { window } = dom;
  window.eval(bundle);
  await new Promise((r) => setTimeout(r, 150));

  const q = (s) => window.document.querySelector(s);
  const text = (s) => q(s)?.textContent ?? '(missing)';
  const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  console.log(`\n=== ${label} ===`);
  return {
    q,
    text,
    click,
    wait,
    win: window,
    vis(id) {
      return !q(`[data-tab="${id}"]`).hidden;
    },
    close: () => {
      window.close();
    },
  };
}

const clickerSeed = { souls: 500000, totalClicks: 3, upgrades: {}, generators: { 'soul-siphon': 1 }, lastSeen: null };

// ---------- Scenario A: fresh progression ----------
{
  const t = await bootScenario('A0: ZERO PROGRESSION (no seeds)', {});
  step('only Souls tab visible', () => {
    assert(t.vis('souls'), 'souls hidden');
    assert(!t.vis('legion') && !t.vis('world') && !t.vis('crypt'), 'a locked tab is visible');
  });
  step('active pane is Souls', () => assert(!t.q('[data-tab-pane="souls"]').hidden, 'souls pane hidden'));
  t.close();
}
{
  const t = await bootScenario('A: SIPHON OWNED (legion unlocked, no troops)', {
    'webclickergame.clicker': clickerSeed,
    'webclickergame.legion': { unlocked: true, units: {}, unitUnlocks: {} },
  });
  step('souls+legion visible, world/crypt hidden', () => {
    assert(t.vis('souls') && t.vis('legion'), 'expected tabs missing');
    assert(!t.vis('world') && !t.vis('crypt'), 'a locked tab is visible');
  });
  t.close();
}

// ---------- Scenario B: mid-campaign with an army ----------
{
  const t = await bootScenario('B: MID-CAMPAIGN (200 wraiths, 0 cleared)', {
    'webclickergame.clicker': clickerSeed,
    'webclickergame.legion': { unlocked: true, units: { wraith: 200 }, unitUnlocks: {} },
  });
  step('souls/legion/world visible', () => {
    assert(t.vis('souls') && t.vis('legion') && t.vis('world'), 'missing expected tabs');
  });
  step('crypt still hidden', () => assert(!t.vis('crypt'), 'crypt visible too early'));

  step('switch to Legion tab works', () => {
    t.click(t.q('[data-tab="legion"]'));
    assert(!t.q('[data-tab-pane="legion"]').hidden, 'legion pane not shown');
  });
  step('attack ENABLED with army', () => assert(t.q('[data-combat="attack"]').disabled === false, 'disabled'));

  // Full battle: victory over Village -> 1/10 -> Crypt unlocks live.
  step('ATTACK starts battle', () => {
    t.click(t.q('[data-tab="world"]'));
    t.click(t.q('[data-combat="attack"]'));
    assert(t.q('[data-combat="battle-view"]').hidden === false, 'no battle');
  });
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline && t.q('[data-combat="result-view"]').hidden === true) await t.wait(250);
  step('VICTORY + 1/10 + crypt unlocked by first clear', () => {
    assert(t.text('[data-combat="outcome"]').includes('VICTORY'), t.text('[data-combat="outcome"]'));
    assert(/1 \/ 10/.test(t.text('[data-combat="progress"]')), t.text('[data-combat="progress"]'));
    assert(t.vis('crypt'), 'crypt did not unlock after first clear');
  });
  t.close();
}

// ---------- Scenario C: conquered Age of Ash (legacy save) -> advance to Iron ----------
{
  const t = await bootScenario('C: CONQUERED AGE OF ASH (legacy 10/10 save)', {
    'webclickergame.clicker': clickerSeed,
    'webclickergame.legion': { unlocked: true, units: { wraith: 5000 }, unitUnlocks: {} },
    'webclickergame.combat': { battle: null, unlockedTargets: 10, defeatedTargets: 10 },
  });
  step('all four tabs visible', () => {
    assert(t.vis('souls') && t.vis('legion') && t.vis('world') && t.vis('crypt'), 'tab missing');
  });

  step('conquered lull: era still Ash, no completion panel, advance button ready', () => {
    assert(t.text('[data-combat="era"]').includes('Age of Ash'), t.text('[data-combat="era"]'));
    assert(t.q('[data-combat="campaign-complete"]').hidden === true, 'complete box shown early');
    assert(t.q('[data-combat="current-target"]').hidden === true, 'target card still visible');
    assert(t.q('[data-combat="advance-age"]').hidden === false, 'legion advance button hidden');
    assert(
      t.text('[data-combat="advance-age"]').includes('Age of Iron'),
      t.text('[data-combat="advance-age"]'),
    );
    assert(/conquered/.test(t.text('[data-combat="progress"]')), t.text('[data-combat="progress"]'));
  });
  step('ATTACK unavailable during lull', () => {
    assert(t.q('[data-combat="controls"]').hidden === true, 'controls visible');
    assert(t.q('[data-combat="attack"]').disabled === true, 'attack clickable');
  });
  step('World tab shows conquered note with advance action', () => {
    t.click(t.q('[data-tab="world"]'));
    assert(t.q('[data-combat="era-conquered"]').hidden === false, 'lull note hidden');
    assert(t.q('[data-combat="advance-world"]').hidden === false, 'world advance hidden');
    assert(t.text('[data-combat="advance-world"]').includes('Age of Iron'), 'wrong world label');
  });

  // Take the advance action from the Legion pane.
  t.click(t.q('[data-tab="legion"]'));
  step('advance button replaces ATTACK in Legion pane', () => {
    assert(t.q('[data-combat="controls"]').hidden === true, 'controls not replaced');
    assert(t.q('[data-combat="advance-age"]').hidden === false, 'advance hidden in legion');
  });
  t.click(t.q('[data-combat="advance-age"]'));

  step('advanced to Age of Iron @ Village 1,000 CP, ATTACK restored', () => {
    assert(t.text('[data-combat="era"]').includes('Age of Iron'), t.text('[data-combat="era"]'));
    assert(t.vis('souls') && t.vis('legion') && t.vis('world') && t.vis('crypt'), 'tab missing');
    t.click(t.q('[data-tab="world"]'));
    assert(t.q('[data-combat="current-target"]').hidden === false, 'no target card for Iron');
    assert(/1,000/.test(t.text('[data-combat="enemy-power"]')), t.text('[data-combat="enemy-power"]'));
    assert(t.text('[data-combat="target-name"]').includes('Village'), t.text('[data-combat="target-name"]'));
    assert(t.q('[data-combat="advance-age"]').hidden === true, 'advance button stuck visible');
    assert(t.q('[data-combat="controls"]').hidden === false, 'controls did not return');
    assert(t.q('[data-combat="attack"]').disabled === false, 'attack disabled after advance');
    const rows = t.q('[data-combat="progression"]').children.length;
    assert(rows === 10, `rows=${rows}`);
  });

  // Reload persistence: capture storage exactly as the game saved it, then
  // boot a completely fresh DOM from that state.
  const persisted = {};
  for (let i = 0; i < t.win.localStorage.length; i++) {
    const key = t.win.localStorage.key(i);
    persisted[key] = t.win.localStorage.getItem(key);
  }
  assert(Object.keys(persisted).length > 0, 'storage capture empty');

  // The combat blob must carry the NEW age-scoped keys.
  const combatBlob = JSON.parse(persisted['webclickergame.combat']);
  assert(combatBlob.ageId === 'age-of-iron', `ageId=${combatBlob.ageId}`);
  assert(combatBlob.clearedInAge === 0, `clearedInAge=${combatBlob.clearedInAge}`);
  t.close();

  const t2 = await bootScenario('C2: RELOAD FROM PERSISTED IRON STATE', persisted);
  console.log('  DIAG combat blob :', t2.win.localStorage.getItem('webclickergame.combat'));
  console.log('  DIAG progress    :', JSON.stringify(t2.text('[data-combat="progress"]')));
  console.log('  DIAG tabs        :', ['souls', 'legion', 'world', 'crypt'].map((id) => `${id}=${t2.vis(id)}`).join(' '));
  step('reload: Iron progression preserved', () => {
    assert(t2.vis('souls') && t2.vis('legion') && t2.vis('world') && t2.vis('crypt'), 'tab missing');
    assert(t2.text('[data-combat="era"]').includes('Age of Iron'), t2.text('[data-combat="era"]'));
    t2.click(t2.q('[data-tab="world"]'));
    assert(t2.q('[data-combat="current-target"]').hidden === false, 'Iron card lost on reload');
    assert(/1,000/.test(t2.text('[data-combat="enemy-power"]')), t2.text('[data-combat="enemy-power"]'));
    assert(t2.q('[data-combat="attack"]').disabled === false, 'attack disabled after reload');
    assert(t2.q('[data-combat="advance-age"]').hidden === true, 'advance visible after reload');
  });
  t2.close();
}

// ---------- Scenario D: final Age conquered -> whole-campaign completion ----------
{
  const t = await bootScenario('D: FINAL AGE CONQUERED (Age of Ruin complete)', {
    'webclickergame.clicker': clickerSeed,
    'webclickergame.legion': { unlocked: true, units: { wraith: 5000 }, unitUnlocks: {} },
    'webclickergame.combat': { v: 1, battle: null, ageId: 'age-of-ruin', clearedInAge: 10 },
  });
  step('all four tabs visible', () => {
    assert(t.vis('souls') && t.vis('legion') && t.vis('world') && t.vis('crypt'), 'tab missing');
  });
  step('switch to World tab', () => t.click(t.q('[data-tab="world"]')));

  step('completion panel shown, no advance anywhere', () => {
    assert(t.text('[data-combat="era"]').includes('Age of Ruin'), t.text('[data-combat="era"]'));
    assert(t.q('[data-combat="campaign-complete"]').hidden === false, 'complete box hidden');
    assert(t.q('[data-combat="current-target"]').hidden === true, 'card visible');
    assert(
      t.text('[data-combat="final-target-name"]').includes('Imperial Stronghold'),
      'wrong final name',
    );
    assert(
      t.text('[data-combat="campaign-complete"]').includes('None remain'),
      'stale next-age note',
    );
    assert(t.q('[data-combat="advance-age"]').hidden === true, 'legion advance visible');
    assert(t.q('[data-combat="advance-world"]').hidden === true, 'world advance visible');
    assert(t.q('[data-combat="era-conquered"]').hidden === true, 'lull note visible');
  });
  step('ATTACK unavailable', () => {
    assert(t.q('[data-combat="controls"]').hidden === true, 'controls visible');
    assert(t.q('[data-combat="attack"]').disabled === true, 'attack clickable');
  });
  step('progression footer says Campaign Complete', () => {
    assert(t.q('[data-combat="progression-complete"]').hidden === false, 'footer hidden');
  });
  step('all ten rows of the final Age listed', () => {
    const rows = t.q('[data-combat="progression"]').children.length;
    assert(rows === 10, `rows=${rows}`);
  });

  // Reload persistence: completion must survive a fresh boot.
  const persisted = {};
  for (let i = 0; i < t.win.localStorage.length; i++) {
    const key = t.win.localStorage.key(i);
    persisted[key] = t.win.localStorage.getItem(key);
  }
  t.close();

  const t2 = await bootScenario('D2: RELOAD FROM PERSISTED COMPLETION', persisted);
  step('reload: completion state preserved', () => {
    assert(t2.text('[data-combat="era"]').includes('Age of Ruin'), t2.text('[data-combat="era"]'));
    t2.click(t2.q('[data-tab="world"]'));
    assert(t2.q('[data-combat="campaign-complete"]').hidden === false, 'complete box hidden');
    assert(t2.text('[data-combat="progress"]').includes('complete'), t2.text('[data-combat="progress"]'));
    assert(
      t2.text('[data-combat="final-target-name"]').includes('Imperial Stronghold'),
      'final name lost',
    );
    assert(t2.q('[data-combat="attack"]').disabled === true, 'attack enabled after reload');
    assert(t2.q('[data-combat="controls"]').hidden === true, 'controls visible after reload');
  });
  t2.close();
}

// ---------- Scenario E: live combat in Age of Iron (Knight garrison) ----------
{
  const t = await bootScenario('E: IRON AGE BATTLE (Village, 1,000 CP)', {
    'webclickergame.clicker': clickerSeed,
    'webclickergame.legion': { unlocked: true, units: { wraith: 5000 }, unitUnlocks: {} },
    'webclickergame.combat': { v: 1, battle: null, ageId: 'age-of-iron', clearedInAge: 0 },
  });
  step('booted into Iron at Village', () => {
    assert(t.text('[data-combat="era"]').includes('Age of Iron'), t.text('[data-combat="era"]'));
    t.click(t.q('[data-tab="world"]'));
    assert(/1,000/.test(t.text('[data-combat="enemy-power"]')), t.text('[data-combat="enemy-power"]'));
    // The composer fields the Knight from the very first Iron target.
    assert(t.text('[data-combat="enemy-army"]').includes('Knight'), 'no Knight in Iron garrison');
  });
  step('ATTACK starts the Iron battle', () => {
    t.click(t.q('[data-combat="attack"]'));
    assert(t.q('[data-combat="battle-view"]').hidden === false, 'no battle');
  });
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline && t.q('[data-combat="result-view"]').hidden === true) await t.wait(250);
  step('VICTORY advances Iron to 1/10 without age switch', () => {
    assert(t.text('[data-combat="outcome"]').includes('VICTORY'), t.text('[data-combat="outcome"]'));
    assert(/1 \/ 10/.test(t.text('[data-combat="progress"]')), t.text('[data-combat="progress"]'));
    assert(t.text('[data-combat="era"]').includes('Age of Iron'), 'age flipped early');
    assert(t.q('[data-combat="advance-age"]').hidden === true, 'advance shown mid-age');
  });
  t.close();
}

// ---------- Scenario F: Iron Royal Fortress shows a mixed garrison ----------
{
  const t = await bootScenario('F: IRON GARRISON COMPOSITION (Royal Fortress)', {
    'webclickergame.clicker': clickerSeed,
    'webclickergame.legion': { unlocked: true, units: { wraith: 5000 }, unitUnlocks: {} },
    'webclickergame.combat': { v: 1, battle: null, ageId: 'age-of-iron', clearedInAge: 6 },
  });
  step('Royal Fortress garrison preview is a believable mixed army', () => {
    t.click(t.q('[data-tab="world"]'));
    assert(
      t.text('[data-combat="target-name"]').includes('Royal Fortress'),
      t.text('[data-combat="target-name"]'),
    );
    const armyText = t.q('[data-combat="enemy-army"]').textContent;
    assert(armyText.includes('Iron Militia'), `no militia: ${armyText}`);
    assert(armyText.includes('Iron Archer'), `no archers: ${armyText}`);
    assert(armyText.includes('Knight'), `no knights: ${armyText}`);
    // Officers must stay a thin layer over massed fodder (regression guard
    // against the old greedy composer's 4,687-captain fortress).
    const captainMatch = /([\d,]+)\s+Iron Captain/.exec(armyText);
    assert(captainMatch !== null, `no captains: ${armyText}`);
    const captains = parseInt(captainMatch[1].replace(/,/g, ''), 10);
    const militia = parseInt(/([\d,]+)\s+Iron Militia/.exec(armyText)[1].replace(/,/g, ''), 10);
    assert(captains > 0 && militia > captains * 20, `captains ${captains} vs militia ${militia}`);
  });
  t.close();
}

// ---------- Scenario G: debug popout window + TOTAL RESET ----------
{
  const t = await bootScenario('G: DEBUG POPOUT & TOTAL RESET', {
    'webclickergame.clicker': clickerSeed,
    'webclickergame.combat': { v: 1, battle: null, ageId: 'age-of-iron', clearedInAge: 4 },
    // Foreign key must survive the wipe (prefix sweep, not clear()).
    'unrelated.app': 'keep-me',
  });
  const gameKeys = () =>
    Object.keys(t.win.localStorage).filter((k) => k.startsWith('webclickergame.'));
  step('popout lives outside the header and opens via the toggle', () => {
    assert(
      t.q('.game-header #diagnostics') === null,
      'diagnostics still inside the game header',
    );
    assert(t.q('#diagnostics').hidden === true, 'window starts open');
    // Player-facing default: the 🐞 toggle itself is hidden until dev access
    // (Ctrl+Shift+D or ?debug=1) unlocks it. Synthetic clicks still reach it.
    assert(t.q('#diagnostics-toggle').hidden === true, 'debug toggle visible without dev access');
    t.click(t.q('#diagnostics-toggle'));
    assert(t.q('#diagnostics').hidden === false, 'window did not open');
  });
  step('window holds status rows plus all three actions', () => {
    assert(t.q('#diagnostics [data-status="loop"]') !== null, 'no status rows');
    assert(t.q('#save-export') !== null && t.q('#save-import') !== null, 'backup buttons missing');
    assert(t.q('#save-total-reset') !== null, 'total reset missing');
    assert(gameKeys().length >= 2, 'seeded saves missing');
  });
  step('TOTAL RESET wipes every webclickergame.* key, keeps foreign ones', () => {
    let confirmMessage = '';
    t.win.confirm = (msg) => {
      confirmMessage = String(msg);
      return true;
    };
    t.click(t.q('#save-total-reset'));
    assert(confirmMessage.includes('Prestige'), 'confirm text does not mention Prestige');
    assert(gameKeys().length === 0, `keys left behind: ${gameKeys().join(', ')}`);
    assert(t.win.localStorage.getItem('unrelated.app') === 'keep-me', 'foreign key was wiped');
  });
  step('unload cascade cannot resurrect the wiped keys', () => {
    // Real browsers fire these while location.reload() tears the page down;
    // jsdom never navigates, so replay them by hand. This is precisely what
    // used to re-save stale session state OVER the wipe (the "leftovers").
    Object.defineProperty(t.win.document, 'visibilityState', {
      value: 'hidden',
      configurable: true,
    });
    t.win.document.dispatchEvent(new t.win.Event('visibilitychange'));
    t.win.dispatchEvent(new t.win.Event('pagehide'));
    t.win.dispatchEvent(new t.win.Event('beforeunload'));
    assert(gameKeys().length === 0, `resurrected keys: ${gameKeys().join(', ')}`);
  });
  t.close();
}

// ---------- Scenario H: Prestige progress survives reload (boot-order guard) ----------
{
  const t = await bootScenario('H: PRESTIGE SAVE SURVIVES RELOAD (shop gate)', {
    'webclickergame.clicker': clickerSeed,
    'webclickergame.legion': { unlocked: true, units: { wraith: 500 }, unitUnlocks: {} },
    // Mid-progress campaign: its restore publishes conqueredAges >= 1,
    // which fires Age-milestone reports during boot. Against an unrestored
    // prestige these once saved a default-state blob OVER this real one.
    'webclickergame.combat': { v: 1, battle: null, ageId: 'age-of-iron', clearedInAge: 4 },
    'webclickergame.prestige': {
      v: 1,
      count: 2,
      points: 3,
      claimedRewards: ['age:age-of-ash', 'age:age-of-iron'],
      purchases: {},
      pendingRewards: {},
    },
  });

  step('prestige counter and points survive the boot', () => {
    const blob = JSON.parse(t.win.localStorage.getItem('webclickergame.prestige'));
    assert(blob.count === 2, `count lost: ${blob.count}`);
    assert(blob.points === 3, `points lost: ${blob.points}`);
    assert(
      Array.isArray(blob.claimedRewards) && blob.claimedRewards.includes('age:age-of-ash'),
      'claimed ledger lost',
    );
  });

  step('debug shop button enabled by prior Prestige', () => {
    t.click(t.q('#diagnostics-toggle'));
    const button = t.q('#debug-prestige-shop');
    assert(button !== null, 'shop button missing');
    assert(button.disabled === false, 'shop button still locked');
  });

  step('shop opens with the persisted point balance', () => {
    t.click(t.q('#debug-prestige-shop'));
    assert(t.q('[data-shop="modal"]').hidden === false, 'shop did not open');
    assert(t.text('[data-shop="points"]').trim() === '3', t.text('[data-shop="points"]'));
  });

  t.close();
}

// ---------- Scenario I: save import end-to-end (file -> storage -> reload guard) ----------
{
  const backup = {
    app: 'endless-souls',
    format: 1,
    schemaVersion: 1,
    exportedAt: '2026-01-01T00:00:00.000Z',
    origin: 'http://localhost/',
    data: {
      'webclickergame.prestige': {
        v: 1,
        count: 9,
        points: 7,
        claimedRewards: ['age:age-of-ash'],
        purchases: {},
        pendingRewards: {},
      },
      'webclickergame.clicker': {
        v: 1,
        souls: 4321,
        totalClicks: 42,
        upgrades: {},
        generators: {},
        lastSeen: null,
      },
      'foreign.key': 'never-written',
    },
  };

  const t = await bootScenario('I: SAVE IMPORT (file -> storage -> reload guard)', {
    // Stale session state the old bug would resurrect over the import.
    'webclickergame.clicker': { souls: 111, totalClicks: 5, upgrades: {}, generators: {}, lastSeen: null },
  });

  // Async work happens at BLOCK level (sync step() cannot await): dispatch
  // the import, then poll storage until the handler's commit lands.
  t.win.confirm = () => true;
  t.click(t.q('#diagnostics-toggle'));
  const input = t.q('#save-import-file');
  const file = new t.win.File([JSON.stringify(backup)], 'backup.json', {
    type: 'application/json',
  });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new t.win.Event('change'));

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const raw = t.win.localStorage.getItem('webclickergame.prestige');
    if (raw !== null && JSON.parse(raw).count === 9) break;
    await t.wait(25);
  }

  step('import replaces game keys with backup contents', () => {
    const prestige = JSON.parse(t.win.localStorage.getItem('webclickergame.prestige'));
    assert(
      prestige.count === 9 && prestige.points === 7,
      `prestige not restored: ${JSON.stringify(prestige)}`,
    );
    const clicker = JSON.parse(t.win.localStorage.getItem('webclickergame.clicker'));
    assert(clicker.souls === 4321, `clicker not restored: ${clicker.souls}`);
    assert(t.win.localStorage.getItem('foreign.key') === null, 'foreign key was written');
  });

  // Replay the unload cascade a real browser fires during location.reload().
  Object.defineProperty(t.win.document, 'visibilityState', {
    value: 'hidden',
    configurable: true,
  });
  t.win.document.dispatchEvent(new t.win.Event('visibilitychange'));
  t.win.dispatchEvent(new t.win.Event('pagehide'));
  t.win.dispatchEvent(new t.win.Event('beforeunload'));

  step('unload cascade cannot overwrite the imported blobs', () => {
    const prestige = JSON.parse(t.win.localStorage.getItem('webclickergame.prestige'));
    assert(prestige.points === 7, `points overwritten by unload flush: ${prestige.points}`);
    const clicker = JSON.parse(t.win.localStorage.getItem('webclickergame.clicker'));
    assert(clicker.souls === 4321, `souls overwritten by unload flush: ${clicker.souls}`);
  });

  t.close();
}

// ---------- Scenario K: DEFEAT transcript + reduced loot ----------
{
  const t = await bootScenario('K: DEFEAT TRANSCRIPT & LOOT', {
    'webclickergame.clicker': clickerSeed,
    'webclickergame.legion': { unlocked: true, units: { wraith: 10 }, unitUnlocks: {} },
    'webclickergame.combat': { v: 1, battle: null, ageId: 'age-of-ash', clearedInAge: 1, fledHeroes: [] },
  });
  step('booted with a small strike force', () => {
    assert(t.vis('souls') && t.vis('legion') && t.vis('world'), 'tabs missing');
  });

  step('ATTACK starts the battle', () => {
    t.click(t.q('[data-tab="world"]'));
    t.click(t.q('[data-combat="attack"]'));
    assert(t.q('[data-combat="battle-view"]').hidden === false, 'no battle');
  });

  const deadline = Date.now() + 20000;
  while (Date.now() < deadline && t.q('[data-combat="result-view"]').hidden === true) {
    await t.wait(250);
  }

  step('DEFEAT keeps the battle panel visible (transcript)', () => {
    assert(t.text('[data-combat="outcome"]').includes('DEFEAT'), t.text('[data-combat="outcome"]'));
    assert(t.q('[data-combat="battle-view"]').hidden === false, 'battle panel was hidden on defeat');
    const log = t.q('[data-combat="battle-log"]');
    assert(log.children.length > 0, 'battle log is empty on defeat');
  });

  step('defeat pays reduced loot and shows it', () => {
    const lootLine = t.q('[data-combat="loot-gained"]');
    // Village-table casualties are guaranteed (min-1/tick), so the line
    // must render; the amount is the rounded-up half share.
    assert(lootLine.hidden === false, `loot line hidden: "${lootLine.textContent}"`);
    assert(lootLine.textContent.includes('Loot gained'), lootLine.textContent);
  });

  step('no hero at Ash target -> banner stays hidden', () => {
    const banner = t.q('[data-combat="hero-banner"]');
    if (banner !== null) {
      assert(banner.hidden === true || banner.textContent === '', 'banner visible without hero');
    }
  });
  t.close();
}

// ---------- Scenario L: dev access via ?debug=1 (tab-session unlock) ----------
{
  const t = await bootScenario('L: DEV ACCESS (?debug=1)', {}, { url: 'http://localhost/?debug=1' });
  step('?debug=1 reveals the toggle and stores the session flag', () => {
    assert(t.q('#diagnostics-toggle').hidden === false, '?debug=1 did not reveal the toggle');
    assert(
      t.win.sessionStorage.getItem('webclickergame.dev') === '1',
      'dev flag missing from sessionStorage',
    );
  });
  step('popout opens via the revealed toggle', () => {
    t.click(t.q('#diagnostics-toggle'));
    assert(t.q('#diagnostics').hidden === false, 'window did not open');
  });
  t.close();
}

// ---------- Scenario M: dev access via Ctrl+Shift+D ----------
{
  const t = await bootScenario('M: DEV ACCESS (CTRL+SHIFT+D)', {});
  step('default boot keeps debug fully hidden', () => {
    assert(t.q('#diagnostics-toggle').hidden === true, 'toggle visible without dev access');
    assert(t.q('#diagnostics').hidden === true, 'panel visible without dev access');
    assert(t.win.sessionStorage.getItem('webclickergame.dev') === null, 'flag set without unlock');
  });
  step('Ctrl+Shift+D unlocks debug and opens the popout', () => {
    t.win.dispatchEvent(new t.win.KeyboardEvent('keydown', {
      ctrlKey: true,
      shiftKey: true,
      code: 'KeyD',
    }));
    assert(t.q('#diagnostics-toggle').hidden === false, 'shortcut did not reveal the toggle');
    assert(t.q('#diagnostics').hidden === false, 'shortcut did not open the window');
  });
  step('second Ctrl+Shift+D closes the popout (access stays)', () => {
    t.win.dispatchEvent(new t.win.KeyboardEvent('keydown', {
      ctrlKey: true,
      shiftKey: true,
      code: 'KeyD',
    }));
    assert(t.q('#diagnostics').hidden === true, 'shortcut did not close the window');
    assert(t.q('#diagnostics-toggle').hidden === false, 'access was revoked by toggle');
  });
  t.close();
}

console.log(failed ? '\nSMOKE: FAILURES' : '\nSMOKE: ALL PASS');
process.exit(failed ? 1 : 0);

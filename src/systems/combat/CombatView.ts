import { formatNumber } from '../../ui/format';
import { tierMeta } from './abilities';
import { formatWipePhrase } from './battleFlavor';
import { armyPower, takeFromArmy } from '../legion/deployment';
import type { ArmyUnitGroup } from '../legion/types';
import type {
  ActiveBattleView,
  BattleResult,
  CombatChangedPayload,
  CombatTargetView,
} from './types';
import { BuildingSystem } from '../buildings/BuildingSystem';

const DEPLOY_PERCENTS = [0.25, 0.5, 0.75, 1] as const;
const MOMENTUM_LABEL: Record<string, string> = {
  attacker: 'Your legion',
  defender: 'The defense',
  even: 'Evenly matched',
};

function describeGroups(label: string, groups: { count: number; name: string }[]): string {
  if (groups.length === 0) return `${label}: None`;
  const detail = groups.map((group) => `${formatNumber(group.count)} ${group.name}`).join(', ');
  return `${label}: ${detail}`;
}

function describeForces(forces: { deployed: number; surviving: number; name: string }[]): string {
  const alive = forces.filter((force) => force.deployed > 0);
  if (alive.length === 0) return 'None';
  return alive
    .map((force) => {
      const lost = force.deployed - force.surviving;
      return lost > 0
        ? `${formatNumber(force.surviving)} ${force.name} (−${formatNumber(lost)})`
        : `${formatNumber(force.surviving)} ${force.name}`;
    })
    .join(', ');
}

function barPercent(current: number, initial: number): number {
  if (initial <= 0) return 0;
  return Math.min(100, Math.max(0, (current / initial) * 100));
}

export class CombatView {
  private readonly eraLabel: HTMLElement;
  private readonly progressLabel: HTMLElement;
  private readonly armyPowerLabel: HTMLElement;
  private readonly currentTargetEl: HTMLElement;
  private readonly controlsEl: HTMLElement;
  private readonly deployButtons: HTMLButtonElement[];
  private readonly deployPreviewLabel: HTMLElement;
  private readonly attackButton: HTMLButtonElement;

  private readonly battleViewEl: HTMLElement;
  private readonly battleStatusLabel: HTMLElement;
  private readonly battleAttackerBarFill: HTMLElement;
  private readonly battleDefenderBarFill: HTMLElement;
  private readonly battleAttackerPowerLabel: HTMLElement;
  private readonly battleDefenderPowerLabel: HTMLElement;
  private readonly battleForcesLabel: HTMLElement;
  private readonly heroBannerEl: HTMLElement;
  private readonly battleLogEl: HTMLElement;

  /** QOL toggle below ATTACK: jump to the World pane when a battle starts. */
  private readonly worldSwitchInput: HTMLInputElement;

  /** Enemy CP of the current target; drives the deploy-preview risk tint. */
private currentTargetEnemyPower = 0;
  private campaignComplete = false;
  private buildings: BuildingSystem | null = null;
  /** Conquered-Age lull: advance buttons replace ATTACK / Continue Attack. */
  private eraConquered = false;
  private readonly progressionListEl: HTMLElement | null;
  private readonly completeBoxEl: HTMLElement | null;
  private readonly finalTargetNameEl: HTMLElement | null;
  private readonly progressionCompleteLineEl: HTMLElement | null;
  private readonly eraConqueredEl: HTMLElement | null;
  private readonly advanceAgeButton: HTMLButtonElement;
  private readonly advanceResultButton: HTMLButtonElement;
  private readonly advanceWorldButton: HTMLButtonElement | null;

  private readonly resultViewEl: HTMLElement;
  private readonly outcomeLabel: HTMLElement;
  private readonly survivorsLabel: HTMLElement;
  private readonly casualtiesLabel: HTMLElement;
  private readonly enemyCasualtiesLabel: HTMLElement;
  private readonly lootLine: HTMLElement;
  private readonly heroLine: HTMLElement;
  private readonly defeatCauseLabel: HTMLElement;

  /** QOL: shown with every result — sends the player back to recruitment. */
  private readonly returnLegionButton: HTMLButtonElement;

  /** QOL: re-attacks the campaign frontier with the selected deploy percent. */
  private readonly continueAttackButton: HTMLButtonElement;

  private readonly enemyArmyEl: HTMLElement;

  private readonly battleIdleEl: HTMLElement;
  private readonly idleTargetNameEl: HTMLElement;
  private readonly idleTargetPowerEl: HTMLElement;
  private readonly idleTargetTerrainEl: HTMLElement;
  private readonly idleTargetLootEl: HTMLElement;
  private readonly idleEnemyArmyEl: HTMLElement;
  private readonly idleDescriptionEl: HTMLElement;
  private readonly idleControlsEl: HTMLElement;
  private readonly idleDeployButtons: HTMLButtonElement[];
  private readonly idleDeployPreviewEl: HTMLElement;
  private readonly idleAttackButton: HTMLButtonElement;

  private attackHandler: ((percent: number, targetId: string) => void) | null = null;
  private autoSwitchHandler: ((enabled: boolean) => void) | null = null;
  private returnLegionHandler: (() => void) | null = null;
  private advanceAgeHandler: (() => void) | null = null;
  private selectedPercent = 1;
  private currentTargetId: string | null = null;
  private lastArmy: ArmyUnitGroup[] = [];
  private lastRenderedEventId = 0;

  constructor(root: ParentNode) {
    const era = root.querySelector<HTMLElement>('[data-combat="era"]');
    const progress = root.querySelector<HTMLElement>('[data-combat="progress"]');
    const currentTarget = root.querySelector<HTMLElement>('[data-combat="current-target"]');
    const armyPower = root.querySelector<HTMLElement>('[data-combat="army-power"]');

    const controls = root.querySelector<HTMLElement>('[data-combat="controls"]');
    const deployPreview = root.querySelector<HTMLElement>('[data-combat="deploy-preview"]');
    const attack = root.querySelector<HTMLButtonElement>('[data-combat="attack"]');

    const battleView = root.querySelector<HTMLElement>('[data-combat="battle-view"]');
    const battleStatus = root.querySelector<HTMLElement>('[data-combat="battle-status"]');
    const attackerBarFill = root.querySelector<HTMLElement>('[data-combat="bar-attacker"]');
    const defenderBarFill = root.querySelector<HTMLElement>('[data-combat="bar-defender"]');
    const attackerPowerLabel = root.querySelector<HTMLElement>('[data-combat="power-attacker"]');
    const defenderPowerLabel = root.querySelector<HTMLElement>('[data-combat="power-defender"]');
    const forces = root.querySelector<HTMLElement>('[data-combat="battle-forces"]');
    const heroBanner = root.querySelector<HTMLElement>('[data-combat="hero-banner"]');
    const log = root.querySelector<HTMLElement>('[data-combat="battle-log"]');

    const worldSwitch = root.querySelector<HTMLInputElement>('[data-combat="world-switch"]');

    const resultView = root.querySelector<HTMLElement>('[data-combat="result-view"]');
    const outcome = root.querySelector<HTMLElement>('[data-combat="outcome"]');
    const survivors = root.querySelector<HTMLElement>('[data-combat="survivors"]');
    const casualties = root.querySelector<HTMLElement>('[data-combat="casualties"]');
    const enemyCasualties = root.querySelector<HTMLElement>('[data-combat="enemy-casualties"]');
    const lootGained = root.querySelector<HTMLElement>('[data-combat="loot-gained"]');
    const heroOutcome = root.querySelector<HTMLElement>('[data-combat="hero-outcome"]');
    const defeatCause = root.querySelector<HTMLElement>('[data-combat="defeat-cause"]');
    const returnLegion = root.querySelector<HTMLButtonElement>('[data-combat="return-legion"]');
    const continueAttack = root.querySelector<HTMLButtonElement>('[data-combat="continue-attack"]');

    const enemyArmy = root.querySelector<HTMLElement>('[data-combat="enemy-army"]');

    const battleIdle = root.querySelector<HTMLElement>('[data-combat="battle-idle"]');
    const idleTargetName = root.querySelector<HTMLElement>('[data-combat="idle-target-name"]');
    const idleTargetPower = root.querySelector<HTMLElement>('[data-combat="idle-target-power"]');
    const idleTargetTerrain = root.querySelector<HTMLElement>('[data-combat="idle-target-terrain"]');
    const idleTargetLoot = root.querySelector<HTMLElement>('[data-combat="idle-target-loot"]');
    const idleEnemyArmy = root.querySelector<HTMLElement>('[data-combat="idle-enemy-army"]');
    const idleDescription = root.querySelector<HTMLElement>('[data-combat="idle-description"]');
    const idleControls = root.querySelector<HTMLElement>('[data-combat="idle-controls"]');
    const idleDeployPreview = root.querySelector<HTMLElement>('[data-combat="idle-deploy-preview"]');
    const idleAttack = root.querySelector<HTMLButtonElement>('[data-combat="idle-attack"]');

    const required: [unknown, string][] = [
      [era, 'era'],
      [progress, 'progress'],
      [armyPower, 'army-power'],
      [controls, 'controls'],
      [deployPreview, 'deploy-preview'],
      [attack, 'attack'],
      [battleView, 'battle-view'],
      [battleStatus, 'battle-status'],
      [attackerBarFill, 'bar-attacker'],
      [defenderBarFill, 'bar-defender'],
      [attackerPowerLabel, 'power-attacker'],
      [defenderPowerLabel, 'power-defender'],
      [forces, 'battle-forces'],
      [heroBanner, 'hero-banner'],
      [log, 'battle-log'],
      [resultView, 'result-view'],
      [outcome, 'outcome'],
      [survivors, 'survivors'],
      [casualties, 'casualties'],
      [enemyCasualties, 'enemy-casualties'],
      [lootGained, 'loot-gained'],
      [heroOutcome, 'hero-outcome'],
      [defeatCause, 'defeat-cause'],
      [enemyArmy, 'enemy-army'],
      [currentTarget, 'current-target'],
      [worldSwitch, 'world-switch'],
      [returnLegion, 'return-legion'],
      [continueAttack, 'continue-attack'],
      [battleIdle, 'battle-idle'],
      [idleTargetName, 'idle-target-name'],
      [idleTargetPower, 'idle-target-power'],
      [idleTargetTerrain, 'idle-target-terrain'],
      [idleTargetLoot, 'idle-target-loot'],
      [idleEnemyArmy, 'idle-enemy-army'],
      [idleDescription, 'idle-description'],
      [idleControls, 'idle-controls'],
      [idleDeployPreview, 'idle-deploy-preview'],
      [idleAttack, 'idle-attack'],
    ];
    for (const [element, name] of required) {
      if (element === null) throw new Error(`combat element [data-combat="${name}"] not found`);
    }

    this.eraLabel = era!;
    this.progressLabel = progress!;
    this.armyPowerLabel = armyPower!;
    this.currentTargetEl = currentTarget!;
    this.controlsEl = controls!;
    this.deployPreviewLabel = deployPreview!;
    this.attackButton = attack!;

    this.battleViewEl = battleView!;
    this.battleStatusLabel = battleStatus!;
    this.battleAttackerBarFill = attackerBarFill!;
    this.battleDefenderBarFill = defenderBarFill!;
    this.battleAttackerPowerLabel = attackerPowerLabel!;
    this.battleDefenderPowerLabel = defenderPowerLabel!;
    this.battleForcesLabel = forces!;
    this.heroBannerEl = heroBanner!;
    this.battleLogEl = log!;

    this.worldSwitchInput = worldSwitch!;
    this.worldSwitchInput.addEventListener('change', () => {
      this.autoSwitchHandler?.(this.worldSwitchInput.checked);
    });

    this.resultViewEl = resultView!;
    this.outcomeLabel = outcome!;
    this.survivorsLabel = survivors!;
    this.casualtiesLabel = casualties!;
    this.enemyCasualtiesLabel = enemyCasualties!;
    this.lootLine = lootGained!;
    this.heroLine = heroOutcome!;
    this.defeatCauseLabel = defeatCause!;
    this.returnLegionButton = returnLegion!;
    this.returnLegionButton.addEventListener('click', () => {
      this.returnLegionHandler?.();
    });

    this.continueAttackButton = continueAttack!;
    this.continueAttackButton.addEventListener('click', () => {
      // Always forward: the frontier target from the latest payload. After a
      // victory that is the newly unlocked target; after a defeat the
      // frontier is unchanged, so this retries the blocker (the only way
      // forward — defeats never advance and never lock attacking).
      if (this.currentTargetId !== null) {
        this.attackHandler?.(this.selectedPercent, this.currentTargetId);
      }
    });

    this.enemyArmyEl = enemyArmy!;
    this.progressionListEl = root.querySelector<HTMLElement>('[data-combat="progression"]');
    this.completeBoxEl = root.querySelector<HTMLElement>('[data-combat="campaign-complete"]');
    this.finalTargetNameEl = root.querySelector<HTMLElement>('[data-combat="final-target-name"]');
    this.progressionCompleteLineEl = root.querySelector<HTMLElement>(
      '[data-combat="progression-complete"]',
    );
    this.eraConqueredEl = root.querySelector<HTMLElement>('[data-combat="era-conquered"]');
    const advanceAge = root.querySelector<HTMLButtonElement>('[data-combat="advance-age"]');
    const advanceResult = root.querySelector<HTMLButtonElement>('[data-combat="advance-result"]');
    const requiredAdvance: [unknown, string][] = [
      [advanceAge, 'advance-age'],
      [advanceResult, 'advance-result'],
    ];
    for (const [element, name] of requiredAdvance) {
      if (element === null) throw new Error(`combat element [data-combat="${name}"] not found`);
    }
    this.advanceAgeButton = advanceAge!;
    this.advanceResultButton = advanceResult!;
    this.advanceWorldButton = root.querySelector<HTMLButtonElement>('[data-combat="advance-world"]');
    for (const button of [this.advanceAgeButton, this.advanceResultButton, this.advanceWorldButton]) {
      button?.addEventListener('click', () => {
        if (!this.eraConquered) return;
        this.advanceAgeHandler?.();
      });
    }
    this.deployButtons = Array.from(
      root.querySelectorAll<HTMLButtonElement>('[data-combat-deploy]'),
    );
    if (this.deployButtons.length !== DEPLOY_PERCENTS.length) {
      throw new Error('combat deployment buttons missing');
    }
    for (let index = 0; index < this.deployButtons.length; index += 1) {
      const button = this.deployButtons[index];
      button.textContent = `${DEPLOY_PERCENTS[index] * 100}%`;
      button.addEventListener('click', () => {
        this.selectedPercent = DEPLOY_PERCENTS[index];
        this.syncControls();
      });
    }

    attack!.addEventListener('click', () => {
      if (this.currentTargetEl!.hidden === false) {
        this.attackHandler?.(this.selectedPercent, this.currentTargetId!);
      }
    });

    this.battleIdleEl = battleIdle!;
    this.idleTargetNameEl = idleTargetName!;
    this.idleTargetPowerEl = idleTargetPower!;
    this.idleTargetTerrainEl = idleTargetTerrain!;
    this.idleTargetLootEl = idleTargetLoot!;
    this.idleEnemyArmyEl = idleEnemyArmy!;
    this.idleDescriptionEl = idleDescription!;
    this.idleControlsEl = idleControls!;
    this.idleDeployPreviewEl = idleDeployPreview!;
    this.idleAttackButton = idleAttack!;
    this.idleDeployButtons = Array.from(
      root.querySelectorAll<HTMLButtonElement>('[data-combat-deploy-idle]'),
    );
    if (this.idleDeployButtons.length !== DEPLOY_PERCENTS.length) {
      throw new Error('combat idle deployment buttons missing');
    }
    for (let index = 0; index < this.idleDeployButtons.length; index += 1) {
      const button = this.idleDeployButtons[index];
      button.textContent = `${DEPLOY_PERCENTS[index] * 100}%`;
      button.addEventListener('click', () => {
        this.selectedPercent = DEPLOY_PERCENTS[index];
        this.syncControls();
      });
    }
    this.idleAttackButton.addEventListener('click', () => {
      if (this.currentTargetId !== null) {
        this.attackHandler?.(this.selectedPercent, this.currentTargetId);
      }
    });
  }

  onAttack(handler: (percent: number, targetId: string) => void): void {
    this.attackHandler = handler;
  }

  /** Current state of the "switch to World on attack" QOL toggle. */
  get autoSwitchToWorld(): boolean {
    return this.worldSwitchInput.checked;
  }

  /** Applies a persisted toggle state (boot restore). */
  setAutoSwitchToWorld(enabled: boolean): void {
    this.worldSwitchInput.checked = enabled;
  }

  /** Fires whenever the player toggles the switch, with the new value. */
  onAutoSwitchChange(handler: (enabled: boolean) => void): void {
    this.autoSwitchHandler = handler;
  }

  /** Fires when the player presses the result view's "Return to Legion". */
  onReturnToLegion(handler: () => void): void {
    this.returnLegionHandler = handler;
  }

/** Fires when the player presses an advance-to-next-Age button. */
  onAdvanceAge(handler: () => void): void {
    this.advanceAgeHandler = handler;
  }

  setBuildings(buildingsSystem: BuildingSystem): void {
    this.buildings = buildingsSystem;
  }

  render(payload: CombatChangedPayload, army: ArmyUnitGroup[]): void {
    this.lastArmy = army;

    const conquering = payload.eraConquered === true;
    this.eraLabel.textContent = payload.eraName;
    if (this.progressionListEl !== null) this.renderProgression(payload.targets);

    let totalPower = 0;
    for (const group of army) totalPower += group.count * group.combatPowerEach;
    this.armyPowerLabel.textContent = formatNumber(totalPower);

    // Render current target (instead of full target list). Sets the
    // campaignComplete/eraConquered flags and the progress label.
    this.renderCurrentTarget(payload);
    this.eraConquered = conquering;

    const battling = payload.phase === 'battle' && payload.battle !== null;
    const resultShown = payload.phase === 'result' && payload.result !== null;

    // During a conquered lull the advance action takes over both attack
    // slots; everything returns to normal once the next Age is loaded.
    const advanceLabel =
      payload.nextEraName !== null ? `Advance to the ${payload.nextEraName}` : '';
    for (const button of [this.advanceAgeButton, this.advanceResultButton, this.advanceWorldButton]) {
      if (button === null) continue;
      button.hidden = !conquering || battling;
      button.textContent = advanceLabel;
    }
    if (this.eraConqueredEl !== null) this.eraConqueredEl.hidden = !conquering || battling;

    // Campaign-complete/conquered hide the deployment controls entirely (the
    // flags are set inside renderCurrentTarget, which runs just above).
    this.controlsEl.hidden = battling || this.campaignComplete || conquering;
    this.continueAttackButton.hidden = conquering;
    // On VICTORY and DEFEAT the battle panel stays visible under the result
    // card: frozen power bars/forces plus the full flavor transcript, so the
    // player can read what happened. The hero banner is re-derived from
    // OUTCOMES there, so it can never contradict the fate lines
    // ("fled"/"slain") rendered right beside it.
    const showTranscript = resultShown && payload.result !== null;
    this.battleViewEl.hidden = !battling && !showTranscript;
    this.resultViewEl.hidden = !resultShown;

    const idle = !battling && !resultShown;
    this.battleIdleEl.hidden = !idle || this.campaignComplete || conquering;

    if (showTranscript && payload.result !== null) {
      const result = payload.result;

      // Truthful end-state: bars show each side's SURVIVING share of its
      // deployed force (raw powers collapse to zero once a side is wiped).
      this.battleAttackerBarFill.style.width = `${Math.round(
        result.finalAttackerStrength * 100,
      )}%`;
      this.battleDefenderBarFill.style.width = `${Math.round(
        result.finalDefenderStrength * 100,
      )}%`;
      this.battleAttackerPowerLabel.textContent = `${Math.round(
        result.finalAttackerStrength * 100,
      )}%`;
      this.battleDefenderPowerLabel.textContent = `${Math.round(
        result.finalDefenderStrength * 100,
      )}%`;
      this.battleStatusLabel.textContent =
        result.outcome === 'victory'
          ? `Victory at ${result.targetName} · Ended in ${result.durationSeconds.toFixed(1)}s`
          : `Broken at ${result.targetName} · Ended in ${result.durationSeconds.toFixed(1)}s`;

      // Hero presence banner re-derived from OUTCOMES, so it can never
      // contradict the fate lines ("fled"/"slain") rendered right beside it.
      const standing = result.standingHeroCount ?? 0;
      if (standing > 0) {
        this.heroBannerEl.hidden = false;
        this.heroBannerEl.textContent =
          standing === 1
            ? '⚠ ENEMY HERO IS PRESENT'
            : `⚠ ENEMY HEROES ARE PRESENT ×${standing}`;
      } else {
        this.heroBannerEl.hidden = true;
        this.heroBannerEl.textContent = '';
      }

      // Terminal beats (decisive climax + same-tick lines) were pushed AFTER
      // the last live publish — replay them into the frozen log so the
      // transcript shows its ending.
      if (result.transcriptEvents !== undefined) {
        this.renderLog(result.transcriptEvents);
      }
      // The forces line is one tick stale at battle end and duplicates the
      // survivors/casualties lists in the result card — hide it here.
      this.battleForcesLabel.hidden = true;
    }

    if (!battling && !this.campaignComplete && !conquering) this.syncControls();
    if (idle) this.renderIdle(payload);
    if (battling && payload.battle !== null) this.renderBattle(payload.battle);

    if (resultShown) {
      this.renderResult(payload.result!);
    }

    // Continue Attack mirrors ATTACK availability: needs a frontier target
    // and living troops. Defeats never advance the frontier, so after one
    // this stays enabled as soon as any garrison remains.
    const totalUnits = army.reduce((sum, group) => sum + group.count, 0);
    this.continueAttackButton.disabled =
      !resultShown || conquering || totalUnits < 1 || payload.currentTargetId === null;
  }

  /** Campaign ladder: ✓ cleared · ▶ current · ○ locked, in progression order. */
  private renderProgression(targets: CombatTargetView[]): void {
    const list = this.progressionListEl!;
    const fragment = document.createDocumentFragment();
    for (const target of targets) {
      const li = document.createElement('li');
      li.className = `progression-row is-${target.status}`;
      const icon = document.createElement('span');
      icon.className = 'progression-icon';
      icon.textContent =
        target.status === 'cleared' ? '✓' : target.status === 'current' ? '▶' : '○';
      icon.setAttribute(
        'aria-label',
        target.status === 'cleared'
          ? 'cleared'
          : target.status === 'current'
            ? 'current target'
            : 'locked',
      );
      const nameEl = document.createElement('span');
      nameEl.className = 'progression-name';
      nameEl.textContent = target.name;
      const powerEl = document.createElement('span');
      powerEl.className = 'progression-power';
      powerEl.textContent = formatNumber(target.enemyPower);
      li.append(icon, nameEl, powerEl);
      fragment.appendChild(li);
    }
    list.replaceChildren(fragment);
  }

  private renderCurrentTarget(payload: CombatChangedPayload): void {
    const { targets, currentTargetId, clearedCount } = payload;
    const totalTargets = targets.length;

    // Remember which target ATTACK will act on; the click handler reads this.
    // (The rework rendered this value locally without ever storing it, so
    // every attack fired with a null id and silently started nothing.)
    this.currentTargetId = currentTargetId;
    this.progressLabel.textContent = `Campaign ${clearedCount} / ${totalTargets} cleared`;

    // Final-Age completion and the mid-game conquered lull are distinct
    // states: only conquering the LAST Age completes the whole campaign.
    const isComplete = payload.conqueredAges >= payload.totalAges;
    const isConquered = payload.eraConquered === true && !isComplete;
    this.campaignComplete = isComplete;

    // Completion footer under the progression ladder (left panel).
    if (this.progressionCompleteLineEl !== null) {
      this.progressionCompleteLineEl.hidden = !isComplete;
    }

    if (isComplete) {
      // Campaign done: surface the state through the outer label and swap the
      // target card for the completion panel. Never rewrite the card's DOM —
      // wiping its children used to nullify the element lookups below and
      // crash the event cascade on any mid-session prestige.
      this.progressLabel.textContent = 'Campaign complete — all Ages conquered';
      this.currentTargetEl.hidden = true;
      this.currentTargetEnemyPower = 0;
      this.attackButton.disabled = true;

      if (this.completeBoxEl !== null) {
        this.completeBoxEl.hidden = false;
        const finalTarget = targets[totalTargets - 1];
        if (this.finalTargetNameEl !== null && finalTarget !== undefined) {
          this.finalTargetNameEl.textContent = finalTarget.name;
        }
      }
      return;
    }

    if (this.completeBoxEl !== null) this.completeBoxEl.hidden = true;

    if (isConquered) {
      // Age conquered, next Age awaits: no target exists to deploy against
      // until the player takes the advance action.
      this.progressLabel.textContent = `${payload.eraName} conquered — ${clearedCount} / ${totalTargets} cleared`;
      this.currentTargetEl.hidden = true;
      this.currentTargetEnemyPower = 0;
      this.attackButton.disabled = true;
      return;
    }

    if (!currentTargetId) {
      this.currentTargetEl!.hidden = true;
      this.currentTargetEnemyPower = 0;
      return;
    }

    // Find the current target
    const target = targets.find((t) => t.id === currentTargetId);
    if (!target) {
      this.currentTargetEl!.hidden = true;
      this.currentTargetEnemyPower = 0;
      return;
    }

    this.currentTargetEl!.hidden = false;
    this.currentTargetEnemyPower = target.enemyPower;

    // Name with ▶ if current
    const nameEl = this.currentTargetEl!.querySelector('[data-combat="target-name"]')!;
    nameEl.textContent = target.status === 'current' ? `▶ ${target.name}` : target.name;
    nameEl.classList.toggle('is-current', target.status === 'current');

    // Enemy power
    const powerEl = this.currentTargetEl!.querySelector('[data-combat="enemy-power"]')!;
    powerEl.textContent = `Enemy Power ${formatNumber(target.enemyPower)}`;

    // Terrain
    const terrainVal = target.terrain ?? 'settlement';
    const terrainEl = this.currentTargetEl!.querySelector('[data-combat="terrain"]')!;
    terrainEl.textContent = `Terrain: ${terrainVal}`;

    // Loot
    const lootEl = this.currentTargetEl!.querySelector('[data-combat="loot"]')!;
    lootEl.textContent = `Loot: 🦴 ${formatNumber(target.loot.bone)} · 🍖 ${formatNumber(target.loot.flesh)} · ⚙️ ${formatNumber(target.loot.iron)}`;

    // Standing garrison preview (Heroes roll per battle and are never listed)
    this.renderEnemyArmy(target);

    // Flavor text
    const descEl = this.currentTargetEl!.querySelector<HTMLElement>(
      '[data-combat="description"]',
    )!;
    const flavorVal = target.flavorText ?? '';
    descEl.textContent = flavorVal;
    descEl.hidden = flavorVal === '';

    // Show controls (attack button, deployment) unless campaign complete
    this.controlsEl.hidden = false;
    this.attackButton.disabled = false;
  }

  private renderEnemyArmy(target: CombatTargetView): void {
    const list = this.enemyArmyEl;
    if (target.army.length === 0) {
      list.replaceChildren();
      list.hidden = true;
      return;
    }
    list.hidden = false;
    const fragment = document.createDocumentFragment();
    for (const entry of target.army) {
      const item = document.createElement('li');
      item.className = 'target-army-item';
      item.textContent = `${formatNumber(entry.count)} ${entry.name}`;
      fragment.appendChild(item);
    }
    list.replaceChildren(fragment);
  }

  private renderIdle(payload: CombatChangedPayload): void {
    if (this.campaignComplete || this.eraConquered) {
      this.idleControlsEl.hidden = true;
      return;
    }

    const target = payload.currentTargetId
      ? payload.targets.find((t) => t.id === payload.currentTargetId)
      : undefined;

    if (!target) {
      this.idleTargetNameEl.textContent = '';
      this.idleTargetPowerEl.textContent = '';
      this.idleTargetTerrainEl.textContent = '';
      this.idleTargetLootEl.textContent = '';
      this.idleEnemyArmyEl.replaceChildren();
      this.idleEnemyArmyEl.hidden = true;
      this.idleDescriptionEl.hidden = true;
      this.idleControlsEl.hidden = true;
      return;
    }

    this.idleTargetNameEl.textContent =
      target.status === 'current' ? `▶ ${target.name}` : target.name;
    this.idleTargetPowerEl.textContent = `Enemy Power ${formatNumber(target.enemyPower)}`;
    this.idleTargetTerrainEl.textContent = `Terrain: ${target.terrain ?? 'settlement'}`;
    this.idleTargetLootEl.textContent = `Loot: 🦴 ${formatNumber(target.loot.bone)} · 🍖 ${formatNumber(target.loot.flesh)} · ⚙️ ${formatNumber(target.loot.iron)}`;

    if (target.army.length === 0) {
      this.idleEnemyArmyEl.replaceChildren();
      this.idleEnemyArmyEl.hidden = true;
    } else {
      this.idleEnemyArmyEl.hidden = false;
      const fragment = document.createDocumentFragment();
      for (const entry of target.army) {
        const item = document.createElement('li');
        item.className = 'target-army-item';
        item.textContent = `${formatNumber(entry.count)} ${entry.name}`;
        fragment.appendChild(item);
      }
      this.idleEnemyArmyEl.replaceChildren(fragment);
    }

    const flavorVal = target.flavorText ?? '';
    this.idleDescriptionEl.textContent = flavorVal;
    this.idleDescriptionEl.hidden = flavorVal === '';

    this.idleControlsEl.hidden = false;
  }

  private renderBattle(battle: ActiveBattleView): void {
    const heroNote = battle.heroCount > 0 ? ` · Enemy Hero ×${battle.heroCount}` : '';
    this.battleStatusLabel.textContent =
      `Clash at ${battle.targetName} · Advantage: ${MOMENTUM_LABEL[battle.momentum] ?? battle.momentum}` +
      ` · ${battle.elapsedSeconds.toFixed(1)}s${heroNote}`;

    // Enemy-Hero presence banner above the forces list (plural-aware).
    if (battle.heroCount > 0) {
      this.heroBannerEl.hidden = false;
      this.heroBannerEl.textContent =
        battle.heroCount === 1
          ? '⚠ ENEMY HERO IS PRESENT'
          : `⚠ ENEMY HEROES ARE PRESENT ×${battle.heroCount}`;
    } else {
      this.heroBannerEl.hidden = true;
      this.heroBannerEl.textContent = '';
    }

    this.battleAttackerBarFill.style.width = `${barPercent(
      battle.attackerPower,
      battle.initialAttackerPower,
    )}%`;
    this.battleDefenderBarFill.style.width = `${barPercent(
      battle.defenderPower,
      battle.initialDefenderPower,
    )}%`;
    this.battleAttackerPowerLabel.textContent = formatNumber(Math.round(battle.attackerPower));
    this.battleDefenderPowerLabel.textContent = formatNumber(Math.round(battle.defenderPower));

    this.battleForcesLabel.hidden = false;
    this.battleForcesLabel.textContent =
      `Yours: ${describeForces(battle.attackerForces)} · ` +
      `Enemy: ${describeForces(battle.defenderForces)}`;

    this.renderLog(battle.events);
  }

  private renderLog(events: ActiveBattleView['events']): void {
    // Smart autoscroll: follow the newest entry ONLY while the reader is
    // already at (or near) the bottom — scrolling up to reread must stick.
    const nearBottom =
      this.battleLogEl.scrollHeight - this.battleLogEl.scrollTop - this.battleLogEl.clientHeight <
      24;

    if (this.lastRenderedEventId > 0 && events.length > 0 && events[0].id === 1) {
      this.lastRenderedEventId = 0;
      this.battleLogEl.replaceChildren();
    }

    for (const event of events) {
      if (event.id <= this.lastRenderedEventId) continue;
      this.lastRenderedEventId = event.id;
      const item = document.createElement('li');
      // Tiered abilities append their rarity class for distinct styling.
      const tierClass = tierMeta(event.tier).cssClass;
      item.className =
        tierClass === 'is-tier-basic'
          ? `battle-log-item is-${event.kind}`
          : `battle-log-item is-${event.kind} ${tierClass}`;
      item.textContent = event.message;
      this.battleLogEl.appendChild(item);
    }
    while (this.battleLogEl.childElementCount > events.length) {
      this.battleLogEl.removeChild(this.battleLogEl.firstElementChild!);
    }
    if (nearBottom) this.battleLogEl.scrollTop = this.battleLogEl.scrollHeight;
  }

  private syncControls(): void {
    if (this.campaignComplete || this.eraConquered) {
      // No target exists to deploy against; keep the panel inert.
      this.attackButton.disabled = true;
      this.idleAttackButton.disabled = true;
      return;
    }

    const totalUnits = this.lastArmy.reduce((sum, group) => sum + group.count, 0);
    const deployedCount = Math.floor(totalUnits * this.selectedPercent);

    for (let index = 0; index < this.deployButtons.length; index += 1) {
      this.deployButtons[index].classList.toggle(
        'is-active',
        DEPLOY_PERCENTS[index] === this.selectedPercent,
      );
    }
    for (let index = 0; index < this.idleDeployButtons.length; index += 1) {
      this.idleDeployButtons[index].classList.toggle(
        'is-active',
        DEPLOY_PERCENTS[index] === this.selectedPercent,
      );
    }

    const deployedGroups = takeFromArmy(this.lastArmy, deployedCount);
    const deployedPower = armyPower(deployedGroups);

    const outgunned =
      deployedCount > 0 &&
      this.currentTargetEnemyPower > 0 &&
      deployedPower < this.currentTargetEnemyPower;

    const previewText =
      `Deploying ${formatNumber(deployedCount)} / ${formatNumber(totalUnits)} troops · ` +
      `${formatNumber(deployedPower)} power` +
      (outgunned ? ' · ⚠ enemy is stronger' : '');

    this.deployPreviewLabel.classList.toggle('is-risky', outgunned);
    this.deployPreviewLabel.textContent = previewText;
    this.idleDeployPreviewEl.classList.toggle('is-risky', outgunned);
    this.idleDeployPreviewEl.textContent = previewText;

    this.attackButton.disabled = deployedCount < 1;
    this.idleAttackButton.disabled = deployedCount < 1;
  }

private renderResult(result: BattleResult): void {
    const victory = result.outcome === 'victory';
    this.outcomeLabel.textContent = victory ? 'VICTORY' : 'DEFEAT';
    this.outcomeLabel.classList.toggle('is-victory', victory);
    this.outcomeLabel.classList.toggle('is-defeat', !victory);

    this.survivorsLabel.textContent = describeGroups('Survivors', result.survivingArmy);
    this.casualtiesLabel.textContent = describeGroups('Casualties', result.casualties);
    this.enemyCasualtiesLabel.textContent = `Enemy casualties: ${formatNumber(
      result.defenderCasualties,
    )}`;

    const loot = result.lootGained;
    const lootParts: string[] = [];
    if (loot !== null && this.buildings !== null) {
      for (const [resourceId, amount] of Object.entries(loot)) {
        let gained = amount ?? 0;
        if (resourceId === 'bone' && this.buildings.isBuilt('bone-sorting-house')) {
          gained *= 2;
        }
        if (gained > 0) lootParts.push(`+${formatNumber(gained)} ${resourceId}`);
      }
    } else if (loot !== null) {
      if (loot.bone > 0) lootParts.push(`+${formatNumber(loot.bone)} Bone`);
      if (loot.flesh > 0) lootParts.push(`+${formatNumber(loot.flesh)} Flesh`);
      if (loot.iron > 0) lootParts.push(`+${formatNumber(loot.iron)} Iron`);
    }
    this.lootLine.hidden = lootParts.length === 0;
    this.lootLine.textContent =
      lootParts.length === 0 ? '' : `Loot gained: ${lootParts.join(' · ')}`;

    // Hero fate lines, e.g. "Enemy Hero Ser Aldric was slain" / "escaped"
    if (result.heroOutcome.length === 0) {
      this.heroLine.hidden = true;
      this.heroLine.textContent = '';
    } else {
      const parts = result.heroOutcome.map((hero) =>
        hero.fled === true
          ? `${hero.name} fled the field — they live to hunt you again.`
          : hero.killed
            ? `${hero.name} was slain`
            : `${hero.name} escaped`,
      );
      this.heroLine.hidden = false;
      this.heroLine.textContent = `Hero: ${parts.join(' · ')}`;
    }

    // Defeat attribution: name the Hero that wiped the legion, when one did.
    const wipeNames = victory ? [] : (result.wipedByHeroes ?? []);
    this.defeatCauseLabel.hidden = wipeNames.length === 0;
    this.defeatCauseLabel.textContent =
      wipeNames.length > 0 ? formatWipePhrase(wipeNames) : '';
  }
}

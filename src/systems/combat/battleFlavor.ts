import type { TerrainType } from './terrain';

/**
 * Battle-log flavor pools for the combat phase.
 *
 * Templates carry {target} / {hero} / {unit} tokens substituted via
 * formatFlavor. Kept separate from the engine so prose can be tuned without
 * touching combat math; every pool is consumed through pickLine(rng).
 */

/** Picks one entry from a flavor pool using an injected rng. */
export function pickLine(pool: readonly string[], rng: () => number): string {
  return pool[Math.floor(rng() * pool.length)]!;
}

/** Substitutes {token} placeholders with the provided values. */
export function formatFlavor(template: string, vars: Record<string, string>): string {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    out = out.split(`{${key}}`).join(value);
  }
  return out;
}

/**
 * Exact comma-grouped number for ability casualty reports. Deliberately NOT
 * ui/format's abbreviated style: dramatic beats must state the true body
 * count ("487,231 WRAITHS DESTROYED."), never "487.23K".
 */
export function formatExact(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return Math.round(value).toLocaleString('en-US');
}

/**
 * Defeat attribution phrase, natural-language with plural join:
 * "Aldric has wiped your forces." / "Aldric and Bertrand have wiped your
 * forces." Empty input yields an empty string (caller hides the line).
 */
export function formatWipePhrase(names: readonly string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return `${names[0]} has wiped your forces.`;
  const allButLast = names.slice(0, -1).join(', ');
  return `${allButLast} and ${names[names.length - 1]} have wiped your forces.`;
}

/** Opening line of a battle, per battlefield terrain. */
export const TERRAIN_OPENINGS: Record<TerrainType, readonly string[]> = {
  plains: [
    'The legion spreads across the plains of {target} like a slow tide.',
    'Open ground before {target}. Nowhere for the living to hide.',
    'Wind flattens the grass of {target} under marching bone.',
    'The plains of {target} have seen harvests before. None like this.',
  ],
  forest: [
    'Shadows swallow your ranks as the legion enters the woods of {target}.',
    'The trees of {target} will remember what happens here.',
    'Birdsong dies ahead of you — the woods of {target} already know.',
    'Roots trip the living as your legion threads the forest of {target}.',
  ],
  hills: [
    'The defenders hold the high ground above {target}. Your legion climbs anyway.',
    'The hills of {target} offer the living no shelter and your dead no obstacle.',
    'Sheep scatter down the slopes of {target}. Something worse is coming up.',
    'Every ridge above {target} costs blood. Your dead pay it gladly.',
  ],
  mountains: [
    'Thin air, thin hope — the legion ascends toward {target}.',
    'Stone and silence guard the passes below {target}. Both will break.',
    'The cold bites first at {target}. Your dead do not notice.',
    'Avalanche country. {target} watches your legion come and waits for nature to help.',
  ],
  settlement: [
    'Doors slam shut across {target} as the legion reaches the streets.',
    'The hearth-fires of {target} will warm no one by morning.',
    'Market stalls overturn as {target} empties its streets in panic.',
    'Dogs bark themselves hoarse in {target}. By dusk they will eat well.',
  ],
  'walled-settlement': [
    'Ladders rise against the walls of {target}.',
    'The walls of {target} stand between the living and the inevitable.',
    'Bells ring alarm across {target}. Your dead climb faster than the gates can close.',
    'Mortars of the masonry rain dust as the legion leans on the walls of {target}.',
  ],
  fortress: [
    'Gates of iron close before the legion at {target}. Iron rusts.',
    'The fortress of {target} was built against armies. It has never met yours.',
    'Banner towers over the walls of {target}. It will not fly by nightfall.',
    'Every siege engine the builders of {target} imagined, they imagined wrongly.',
  ],
};

/** A named Hero enters the battle (fresh face). */
export const HERO_ARRIVAL_LINES: readonly string[] = [
  '{hero} takes the field. The defenders straighten.',
  '{hero} steps forward, blade already bare.',
  'A horn sounds — {hero} enters the battle.',
  'The defenders part to let {hero} through. They have been waiting for this.',
  '{hero} arrives unhurried, as if your legion were an errand.',
  'Steel sings somewhere behind the line — {hero} has joined the fight.',
  'Your wights turn as one. {hero} is among them.',
];

/**
 * A Hero that survived your last failed assault holds the same ground
 * again — they have been waiting for you.
 */
export const RETURN_DEFENDER_LINES: readonly string[] = [
  '{hero} stands where you last broke.',
  '{hero} never left the walls. They were waiting for you.',
  'They told {hero} you would come back. {hero} believed them.',
  '{hero} waits atop the ridge, patient as stone.',
  'Same banner, same scar — {hero} has held this ground since your legion fled.',
];

/** A fled veteran returns via the grudge system. */
export const NEMESIS_RETURN_LINES: readonly string[] = [
  '{hero} returns — the grudge unbroken.',
  '{hero} comes back for what you took.',
  'They said {hero} fled. Fled soldiers return angry.',
  '{hero} strides back onto the field, old debts in hand.',
  '{hero} is back. Of course they are back.',
  'The same face, the same scar — {hero} never left your ledger.',
  '{hero} crosses the field like a promise kept too long.',
];

/** Aggregate pinned line when more Heroes arrive than we announce by name. */
export const HERO_ARRIVAL_OVERFLOW_LINES: readonly string[] = [
  '{count} more vengeful shades take the field.',
  'Behind them, {count} more grudge-bearers step into the light.',
  'And still they come — {count} more Heroes answer the horns.',
];

/** First resolve damage a Hero takes (once per Hero per battle). */
export const HERO_BLOODED_LINES: readonly string[] = [
  '{hero} is bloodied but holds.',
  'First blood drawn from {hero}; they give ground an inch.',
  'Your blades find {hero}. They smile through it.',
  'A wound opens across {hero}. They wipe their eyes and keep cutting.',
  '{hero} staggers — then sets their feet like a man planting a flag.',
  'Blood stripes {hero}\u2019s armor now. It does not slow the blade.',
  'You hurt {hero}. Their expression says you will regret the lesson.',
];

/** A Hero past half resolve fights harder (once per Hero per battle). */
export const HERO_ESCALATION_LINES: readonly string[] = [
  'Wounded, {hero} fights with desperate fury.',
  '{hero} bleeds freely — and kills faster for it.',
  'Half-broken, {hero} redoubles the slaughter.',
  'Pain only sharpens {hero}. The wounded ones are always the worst.',
  '{hero} laughs through cracked teeth and comes on harder.',
  'Something feral wakes in {hero}. Give ground.',
  'Cornered things bite deepest. {hero} proves the proverb.',
];

/** A Hero stack is destroyed mid-battle. */
export const HERO_SLAIN_LINES: readonly string[] = [
  '{hero} falls beneath a tide of bone.',
  "{hero} drops, and the defenders' courage drops with them.",
  'The line parts around {hero}\u2019s body. No one claims the kill.',
  '{hero} dies as legends do: badly, and in the mud.',
  '{hero} takes three of yours on the way down. Worth every one.',
  'They will sing about {hero}. Briefly, and off-key.',
  '{hero} kneels, topples, and is gone beneath the trampling host.',
  'Even your wights pause. Then the tide closes over {hero}.',
];

/** A Hero flees mid-battle and joins the grudge ledger. */
export const HERO_RETREAT_LINES: readonly string[] = [
  '{hero} sounds the retreat and flees the field!',
  '{hero} breaks away, vanishing into the dust.',
  '{hero} abandons the wall — the grudge survives them.',
  'Spurring hard, {hero} escapes the closing trap!',
  '{hero} cuts free of the melee and does not look back.',
  'Live today, return tomorrow — {hero} rides for the hills.',
  'Your claws close on cloak, not flesh. {hero} is gone.',
];

/** Only Heroes remain standing on the defense. */
export const HERO_LAST_STAND_LINES: readonly string[] = [
  '{hero} stands alone against your legion.',
  'Only {hero} remains — and they refuse to kneel.',
  'The ranks are gone. {hero} plants their banner alone amid the dead.',
  'Every shield around {hero} has fallen. They do not step back.',
  '{hero} surveys the ruin of their army and bares steel at all of you.',
  'No soldiers left around {hero}. Just legend, standing in the open.',
];

/**
 * A Hero breaks through to join the last stand (rolled once when only
 * Heroes remain). Rendered as a pinned gold arrival like any other Hero.
 */
export const HERO_REINFORCEMENT_LINES: readonly string[] = [
  'A horn beyond the walls — {hero} crashes into your flank to join the last stand!',
  '{hero} arrives at the double, answering the last stand with steel.',
  'Through the press of your legion, {hero} reaches the survivors. The last stand grows.',
  'Reinforcement! {hero} wades into your ranks to stand beside their own.',
  '{hero} was not on the field when this began. They are on it now.',
  'Late to the battle, early to the grave — {hero} joins the last stand.',
];

/** The first defender casualties of the battle. */
export const FIRST_BLOOD_LINES: readonly string[] = [
  'First blood colors the mud outside {target}.',
  "The first of {target}'s defenders fall. Many follow.",
  'Contact. The harvest of {target} begins.',
  'Your front rank closes. {target} bleeds first.',
  'The shields of the living meet the claws of the dead outside {target}.',
];

/** Zombie Plague: the first mid-battle rising of converted enemies. */
export const ZOMBIE_PLAGUE_LINES: readonly string[] = [
  'The slain stagger back up — fighting for their killers.',
  'Fresh corpses twitch, then rise to fill the horde.',
  "The enemy's fallen march again, on the wrong side.",
];

/** Zombie Plague: recurring replenishment beats as more corpses convert. */
export const ZOMBIE_PLAGUE_RAISE_LINES: readonly string[] = [
  'Your necromancers stitch fresh soldiers from the enemy dead.',
  'Another rank rises — their army now fights itself.',
  'Corpses are currency, and this battlefield is rich.',
  'The fallen trade their banners for your cause.',
  'Every kill is a recruitment. The legion does not mourn.',
];

/** Zombie Plague: the garrison-conversion CAP has been reached. */
export const ZOMBIE_PLAGUE_CAP_LINES: readonly string[] = [
  'A quarter of their army now serves you. The living hold nothing.',
  'The harvest is complete — no corpse left unclaimed on this field.',
  'Their dead are spent. The plague has taken its full tithe.',
  'One soldier in four answers to you now. The rest should despair.',
];

/** A unit group takes its first losses of the battle ({unit} token). */
export const RANK_LOSS_LINES: readonly string[] = [
  '{unit} ranks take losses.',
  'Gaps open in the {unit} formation.',
  '{unit} loses files of soldiers to the dark.',
  'Your dead chew into the {unit} line.',
  '{unit} steadies — barely — as their numbers thin.',
];

/** A unit group is destroyed entirely ({unit} token). */
export const RANK_WIPE_LINES: readonly string[] = [
  '{unit} ranks are wiped out.',
  'Nothing of {unit} remains upright.',
  'The last of {unit} goes down trampling.',
  '{unit} is unmade where they stood.',
  'Silence where {unit} used to be.',
];

/** Defender strength falling below half. */
export const RESISTANCE_WEAKENED_LINES: readonly string[] = [
  'Enemy resistance weakens.',
  'The defense thins; your advance quickens.',
  'Fewer shields answer the horns of {target} each minute.',
  'Their line sags like wet cloth.',
];

/** Defender strength falling below a quarter. */
export const DEFENSE_COLLAPSING_LINES: readonly string[] = [
  'The enemy line is collapsing.',
  'What is left of the defense bunches against its own walls.',
  'They are dying faster than they can run now.',
  'Breaks yawn along the enemy front. Your legion pours through.',
];

/** Attacker strength falling below a quarter. */
export const LEGION_WAVERING_LINES: readonly string[] = [
  'Your legion wavers on the brink.',
  'The tide of bone thins. Your dead feel it too.',
  'So few of yours remain that the drums forget their rhythm.',
  'Your legion holds by hatred alone.',
];

/** Momentum swing lines, keyed by who holds the advantage. */
export const MOMENTUM_LINES: Record<'attacker' | 'defender' | 'even', readonly string[]> = {
  attacker: [
    'Your legion seizes the advantage.',
    'The defenders bend; your dead press harder.',
    'Ground gives way to your advance tick by tick.',
    'Horns falter along the enemy line. Yours do not.',
    'The push becomes a shove, and the shove begins to roll.',
  ],
  defender: [
    'The defense gains the upper hand.',
    'The walls answer; your ranks falter.',
    'Cheering rises from their lines. It will not last.',
    'They hold, and holding, they begin to push back.',
    'Your advance stalls against gritted, living teeth.',
  ],
  even: [
    'Neither side yields.',
    'The lines lock, grinding bone against steel.',
    'Two stubbornnesses meet. Neither blinks.',
    'The field drinks from both armies evenly.',
    'Advance and counter-advance cancel into slaughter.',
  ],
};

/** Tank Death Burst: the Tank's final act claims a share of the attackers. */
export const TANK_DEATH_BURST_LINES: readonly string[] = [
  '{hero} collapses — and the earth erupts beneath your ranks.',
  '{hero} falls, but the shockwave catches your front line mid-charge.',
  'As {hero} drops, the ground splits open under your soldiers.',
  '{hero} dies standing. The blast that follows does not care.',
  'Your blade finds {hero}. The explosion finds you right back.',
  '{hero} kneels, drives a fist into the earth, and takes a fifth of your army with them.',
  'The last thing {hero} does is smile — then the world turns white.',
  '{hero} shatters. The concussive wave rolls through your ranks like thunder.',
];

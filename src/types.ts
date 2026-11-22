export type Role = "Tank" | "Fighter" | "Assassin" | "Mage" | "Marksman" | "Support";
export type Lane = "exp" | "gold" | "mid" | "roam" | "jungle";
export type DamageType = "physical" | "magic" | "mixed";

export const LANES: readonly Lane[] = ["gold", "exp", "mid", "jungle", "roam"];
export const LANE_LABEL: Record<Lane, string> = {
  gold: "Gold lane",
  exp: "EXP lane",
  mid: "Mid lane",
  jungle: "Jungle",
  roam: "Roam",
};

/** Normalised 0..1 scores describing what a hero brings to a fight. */
export interface HeroTraits {
  /** Self-heal, lifesteal or ally healing — what anti-heal items shut down. */
  sustain: number;
  shields: number;
  burst: number;
  /** Reliance on basic attacks / attack speed. */
  basicAttacker: number;
  crit: boolean;
  /** Hard crowd control (stun, knock-up, suppress…). */
  cc: number;
  mobility: number;
  tanky: number;
  trueDamage: boolean;
  /** Deals damage scaling with the target's HP (shreds tanks). */
  maxHpDamage: boolean;
  conceal: boolean;
  poke: boolean;
}

export interface HeroRelation {
  ids: number[];
  desc: string;
}

export interface Hero {
  id: number;
  name: string;
  roles: Role[];
  lanes: Lane[];
  specialities: string[];
  icon: string;
  ability: { durability: number; offense: number; effects: number; difficulty: number };
  meta: { win: number; pick: number; ban: number };
  damage: DamageType;
  traits: HeroTraits;
  archetype: Archetype;
  relation: { strong?: HeroRelation; weak?: HeroRelation; assist?: HeroRelation };
}

export type Archetype =
  | "mm_crit"
  | "mm_onhit"
  | "mm_burst"
  | "mm_magic"
  | "mage"
  | "mage_tank"
  | "assassin_phys"
  | "assassin_magic"
  | "fighter_phys"
  | "fighter_magic"
  | "tank"
  | "support_heal"
  | "support";

export type ItemTag =
  | "antiheal"
  | "physDef"
  | "magicDef"
  | "antiBurst"
  | "antiBasic"
  | "antiCrit"
  | "revive"
  | "physPen"
  | "magicPen"
  | "tankShred"
  | "sustain"
  | "crit"
  | "atkSpeed"
  | "damage"
  | "cdr"
  | "slow"
  | "boots"
  | "ccReduce"
  | "teamUtility";

export interface ItemComponent {
  name: string;
  cost: number;
  /** Set when the piece already carries part of the finished item's effect. */
  effect?: string;
}

export interface Item {
  id: string;
  name: string;
  cost: number;
  category: "attack" | "magic" | "defense" | "boots";
  tags: ItemTag[];
  /** One spoken-length sentence on what it does. */
  blurb: string;
  /** The cheap piece worth buying first when you can't afford the full item. */
  component?: ItemComponent;
  aliases?: string[];
}

/** One enemy or ally as currently understood, optionally with live scoreboard stats. */
export interface PlayerState {
  heroId: number;
  kills?: number;
  deaths?: number;
  assists?: number;
  gold?: number;
  level?: number;
  /** Item ids from the catalog (unknown items are dropped). */
  items?: string[];
}

export interface ThreatSource {
  heroId: number;
  /** Relative share of the enemy team's kill pressure (sums to 1). */
  weight: number;
  fed: boolean;
}

export interface ThreatProfile {
  /** Share of enemy damage that is physical / magic, weighted by who is ahead. */
  physShare: number;
  magicShare: number;
  sustain: number;
  shields: number;
  burst: number;
  basicAttack: number;
  crit: number;
  cc: number;
  tankiness: number;
  trueDamage: number;
  /** Enemies sorted by how dangerous they currently are. */
  sources: ThreatSource[];
  /** Enemy heroes contributing most to each axis, for explanations. */
  who: Partial<Record<"sustain" | "burst" | "basicAttack" | "cc" | "tankiness" | "magic" | "physical" | "crit", number[]>>;
  /** True once live scoreboard stats were factored in. */
  live: boolean;
}

export interface BuildSlot {
  item: Item;
  /** Why this item is in the build — spoken with the recommendation. */
  reason: string;
  kind: "boots" | "core" | "situational" | "damage";
  owned: boolean;
  /** A counter that matters right now (fed enemy, heavy healing) rather than a nice-to-have. */
  urgent?: boolean;
}

export interface NextStep {
  action: "buy" | "buy-component" | "save" | "sell-swap" | "done";
  item?: Item;
  component?: ItemComponent;
  sell?: Item;
  goldNeeded?: number;
  /** Short line for text-to-speech. */
  say: string;
  /** Longer explanation for the screen. */
  detail: string;
}

export interface BuildPlan {
  slots: BuildSlot[];
  next: NextStep;
  spell: { name: string; reason: string };
  emblem: { name: string; talents: string[]; reason: string };
  /** Lane-specific note about the boots blessing (jungle / roam). */
  bootsNote?: string;
}

export interface CounterPick {
  hero: Hero;
  score: number;
  reasons: string[];
}

export type ScreenKind = "draft" | "loading" | "scoreboard" | "shop" | "gameplay" | "post_game" | "other";

/** Normalised result of one screenshot analysis. */
export interface Observation {
  screen: ScreenKind;
  gameTimeSec?: number;
  myGold?: number;
  allies: PlayerState[];
  enemies: PlayerState[];
  /** Hero the model believes is the user (highlighted row). */
  meHeroId?: number;
  tip?: string;
  /** Names the model returned that matched nothing we know. */
  unknown: string[];
}

export interface Advice {
  /** Stable key used to avoid repeating the same line. */
  key: string;
  say: string;
  detail?: string;
  kind: "buy" | "threat" | "setup" | "timer" | "tip" | "info";
  priority: 0 | 1 | 2;
}

import type { Item, ItemComponent } from "../types";
import { editDistance, normalizeName } from "./heroes";

/**
 * Curated equipment catalog — the items the coach can recommend.
 *
 * Unlike hero data (synced from Moonton's API), this is hand-maintained: costs
 * and names move with balance patches, so check it against the in-game shop
 * after a big update. Costs are only used for "can you afford it yet" advice,
 * so being a few gold off does not change what gets recommended.
 */
const c = (name: string, cost: number): ItemComponent => ({ name, cost });

export const ITEMS: Item[] = [
  // ── Boots ────────────────────────────────────────────────────────────────
  { id: "warrior_boots", name: "Warrior Boots", cost: 690, category: "boots", tags: ["boots", "physDef"], blurb: "Physical defense that grows as you take basic attacks." },
  { id: "tough_boots", name: "Tough Boots", cost: 700, category: "boots", tags: ["boots", "magicDef", "ccReduce"], blurb: "Magic defense and shorter crowd control." },
  { id: "swift_boots", name: "Swift Boots", cost: 710, category: "boots", tags: ["boots", "atkSpeed"], blurb: "Attack speed for basic-attack heroes." },
  { id: "arcane_boots", name: "Arcane Boots", cost: 690, category: "boots", tags: ["boots", "magicPen"], blurb: "Magic penetration for early damage." },
  { id: "magic_shoes", name: "Magic Shoes", cost: 710, category: "boots", tags: ["boots", "cdr"], blurb: "Cooldown reduction." },
  { id: "rapid_boots", name: "Rapid Boots", cost: 750, category: "boots", tags: ["boots"], blurb: "The most movement speed, for rotating." },
  { id: "demon_shoes", name: "Demon Shoes", cost: 720, category: "boots", tags: ["boots"], blurb: "Mana regeneration." },

  // ── Attack ───────────────────────────────────────────────────────────────
  { id: "blade_of_despair", name: "Blade of Despair", cost: 3010, category: "attack", tags: ["damage"], blurb: "The biggest raw physical attack; extra damage to low-health targets.", component: c("Legion Sword", 910) },
  { id: "berserkers_fury", name: "Berserker's Fury", cost: 2390, category: "attack", tags: ["damage", "crit"], blurb: "Crit chance and crit damage.", aliases: ["Berserker Fury"] },
  { id: "windtalker", name: "Windtalker", cost: 1820, category: "attack", tags: ["atkSpeed", "crit"], blurb: "Attack speed, movement speed and chain lightning for wave clear." },
  { id: "haas_claws", name: "Haas's Claws", cost: 1810, category: "attack", tags: ["damage", "sustain"], blurb: "Lifesteal for sustained fights.", component: c("Vampire Mallet", 480), aliases: ["Haas Claws", "Haa's Claws"] },
  { id: "demon_hunter_sword", name: "Demon Hunter Sword", cost: 2180, category: "attack", tags: ["atkSpeed", "tankShred", "sustain"], blurb: "Basic attacks deal bonus damage based on the target's current HP — melts tanks." },
  { id: "golden_staff", name: "Golden Staff", cost: 2000, category: "attack", tags: ["atkSpeed"], blurb: "Turns crit into attack speed and makes on-hit effects trigger more often." },
  { id: "corrosion_scythe", name: "Corrosion Scythe", cost: 2050, category: "attack", tags: ["atkSpeed", "slow"], blurb: "Attack speed plus a slow on every hit." },
  { id: "malefic_roar", name: "Malefic Roar", cost: 2060, category: "attack", tags: ["physPen"], blurb: "Percent physical penetration — more value the more armor they build.", component: c("Fury Hammer", 830) },
  { id: "malefic_gun", name: "Malefic Gun", cost: 2060, category: "attack", tags: ["physPen"], blurb: "Marksman penetration item with extra range.", component: c("Fury Hammer", 830) },
  { id: "hunter_strike", name: "Hunter Strike", cost: 2010, category: "attack", tags: ["damage", "cdr", "physPen"], blurb: "Attack, cooldown reduction and flat penetration — the standard burst opener." },
  { id: "blade_of_the_heptaseas", name: "Blade of the Heptaseas", cost: 1950, category: "attack", tags: ["damage", "physPen"], blurb: "Early penetration and a bonus hit when you open from out of combat.", aliases: ["Blade of Heptaseas", "Heptaseas"] },
  { id: "war_axe", name: "War Axe", cost: 2100, category: "attack", tags: ["damage", "sustain", "cdr"], blurb: "Stacks attack and spell vamp the longer you fight." },
  { id: "bloodlust_axe", name: "Bloodlust Axe", cost: 1970, category: "attack", tags: ["damage", "sustain", "cdr"], blurb: "Spell vamp for skill-based fighters." },
  { id: "endless_battle", name: "Endless Battle", cost: 2330, category: "attack", tags: ["damage", "sustain", "cdr"], blurb: "True damage on the basic attack after each skill." },
  { id: "great_dragon_spear", name: "Great Dragon Spear", cost: 2140, category: "attack", tags: ["damage", "cdr", "crit"], blurb: "Burst of speed and damage after casting your ultimate." },
  { id: "sky_piercer", name: "Sky Piercer", cost: 1500, category: "attack", tags: ["damage"], blurb: "Executes low-health enemies; grows with kills, shrinks when you die." },
  { id: "sea_halberd", name: "Sea Halberd", cost: 2050, category: "attack", tags: ["antiheal", "damage", "atkSpeed"], blurb: "Your damage cuts the target's healing and shields.", component: c("Ogre Tomahawk", 830) },
  { id: "rose_gold_meteor", name: "Rose Gold Meteor", cost: 2120, category: "attack", tags: ["damage", "magicDef", "antiBurst"], blurb: "Attack plus magic defense, and a shield when you drop low.", component: c("Magic Resist Cloak", 220) },
  { id: "wind_of_nature", name: "Wind of Nature", cost: 1910, category: "attack", tags: ["antiBurst", "atkSpeed", "sustain"], blurb: "Active: ignore all physical damage for two seconds.", component: c("Vampire Mallet", 480) },

  // ── Magic ────────────────────────────────────────────────────────────────
  { id: "clock_of_destiny", name: "Clock of Destiny", cost: 1950, category: "magic", tags: ["damage"], blurb: "Stacks HP and magic power over time — buy it first." },
  { id: "lightning_truncheon", name: "Lightning Truncheon", cost: 2250, category: "magic", tags: ["damage", "cdr"], blurb: "Bonus burst that scales with your mana." },
  { id: "genius_wand", name: "Genius Wand", cost: 2000, category: "magic", tags: ["damage", "magicPen"], blurb: "Magic penetration that stacks as you hit." },
  { id: "holy_crystal", name: "Holy Crystal", cost: 3000, category: "magic", tags: ["damage"], blurb: "The biggest raw magic power." },
  { id: "blood_wings", name: "Blood Wings", cost: 3000, category: "magic", tags: ["damage"], blurb: "Huge magic power plus a shield." },
  { id: "divine_glaive", name: "Divine Glaive", cost: 1970, category: "magic", tags: ["magicPen"], blurb: "Percent magic penetration — buy when they stack magic defense." },
  { id: "glowing_wand", name: "Glowing Wand", cost: 2120, category: "magic", tags: ["damage", "tankShred"], blurb: "Burn based on the target's max HP — for tanky lineups." },
  { id: "ice_queen_wand", name: "Ice Queen Wand", cost: 2240, category: "magic", tags: ["damage", "slow", "sustain"], blurb: "Skills slow; adds spell vamp." },
  { id: "concentrated_energy", name: "Concentrated Energy", cost: 2020, category: "magic", tags: ["damage", "sustain"], blurb: "Spell vamp for sustained magic fighters." },
  { id: "feather_of_heaven", name: "Feather of Heaven", cost: 2030, category: "magic", tags: ["damage", "atkSpeed"], blurb: "Attack speed and bonus magic damage on basic attacks." },
  { id: "starlium_scythe", name: "Starlium Scythe", cost: 2220, category: "magic", tags: ["damage", "cdr"], blurb: "Empowered true-damage basic attack after a skill." },
  { id: "wishing_lantern", name: "Wishing Lantern", cost: 2250, category: "magic", tags: ["damage", "tankShred"], blurb: "Bonus damage based on the target's HP after dealing enough damage." },
  { id: "enchanted_talisman", name: "Enchanted Talisman", cost: 1870, category: "magic", tags: ["cdr", "teamUtility"], blurb: "Mana regeneration and cooldown reduction." },
  { id: "fleeting_time", name: "Fleeting Time", cost: 2050, category: "magic", tags: ["cdr"], blurb: "Kills and assists cut your ultimate's cooldown." },
  { id: "flask_of_the_oasis", name: "Flask of the Oasis", cost: 1850, category: "magic", tags: ["teamUtility", "cdr"], blurb: "Stronger heals and shields for your team." },
  { id: "winter_crown", name: "Winter Crown", cost: 1910, category: "magic", tags: ["antiBurst"], blurb: "Active: freeze yourself, immune to everything for two seconds.", aliases: ["Winter Truncheon"] },

  // ── Defense ──────────────────────────────────────────────────────────────
  { id: "dominance_ice", name: "Dominance Ice", cost: 2010, category: "defense", tags: ["physDef", "antiheal", "antiBasic", "cdr"], blurb: "Physical defense that slows nearby enemies' attack speed and cuts their healing and shields.", component: c("Black Ice Shield", 770) },
  { id: "antique_cuirass", name: "Antique Cuirass", cost: 2170, category: "defense", tags: ["physDef"], blurb: "Each skill that hits you lowers the attacker's physical attack.", component: c("Dreadnaught Armor", 730) },
  { id: "blade_armor", name: "Blade Armor", cost: 1910, category: "defense", tags: ["physDef", "antiBasic", "antiCrit"], blurb: "Reflects basic-attack damage and blunts crits.", component: c("Steel Legplates", 630) },
  { id: "athenas_shield", name: "Athena's Shield", cost: 2150, category: "defense", tags: ["magicDef", "antiBurst"], blurb: "Magic defense with a shield that soaks magic burst.", component: c("Silence Robe", 1020), aliases: ["Athena Shield"] },
  { id: "radiant_armor", name: "Radiant Armor", cost: 1880, category: "defense", tags: ["magicDef"], blurb: "Stacking reduction against repeated magic hits.", component: c("Magic Resist Cloak", 220) },
  { id: "oracle", name: "Oracle", cost: 1860, category: "defense", tags: ["magicDef", "cdr", "sustain"], blurb: "Boosts the healing and shields you receive." },
  { id: "immortality", name: "Immortality", cost: 2120, category: "defense", tags: ["revive", "antiBurst"], blurb: "Revives you once on a long cooldown." },
  { id: "queens_wings", name: "Queen's Wings", cost: 2250, category: "defense", tags: ["antiBurst", "sustain"], blurb: "Damage reduction and spell vamp when you drop low.", aliases: ["Queen Wings"] },
  { id: "brute_force_breastplate", name: "Brute Force Breastplate", cost: 1870, category: "defense", tags: ["physDef", "magicDef"], blurb: "Stacks defense and movement speed as you fight." },
  { id: "thunder_belt", name: "Thunder Belt", cost: 2290, category: "defense", tags: ["physDef", "magicDef", "slow", "cdr"], blurb: "True-damage slow after each skill; each proc adds permanent defense." },
  { id: "cursed_helmet", name: "Cursed Helmet", cost: 1760, category: "defense", tags: ["magicDef"], blurb: "Burns nearby enemies — clears waves for tanks.", component: c("Molten Essence", 800) },
  { id: "guardian_helmet", name: "Guardian Helmet", cost: 2200, category: "defense", tags: ["sustain"], blurb: "Massive HP and regeneration out of combat.", aliases: ["Sky Guardian Helmet"] },
  { id: "twilight_armor", name: "Twilight Armor", cost: 2260, category: "defense", tags: ["physDef", "antiBurst"], blurb: "Caps how much a single hit can take off you." },
];

const byId = new Map(ITEMS.map((i) => [i.id, i]));

export const componentId = (name: string): string => `comp:${normalizeName(name)}`;

/** Every cheap component referenced by the catalog, keyed by its "comp:" id. */
export const COMPONENTS: Map<string, ItemComponent> = new Map(
  ITEMS.filter((i) => i.component).map((i) => [componentId(i.component!.name), i.component!]),
);

/** Resolve an item or a "comp:" component id to something with a name and cost. */
export function itemById(id: string): Item | undefined {
  return byId.get(id);
}

export function ownedLabel(id: string): string {
  return byId.get(id)?.name ?? COMPONENTS.get(id)?.name ?? id;
}

const lookup = new Map<string, string>();
for (const item of ITEMS) {
  lookup.set(normalizeName(item.name), item.id);
  for (const alias of item.aliases ?? []) lookup.set(normalizeName(alias), item.id);
}
for (const [id, comp] of COMPONENTS) lookup.set(normalizeName(comp.name), id);

/**
 * Match free text (vision output) to a catalog id. Returns a finished item or a
 * pseudo-item for a component ("comp:…"). Undefined when nothing is close.
 */
export function findItem(text: string): { id: string; name: string } | undefined {
  const key = normalizeName(text);
  if (!key) return undefined;
  let id = lookup.get(key);
  if (!id) {
    let bestDist = Infinity;
    for (const [norm, candidate] of lookup) {
      const d = editDistance(key, norm);
      if (d < bestDist) {
        bestDist = d;
        id = candidate;
      }
    }
    if (bestDist > Math.floor(key.length / 6)) return undefined;
  }
  return id ? { id, name: ownedLabel(id) } : undefined;
}

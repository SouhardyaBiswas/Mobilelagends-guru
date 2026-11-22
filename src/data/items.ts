import type { Item, ItemComponent } from "../types";
import { editDistance, normalizeName } from "./heroes";

/**
 * Curated equipment catalog — the items the coach can recommend.
 *
 * Checked against patch 2.2.23 (Nov 2026). Unlike hero data (synced from
 * Moonton's API) this is hand-maintained: names and costs move with balance
 * patches, so re-check it against the in-game shop after a big update. Costs
 * only drive "can you afford it yet", so being a few gold off changes nothing.
 *
 * A component's `effect` is set only when the cheap piece already carries part
 * of the finished item's answer (Dreadnaught Armor, Fury Hammer…). That is what
 * makes buying it early a real counter rather than just progress. No component
 * carries anti-heal — that needs the finished item.
 */
const c = (name: string, cost: number, effect?: string): ItemComponent => ({ name, cost, effect });

const LEGION_SWORD = c("Legion Sword", 910);
const FURY_HAMMER = c("Fury Hammer", 830, "already gives physical penetration");
const SILENCE_ROBE = c("Silence Robe", 1020, "already gives HP and magic defense");

export const ITEMS: Item[] = [
  // ── Boots (720 each) ─────────────────────────────────────────────────────
  { id: "warrior_boots", name: "Warrior Boots", cost: 720, category: "boots", tags: ["boots", "physDef"], blurb: "Physical defense." },
  { id: "tough_boots", name: "Tough Boots", cost: 720, category: "boots", tags: ["boots", "magicDef", "ccReduce"], blurb: "Magic defense and shorter crowd control." },
  { id: "swift_boots", name: "Swift Boots", cost: 720, category: "boots", tags: ["boots", "atkSpeed"], blurb: "Attack speed for basic-attack heroes." },
  { id: "arcane_boots", name: "Arcane Boots", cost: 720, category: "boots", tags: ["boots", "magicPen"], blurb: "Magic penetration for early damage." },
  { id: "magic_shoes", name: "Magic Shoes", cost: 720, category: "boots", tags: ["boots", "cdr"], blurb: "Cooldown reduction.", aliases: ["Magic Boots"] },
  { id: "rapid_boots", name: "Rapid Boots", cost: 720, category: "boots", tags: ["boots"], blurb: "The most movement speed, for rotating." },
  { id: "demon_shoes", name: "Demon Shoes", cost: 720, category: "boots", tags: ["boots"], blurb: "Mana regeneration.", aliases: ["Demon Boots"] },

  // ── Attack ───────────────────────────────────────────────────────────────
  { id: "blade_of_despair", name: "Blade of Despair", cost: 3010, category: "attack", tags: ["damage"], blurb: "The biggest raw physical attack; extra against targets under half health.", component: LEGION_SWORD },
  { id: "berserkers_fury", name: "Berserker's Fury", cost: 2390, category: "attack", tags: ["damage", "crit"], blurb: "Crit chance and crit damage, with true damage on crits.", component: LEGION_SWORD, aliases: ["Berserker Fury"] },
  { id: "windtalker", name: "Windtalker", cost: 1880, category: "attack", tags: ["atkSpeed", "crit"], blurb: "Attack speed, crit and movement speed, with a bouncing hit for wave clear." },
  { id: "haas_claws", name: "Haas' Claws", cost: 2020, category: "attack", tags: ["damage", "sustain", "crit", "atkSpeed"], blurb: "Lifesteal with attack speed and crit.", component: c("Vampire Mallet", 400, "already gives lifesteal"), aliases: ["Haas's Claws", "Haas Claws"] },
  { id: "demon_hunter_sword", name: "Demon Hunter Sword", cost: 2180, category: "attack", tags: ["atkSpeed", "tankShred"], blurb: "Basic attacks deal bonus damage based on the target's current HP — melts tanks." },
  { id: "golden_staff", name: "Golden Staff", cost: 2000, category: "attack", tags: ["atkSpeed"], blurb: "Every third basic attack triggers your on-hit effects extra times." },
  { id: "corrosion_scythe", name: "Corrosion Scythe", cost: 2050, category: "attack", tags: ["atkSpeed", "slow"], blurb: "Attack speed plus a stacking slow on every hit." },
  { id: "malefic_roar", name: "Malefic Roar", cost: 2060, category: "attack", tags: ["physPen"], blurb: "Percent physical penetration — worth more the more armor they build.", component: LEGION_SWORD },
  { id: "malefic_gun", name: "Malefic Gun", cost: 2120, category: "attack", tags: ["physPen", "atkSpeed"], blurb: "Marksman penetration with attack speed and extra range.", component: FURY_HAMMER },
  { id: "hunter_strike", name: "Hunter Strike", cost: 2010, category: "attack", tags: ["damage", "cdr", "physPen"], blurb: "Attack, cooldown reduction and flat penetration — the standard burst opener.", component: FURY_HAMMER },
  { id: "blade_of_the_heptaseas", name: "Blade of the Heptaseas", cost: 1950, category: "attack", tags: ["damage", "physPen"], blurb: "Early penetration and a bonus hit when you open from out of combat.", component: FURY_HAMMER, aliases: ["Blade of Heptaseas", "Heptaseas"] },
  { id: "war_axe", name: "War Axe", cost: 2100, category: "attack", tags: ["damage", "sustain", "cdr"], blurb: "Stacks attack the longer you fight, with lifesteal and cooldown reduction." },
  { id: "endless_battle", name: "Endless Battle", cost: 2330, category: "attack", tags: ["damage", "cdr"], blurb: "True damage on the basic attack after each skill." },
  { id: "great_dragon_spear", name: "Great Dragon Spear", cost: 2140, category: "attack", tags: ["damage", "cdr", "crit"], blurb: "A burst of movement speed after casting your ultimate." },
  { id: "sky_piercer", name: "Sky Piercer", cost: 1500, category: "attack", tags: ["damage"], blurb: "Cheap: executes enemies at very low health, stronger with every kill." },
  { id: "sea_halberd", name: "Sea Halberd", cost: 2050, category: "attack", tags: ["antiheal", "damage", "atkSpeed"], blurb: "Your damage cuts the target's healing and shields; bonus damage to high-HP heroes.", component: LEGION_SWORD },
  { id: "rose_gold_meteor", name: "Rose Gold Meteor", cost: 2030, category: "attack", tags: ["antiBurst", "physDef", "magicDef", "atkSpeed"], blurb: "A shield when you drop low, with attack speed and lifesteal.", component: c("Magic Blade", 1050, "already has the low-health shield") },
  { id: "wind_of_nature", name: "Wind of Nature", cost: 1910, category: "attack", tags: ["antiBurst", "atkSpeed", "sustain"], blurb: "Active: immune to physical damage for two seconds (one second on non-marksmen)." },

  // ── Magic ────────────────────────────────────────────────────────────────
  { id: "clock_of_destiny", name: "Clock of Destiny", cost: 2030, category: "magic", tags: ["damage", "cdr"], blurb: "HP, mana and stacking defense over time — buy it first." },
  { id: "lightning_truncheon", name: "Lightning Truncheon", cost: 2250, category: "magic", tags: ["damage", "cdr"], blurb: "A bonus area burst on your skills every few seconds." },
  { id: "genius_wand", name: "Genius Wand", cost: 2000, category: "magic", tags: ["damage", "magicPen"], blurb: "Magic penetration that shreds further as you hit." },
  { id: "holy_crystal", name: "Holy Crystal", cost: 3000, category: "magic", tags: ["damage"], blurb: "The biggest raw magic power." },
  { id: "blood_wings", name: "Blood Wings", cost: 2100, category: "magic", tags: ["damage"], blurb: "Magic power plus a regenerating shield." },
  { id: "divine_glaive", name: "Divine Glaive", cost: 1970, category: "magic", tags: ["magicPen"], blurb: "Percent magic penetration — buy when they stack magic defense." },
  { id: "glowing_wand", name: "Glowing Wand", cost: 2050, category: "magic", tags: ["antiheal", "damage", "tankShred"], blurb: "Burns a share of max HP and cuts the target's healing and shields." },
  { id: "ice_queen_wand", name: "Ice Queen Wand", cost: 2040, category: "magic", tags: ["damage", "slow", "sustain"], blurb: "Skills slow; adds spell vamp and movement speed." },
  { id: "concentrated_energy", name: "Concentrated Energy", cost: 2020, category: "magic", tags: ["damage", "sustain"], blurb: "Lifesteal for sustained magic fighters." },
  { id: "feather_of_heaven", name: "Feather of Heaven", cost: 2030, category: "magic", tags: ["damage", "atkSpeed"], blurb: "Attack speed and bonus magic damage on basic attacks." },
  { id: "starlium_scythe", name: "Starlium Scythe", cost: 2120, category: "magic", tags: ["damage", "cdr"], blurb: "Empowered true-damage basic attack after a skill." },
  { id: "wishing_lantern", name: "Wishing Lantern", cost: 2250, category: "magic", tags: ["damage", "tankShred"], blurb: "Bonus hits based on the target's current HP as you deal damage." },
  { id: "enchanted_talisman", name: "Enchanted Talisman", cost: 2070, category: "magic", tags: ["cdr", "teamUtility"], blurb: "Cooldown reduction and a higher cooldown cap." },
  { id: "fleeting_time", name: "Fleeting Time", cost: 2050, category: "magic", tags: ["cdr"], blurb: "Kills and assists cut your ultimate's cooldown." },
  { id: "flask_of_the_oasis", name: "Flask of the Oasis", cost: 1850, category: "magic", tags: ["teamUtility", "cdr"], blurb: "Stronger heals, plus a shield for low-health allies." },
  { id: "winter_crown", name: "Winter Crown", cost: 1910, category: "magic", tags: ["antiBurst"], blurb: "Active: freeze yourself, untargetable for two seconds.", aliases: ["Winter Truncheon"] },

  // ── Defense ──────────────────────────────────────────────────────────────
  { id: "dominance_ice", name: "Dominance Ice", cost: 2010, category: "defense", tags: ["physDef", "magicDef", "antiheal"], blurb: "Physical and magic defense that grows with enemies nearby, and an aura that cuts their healing and shields.", component: c("Black Ice Shield", 780, "already gives defense that grows with enemies nearby") },
  { id: "antique_cuirass", name: "Antique Cuirass", cost: 2170, category: "defense", tags: ["physDef"], blurb: "Each skill that hits you lowers the attacker's physical damage.", component: c("Dreadnaught Armor", 730, "already weakens physical attackers who hit you with skills") },
  { id: "blade_armor", name: "Blade Armor", cost: 1910, category: "defense", tags: ["physDef", "antiBasic", "antiCrit"], blurb: "Reflects basic-attack damage and blunts crits.", component: c("Steel Legplates", 630) },
  { id: "chastise_pauldron", name: "Chastise Pauldron", cost: 2100, category: "defense", tags: ["physDef", "antiBasic"], blurb: "Enemies who attack you have their attack speed cut.", component: c("Steel Legplates", 630) },
  { id: "valkyries_shield", name: "Valkyrie's Shield", cost: 2150, category: "defense", tags: ["magicDef", "antiBurst"], blurb: "Magic defense that cuts magic damage for a few seconds when you get hit.", component: SILENCE_ROBE, aliases: ["Athena's Shield", "Athena Shield", "Valkyrie Shield"] },
  { id: "radiant_armor", name: "Radiant Armor", cost: 1880, category: "defense", tags: ["magicDef"], blurb: "Magic defense that stacks up against repeated magic hits.", component: SILENCE_ROBE },
  { id: "oracle", name: "Oracle", cost: 1860, category: "defense", tags: ["physDef", "magicDef", "cdr", "sustain"], blurb: "Boosts the healing and shields you receive." },
  { id: "immortality", name: "Immortality", cost: 2120, category: "defense", tags: ["revive", "antiBurst"], blurb: "Revives you once on a long cooldown." },
  { id: "queens_wings", name: "Queen's Wings", cost: 2250, category: "defense", tags: ["antiBurst", "sustain"], blurb: "Heavy damage reduction when you drop low.", aliases: ["Queen Wings"] },
  { id: "brute_force_breastplate", name: "Brute Force Breastplate", cost: 2070, category: "defense", tags: ["physDef", "ccReduce", "cdr"], blurb: "HP, cooldown reduction and crowd-control resistance as you fight." },
  { id: "thunder_belt", name: "Thunder Belt", cost: 1820, category: "defense", tags: ["physDef", "magicDef", "slow"], blurb: "Cheap: a true-damage hit that also adds permanent defense each time it lands." },
  { id: "cursed_helmet", name: "Cursed Helmet", cost: 1910, category: "defense", tags: ["magicDef"], blurb: "Burns nearby enemies — clears waves for tanks.", component: c("Molten Essence", 800, "already burns nearby enemies") },
  { id: "guardian_helmet", name: "Guardian Helmet", cost: 2500, category: "defense", tags: ["sustain"], blurb: "Massive HP and regeneration.", aliases: ["Sky Guardian Helmet"] },
];

/** Selling refunds this share of the price once the first few seconds have passed. */
export const SELL_REFUND = 0.6;

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

import type { Archetype, Hero, Lane } from "../types";

/**
 * A build is a short fixed core plus slots the planner fills from the enemy
 * lineup. That mirrors how strong players itemise: two or three items your hero
 * always wants, then answers to whoever is actually hurting you.
 */
export interface BuildTemplate {
  label: string;
  boots: string;
  /** Always built, in this order. */
  core: string[];
  coreWhy: string;
  /** Damage / utility items used to fill slots no situational pick claimed. */
  filler: string[];
  antiheal: string;
  /** Percent penetration, moved up when the enemy stacks defense. */
  pen?: string;
  /** Max-HP damage, moved up into tanky lineups. */
  tankShred?: string;
  defense: { physical: string[]; magic: string[] };
  /** How many defensive items this kind of hero can afford (carries 1–2, tanks 5). */
  maxDefense: number;
  spell: { name: string; reason: string };
  emblem: { name: string; talents: string[]; reason: string };
}

const CARRY_DEF_PHYS = ["wind_of_nature", "immortality"];
const CARRY_DEF_MAGIC = ["rose_gold_meteor", "valkyries_shield"];
const MAGE_DEF = ["winter_crown", "immortality"];
const FRONT_PHYS = ["antique_cuirass", "blade_armor", "chastise_pauldron", "brute_force_breastplate"];
const FRONT_MAGIC = ["valkyries_shield", "radiant_armor", "oracle"];

const FLICKER = { name: "Flicker", reason: "A blink to escape a dive or reposition for the kill." };

export const TEMPLATES: Record<Archetype, BuildTemplate> = {
  mm_crit: {
    label: "Crit marksman",
    boots: "swift_boots",
    core: ["windtalker", "berserkers_fury"],
    coreWhy: "Attack speed first, then crit — your damage comes from basic attacks.",
    filler: ["haas_claws", "blade_of_despair", "malefic_roar", "great_dragon_spear"],
    antiheal: "sea_halberd",
    pen: "malefic_roar",
    tankShred: "demon_hunter_sword",
    defense: { physical: CARRY_DEF_PHYS, magic: CARRY_DEF_MAGIC },
    maxDefense: 2,
    spell: FLICKER,
    emblem: { name: "Marksman", talents: ["Fatal", "Weapon Master", "Weakness Finder"], reason: "Crit, more stats from your items, and a slow on your basic attacks." },
  },
  mm_onhit: {
    label: "On-hit marksman",
    boots: "swift_boots",
    core: ["corrosion_scythe", "demon_hunter_sword", "golden_staff"],
    coreWhy: "The attack-speed trio: every hit slows, shreds HP and triggers your passive faster.",
    filler: ["malefic_roar", "haas_claws", "blade_of_despair"],
    antiheal: "sea_halberd",
    pen: "malefic_roar",
    tankShred: "demon_hunter_sword",
    defense: { physical: CARRY_DEF_PHYS, magic: CARRY_DEF_MAGIC },
    maxDefense: 2,
    spell: { name: "Inspire", reason: "A burst of attack speed for your on-hit damage. Take Flicker instead if they have divers." },
    emblem: { name: "Marksman", talents: ["Swift", "Weapon Master", "Weakness Finder"], reason: "Attack speed, more stats from your items, and a slow on your basic attacks." },
  },
  mm_burst: {
    label: "Burst marksman",
    boots: "swift_boots",
    core: ["hunter_strike", "blade_of_despair"],
    coreWhy: "Skill damage and penetration — you burst with abilities, not sustained attacks.",
    filler: ["malefic_roar", "berserkers_fury", "endless_battle", "great_dragon_spear"],
    antiheal: "sea_halberd",
    pen: "malefic_roar",
    tankShred: "demon_hunter_sword",
    defense: { physical: CARRY_DEF_PHYS, magic: CARRY_DEF_MAGIC },
    maxDefense: 2,
    spell: FLICKER,
    emblem: { name: "Assassin", talents: ["Rupture", "Weapon Master", "Quantum Charge"], reason: "Penetration, more stats from your items, and speed plus healing on basic attacks." },
  },
  mm_magic: {
    label: "Magic marksman",
    boots: "arcane_boots",
    core: ["feather_of_heaven", "genius_wand"],
    coreWhy: "Attack speed with magic on-hit, then penetration.",
    filler: ["holy_crystal", "divine_glaive", "blood_wings"],
    antiheal: "glowing_wand",
    pen: "divine_glaive",
    tankShred: "glowing_wand",
    defense: { physical: MAGE_DEF, magic: ["winter_crown", "valkyries_shield"] },
    maxDefense: 2,
    spell: FLICKER,
    emblem: { name: "Mage", talents: ["Swift", "Weapon Master", "Impure Rage"], reason: "Attack speed, more stats from your items, and max-HP damage on skills." },
  },
  mage: {
    label: "Mage",
    boots: "arcane_boots",
    core: ["clock_of_destiny", "lightning_truncheon"],
    coreWhy: "Clock first so it stacks, then Lightning Truncheon for burst.",
    filler: ["genius_wand", "holy_crystal", "divine_glaive", "blood_wings"],
    antiheal: "glowing_wand",
    pen: "divine_glaive",
    tankShred: "glowing_wand",
    defense: { physical: MAGE_DEF, magic: ["winter_crown", "valkyries_shield"] },
    maxDefense: 2,
    spell: FLICKER,
    emblem: { name: "Mage", talents: ["Rupture", "Bargain Hunter", "Lethal Ignition"], reason: "Penetration, cheaper items, and bonus damage when you land a burst." },
  },
  mage_tank: {
    label: "Sustain mage",
    boots: "tough_boots",
    core: ["clock_of_destiny", "oracle"],
    coreWhy: "Clock for HP and power, Oracle to amplify your own shields and healing.",
    filler: ["glowing_wand", "genius_wand", "thunder_belt", "immortality"],
    antiheal: "dominance_ice",
    pen: "genius_wand",
    tankShred: "glowing_wand",
    defense: { physical: FRONT_PHYS, magic: FRONT_MAGIC },
    maxDefense: 4,
    spell: FLICKER,
    emblem: { name: "Mage", talents: ["Agility", "Festival of Blood", "Impure Rage"], reason: "Movement speed, spell vamp, and max-HP damage on skills." },
  },
  assassin_phys: {
    label: "Physical assassin",
    boots: "tough_boots",
    core: ["hunter_strike", "blade_of_the_heptaseas"],
    coreWhy: "Cooldown and penetration to delete squishy targets.",
    filler: ["blade_of_despair", "malefic_roar", "sky_piercer"],
    antiheal: "sea_halberd",
    pen: "malefic_roar",
    defense: { physical: ["immortality", "brute_force_breastplate"], magic: ["rose_gold_meteor", "valkyries_shield"] },
    maxDefense: 2,
    spell: { name: "Execute", reason: "Finishes low-health targets through shields and escapes." },
    emblem: { name: "Assassin", talents: ["Rupture", "Master Assassin", "Killing Spree"], reason: "Penetration, more damage to isolated targets, and a heal when you hit low-health heroes." },
  },
  assassin_magic: {
    label: "Magic assassin",
    boots: "arcane_boots",
    core: ["genius_wand", "holy_crystal"],
    coreWhy: "Penetration then raw magic power to one-shot carries.",
    filler: ["divine_glaive", "blood_wings", "starlium_scythe"],
    antiheal: "glowing_wand",
    pen: "divine_glaive",
    defense: { physical: MAGE_DEF, magic: ["winter_crown", "valkyries_shield"] },
    maxDefense: 2,
    spell: { name: "Execute", reason: "Finishes low-health targets through shields and escapes." },
    emblem: { name: "Assassin", talents: ["Rupture", "Master Assassin", "Lethal Ignition"], reason: "Penetration, more damage to isolated targets, and bonus damage when you land a burst." },
  },
  fighter_phys: {
    label: "Fighter",
    boots: "warrior_boots",
    core: ["war_axe", "hunter_strike"],
    coreWhy: "War Axe for sustained fights, then cooldown and penetration.",
    filler: ["thunder_belt", "queens_wings", "malefic_roar", "immortality"],
    antiheal: "sea_halberd",
    pen: "malefic_roar",
    defense: { physical: FRONT_PHYS, magic: FRONT_MAGIC },
    maxDefense: 3,
    spell: FLICKER,
    emblem: { name: "Fighter", talents: ["Firmness", "Festival of Blood", "Brave Smite"], reason: "Defense, spell vamp, and healing when your skills hit." },
  },
  fighter_magic: {
    label: "Magic fighter",
    boots: "arcane_boots",
    core: ["genius_wand", "concentrated_energy"],
    coreWhy: "Penetration, then spell vamp to stay in the fight.",
    filler: ["holy_crystal", "starlium_scythe", "divine_glaive"],
    antiheal: "glowing_wand",
    pen: "divine_glaive",
    defense: { physical: ["winter_crown", "antique_cuirass", "immortality"], magic: ["winter_crown", "valkyries_shield"] },
    maxDefense: 2,
    spell: FLICKER,
    emblem: { name: "Fighter", talents: ["Rupture", "Festival of Blood", "Brave Smite"], reason: "Penetration, spell vamp, and healing when your skills hit." },
  },
  tank: {
    label: "Tank",
    boots: "tough_boots",
    core: [],
    coreWhy: "",
    filler: ["thunder_belt", "immortality", "guardian_helmet", "cursed_helmet"],
    antiheal: "dominance_ice",
    defense: { physical: FRONT_PHYS, magic: FRONT_MAGIC },
    maxDefense: 5,
    spell: FLICKER,
    emblem: { name: "Tank", talents: ["Vitality", "Tenacity", "Concussive Blast"], reason: "HP, damage reduction when low, and area damage that scales with your HP." },
  },
  support_heal: {
    label: "Healer",
    boots: "magic_shoes",
    core: ["flask_of_the_oasis", "enchanted_talisman"],
    coreWhy: "Stronger heals and the cooldown and mana to keep casting them.",
    filler: ["fleeting_time", "oracle", "immortality"],
    antiheal: "dominance_ice",
    defense: { physical: ["antique_cuirass", "chastise_pauldron"], magic: ["valkyries_shield", "radiant_armor"] },
    maxDefense: 3,
    spell: FLICKER,
    emblem: { name: "Support", talents: ["Agility", "Pull Yourself Together", "Focusing Mark"], reason: "Movement speed, shorter battle-spell cooldown, and a mark that makes allies hit your target harder." },
  },
  support: {
    label: "Support",
    boots: "tough_boots",
    core: ["enchanted_talisman"],
    coreWhy: "Cooldown and mana so your utility is always up.",
    filler: ["fleeting_time", "thunder_belt", "immortality", "oracle"],
    antiheal: "dominance_ice",
    defense: { physical: ["antique_cuirass", "chastise_pauldron", "blade_armor"], magic: ["valkyries_shield", "radiant_armor"] },
    maxDefense: 4,
    spell: FLICKER,
    emblem: { name: "Support", talents: ["Agility", "Pull Yourself Together", "Focusing Mark"], reason: "Movement speed, shorter battle-spell cooldown, and a mark that makes allies hit your target harder." },
  },
};

/** Heroes whose signature build differs from their archetype's default core. */
export const HERO_CORE: Record<string, Partial<Pick<BuildTemplate, "core" | "coreWhy" | "boots" | "filler">>> = {
  Esmeralda: { boots: "tough_boots", core: ["clock_of_destiny", "oracle"], filler: ["dominance_ice", "thunder_belt", "immortality", "glowing_wand"] },
  Aldous: { boots: "tough_boots", core: ["thunder_belt", "endless_battle"], coreWhy: "Your stacks are the damage — build to survive long enough to land the punch." },
  Sun: { boots: "swift_boots", core: ["corrosion_scythe", "demon_hunter_sword"], coreWhy: "Your clones copy on-hit effects, so attack speed scales three times over." },
  Argus: { boots: "swift_boots", core: ["corrosion_scythe", "demon_hunter_sword"], coreWhy: "Attack speed charges your passive and keeps targets in range." },
  Zilong: { boots: "swift_boots", core: ["corrosion_scythe", "demon_hunter_sword"], coreWhy: "You win by out-hitting people, so stack attack speed." },
  Masha: { boots: "swift_boots", core: ["corrosion_scythe", "demon_hunter_sword"], coreWhy: "Attack speed is what feeds your HP bars." },
};

export function templateFor(hero: Hero, lane: Lane | undefined): BuildTemplate {
  const override = HERO_CORE[hero.name];
  // A tanky "support" (Lolita, Carmilla…) itemises like a tank, not an enchanter.
  const base = hero.archetype === "support" && hero.ability.durability >= 60 ? TEMPLATES.tank : TEMPLATES[hero.archetype];
  const tpl: BuildTemplate = { ...base, ...override, coreWhy: override?.coreWhy ?? base.coreWhy };
  if (lane === "jungle") {
    // Junglers trade the second talent for objective damage.
    const talents = tpl.emblem.talents.map((t, i) => (i === 1 ? "Seasoned Hunter" : t));
    return {
      ...tpl,
      spell: { name: "Retribution", reason: "Required to jungle, and it unlocks the jungle blessing on your boots." },
      emblem: { ...tpl.emblem, talents, reason: "Your usual emblem, with Seasoned Hunter for extra damage to Turtle and Lord." },
    };
  }
  return tpl;
}

export function bootsNote(lane: Lane | undefined): string | undefined {
  if (lane === "jungle") return "Add a free jungle blessing to your boots: Ice steals movement speed, Flame steals attack, Bloody steals HP.";
  if (lane === "roam") return "Add a free roam blessing to your boots: Conceal for team stealth, Encourage for ally defense, Favor if you heal or shield, Dire Hit for a bonus hit.";
  return undefined;
}

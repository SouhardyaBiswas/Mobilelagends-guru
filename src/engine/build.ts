import { bootsNote, templateFor, type BuildTemplate } from "../data/builds";
import { heroById, heroName } from "../data/heroes";
import { componentId, itemById, SELL_REFUND } from "../data/items";
import type { BuildPlan, BuildSlot, Hero, Item, Lane, NextStep, PlayerState, ThreatProfile } from "../types";
import { analyzeThreat } from "./threat";

export interface BuildInput {
  hero: Hero;
  lane?: Lane;
  enemies: PlayerState[];
  /** Item ids already bought; components appear as "comp:<slug>". */
  owned: string[];
  gold?: number;
  gameTimeSec?: number;
}

interface Pick {
  item: Item;
  score: number;
  reason: string;
  defensive: boolean;
}

const SLOTS = 6;
/** Picks at or above this score jump ahead of the rest of the core build. */
const URGENT = 75;
/** After this point carries can trade boots for a sixth real item. */
const LATE_GAME_SEC = 15 * 60;

const DEFENSIVE_TAGS = new Set(["physDef", "magicDef", "antiBurst", "revive"]);
const isDefensive = (item: Item) => item.category === "defense" || item.tags.some((t) => DEFENSIVE_TAGS.has(t));

function list(ids: number[] | undefined, max = 2): string {
  const names = (ids ?? []).slice(0, max).map(heroName);
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** The enemy most worth itemising against right now, if one clearly stands out. */
function mainThreat(threat: ThreatProfile): { hero: Hero; fed: boolean } | undefined {
  const top = threat.sources[0];
  if (!top) return undefined;
  const hero = heroById(top.heroId);
  if (!hero) return undefined;
  // Either the scoreboard says they are ahead, or they carry an outsized share of the pressure.
  return top.fed || top.weight >= 0.34 ? { hero, fed: top.fed } : undefined;
}

function chooseBoots(tpl: BuildTemplate, threat: ThreatProfile, squishy: boolean): { id: string; reason: string } {
  // Carries keep their damage boots; only frontliners adapt boots to the lineup.
  if (squishy) return { id: tpl.boots, reason: "" };
  if (threat.cc >= 2.2 || threat.magicShare >= 0.55) {
    const why = threat.cc >= 2.2 ? `shorter crowd control from ${list(threat.who.cc) || "their lineup"}` : "most of their damage is magic";
    return { id: "tough_boots", reason: `Tough Boots — ${why}.` };
  }
  if (threat.physShare >= 0.6) return { id: "warrior_boots", reason: "Warrior Boots — most of their damage is physical." };
  return { id: tpl.boots, reason: "" };
}

function situationalPicks(hero: Hero, tpl: BuildTemplate, threat: ThreatProfile, enemies: PlayerState[]): Pick[] {
  const picks: Pick[] = [];
  const add = (id: string | undefined, score: number, reason: string) => {
    const item = id ? itemById(id) : undefined;
    if (!item) return;
    const existing = picks.find((p) => p.item.id === item.id);
    // The same item can answer two problems (Dominance Ice: armor and anti-heal) — keep the stronger case.
    if (existing) {
      if (score > existing.score) Object.assign(existing, { score, reason });
      return;
    }
    picks.push({ item, score, reason, defensive: isDefensive(item) });
  };

  const squishy = tpl.maxDefense <= 2;
  const main = mainThreat(threat);
  const fedBonus = main?.fed ? 25 : 0;

  // 1. Anti-heal: worth a slot once two enemies lean on healing or shields.
  const healNeed = threat.sustain + 0.5 * threat.shields;
  if (healNeed >= 1.2) {
    const healers = list(threat.who.sustain) || "their lineup";
    add(tpl.antiheal, 55 + healNeed * 12, `Anti-heal — cuts the healing and shields ${healers} rely on.`);
  }

  // 2. Defense against whoever is actually dangerous.
  const magicFirst = (ids: string[]) => {
    // Valkyrie's Shield answers burst; Radiant Armor is better against repeated hits.
    const topMagic = heroById(threat.who.magic?.[0] ?? -1);
    const sustainedMage = topMagic && topMagic.traits.burst < 0.55;
    return sustainedMage ? [...ids].sort((a, b) => Number(b === "radiant_armor") - Number(a === "radiant_armor")) : ids;
  };
  const physFirst = (ids: string[]) => {
    // Against basic attackers, Blade Armor (crit) or Chastise Pauldron (attack speed) beat Antique Cuirass.
    if (threat.basicAttack < 1.2) return ids;
    const preferred = threat.crit >= 1 ? ["blade_armor", "chastise_pauldron"] : ["chastise_pauldron", "blade_armor"];
    const rank = (id: string) => (preferred.includes(id) ? preferred.indexOf(id) : preferred.length);
    return [...ids].sort((a, b) => rank(a) - rank(b));
  };
  const physList = physFirst(tpl.defense.physical);
  const magicList = magicFirst(tpl.defense.magic);

  if (squishy) {
    // Carries buy defense only for a specific problem: a fed enemy, or a real burst hero who will dive them.
    const burster = heroById(threat.who.burst?.[0] ?? -1);
    const diver = main?.fed ? main.hero : threat.burst >= 1 ? burster : undefined;
    if (diver) {
      const magic = diver.damage === "magic" || (diver.damage === "mixed" && threat.magicShare > 0.5);
      const id = (magic ? magicList : physList)[0];
      const why = main?.fed ? `${diver.name} is fed` : `${diver.name} can burst you down`;
      add(id, 52 + threat.burst * 8 + fedBonus, `${why} (${magic ? "magic" : "physical"} damage) — this keeps you alive through the engage.`);
    }
    if (threat.burst >= 2.4 || (main?.fed && threat.burst >= 1.5)) {
      add("immortality", 48 + fedBonus / 2, `A second life against ${list(threat.who.burst) || "their burst"}.`);
    }
  } else {
    // Frontliners split their defensive slots by the enemy's damage mix.
    // At most three dedicated resist items, so there is room for HP and utility.
    const budget = Math.min(3, tpl.maxDefense);
    let nMagic = Math.round(budget * threat.magicShare);
    if (threat.magicShare >= 0.25) nMagic = Math.max(1, nMagic);
    if (threat.physShare >= 0.25) nMagic = Math.min(budget - 1, nMagic);
    const nPhys = budget - nMagic;
    const mainMagic = main ? main.hero.damage === "magic" : false;
    const mainPhys = main ? main.hero.damage === "physical" : false;
    magicList.slice(0, nMagic).forEach((id, i) => {
      const src = list(threat.who.magic) || "their mages";
      add(id, 40 + threat.magicShare * 45 - i * 9 + (mainMagic ? fedBonus + 8 : 0), `Magic defense — ${Math.round(threat.magicShare * 100)}% of their damage is magic (${src}).`);
    });
    physList.slice(0, nPhys).forEach((id, i) => {
      const item = itemById(id);
      const vsBasic = item?.tags.includes("antiBasic") && threat.basicAttack >= 1.2;
      const src = vsBasic ? list(threat.who.basicAttack) || "their marksman" : list(threat.who.physical) || "their physical damage";
      const why = vsBasic ? `blunts basic attacks from ${src}` : `${Math.round(threat.physShare * 100)}% of their damage is physical (${src})`;
      add(id, 40 + threat.physShare * 45 - i * 9 + (mainPhys ? fedBonus + 8 : 0), `Physical defense — ${why}.`);
    });
  }

  // 3. Penetration: against tanky lineups, or once the scoreboard shows them stacking defense.
  const armored = enemies.filter((e) => (e.items ?? []).filter((id) => itemById(id)?.category === "defense").length >= 2).length;
  if (tpl.pen && (threat.tankiness >= 2.2 || armored >= 2)) {
    const why = armored >= 2 ? `${armored} of them are stacking defense items` : `${list(threat.who.tankiness) || "their frontline"} are naturally tanky`;
    add(tpl.pen, 50 + armored * 8 + threat.tankiness * 4, `Penetration — ${why}.`);
  }
  if (tpl.tankShred && threat.tankiness >= 2.6) {
    add(tpl.tankShred, 46 + threat.tankiness * 3, `HP-based damage — melts ${list(threat.who.tankiness) || "their tanks"}.`);
  }

  void hero;
  return picks.sort((a, b) => b.score - a.score);
}

function nextStep(
  slots: BuildSlot[],
  overflow: Pick[],
  input: BuildInput,
  ownedFull: string[],
  squishy: boolean,
): NextStep {
  const { gold, owned } = input;
  const target = slots.find((s) => !s.owned);

  if (!target) {
    // Inventory is full. Swap only for something that answers a real problem.
    const want = overflow[0];
    if (want && want.score >= 60) {
      const offPlan = slots.find((s) => s.kind === "damage" && s.reason === OFF_PLAN);
      const boots = slots.find((s) => s.item.category === "boots");
      const late = (input.gameTimeSec ?? 0) >= LATE_GAME_SEC;
      const sell = offPlan?.item ?? (late && squishy ? boots?.item : undefined);
      if (sell) {
        return {
          action: "sell-swap",
          item: want.item,
          sell,
          say: `Sell ${sell.name} and buy ${want.item.name}.`,
          detail: `${want.reason}${sell.category === "boots" ? " This late, a sixth item is worth more than boots." : ""} Selling refunds ${Math.round(SELL_REFUND * 100)}% of the price.`,
        };
      }
    }
    return { action: "done", say: "Your build is complete.", detail: "All six slots are filled. Watch for a fed enemy — the plan will tell you if a swap is worth it." };
  }

  const { item } = target;
  const comp = item.component;
  const haveComp = !!comp && owned.includes(componentId(comp.name));
  const remaining = item.cost - (haveComp && comp ? comp.cost : 0);
  const why = target.reason;
  void ownedFull;

  if (gold === undefined) {
    const start = comp && !haveComp ? ` Start with ${comp.name}.` : "";
    return { action: "buy", item, component: comp && !haveComp ? comp : undefined, say: `Next item: ${item.name}.${start}`, detail: why };
  }
  if (gold >= remaining) {
    return { action: "buy", item, say: `Buy ${item.name} now.`, detail: why };
  }
  if (comp && !haveComp && gold >= comp.cost) {
    // Only claim the cheap piece helps when it really carries the effect.
    const antiHealPick = item.tags.includes("antiheal") && /^Anti-heal/.test(why);
    const note = comp.effect
      ? `${comp.name} ${comp.effect}${antiHealPick ? " — the anti-heal itself only comes with the finished item" : ""}.`
      : `${comp.name} is just the first piece${antiHealPick ? " — anti-heal only works once the item is finished" : ""}.`;
    return {
      action: "buy-component",
      item,
      component: comp,
      say: comp.effect ? `Buy ${comp.name} now. It ${comp.effect}, and builds into ${item.name}.` : `Buy ${comp.name} now, the first piece of ${item.name}.`,
      detail: `${why} ${note}`,
    };
  }
  // Improvise: rather than sit on gold for an expensive item, take a counter you can afford right now —
  // the finished item if possible, otherwise a cheap piece that already carries part of its effect.
  for (const later of slots) {
    if (later.owned || later === target || later.kind !== "situational") continue;
    const lc = later.item.component;
    const haveLc = !!lc && owned.includes(componentId(lc.name));
    const laterRemaining = later.item.cost - (haveLc && lc ? lc.cost : 0);
    if (gold >= laterRemaining) {
      return {
        action: "buy",
        item: later.item,
        say: `Buy ${later.item.name} now.`,
        detail: `${later.reason} You can't afford ${item.name} yet, so take the counter first.`,
      };
    }
    if (lc?.effect && !haveLc && gold >= lc.cost) {
      return {
        action: "buy-component",
        item: later.item,
        component: lc,
        say: `Buy ${lc.name} now. It ${lc.effect}, and builds into ${later.item.name}.`,
        detail: `${later.reason} You can't afford ${item.name} yet — a cheap counter now beats gold sitting in your pocket.`,
      };
    }
  }

  const goal = comp && !haveComp ? comp : undefined;
  const goldNeeded = (goal ? goal.cost : remaining) - gold;
  return {
    action: "save",
    item,
    component: goal,
    goldNeeded,
    say: `Save ${goldNeeded} more gold for ${goal ? goal.name : item.name}.`,
    detail: goal ? `${why} ${goal.name} is the first piece of ${item.name}.` : why,
  };
}

const OFF_PLAN = "Already in your inventory.";

/**
 * Build the six-item plan for this hero against this enemy team, mark what is
 * already owned, and decide the single next action.
 */
export function planBuild(input: BuildInput): BuildPlan & { threat: ThreatProfile } {
  const { hero } = input;
  const lane = input.lane ?? hero.lanes[0];
  const tpl = templateFor(hero, lane);
  const threat = analyzeThreat(input.enemies);
  const squishy = tpl.maxDefense <= 2;
  const picks = situationalPicks(hero, tpl, threat, input.enemies);

  // Priority order: boots, first core item, urgent answers, rest of core, other answers, filler.
  const ordered: Array<{ item: Item; reason: string; kind: BuildSlot["kind"]; score: number; defensive: boolean }> = [];
  const used = new Set<string>();
  let defensiveCount = 0;
  const push = (item: Item | undefined, reason: string, kind: BuildSlot["kind"], score = 0): boolean => {
    if (!item || used.has(item.id)) return false;
    const defensive = kind !== "boots" && isDefensive(item);
    if (defensive && kind !== "core" && defensiveCount >= tpl.maxDefense) return false;
    if (defensive) defensiveCount++;
    used.add(item.id);
    ordered.push({ item, reason, kind, score, defensive });
    return true;
  };

  const boots = chooseBoots(tpl, threat, squishy);
  push(itemById(boots.id), boots.reason, "boots");
  const [firstCore, ...restCore] = tpl.core;
  if (firstCore) push(itemById(firstCore), tpl.coreWhy, "core");
  for (const p of picks.filter((p) => p.score >= URGENT)) push(p.item, p.reason, "situational", p.score);
  for (const id of restCore) push(itemById(id), tpl.coreWhy, "core");
  for (const p of picks.filter((p) => p.score < URGENT)) push(p.item, p.reason, "situational", p.score);
  for (const id of tpl.filler) push(itemById(id), squishy ? "More damage." : "Rounds out your build.", "damage");

  // Reconcile with what the player actually owns.
  const ownedFull = input.owned.filter((id) => !id.startsWith("comp:"));
  const ownedBoots = ownedFull.map(itemById).find((i) => i?.category === "boots");
  const planned = ordered.map((o) =>
    // Never tell someone to buy a second pair of boots.
    o.kind === "boots" && ownedBoots ? { ...o, item: ownedBoots, reason: "Your boots." } : o,
  );
  const plannedIds = new Set(planned.map((o) => o.item.id));
  const offPlan = ownedFull
    .map(itemById)
    .filter((i): i is Item => !!i && !plannedIds.has(i.id))
    .map((item) => ({ item, reason: OFF_PLAN, kind: "damage" as const, score: 0, defensive: isDefensive(item) }));

  const have = [...planned.filter((o) => ownedFull.includes(o.item.id)), ...offPlan];
  const want = planned.filter((o) => !ownedFull.includes(o.item.id));
  const fitted = [...have, ...want].slice(0, SLOTS);
  const slots: BuildSlot[] = fitted.map((o) => ({ item: o.item, reason: o.reason, kind: o.kind, owned: ownedFull.includes(o.item.id) }));
  const fittedIds = new Set(fitted.map((o) => o.item.id));
  const overflow: Pick[] = want.filter((o) => !fittedIds.has(o.item.id) && o.kind === "situational");

  // Spell: template default, overridden when the lineup demands it.
  let spell = tpl.spell;
  if (lane !== "jungle") {
    if (squishy && threat.cc >= 2.4) {
      spell = { name: "Purify", reason: `They have heavy crowd control (${list(threat.who.cc, 3) || "several stuns"}) — Purify breaks you out.` };
    } else if (!squishy && threat.basicAttack >= 1.7) {
      spell = { name: "Vengeance", reason: `Reflects damage from basic attackers like ${list(threat.who.basicAttack) || "their marksman"} when they focus you.` };
    }
  }

  return {
    slots,
    next: nextStep(slots, overflow, input, ownedFull, squishy),
    spell,
    emblem: tpl.emblem,
    bootsNote: bootsNote(lane),
    threat,
  };
}

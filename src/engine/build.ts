import { bootsNote, templateFor, type BuildTemplate } from "../data/builds";
import { heroById, heroName } from "../data/heroes";
import { componentId, itemById, SELL_REFUND, SHOP_TAB } from "../data/items";
import type { AiBuild, BuildPlan, BuildSlot, Hero, Item, Lane, NextStep, PlayerState, ThreatProfile } from "../types";
import { analyzeThreat } from "./threat";

export interface BuildInput {
  hero: Hero;
  lane?: Lane;
  enemies: PlayerState[];
  /** Item ids already bought; components appear as "comp:<slug>". */
  owned: string[];
  gold?: number;
  gameTimeSec?: number;
  /** The build the player chose in game (read from the shop's Recommended list). Used as the base when present. */
  plannedBuild?: string[];
  /** Item ids the player's shop lists under Recommended / Spare — easy for them to find. */
  shopListed?: string[];
  /** What the shop charges relative to list price (0.95 with the Bargain Hunter emblem talent). */
  priceFactor?: number;
  /** Gold spent so far (total earned minus pocket gold). When known, it decides how far along the build is. */
  spent?: number;
  /** Items read from the player's icons that fit what they have spent. */
  seenItems?: string[];
  /** Remaining prices printed in the shop, still current. */
  shopPrices?: Record<string, number>;
  /** The item the player is part-way through buying, when a read of their inventory showed it. */
  partial?: string;
  /** A build order chosen by the AI coach. When present it replaces the template's order. */
  aiBuild?: AiBuild;
}

const FROM_YOUR_BUILD = "From the build you chose in game.";
const FROM_AI = "Chosen by the coach for this match.";
/** With this much gold in hand there is almost always a piece of the next item to buy. */
const PIECE_FLOOR = 400;

/** The AI coach's build as catalog items: no duplicates, one pair of boots, six at most. Too short a list is ignored. */
function aiItems(ai: AiBuild | undefined): Item[] | undefined {
  const out: Item[] = [];
  for (const id of ai?.ids ?? []) {
    const item = itemById(id);
    if (!item || out.includes(item)) continue;
    if (item.category === "boots" && out.some((i) => i.category === "boots")) continue;
    out.push(item);
  }
  return out.length >= 3 ? out.slice(0, SLOTS) : undefined;
}

/** Use the player's own in-game build as the base, keeping the template's counters and defensive options. */
function withPlannedBuild(tpl: BuildTemplate, plannedIds: string[] | undefined): BuildTemplate {
  const planned = (plannedIds ?? []).map(itemById).filter((i): i is Item => !!i);
  if (planned.length < 3) return tpl;
  const boots = planned.find((i) => i.category === "boots");
  const rest = planned.filter((i) => i.category !== "boots");
  const having = (tag: Item["tags"][number]) => rest.find((i) => i.tags.includes(tag))?.id;
  return {
    ...tpl,
    boots: boots?.id ?? tpl.boots,
    core: rest.slice(0, 2).map((i) => i.id),
    coreWhy: FROM_YOUR_BUILD,
    filler: [...rest.slice(2).map((i) => i.id), ...tpl.filler],
    // If their build already has an item that does the job, move that one up rather than adding another.
    pen: having("physPen") ?? having("magicPen") ?? tpl.pen,
    tankShred: having("tankShred") ?? tpl.tankShred,
    antiheal: having("antiheal") ?? tpl.antiheal,
  };
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

function chooseBoots(tpl: BuildTemplate, threat: ThreatProfile, squishy: boolean, fromPlayer: boolean): { id: string; reason: string } {
  // The player's own choice wins; otherwise carries keep damage boots and frontliners adapt to the lineup.
  if (fromPlayer) return { id: tpl.boots, reason: FROM_YOUR_BUILD };
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

function nextStep(slots: BuildSlot[], overflow: Pick[], input: BuildInput, squishy: boolean): NextStep {
  const { gold, owned } = input;
  const price = pricer(input.priceFactor);
  const target = slots.find((s) => !s.owned);

  /** Tell a new player where the thing actually is in the shop. */
  const where = (it: Item, piece?: { name: string }): string => {
    const listed = input.shopListed?.includes(it.id);
    const tab = `${SHOP_TAB[it.category]} tab`;
    if (piece) return `Open ${it.name}${listed ? "" : ` in the ${tab}`} and tap ${piece.name} in its build path.`;
    return listed ? "" : `It's under the ${tab}.`;
  };

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
          where: where(want.item) || undefined,
          say: `Sell ${sell.name} and buy ${want.item.name}.`,
          detail: `${want.reason}${sell.category === "boots" ? " This late, a sixth item is worth more than boots." : ""} Selling refunds ${Math.round(SELL_REFUND * 100)}% of the price.`,
        };
      }
    }
    return { action: "done", say: "Your build is complete.", detail: "All six slots are filled. Watch for a fed enemy — the plan will tell you if a swap is worth it." };
  }

  const { item } = target;
  const comp = item.component;
  const paid = target.paid ?? 0;
  // Once the player has paid toward an item they already hold pieces of it.
  const haveComp = paid >= 200 || (!!comp && owned.includes(componentId(comp.name)));
  // Best source first: the price the shop itself printed; then what is left after gold already paid;
  // then list price less an owned piece (the shop discounts the difference and rounds down).
  const shopPrice = input.shopPrices?.[item.id];
  const remaining =
    shopPrice !== undefined
      ? shopPrice
      : paid > 0
        ? Math.max(0, price(item.cost) - paid)
        : haveComp && comp
          ? price(item.cost - comp.cost)
          : price(item.cost);
  const why = target.reason;
  const verb = haveComp ? "Finish" : "Buy";

  if (gold === undefined) {
    const start = comp && !haveComp ? ` Start with ${comp.name}.` : "";
    return { action: "buy", item, component: comp && !haveComp ? comp : undefined, where: where(item) || undefined, say: `Next item: ${item.name}.${start}`, detail: why };
  }
  if (gold >= remaining) {
    return { action: "buy", item, where: where(item) || undefined, say: `${verb} ${item.name} now.`, detail: why };
  }
  if (comp && !haveComp && gold >= price(comp.cost)) {
    // Only claim the cheap piece helps when it really carries the effect.
    const antiHealPick = item.tags.includes("antiheal") && /^Anti-heal/.test(why);
    const note = comp.effect
      ? `${comp.name} ${comp.effect}${antiHealPick ? " — the anti-heal itself only comes with the finished item" : ""}.`
      : `${comp.name} is just the first piece${antiHealPick ? " — anti-heal only works once the item is finished" : ""}.`;
    return {
      action: "buy-component",
      item,
      component: comp,
      where: where(item, comp),
      say: comp.effect ? `Buy ${comp.name} now. It ${comp.effect}, and builds into ${item.name}.` : `Buy ${comp.name} now, the first piece of ${item.name}.`,
      detail: `${why} ${note}`.trim(),
    };
  }
  // Improvise: rather than sit on gold for an expensive item, take a counter you can afford right now —
  // the finished item if possible, otherwise a cheap piece that already carries part of its effect.
  // Only for urgent counters: an unfed enemy is no reason to delay your core damage item.
  for (const later of slots) {
    if (later.owned || later === target || !later.urgent) continue;
    const lc = later.item.component;
    const haveLc = !!lc && owned.includes(componentId(lc.name));
    const laterRemaining = haveLc && lc ? price(later.item.cost - lc.cost) : price(later.item.cost);
    if (gold >= laterRemaining) {
      return {
        action: "buy",
        item: later.item,
        where: where(later.item) || undefined,
        say: `Buy ${later.item.name} now.`,
        detail: `${later.reason} You can't afford ${item.name} yet, so take the counter first.`,
      };
    }
    if (lc?.effect && !haveLc && gold >= price(lc.cost)) {
      return {
        action: "buy-component",
        item: later.item,
        component: lc,
        where: where(later.item, lc),
        say: `Buy ${lc.name} now. It ${lc.effect}, and builds into ${later.item.name}.`,
        detail: `${later.reason} You can't afford ${item.name} yet — a cheap counter now beats gold sitting in your pocket.`,
      };
    }
  }

  const goal = comp && !haveComp ? comp : undefined;
  const goldNeeded = (goal ? price(goal.cost) : remaining) - gold;
  if (!goal && gold >= PIECE_FLOOR) {
    // Gold in the pocket does nothing. Pieces give stats now and count toward the item.
    const listed = input.shopListed?.includes(item.id);
    return {
      action: "buy-pieces",
      item,
      goldNeeded,
      where: `Open ${item.name}${listed ? "" : ` in the ${SHOP_TAB[item.category]} tab`} and buy the pieces in its build path that you can afford.`,
      say: `Buy pieces of ${item.name} now. ${goldNeeded} more gold finishes it.`,
      detail: `${why} You have ${gold} gold: spend it on pieces rather than carrying it.`.trim(),
    };
  }
  return {
    action: "save",
    item,
    component: goal,
    goldNeeded,
    where: goal ? where(item, goal) : where(item) || undefined,
    say: goal ? `Save ${goldNeeded} more gold for ${goal.name}.` : `Save ${goldNeeded} more gold to ${haveComp ? "finish" : "buy"} ${item.name}.`,
    detail: goal ? `${why} ${goal.name} is the first piece of ${item.name}.` : why,
  };
}

const OFF_PLAN = "Already in your inventory.";

/** The shop rounds discounted prices down. */
const pricer = (factor = 1) => (listPrice: number) => Math.floor(listPrice * factor);

/**
 * Build the six-item plan for this hero against this enemy team, mark what is
 * already owned, and decide the single next action.
 */
export function planBuild(input: BuildInput): BuildPlan & { threat: ThreatProfile } {
  const { hero } = input;
  const lane = input.lane ?? hero.lanes[0];
  const base = templateFor(hero, lane);
  const tpl = withPlannedBuild(base, input.plannedBuild);
  const fromPlayer = tpl !== base;
  const price = pricer(input.priceFactor);
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

  // The AI coach's order, when there is one, comes first; the rules below then only fill what it left open.
  const ai = aiItems(input.aiBuild);
  for (const item of ai ?? []) push(item, input.aiBuild?.why[item.id] || FROM_AI, item.category === "boots" ? "boots" : "core");
  const aiHasBoots = !!ai?.some((i) => i.category === "boots");

  const playerPickedBoots = fromPlayer && (input.plannedBuild ?? []).some((id) => itemById(id)?.category === "boots");
  const boots = chooseBoots(tpl, threat, squishy, playerPickedBoots);
  if (!aiHasBoots) push(itemById(boots.id), boots.reason, "boots");
  const [firstCore, ...restCore] = tpl.core;
  if (firstCore) push(itemById(firstCore), tpl.coreWhy, "core");
  for (const p of picks.filter((p) => p.score >= URGENT)) push(p.item, p.reason, "situational", p.score);
  for (const id of restCore) push(itemById(id), tpl.coreWhy, "core");
  for (const p of picks.filter((p) => p.score < URGENT)) push(p.item, p.reason, "situational", p.score);
  for (const id of tpl.filler) push(itemById(id), squishy ? "More damage." : "Rounds out your build.", "damage");

  // Reconcile with what the player actually owns: items they confirmed, plus icon reads that fit their spending.
  const confirmed = input.owned.filter((id) => !id.startsWith("comp:"));
  const seenFinished = (input.seenItems ?? []).filter((id) => !id.startsWith("comp:") && itemById(id));
  const seenFits = input.spent === undefined || [...new Set([...confirmed, ...seenFinished])].reduce((sum, id) => sum + price(itemById(id)?.cost ?? 0), 0) <= input.spent + 150;
  let ownedFull = seenFits ? [...new Set([...confirmed, ...seenFinished])] : confirmed;
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
  type Entry = (typeof ordered)[number];
  const entryFor = (item: Item, reason: string): Entry => planned.find((o) => o.item.id === item.id) ?? { item, reason, kind: "core", score: 0, defensive: isDefensive(item) };

  // Spending tells us how far along the build is, even when the icons could not be read:
  // gold left after the known items pays for the next items in the order the player is most
  // likely buying them, and any remainder is progress toward the one after.
  //
  // That order is: an item they visibly hold pieces of; then their own in-game list (it is what
  // the game's quick-buy button offers them); then this plan. A counter the coach merely
  // suggested is never assumed bought — only a read of the inventory or a tap confirms it.
  const paidToward = new Map<string, number>();
  const assumed: Entry[] = [];
  let started: Entry | undefined;
  if (input.spent !== undefined) {
    let budget = input.spent - have.reduce((sum, o) => sum + price(o.item.cost), 0);
    const partial = input.partial ? itemById(input.partial) : undefined;
    const inGame = (input.plannedBuild ?? []).map(itemById).filter((i): i is Item => !!i);
    const expected: Entry[] = [];
    const expect = (e: Entry) => {
      if (ownedFull.includes(e.item.id) || expected.some((x) => x.item.id === e.item.id)) return;
      // Never assume a second pair of boots.
      if (e.item.category === "boots" && (ownedBoots || expected.some((x) => x.item.category === "boots"))) return;
      expected.push(e);
    };
    if (partial) expect(entryFor(partial, "You already hold pieces of it."));
    for (const item of inGame) expect(entryFor(item, FROM_YOUR_BUILD));
    for (const o of want) if (o.kind !== "situational") expect(o);
    for (const e of expected) {
      const cost = price(e.item.cost);
      if (budget + 60 >= cost) {
        ownedFull = [...ownedFull, e.item.id];
        assumed.push(e);
        budget -= cost;
      } else {
        if (budget >= 100) {
          paidToward.set(e.item.id, Math.round(budget));
          started = e;
        }
        break;
      }
    }
  }
  const settled = [...have, ...assumed];
  // An item already paid toward is finished first: its pieces are sitting in the inventory.
  const pending = [...(started ? [started] : []), ...want.filter((o) => !ownedFull.includes(o.item.id) && o.item.id !== started?.item.id)];
  const fitted = [...settled, ...pending].slice(0, SLOTS);
  const slots: BuildSlot[] = fitted.map((o) => ({
    item: o.item,
    reason: o.reason,
    kind: o.kind,
    owned: ownedFull.includes(o.item.id),
    price: price(o.item.cost),
    paid: paidToward.get(o.item.id),
    urgent: o.kind === "situational" && o.score >= URGENT,
  }));
  const fittedIds = new Set(fitted.map((o) => o.item.id));
  const overflow: Pick[] = pending.filter((o) => !fittedIds.has(o.item.id) && o.kind === "situational");

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
    next: nextStep(slots, overflow, input, squishy),
    spell,
    emblem: tpl.emblem,
    bootsNote: bootsNote(lane),
    threat,
  };
}

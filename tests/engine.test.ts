import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { StillnessDetector } from "../src/capture/stillness";
import { HERO_CORE, TEMPLATES, templateFor } from "../src/data/builds";
import { findHero, HEROES } from "../src/data/heroes";
import { componentId, findItem, itemById, itemIcon, ITEMS } from "../src/data/items";
import { eventsBetween } from "../src/data/timeline";
import { planBuild } from "../src/engine/build";
import { buyAdvice, fedAdvice, SpokenLog } from "../src/engine/coach";
import { rankCounters } from "../src/engine/draft";
import { coachReply } from "../src/engine/reply";
import { matchStory } from "../src/engine/story";
import { analyzeThreat } from "../src/engine/threat";
import { briefOn, gamePlan, guessLaneOpponent, skillsOf } from "../src/engine/tips";
import { coachBrief, COACH_SYSTEM, demoCoach, normalizeCoach } from "../src/ai/coach";
import { normalizePosition, positionBrief } from "../src/ai/position";
import { believableItems, buildInputs, EMPTY_SESSION, fitOwnItems, freshSession, orientObservation, sessionReducer, stageOf, type Session } from "../src/state/session";
import type { Observation, PlayerState } from "../src/types";
import { normalizeObservation, parseGameTime, unscramble } from "../src/vision/schema";

const H = (name: string) => {
  const hero = HEROES.find((h) => h.name === name);
  if (!hero) throw new Error(`no hero ${name}`);
  return hero;
};
const team = (...names: string[]): PlayerState[] => names.map((n) => ({ heroId: H(n).id }));
const ids = (...names: string[]) => names.map((n) => H(n).id);
const HEALERS = ["Estes", "Uranus", "Gusion", "Karrie", "Esmeralda"];
const slotIds = (p: ReturnType<typeof planBuild>) => p.slots.map((s) => s.item.id);

describe("catalog integrity", () => {
  it("every item id referenced by templates and the planner exists", () => {
    // A typo or a removed item would otherwise be dropped silently from builds.
    const missing = new Set<string>();
    for (const file of ["src/data/builds.ts", "src/engine/build.ts"]) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/"([a-z]+(?:_[a-z]+)+)"/g)) {
        if (!itemById(m[1]!)) missing.add(`${file}: ${m[1]}`);
      }
    }
    expect([...missing]).toEqual([]);
    for (const tpl of Object.values(TEMPLATES)) expect(itemById(tpl.boots)?.category).toBe("boots");
    for (const [name, o] of Object.entries(HERO_CORE)) {
      expect(HEROES.some((h) => h.name === name), name).toBe(true);
      for (const id of [...(o.core ?? []), ...(o.filler ?? [])]) expect(itemById(id), id).toBeDefined();
    }
  });

  it("has a picture for every item and every component", () => {
    for (const item of ITEMS) {
      expect(itemIcon(item.id), item.name).toBeDefined();
      if (item.component) expect(itemIcon(componentId(item.component.name)), item.component.name).toBeDefined();
    }
  });

  it("has unique item ids and resolves names, aliases and components", () => {
    expect(new Set(ITEMS.map((i) => i.id)).size).toBe(ITEMS.length);
    expect(findItem("Athena's Shield")?.id).toBe("valkyries_shield");
    expect(findItem("valkyries shield")?.id).toBe("valkyries_shield");
    expect(findItem("Haas's Claws")?.id).toBe("haas_claws");
    expect(findItem("Dreadnaught Armor")?.id).toBe(componentId("Dreadnaught Armor"));
    expect(findItem("Totally Made Up Sword")).toBeUndefined();
  });

  it("only anti-heal items carry anti-heal, and no component claims it", () => {
    expect(ITEMS.filter((i) => i.tags.includes("antiheal")).map((i) => i.id).sort()).toEqual(["dominance_ice", "glowing_wand", "sea_halberd"]);
    for (const item of ITEMS) expect(item.component?.effect ?? "").not.toMatch(/anti-?heal|healing/i);
  });
});

describe("hero data", () => {
  it("loads the synced roster with a build template for everyone", () => {
    expect(HEROES.length).toBeGreaterThan(120);
    for (const h of HEROES) {
      expect(h.roles.length, h.name).toBeGreaterThan(0);
      expect(templateFor(h, h.lanes[0]), h.name).toBeDefined();
    }
  });

  it("finds heroes from messy text but refuses wild guesses", () => {
    expect(findHero("chang'e")?.name).toBe("Chang'e");
    expect(findHero("X Borg")?.name).toBe("X.Borg");
    expect(findHero("YU ZHONG")?.name).toBe("Yu Zhong");
    expect(findHero("Esmeralsa")?.name).toBe("Esmeralda");
    expect(findHero("Popol")?.name).toBe("Popol and Kupa");
    expect(findHero("Zed")).toBeUndefined();
    expect(findHero("")).toBeUndefined();
  });
});

describe("threat analysis", () => {
  it("sees a heal-heavy, magic-leaning lineup", () => {
    const t = analyzeThreat(team(...HEALERS));
    expect(t.sustain).toBeGreaterThan(1.2);
    expect(t.magicShare).toBeGreaterThan(0.5);
    expect(t.who.sustain).toContain(H("Estes").id);
    expect(t.live).toBe(false);
  });

  it("re-weights toward a fed enemy", () => {
    const even = analyzeThreat(team(...HEALERS));
    const live = team(...HEALERS).map((p) =>
      p.heroId === H("Gusion").id ? { ...p, kills: 8, deaths: 0, gold: 6900 } : { ...p, kills: 1, deaths: 2, gold: 3000 },
    );
    const fed = analyzeThreat(live);
    expect(fed.sources[0]).toMatchObject({ heroId: H("Gusion").id, fed: true });
    expect(fed.magicShare).toBeGreaterThan(even.magicShare);
    expect(fed.live).toBe(true);
  });
});

describe("build planner", () => {
  it("gives every hero six distinct items with exactly one pair of boots", () => {
    for (const hero of HEROES) {
      const plan = planBuild({ hero, enemies: team(...HEALERS).filter((p) => p.heroId !== hero.id), owned: [] });
      const idsInPlan = slotIds(plan);
      expect(idsInPlan.length, hero.name).toBe(6);
      expect(new Set(idsInPlan).size, hero.name).toBe(6);
      expect(plan.slots.filter((s) => s.item.category === "boots").length, hero.name).toBe(1);
      expect(plan.spell.name, hero.name).toBeTruthy();
      expect(plan.next.action, hero.name).toBe("buy");
    }
  });

  it("adds anti-heal into healers, and the right kind for the hero", () => {
    expect(slotIds(planBuild({ hero: H("Layla"), enemies: team(...HEALERS), owned: [] }))).toContain("sea_halberd");
    // Ranged mages get Glowing Wand: Dominance Ice is a short-range aura.
    const mage = slotIds(planBuild({ hero: H("Eudora"), enemies: team(...HEALERS), owned: [] }));
    expect(mage).toContain("glowing_wand");
    expect(mage).not.toContain("dominance_ice");
    expect(slotIds(planBuild({ hero: H("Tigreal"), enemies: team(...HEALERS), owned: [] }))).toContain("dominance_ice");
    // No anti-heal against a lineup with no sustain.
    const none = slotIds(planBuild({ hero: H("Layla"), enemies: team("Layla", "Eudora", "Saber", "Franco", "Aurora").slice(1), owned: [] }));
    expect(none).not.toContain("sea_halberd");
  });

  it("adapts frontline defense to the enemy damage mix", () => {
    const vsPhys = planBuild({ hero: H("Tigreal"), enemies: team("Hayabusa", "Yu Zhong", "Chou", "Saber", "Lancelot"), owned: [] });
    expect(slotIds(vsPhys)[0]).toBe("warrior_boots");
    expect(slotIds(vsPhys)).toContain("antique_cuirass");
    expect(slotIds(vsPhys)).not.toContain("valkyries_shield");
    const vsMagic = planBuild({ hero: H("Tigreal"), enemies: team("Eudora", "Gusion", "Aurora", "Harley", "Kagura"), owned: [] });
    expect(slotIds(vsMagic)[0]).toBe("tough_boots");
    expect(slotIds(vsMagic).some((id) => id === "valkyries_shield" || id === "radiant_armor")).toBe(true);
    expect(slotIds(vsMagic)).not.toContain("antique_cuirass");
  });

  it("walks buy → component → finish as gold comes in", () => {
    const enemies = team("Hayabusa", "Yu Zhong", "Chou", "Saber", "Lancelot");
    const base = { hero: H("Tigreal"), enemies };
    const first = planBuild({ ...base, owned: ["warrior_boots"], gold: 300 });
    const target = first.next.item!;
    expect(target.id).toBe("antique_cuirass");
    expect(first.next.action).toBe("save");
    expect(first.next.goldNeeded).toBe(target.component!.cost - 300);

    const piece = planBuild({ ...base, owned: ["warrior_boots"], gold: 760 });
    expect(piece.next.action).toBe("buy-component");
    expect(piece.next.component?.name).toBe("Dreadnaught Armor");
    // The cheap piece is only called a counter because it really carries the effect.
    expect(piece.next.say).toContain("already weakens");

    const withPiece = ["warrior_boots", componentId("Dreadnaught Armor")];
    const remaining = target.cost - target.component!.cost;
    // One gold short of finishing, with gold in hand: buy more pieces rather than sit on it.
    expect(planBuild({ ...base, owned: withPiece, gold: remaining - 1 }).next.action).toBe("buy-pieces");
    expect(planBuild({ ...base, owned: withPiece, gold: 200 }).next.action).toBe("save");
    const finish = planBuild({ ...base, owned: withPiece, gold: remaining });
    expect(finish.next).toMatchObject({ action: "buy", say: "Finish Antique Cuirass now." });
  });

  it("does not claim a plain component counters anything", () => {
    const plan = planBuild({ hero: H("Layla"), enemies: team(...HEALERS), owned: ["swift_boots", "windtalker"], gold: 950 });
    expect(plan.next.item?.id).toBe("sea_halberd");
    expect(plan.next.action).toBe("buy-component");
    expect(plan.next.say).toBe("Buy Legion Sword now, the first piece of Sea Halberd.");
    expect(plan.next.detail).toMatch(/only works once the item is finished/);
  });

  it("buys an affordable counter piece instead of sitting on gold", () => {
    // The lesson from pro itemisation: a cheap counter now beats saving for a big item.
    const live = team(...HEALERS).map((p) =>
      p.heroId === H("Gusion").id ? { ...p, kills: 8, deaths: 0, gold: 6900 } : { ...p, kills: 1, deaths: 2, gold: 3000 },
    );
    const plan = planBuild({ hero: H("Layla"), enemies: live, owned: ["swift_boots"], gold: 1450 });
    expect(plan.slots.find((s) => !s.owned)?.item.id).toBe("windtalker"); // still the next core item…
    expect(plan.next).toMatchObject({ action: "buy-component", component: { name: "Magic Blade" } }); // …but 1450g buys the shield piece now
    expect(plan.next.item?.id).toBe("rose_gold_meteor");
    // Same lineup, same gold, nobody fed: the assassin is only a nice-to-have counter,
    // so the plan still contains the defensive item but does not delay the first damage item for it.
    const unfed = planBuild({ hero: H("Layla"), enemies: team(...HEALERS), owned: ["swift_boots"], gold: 1450 });
    expect(slotIds(unfed)).toContain("rose_gold_meteor");
    expect(unfed.next).toMatchObject({ action: "buy-pieces", item: { id: "windtalker" } });
    const calm = planBuild({ hero: H("Layla"), enemies: team("Tigreal", "Franco"), owned: ["swift_boots"], gold: 1450 });
    expect(calm.next).toMatchObject({ action: "buy-pieces", item: { id: "windtalker" } });
  });

  it("moves a defensive answer up when an enemy gets fed", () => {
    const live = team(...HEALERS).map((p) =>
      p.heroId === H("Gusion").id ? { ...p, kills: 8, deaths: 0, gold: 6900 } : { ...p, kills: 1, deaths: 2, gold: 3000 },
    );
    const calm = slotIds(planBuild({ hero: H("Layla"), enemies: team(...HEALERS), owned: [] }));
    const fed = slotIds(planBuild({ hero: H("Layla"), enemies: live, owned: [] }));
    expect(fed.indexOf("rose_gold_meteor")).toBeGreaterThan(0);
    expect(fed.indexOf("rose_gold_meteor")).toBeLessThan(fed.indexOf("berserkers_fury"));
    expect(calm.indexOf("rose_gold_meteor")).toBeGreaterThan(calm.indexOf("berserkers_fury"));
  });

  it("respects what is already owned", () => {
    // Never a second pair of boots.
    const boots = slotIds(planBuild({ hero: H("Layla"), enemies: team(...HEALERS), owned: ["tough_boots"] }));
    expect(boots).toContain("tough_boots");
    expect(boots).not.toContain("swift_boots");
    // Off-plan purchases keep their slot.
    const off = planBuild({ hero: H("Layla"), enemies: team(...HEALERS), owned: ["swift_boots", "golden_staff"] });
    expect(off.slots.filter((s) => s.owned).map((s) => s.item.id)).toEqual(["swift_boots", "golden_staff"]);
    expect(off.slots.length).toBe(6);
  });

  it("suggests a sell-swap only with a full inventory and a real problem", () => {
    const owned = ["swift_boots", "windtalker", "berserkers_fury", "haas_claws", "blade_of_despair", "golden_staff"];
    const live = team(...HEALERS).map((p) =>
      p.heroId === H("Gusion").id ? { ...p, kills: 9, deaths: 0, gold: 9000 } : { ...p, kills: 1, deaths: 2, gold: 3000 },
    );
    const swap = planBuild({ hero: H("Layla"), enemies: live, owned, gold: 3000, gameTimeSec: 16 * 60 });
    expect(swap.next.action).toBe("sell-swap");
    expect(swap.next.sell?.id).toBe("golden_staff");
    expect(swap.next.item?.tags).toContain("antiBurst");
    // Same inventory, nothing threatening: leave it alone.
    const calm = planBuild({ hero: H("Layla"), enemies: team("Tigreal", "Franco", "Lolita", "Hylos", "Belerick").slice(0, 2), owned, gold: 3000 });
    expect(calm.next.action).toBe("done");
  });

  it("picks the battle spell from lane and lineup", () => {
    expect(planBuild({ hero: H("Hayabusa"), lane: "jungle", enemies: team(...HEALERS), owned: [] }).spell.name).toBe("Retribution");
    expect(planBuild({ hero: H("Eudora"), enemies: team("Tigreal", "Atlas", "Franco", "Aurora", "Chou"), owned: [] }).spell.name).toBe("Purify");
    expect(planBuild({ hero: H("Tigreal"), enemies: team("Layla", "Miya", "Hanabi", "Zilong", "Sun"), owned: [] }).spell.name).toBe("Vengeance");
  });
});

describe("draft", () => {
  it("ranks measured counters and honours lane and taken heroes", () => {
    const picks = rankCounters({ enemies: ids("Esmeralda"), allies: [], lane: "gold", limit: 6 });
    expect(picks.map((p) => p.hero.name)).toContain("Karrie");
    expect(picks.every((p) => p.hero.lanes.includes("gold"))).toBe(true);
    expect(picks[0]!.score).toBeGreaterThan(picks.at(-1)!.score);
    const without = rankCounters({ enemies: ids("Esmeralda"), allies: [], banned: ids("Karrie"), lane: "gold", limit: 20 });
    expect(without.map((p) => p.hero.name)).not.toContain("Karrie");
    expect(without.map((p) => p.hero.name)).not.toContain("Esmeralda");
  });
});

describe("still-screen detector", () => {
  const frame = (v: number) => new Uint8Array(100).fill(v);
  const noisy = (seed: number) => Uint8Array.from({ length: 100 }, (_, i) => (i * 37 + seed * 91) % 256);

  it("ignores gameplay, fires once per new still screen", () => {
    const d = new StillnessDetector({ stillThreshold: 3, stableSamples: 2, changeThreshold: 8, minIntervalMs: 5000 });
    let t = 0;
    for (let i = 0; i < 6; i++) expect(d.push(noisy(i), (t += 700)).fire).toBe(false); // moving
    expect(d.push(frame(40), (t += 700)).fire).toBe(false); // panel just opened
    expect(d.push(frame(40), (t += 700)).fire).toBe(false); // one still sample
    expect(d.push(frame(40), (t += 700)).fire).toBe(true); // settled → read it
    for (let i = 0; i < 10; i++) expect(d.push(frame(40), (t += 700)).fire).toBe(false); // same panel: no repeat
    for (let i = 0; i < 3; i++) d.push(noisy(i + 20), (t += 700)); // back to gameplay
    d.push(frame(200), (t += 700));
    d.push(frame(200), (t += 700));
    expect(d.push(frame(200), (t += 700)).fire).toBe(true); // a different panel
  });

  it("rate-limits back-to-back reads", () => {
    const d = new StillnessDetector({ stillThreshold: 3, stableSamples: 1, changeThreshold: 8, minIntervalMs: 5000 });
    d.push(frame(10), 0);
    expect(d.push(frame(10), 100).fire).toBe(true);
    d.push(frame(120), 200);
    expect(d.push(frame(120), 300).fire).toBe(false); // new screen but too soon
    expect(d.push(frame(120), 5200).fire).toBe(true);
  });
});

describe("vision output handling", () => {
  const row = (hero: string, extra: Record<string, unknown> = {}) => ({ hero, isMe: false, kills: -1, deaths: -1, assists: -1, gold: -1, level: -1, items: [], ...extra });

  it("normalises names, numbers and items and reports what it could not place", () => {
    const obs = normalizeObservation({
      screen: "scoreboard",
      gameTime: "07:35",
      myGold: 1420,
      allies: [row("layla", { isMe: true, kills: 3, deaths: 1, assists: 2, gold: 4100, items: ["Swift Boots", "Windtalker", "Dreadnaught Armor", "Mystery Blade"] }), row("Tigreal")],
      enemies: [row("Gusion", { kills: 6, deaths: 0, items: ["Athena's Shield"] }), row("Not A Hero"), row("")],
      tip: "Gusion is ahead.",
    });
    expect(obs.screen).toBe("scoreboard");
    expect(obs.gameTimeSec).toBe(455);
    expect(obs.myGold).toBe(1420);
    expect(obs.meHeroId).toBe(H("Layla").id);
    expect(obs.allies[0]).toMatchObject({ heroId: H("Layla").id, kills: 3, gold: 4100, items: ["swift_boots", "windtalker", componentId("Dreadnaught Armor")] });
    expect(obs.allies[1]!.kills).toBeUndefined();
    expect(obs.enemies).toHaveLength(1);
    expect(obs.enemies[0]!.items).toEqual(["valkyries_shield"]);
    expect(obs.unknown).toEqual(expect.arrayContaining(["Mystery Blade", "Not A Hero"]));
  });

  it("flips the teams when the highlighted row was filed under enemies", () => {
    const obs = normalizeObservation({ screen: "scoreboard", gameTime: "", myGold: -1, allies: [row("Gusion")], enemies: [row("Layla", { isMe: true })], tip: "" });
    expect(obs.allies.map((p) => p.heroId)).toEqual([H("Layla").id]);
    expect(obs.enemies.map((p) => p.heroId)).toEqual([H("Gusion").id]);
    expect(obs.meHeroId).toBe(H("Layla").id);
  });

  it("survives garbage", () => {
    expect(normalizeObservation(null)).toMatchObject({ screen: "other", allies: [], enemies: [] });
    expect(normalizeObservation({ screen: "nonsense", allies: "x", enemies: [null, 5] }).screen).toBe("other");
    expect(parseGameTime("12:05")).toBe(725);
    expect(parseGameTime("soon")).toBeUndefined();
    expect(parseGameTime("")).toBeUndefined();
  });
});

describe("session state", () => {
  const obsOf = (screen: Observation["screen"], allies: PlayerState[], enemies: PlayerState[], extra: Partial<Observation> = {}): Observation => ({ screen, allies, enemies, unknown: [], ...extra });
  const base: Session = { ...EMPTY_SESSION, myHeroId: H("Layla").id, allies: ids("Tigreal", "Eudora"), enemies: ids("Gusion", "Karrie", "Estes") };

  it("corrects a read that has the teams the wrong way round", () => {
    const flipped = obsOf("scoreboard", team("Gusion", "Karrie"), team("Layla", "Tigreal"));
    const fixed = orientObservation(flipped, base);
    expect(fixed.enemies.map((p) => p.heroId)).toEqual(ids("Gusion", "Karrie"));
    expect(fixed.allies.map((p) => p.heroId)).toEqual(ids("Layla", "Tigreal"));
    // Works from the known roster alone when the user's hero is not in the read.
    const noMe = orientObservation(obsOf("scoreboard", team("Gusion", "Estes"), team("Tigreal", "Eudora")), { ...base, myHeroId: undefined });
    expect(noMe.enemies.map((p) => p.heroId)).toEqual(ids("Gusion", "Estes"));
    // And leaves a correct read alone.
    const ok = obsOf("scoreboard", team("Layla"), team("Gusion"));
    expect(orientObservation(ok, base)).toBe(ok);
  });

  it("reads a scoreboard: live stats, owned items, gold and clock", () => {
    const mine: PlayerState = { heroId: H("Layla").id, items: ["swift_boots", "windtalker"] };
    const obs = obsOf("scoreboard", [mine], [{ heroId: H("Gusion").id, kills: 7, deaths: 0, gold: 6000 }], { myGold: 800, gameTimeSec: 300 });
    const s = sessionReducer({ ...base, owned: ["swift_boots", "sea_halberd"] }, { type: "observe", obs, now: 1_000_000 });
    expect(s.phase).toBe("live");
    expect(s.enemyLive[H("Gusion").id]).toMatchObject({ kills: 7 });
    // Icons are never written into the confirmed inventory; they are kept apart as "seen".
    expect(s.owned.sort()).toEqual(["sea_halberd", "swift_boots"]);
    expect(s.seenItems).toEqual(["swift_boots", "windtalker"]);
    expect(s.gold).toBe(800);
    expect(s.clockStart).toBe(1_000_000 - 300_000);
    expect(s.calls).toBe(1);
  });

  it("does not wipe the match when a mid-game screen is misread as loading", () => {
    const playing: Session = { ...base, phase: "live", clockStart: 0, owned: ["swift_boots", "windtalker"], matchId: 3 };
    const sameHeroes = obsOf("loading", team("Layla", "Tigreal", "Eudora"), team("Gusion", "Karrie", "Estes"));
    const s = sessionReducer(playing, { type: "observe", obs: sameHeroes, now: 10 * 60_000 });
    expect(s.matchId).toBe(3);
    expect(s.owned).toEqual(["swift_boots", "windtalker"]);
    expect(s.phase).toBe("live");
  });

  it("starts clean when the next match's loading screen appears", () => {
    const playing: Session = { ...base, phase: "live", clockStart: 0, owned: ["swift_boots", "windtalker", "berserkers_fury"], gold: 900, matchId: 3, enemyLive: { [H("Gusion").id]: { heroId: H("Gusion").id, kills: 9 } } };
    const loading = obsOf("loading", team("Miya", "Franco", "Aurora", "Saber", "Chou"), team("Zilong", "Nana", "Hanabi", "Atlas", "Fanny"), { meHeroId: H("Miya").id });
    const s = sessionReducer(playing, { type: "observe", obs: loading, now: 20 * 60_000 });
    expect(s.matchId).toBe(4);
    expect(s.owned).toEqual([]);
    expect(s.gold).toBeUndefined();
    expect(s.enemyLive).toEqual({});
    expect(s.myHeroId).toBe(H("Miya").id);
    expect(s.enemies).toEqual(ids("Zilong", "Nana", "Hanabi", "Atlas", "Fanny"));
    expect(s.allies).toEqual(ids("Franco", "Aurora", "Saber", "Chou"));
    expect(s.phase).toBe("draft");
  });

  it("treats a scoreboard full of different heroes as a new match", () => {
    const yesterday: Session = { ...base, phase: "live", clockStart: 0, owned: ["swift_boots", "windtalker"], matchId: 7 };
    const board = obsOf(
      "scoreboard",
      [{ heroId: H("Miya").id, items: ["swift_boots"] }, ...team("Franco", "Aurora")],
      team("Zilong", "Nana", "Hanabi"),
      { meHeroId: H("Miya").id, gameTimeSec: 120 },
    );
    const s = sessionReducer(yesterday, { type: "observe", obs: board, now: 5_000_000 });
    expect(s.matchId).toBe(8);
    expect(s.myHeroId).toBe(H("Miya").id);
    expect(s.enemies).toEqual(ids("Zilong", "Nana", "Hanabi"));
    expect(s.owned).toEqual([]); // last game's inventory is gone
    expect(s.seenItems).toEqual(["swift_boots"]); // this game's items, as seen
    expect(s.phase).toBe("live");
    // A scoreboard that merely misreads a couple of portraits is not a new match.
    const noisy = obsOf("scoreboard", team("Layla", "Tigreal", "Eudora"), team("Gusion", "Karrie", "Nana"));
    expect(sessionReducer(yesterday, { type: "observe", obs: noisy, now: 5_000_000 }).matchId).toBe(7);
  });

  it("drops a restored match that is hours old but keeps one in progress", () => {
    const live: Session = { ...base, phase: "live", clockStart: 1_000_000, owned: ["swift_boots"], lane: "gold", matchId: 2 };
    expect(freshSession(live, 1_000_000 + 20 * 60_000)).toBe(live);
    const stale = freshSession(live, 1_000_000 + 3 * 60 * 60_000);
    expect(stale).toMatchObject({ phase: "draft", owned: [], enemies: [], lane: "gold", matchId: 3 });
    expect(stale.myHeroId).toBeUndefined();
    // A draft being prepared is never discarded.
    const draft: Session = { ...base, phase: "draft" };
    expect(freshSession(draft, 9e12)).toBe(draft);
  });

  it("follows the stage buttons: new match, loading, in match, paused", () => {
    const old: Session = { ...base, phase: "live", clockStart: 5, owned: ["swift_boots"], gold: 900, matchId: 4, lane: "gold" };
    const draft = sessionReducer(old, { type: "setStage", stage: "draft", now: 100 });
    // "Hero selection" is the reliable new-match signal: last game's hero, items and enemies are gone.
    expect(draft).toMatchObject({ stage: "draft", phase: "draft", owned: [], enemies: [], lane: "gold", matchId: 5 });
    expect(draft.myHeroId).toBeUndefined();
    const picked: Session = { ...draft, myHeroId: H("Layla").id, enemies: ids("Gusion") };
    const loading = sessionReducer(picked, { type: "setStage", stage: "loading", now: 200 });
    expect(loading).toMatchObject({ stage: "loading", phase: "draft", myHeroId: H("Layla").id });
    const live = sessionReducer(loading, { type: "setStage", stage: "live", now: 300 });
    expect(live).toMatchObject({ stage: "live", phase: "live", clockStart: 300, matchId: 5 });
    // Tapping "In match" again must not restart the clock.
    expect(sessionReducer(live, { type: "setStage", stage: "live", now: 999 }).clockStart).toBe(300);
    expect(stageOf(sessionReducer(live, { type: "setStage", stage: "done", now: 400 }))).toBe("done");
    // Screenshots move the stage on their own.
    const seen = sessionReducer(picked, { type: "observe", obs: obsOf("scoreboard", team("Layla"), team("Gusion")), now: 500 });
    expect(stageOf(seen)).toBe("live");
    expect(stageOf(EMPTY_SESSION)).toBe("draft");
  });

  it("adopts a match computed on the server but keeps this device's log", () => {
    const mine: Session = { ...EMPTY_SESSION, log: [{ at: 1, kind: "say", text: "hello" }] };
    const remote: Session = { ...base, phase: "live", gold: 700, matchId: 9, log: [] };
    const s = sessionReducer(mine, { type: "adopt", session: remote });
    expect(s).toMatchObject({ phase: "live", gold: 700, matchId: 9, myHeroId: H("Layla").id });
    expect(s.log).toEqual(mine.log);
  });

  it("handles buying, finishing from a component, and sell-swaps", () => {
    let s: Session = { ...base, gold: 2000 };
    s = sessionReducer(s, { type: "bought", id: componentId("Dreadnaught Armor") });
    expect(s.gold).toBe(2000 - 730);
    s = sessionReducer(s, { type: "bought", id: "antique_cuirass" });
    expect(s.owned).toEqual(["antique_cuirass"]); // component folded into the finished item
    expect(s.gold).toBe(0);
    s = sessionReducer({ ...s, gold: 1000, owned: ["golden_staff"] }, { type: "swap", sell: "golden_staff", buy: "rose_gold_meteor" });
    expect(s.owned).toEqual(["rose_gold_meteor"]);
    expect(s.gold).toBe(1000 + 1200 - 2030);
  });
});

/**
 * Hand transcriptions of the player's own screenshots (a match as Obsidia vs
 * five bots), written the way the vision model is asked to answer. They pin
 * down how real screens flow through the app; they do not test the model itself.
 */
describe("a real match, from the player's screenshots", () => {
  const row = (hero: string, k: number, d: number, a: number, gold: number, items: string[] = [], isMe = false) => ({ hero, isMe, kills: k, deaths: d, assists: a, gold, level: -1, items });
  const scoreboard = (time: string, myGold: number, mine: ReturnType<typeof row>, enemyGold: number[]) => ({
    screen: "scoreboard",
    gameTime: time,
    myGold,
    allies: [mine, row("Freya", 0, 0, 1, 1092), row("Xavier", 0, 0, 0, 1329), row("Uranus", 1, 0, 0, 1111), row("Franco", 0, 0, 0, 695)],
    enemies: ["Angela", "Minotaur", "Rafaela", "Akai", "Bane"].map((h, i) => row(h, 0, i ? 1 : 0, 0, enemyGold[i]!)),
    myItems: mine.items,
    recommended: [],
    spare: [],
    tip: "",
  });
  const SHOP = {
    screen: "shop",
    gameTime: "02:10",
    myGold: 1209,
    allies: [],
    enemies: [],
    myItems: ["Boots"],
    recommended: [
      { name: "Warrior Boots", price: 446 },
      { name: "Windtalker", price: 1786 },
      { name: "Haas' Claws", price: 1919 },
      { name: "Sky Piercer", price: 1425 },
      { name: "Berserker's Fury", price: 2270 },
      { name: "Malefic Gun", price: 2014 },
    ],
    spare: [
      { name: "Rose Gold Meteor", price: 1928 },
      { name: "Wind of Nature", price: 1814 },
    ],
    tip: "",
  };
  const observe = (s: Session, raw: unknown, now = 1_000_000) => sessionReducer(s, { type: "observe", obs: normalizeObservation(raw), now });
  const plan = (s: Session) => planBuild({ hero: HEROES.find((h) => h.id === s.myHeroId)!, gold: s.gold, ...buildInputs(s) });

  it("reads both teams, the player's hero and spendable gold from one scoreboard", () => {
    const s = observe(EMPTY_SESSION, scoreboard("00:03", 300, row("Obsidia", 0, 0, 0, 300, [], true), [300, 300, 300, 300, 300]));
    expect(s.myHeroId).toBe(H("Obsidia").id);
    expect(s.enemies).toEqual(ids("Angela", "Minotaur", "Rafaela", "Akai", "Bane"));
    expect(s.allies).toEqual(ids("Freya", "Xavier", "Uranus", "Franco"));
    expect(s.gold).toBe(300); // top-right figure, not the row total
    expect(s.phase).toBe("live");
    // 300 gold at the fountain: plain Boots, not "save up".
    const first = plan(s).next;
    expect(first).toMatchObject({ action: "buy-component", component: { name: "Boots" } });
  });

  it("adopts the build from the player's shop, at the shop's real prices", () => {
    let s = observe(EMPTY_SESSION, scoreboard("01:49", 1143, row("Obsidia", 3, 0, 0, 1380, ["Boots"], true), [753, 751, 765, 795, 615]));
    // Spending comes from two printed numbers: 1380 earned, 1143 in pocket.
    expect(s.spent).toBe(237);
    expect(s.seenItems).toEqual([componentId("Boots")]); // the icon read fits the spending, so it is believed
    s = observe(s, SHOP);
    expect(s.plannedBuild).toEqual(["warrior_boots", "windtalker", "haas_claws", "sky_piercer", "berserkers_fury", "malefic_gun"]);
    expect(s.priceFactor).toBe(0.95); // Bargain Hunter: every listed price is 95% of list
    expect(s.gold).toBe(1209);
    const p = plan(s);
    // Their boots and their first two items lead; counters for this enemy team are layered in.
    expect(slotIds(p).slice(0, 2)).toEqual(["warrior_boots", "windtalker"]);
    expect(slotIds(p)).toContain("haas_claws");
    expect(slotIds(p)).toContain("sea_halberd"); // Angela, Rafaela and Minotaur all heal
    expect(slotIds(p)).not.toContain("corrosion_scythe"); // not the generic template
    // Prices match the shop: Warrior Boots 446 with Boots owned, Windtalker 1786.
    expect(p.slots.find((x) => x.item.id === "windtalker")!.price).toBe(1786);
    expect(p.next).toMatchObject({ action: "buy", item: { id: "warrior_boots" }, say: "Finish Warrior Boots now." });
    expect(p.slots[0]).toMatchObject({ owned: false, paid: 237 }); // the Boots already bought count toward it
    expect(p.next.where).toBeUndefined(); // it is in their own Recommended list
    // After boots, 1209 - 446 = 763 gold: not enough for Windtalker (1786).
    s = sessionReducer(s, { type: "bought", id: "warrior_boots" });
    expect(s.gold).toBe(1209 - 446);
    // 763 gold in hand: buy pieces of it now rather than carry the gold.
    expect(plan(s).next).toMatchObject({ action: "buy-pieces", item: { id: "windtalker" }, goldNeeded: 1786 - 763 });
    expect(plan(s).next.say).toBe("Buy pieces of Windtalker now. 1023 more gold finishes it.");
  });

  it("lets the scoreboard's printed names overrule guesses made during hero selection", () => {
    // Draft slots are bare portraits: suppose the read got the player's hero and two enemies wrong.
    const draft = { screen: "draft", gameTime: "", myGold: -1, allies: [row("Angela", -1, -1, -1, -1, [], true), row("Layla", -1, -1, -1, -1)], enemies: [row("Gusion", -1, -1, -1, -1), row("Karrie", -1, -1, -1, -1), row("Estes", -1, -1, -1, -1)], myItems: [], recommended: [], spare: [], tip: "" };
    let s = observe(EMPTY_SESSION, draft);
    expect(s.myHeroId).toBe(H("Angela").id); // wrong, and Angela is really an enemy
    s = observe(s, scoreboard("01:49", 1143, row("Obsidia", 3, 0, 0, 1380, ["Boots"], true), [753, 751, 765, 795, 615]));
    expect(s.myHeroId).toBe(H("Obsidia").id);
    expect(s.enemies).toEqual(ids("Angela", "Minotaur", "Rafaela", "Akai", "Bane"));
    expect(s.allies).toEqual(ids("Freya", "Xavier", "Uranus", "Franco"));
    expect(s.gold).toBe(1143);
    // A mid-match frame mistaken for the draft screen (same heroes) changes nothing.
    const again = observe(s, { ...draft, allies: [row("Obsidia", -1, -1, -1, -1, [], true)], enemies: [row("Angela", -1, -1, -1, -1), row("Minotaur", -1, -1, -1, -1)] });
    expect(again.enemies).toEqual(s.enemies);
    expect(again.myHeroId).toBe(H("Obsidia").id);
    expect(again.owned).toEqual(s.owned);
    expect(again.matchId).toBe(s.matchId);
  });

  it("answers the iPad shortcut with a banner, a spoken line and a picture", () => {
    const origin = "https://coach.example";
    const board = normalizeObservation(scoreboard("01:49", 1143, row("Obsidia", 3, 0, 0, 1380, ["Boots"], true), [753, 751, 765, 795, 615]));
    let s = sessionReducer(EMPTY_SESSION, { type: "observe", obs: board, now: 1 });
    const first = coachReply(s, board, new Set(), origin);
    // Scoreboard alone is enough: hero, enemies, gold and inventory all come from it.
    expect(first.title).toBe("Finish Swift Boots now.");
    expect(first.icon).toBe(`${origin}/items/swift_boots.webp`);
    expect(first.body).toMatch(/You have 1143 gold/);
    // After the shop read, it follows the player's own build instead.
    const shop = normalizeObservation(SHOP);
    s = sessionReducer(s, { type: "observe", obs: shop, now: 2 });
    const second = coachReply(s, shop, new Set(), origin);
    expect(second.title).toBe("Finish Warrior Boots now.");
    expect(second.icon).toBe(`${origin}/items/warrior_boots.webp`);
    expect(second.say).toBe("Finish Warrior Boots now. From the build you chose in game.");
  });

  it("asks for the scoreboard when it cannot tell who the player is", () => {
    const shop = normalizeObservation(SHOP);
    const s = sessionReducer(EMPTY_SESSION, { type: "observe", obs: shop, now: 1 });
    const reply = coachReply(s, shop, new Set(), "https://coach.example");
    expect(reply.title).toBe("Can't see your hero yet");
    expect(reply.say).toMatch(/Open the scoreboard/);
    expect(reply.icon).toBeUndefined();
  });

  it("does not call a two-kill lead at three minutes 'fed'", () => {
    const early = team("Gusion", "Karrie", "Estes").map((p, i) => (i === 0 ? { ...p, kills: 2, deaths: 0, gold: 1900 } : { ...p, kills: 0, deaths: 0, gold: 1450 }));
    expect(analyzeThreat(early).sources.some((x) => x.fed)).toBe(false);
  });

  it("says which shop tab holds an item that is not in the player's list", () => {
    let s = observe(EMPTY_SESSION, scoreboard("01:49", 1143, row("Obsidia", 3, 0, 0, 1380, ["Boots"], true), [753, 751, 765, 795, 615]));
    s = observe(s, SHOP);
    s = { ...s, owned: ["warrior_boots", "windtalker"], gold: 2500 };
    const next = plan(s).next;
    expect(next.item?.id).toBe("sea_halberd");
    expect(next.where).toBe("It's under the Attack tab.");
    expect(buyAdvice(plan(s)).say).toMatch(/^Buy Sea Halberd now\. Anti-heal.*It's under the Attack tab\.$/);
  });
});

/**
 * From a real match the player ran through the coach: hero names, scores and
 * gold were read correctly, but the item icons were not — a hero with 3,619 gold
 * was credited with roughly 10,000 gold of items. These pin down the defences.
 */
describe("misread item icons", () => {
  it("rejects item lists nobody could afford, doubles and second boots", () => {
    // Read for an enemy with 3,619 gold: about 10,000 gold of items, including Arcane Boots twice.
    expect(believableItems(["warrior_boots", "blade_of_despair", "arcane_boots", "arcane_boots", "haas_claws", "glowing_wand"], 3619)).toBe(false);
    expect(believableItems(["blade_of_despair", "demon_hunter_sword", "haas_claws", "haas_claws"], 3242)).toBe(false);
    expect(believableItems(["warrior_boots", "demon_hunter_sword"], 2300)).toBe(false); // 2,900 gold of items on 2,300
    expect(believableItems(["warrior_boots", "demon_hunter_sword"], 2718)).toBe(true); // close enough: discounts and timing allow a little slack
    expect(believableItems(["rapid_boots", "warrior_boots"], 9000)).toBe(false);
    // Plausible lists pass, and with no gold figure there is nothing to judge by.
    expect(believableItems(["warrior_boots", componentId("Legion Sword")], 2000)).toBe(true);
    expect(believableItems(["warrior_boots", "windtalker"], undefined)).toBe(true);
    expect(believableItems(undefined, 100)).toBe(true);
  });

  it("keeps the numbers but drops unbelievable items from the live stats", () => {
    const obs = normalizeObservation({
      screen: "scoreboard", gameTime: "05:23", myGold: 32,
      allies: [{ hero: "Clint", isMe: true, kills: 0, deaths: 0, assists: 1, gold: 2109, level: -1, items: ["Warrior Boots", "Blade of Despair", "Windtalker", "Haas' Claws"] }],
      enemies: [{ hero: "Freya", isMe: false, kills: 5, deaths: 0, assists: 2, gold: 3619, level: -1, items: ["Warrior Boots", "Blade of Despair", "Arcane Boots", "Arcane Boots", "Haas' Claws", "Glowing Wand"] }],
      myItems: [], recommended: [], spare: [], tip: "",
    });
    const s = sessionReducer(EMPTY_SESSION, { type: "observe", obs, now: 1_000_000 });
    expect(s.enemyLive[H("Freya").id]).toMatchObject({ kills: 5, gold: 3619, items: undefined });
    expect(s.spent).toBe(2109 - 32);
    expect(s.owned).toEqual([]); // 7,630 gold of "items" on 2,077 spent: not believed
    expect(s.seenItems).toBeUndefined();
  });

  it("works out build progress from gold spent when the icons cannot be trusted", () => {
    // Clint, 2,077 gold spent, following the build read from his shop.
    const p = planBuild({ hero: H("Clint"), enemies: team("Brody", "Gatotkaca", "Alucard", "Freya", "Dyrroth"), owned: [], gold: 32, spent: 2077, plannedBuild: ["rapid_boots", "endless_battle", "malefic_gun", "blade_of_despair", "berserkers_fury", "great_dragon_spear"] });
    expect(p.slots[0]).toMatchObject({ item: { id: "rapid_boots" }, owned: true });
    expect(p.slots[1]).toMatchObject({ item: { id: "endless_battle" }, owned: false, paid: 2077 - 720 });
    expect(p.next).toMatchObject({ action: "save", item: { id: "endless_battle" }, goldNeeded: 2330 - 1357 - 32 });
    expect(p.next.say).toBe("Save 941 more gold to finish Endless Battle.");
    // The shop's own printed price beats the estimate when it is current.
    const quoted = planBuild({ hero: H("Clint"), enemies: [], owned: [], gold: 900, spent: 2077, plannedBuild: ["rapid_boots", "endless_battle", "malefic_gun"], shopPrices: { endless_battle: 880 } });
    expect(quoted.next).toMatchObject({ action: "buy", say: "Finish Endless Battle now." });
  });

  it("counts a drop in pocket gold between scoreboards as a purchase", () => {
    const base: Session = { ...EMPTY_SESSION, phase: "live", myHeroId: H("Clint").id, enemies: ids("Freya"), gold: 1500, spent: 800, clockStart: 0 };
    const play = (gold: number) => normalizeObservation({ screen: "gameplay", gameTime: "", myGold: gold, allies: [], enemies: [], myItems: [], recommended: [], spare: [], tip: "" });
    expect(sessionReducer(base, { type: "observe", obs: play(1620), now: 1 }).spent).toBe(800); // earned more, bought nothing
    expect(sessionReducer(base, { type: "observe", obs: play(300), now: 1 }).spent).toBe(800 + 1200); // spent 1,200
  });
});

describe("match clock", () => {
  const frame = (screen: string, time: string) => normalizeObservation({ screen, gameTime: time, myGold: 100, allies: [], enemies: [], myItems: [], recommended: [], spare: [], tip: "" });
  const live: Session = { ...EMPTY_SESSION, phase: "live", myHeroId: H("Clint").id, enemies: ids("Freya") };
  const clockAt = (s: Session, now: number) => Math.round((now - s.clockStart!) / 1000);

  it("takes the clock only from in-match screens", () => {
    // A hero-selection countdown ("00:38") is not the match clock.
    expect(sessionReducer(EMPTY_SESSION, { type: "observe", obs: frame("draft", "00:38"), now: 1000 }).clockStart).toBeUndefined();
    expect(sessionReducer(EMPTY_SESSION, { type: "observe", obs: frame("other", "12:00"), now: 1000 }).clockStart).toBeUndefined();
    const s = sessionReducer(live, { type: "observe", obs: frame("gameplay", "03:10"), now: 500_000 });
    expect(clockAt(s, 500_000)).toBe(190);
  });

  it("lets the first real reading replace a clock that was only a guess", () => {
    // "In match" tapped (or the clock guessed) three minutes late: the clock says 0:00.
    const guessed = sessionReducer({ ...live, phase: "draft" }, { type: "setStage", stage: "live", now: 400_000 });
    expect(clockAt(guessed, 400_000)).toBe(0);
    const s = sessionReducer(guessed, { type: "observe", obs: frame("scoreboard", "03:10"), now: 410_000 });
    expect(clockAt(s, 410_000)).toBe(190);
    expect(s.clockSure).toBe(true);
  });

  it("ignores one wild reading but follows two that agree", () => {
    let s = sessionReducer(live, { type: "observe", obs: frame("gameplay", "03:10"), now: 500_000 });
    // A minute later the read says 14:30 — a misread timer, not a real jump.
    s = sessionReducer(s, { type: "observe", obs: frame("gameplay", "14:30"), now: 560_000 });
    expect(clockAt(s, 560_000)).toBe(250);
    // Small corrections are always taken.
    s = sessionReducer(s, { type: "observe", obs: frame("scoreboard", "04:25"), now: 570_000 });
    expect(clockAt(s, 570_000)).toBe(265);
    // If our clock really was wrong, two consistent readings fix it.
    s = sessionReducer(s, { type: "observe", obs: frame("gameplay", "09:00"), now: 600_000 });
    expect(clockAt(s, 600_000)).toBe(295);
    s = sessionReducer(s, { type: "observe", obs: frame("gameplay", "09:20"), now: 620_000 });
    expect(clockAt(s, 620_000)).toBe(560);
  });
});

describe("match memory", () => {
  const rowOf = (hero: string, k: number, d: number, a: number, gold: number, isMe = false) => ({ hero, isMe, kills: k, deaths: d, assists: a, gold, level: -1, items: [] });
  const board = (time: string, mine: Array<[string, number, number, number, number]>, theirs: Array<[string, number, number, number, number]>) =>
    normalizeObservation({ screen: "scoreboard", gameTime: time, myGold: 500, allies: mine.map(([h, k, d, a, g], i) => rowOf(h, k, d, a, g, i === 0)), enemies: theirs.map(([h, k, d, a, g]) => rowOf(h, k, d, a, g)), myItems: [], recommended: [], spare: [], tip: "" });
  const at = (min: number) => min * 60_000;
  const MINE = (g: number[], kd: Array<[number, number, number]>) => ["Obsidia", "Freya", "Xavier", "Uranus", "Franco"].map((h, i) => [h, ...kd[i]!, g[i]!] as [string, number, number, number, number]);
  const THEIRS = (g: number[], kd: Array<[number, number, number]>) => ["Angela", "Minotaur", "Rafaela", "Akai", "Bane"].map((h, i) => [h, ...kd[i]!, g[i]!] as [string, number, number, number, number]);
  const flat: Array<[number, number, number]> = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];

  it("remembers every scoreboard and treats two reads of the same moment as one", () => {
    let s = sessionReducer(EMPTY_SESSION, { type: "observe", obs: board("02:00", MINE([1400, 1100, 1300, 1100, 700], flat), THEIRS([750, 750, 760, 800, 600], flat)), now: at(2) });
    expect(s.history).toHaveLength(1);
    expect(s.history[0]!.at).toBe(120);
    expect(s.allyLive[H("Freya").id]).toMatchObject({ gold: 1100 });
    s = sessionReducer(s, { type: "observe", obs: board("02:05", MINE([1450, 1100, 1300, 1100, 700], flat), THEIRS([750, 750, 760, 800, 600], flat)), now: at(2) + 5000 });
    expect(s.history).toHaveLength(1); // same open scoreboard
    s = sessionReducer(s, { type: "observe", obs: board("05:00", MINE([3000, 2400, 2600, 2300, 1500], flat), THEIRS([1500, 1500, 1500, 1600, 2900], flat)), now: at(5) });
    expect(s.history).toHaveLength(2);
    // A new match starts with an empty memory.
    expect(sessionReducer(s, { type: "setStage", stage: "draft", now: 1 }).history).toEqual([]);
  });

  it("tells the story from the first scoreboard, then compares against it", () => {
    let s = sessionReducer(EMPTY_SESSION, { type: "observe", obs: board("02:00", MINE([1400, 1100, 1300, 1100, 700], [[3, 0, 0], [0, 0, 1], [0, 0, 0], [1, 0, 0], [0, 0, 0]]), THEIRS([750, 750, 760, 800, 600], flat)), now: at(2) });
    const first = matchStory(s)!;
    expect(first.teamGold).toMatchObject({ mine: 5600, theirs: 3660, lead: 1940 });
    expect(first.lines[0]).toBe("Your team is ahead by 1.9k gold.");
    expect(first.lines.join(" ")).toMatch(/You have the most gold on your team/);
    expect(first.lines.at(-1)).toMatch(/first scoreboard I have seen/);
    expect(first.leadChange).toBeUndefined();

    // Three minutes later Bane has snowballed and the lead has shrunk.
    s = sessionReducer(s, { type: "observe", obs: board("05:00", MINE([2600, 2300, 2500, 2200, 1500], [[3, 2, 1], [2, 0, 3], [0, 1, 1], [1, 0, 2], [0, 4, 1]]), THEIRS([1500, 1500, 1500, 1600, 4200], [[0, 1, 2], [0, 1, 2], [0, 1, 1], [0, 2, 2], [6, 0, 1]])), now: at(5) });
    const later = matchStory(s)!;
    expect(later.teamGold!.lead).toBe(11100 - 10300);
    expect(later.leadChange).toBe(800 - 1940);
    expect(later.overMinutes).toBe(3);
    // 800 gold out of 21k is not a real lead any more: the coach calls it even, and says who gained.
    expect(later.lines[0]).toBe("The teams are about even on gold. They gained 1.1k on you in the last 3 minutes.");
    const text = later.lines.join(" ");
    expect(text).toMatch(/Freya is your strongest teammate \(2\/0\/3\)/);
    expect(text).toMatch(/Franco is struggling \(0\/4\/1\)/);
    expect(text).toMatch(/Bane is their richest hero \(6\/0\/1\)/);
    expect(later.players[0]).toMatchObject({ heroId: H("Bane").id, side: "enemy", gold: 4200, gain: 3600 });
    expect(later.players.find((p) => p.side === "me")).toMatchObject({ gain: 1200 });
    // The spoken line's key changes exactly when the situation does (ahead → even), so it is said once.
    expect(first.headline!.key).toBe("story:ahead:carry");
    expect(later.headline!.key).toBe("story:even:carry");
    expect(later.headline!.say).toMatch(/^The teams are about even on gold\. They gained 1\.1k on you/);
  });

  it("says nothing before a scoreboard has been seen", () => {
    expect(matchStory(EMPTY_SESSION)).toBeUndefined();
    expect(matchStory({ ...EMPTY_SESSION, myHeroId: H("Layla").id })).toBeUndefined();
  });
});

describe("new-player guidance", () => {
  it("names real skills and gives advice that follows from the kit", () => {
    const franco = briefOn(H("Franco"), H("Layla"));
    expect(franco.summary).toMatch(/tank/);
    // Skill names come from the synced game data, not from memory.
    expect(franco.watch.map((w) => w.name)).toEqual(expect.arrayContaining(["Iron Hook", "Bloody Hunt"]));
    expect(franco.watch.every((w) => w.text.length > 10 && w.kind)).toBe(true);
    expect(franco.how.join(" ")).toMatch(/Iron Hook/);
    expect(franco.how.join(" ")).toMatch(/out-range/); // Layla is ranged, Franco is not
    // A healer earns an anti-heal line naming the item this hero would buy.
    expect(briefOn(H("Estes"), H("Layla")).how.join(" ")).toMatch(/Buy Sea Halberd/);
    expect(briefOn(H("Estes"), H("Eudora")).how.join(" ")).toMatch(/Buy Glowing Wand/);
  });

  it("covers every hero, including ones newer than any guide", () => {
    for (const h of HEROES) {
      const b = briefOn(h, H("Layla"));
      expect(skillsOf(h.id).length, h.name).toBeGreaterThanOrEqual(3);
      expect(b.summary.length, h.name).toBeGreaterThan(10);
      expect(b.watch.length, h.name).toBeGreaterThan(0);
      expect(b.how.length, h.name).toBeGreaterThan(0);
    }
  });

  it("guesses the lane opponent and builds a plan around them", () => {
    const enemies = ids("Angela", "Minotaur", "Rafaela", "Akai", "Bane");
    expect(guessLaneOpponent("exp", enemies)).toBe(H("Bane").id);
    expect(guessLaneOpponent("gold", ids("Layla", "Tigreal", "Eudora"))).toBe(H("Layla").id);
    expect(guessLaneOpponent(undefined, enemies)).toBeUndefined();
    const threat = analyzeThreat(team("Angela", "Minotaur", "Rafaela", "Akai", "Bane"));
    const plan = gamePlan(H("Obsidia"), enemies, threat, H("Bane").id);
    expect(plan[0]).toMatch(/^In lane you face Bane/);
    expect(plan.join(" ")).toMatch(/anti-heal/);
    expect(plan.at(-1)).toMatch(/^Your job: farm safely/);
    expect(plan.length).toBeLessThanOrEqual(5);
  });

  it("reads sensibly for the player's real match (Obsidia into two healers and two tanks)", () => {
    const me = H("Obsidia");
    const enemies = ids("Angela", "Minotaur", "Rafaela", "Akai", "Bane");
    const plan = gamePlan(me, enemies, analyzeThreat(team("Angela", "Minotaur", "Rafaela", "Akai", "Bane")));
    // Supports are not "their damage": the reason to kill a healer is that she keeps the others alive.
    expect(plan[0]).toBe("Kill first: Angela and Rafaela — their healers. While they live, nobody else dies.");
    expect(plan.join(" ")).not.toMatch(/Angela[^.]*their damage/);
    // "You out-range them" is only true of heroes who have to walk up to you.
    const outRanged = (name: string) => briefOn(H(name), me).how.some((line) => line.startsWith("You out-range"));
    expect(outRanged("Angela")).toBe(false);
    expect(outRanged("Rafaela")).toBe(false);
    expect(outRanged("Akai")).toBe(true);
    expect(outRanged("Bane")).toBe(true);
    // A team with a marksman still gets the usual target call.
    expect(gamePlan(H("Layla"), ids("Karrie", "Tigreal"), analyzeThreat(team("Karrie", "Tigreal")))[0]).toMatch(/^Kill first: Karrie — their damage/);
  });

  it("counts the lane matchup double when ranking picks", () => {
    const enemies = ids("Esmeralda", "Estes", "Gusion");
    const plain = rankCounters({ enemies, allies: [], lane: "exp", limit: 40 });
    const laned = rankCounters({ enemies, allies: [], lane: "exp", laneOpponent: H("Esmeralda").id, limit: 40 });
    const dyrroth = (list: typeof plain) => list.find((p) => p.hero.name === "Dyrroth")!;
    expect(dyrroth(laned).score).toBeGreaterThan(dyrroth(plain).score);
    expect(dyrroth(laned).reasons.join(" ")).toMatch(/your lane/);
  });
});

describe("coach", () => {
  it("keeps one key while only the gold amount changes", () => {
    const base = { hero: H("Layla"), enemies: team(...HEALERS), owned: ["swift_boots"] };
    const a = buyAdvice(planBuild({ ...base, gold: 100 }));
    const b = buyAdvice(planBuild({ ...base, gold: 300 }));
    expect(a.key).toBe(b.key);
    expect(a.say).not.toBe(b.say);
    const log = new SpokenLog();
    expect(log.shouldSay(a, 0, 45_000)).toBe(true);
    expect(log.shouldSay(b, 10_000, 45_000)).toBe(false);
    expect(log.shouldSay(b, 60_000, 45_000)).toBe(true);
  });

  it("calls out a fed enemy once", () => {
    const live = team(...HEALERS).map((p) => (p.heroId === H("Gusion").id ? { ...p, kills: 8, deaths: 0, gold: 6900 } : { ...p, kills: 1, deaths: 2, gold: 3000 }));
    const threat = analyzeThreat(live);
    const first = fedAdvice(threat, new Set());
    expect(first).toHaveLength(1);
    expect(first[0]!.say).toBe("Gusion is fed. Magic burst damage — I'm adjusting your build.");
    expect(fedAdvice(threat, new Set([H("Gusion").id]))).toHaveLength(0);
  });

  it("fires timers as the clock passes them, without replaying after a resync", () => {
    expect(eventsBetween(118, 121).map((e) => e.id)).toEqual(["turtle"]);
    expect(eventsBetween(121, 122)).toEqual([]);
    expect(eventsBetween(0, 600)).toEqual([]);
  });
});

/**
 * A ranked match played on the phone, as the reader (Claude Haiku) reported it in
 * the server's logs: six scoreboards and one shop screen. Three of the scoreboards
 * came back with the enemy columns shifted, and the scoreboard's gold totals left
 * out the 300 starting gold.
 */
describe("a second real match, from the server's logs", () => {
  type Row = [hero: string, k: number, d: number, a: number, gold: number];
  const row = ([hero, kills, deaths, assists, gold]: Row, isMe = false) => ({ hero, isMe, kills, deaths, assists, gold, level: -1, items: [] });
  const board = (gameTime: string, myGold: number, allies: Row[], enemies: Row[]): Observation =>
    normalizeObservation({ screen: "scoreboard", gameTime, myGold, allies: allies.map((r) => row(r, r[0] === "Zetian")), enemies: enemies.map((r) => row(r)), myItems: [], recommended: [], spare: [], tip: "" });
  const READS: Observation[] = [
    board("07:21", 361, [["Argus", 4, 0, 1, 5667], ["Zetian", 2, 4, 7, 4401], ["Carmilla", 0, 5, 7, 3472], ["Thamuz", 5, 4, 4, 5268], ["Ixia", 3, 1, 3, 5392]],
      [["Belerick", 2, 5, 10, 4152], ["Novaria", 0, 3, 10, 3684], ["Layla", 2, 1, 5, 4917], ["Badang", 1, 4, 0, 3313], ["Freya", 9, 3, 2, 4693]]),
    board("08:08", 627, [["Argus", 5, 0, 2, 6487], ["Zetian", 3, 4, 9, 5092], ["Carmilla", 0, 5, 7, 3820], ["Thamuz", 5, 4, 5, 5864], ["Ixia", 4, 1, 3, 6066]],
      [["Belerick", 2, 6, 10, 4472], ["Novaria", 0, 3, 10, 4111], ["Layla", 2, 2, 5, 5159], ["Badang", 1, 5, 0, 3465], ["Freya", 9, 3, 2, 5230]]),
    // Shifted: gold in "kills", kills in "deaths", deaths in "assists", assists in "gold".
    board("08:49", 1131, [["Argus", 6, 0, 2, 7349], ["Zetian", 3, 4, 9, 5596], ["Carmilla", 0, 5, 8, 4553], ["Thamuz", 5, 4, 5, 6521], ["Ixia", 4, 1, 3, 6687]],
      [["Belerick", 4773, 2, 6, 10], ["Novaria", 4592, 0, 3, 10], ["Layla", 5606, 2, 2, 5], ["Badang", 3656, 1, 5, 0], ["Freya", 5390, 9, 4, 2]]),
    board("10:32", 18, [["Argus", 6, 1, 4, 8619], ["Zetian", 5, 5, 11, 7010], ["Carmilla", 0, 5, 13, 5972], ["Thamuz", 6, 4, 7, 8058], ["Ixia", 6, 1, 5, 8516]],
      [["Belerick", 6100, 2, 7, 11], ["Novaria", 5715, 0, 5, 11], ["Layla", 7686, 4, 2, 5], ["Badang", 4584, 1, 6, 0], ["Freya", 6590, 9, 5, 2]]),
    board("11:44", 141, [["Argus", 6, 1, 4, 9101], ["Zetian", 5, 5, 14, 7627], ["Carmilla", 1, 7, 18, 6968], ["Thamuz", 8, 4, 11, 9426], ["Ixia", 9, 2, 6, 9519]],
      [["Belerick", 2, 9, 13, 7091], ["Novaria", 0, 5, 12, 6308], ["Layla", 6, 2, 6, 9392], ["Badang", 2, 8, 1, 5679], ["Freya", 9, 7, 4, 7384]]),
    // Shifted the other way: gold in "kills" and in "gold", assists lost.
    board("13:18", 186, [["Argus", 6, 1, 4, 10309], ["Zetian", 5, 6, 18, 8664], ["Carmilla", 1, 7, 22, 8087], ["Thamuz", 8, 4, 11, 10718], ["Ixia", 13, 2, 6, 11153]],
      [["Belerick", 8063, 2, 10, 8063], ["Novaria", 7180, 0, 6, 7180], ["Layla", 10645, 7, 2, 10645], ["Badang", 6449, 2, 9, 6449], ["Freya", 8030, 9, 8, 8030]]),
  ];
  const IN_GAME = ["arcane_boots", "glowing_wand", "lightning_truncheon", "divine_glaive", "wishing_lantern", "holy_crystal"];
  const SHOP = normalizeObservation({
    screen: "shop", gameTime: "13:32", myGold: 242, allies: [], enemies: [],
    myItems: ["Arcane Boots", "Glowing Wand", "Lightning Truncheon", "Divine Glaive", "Wishing Lantern"],
    recommended: [{ name: "Arcane Boots", price: 684 }, { name: "Glowing Wand", price: 1947 }, { name: "Lightning Truncheon", price: 2137 }, { name: "Divine Glaive", price: 1871 }, { name: "Wishing Lantern", price: 2137 }, { name: "Holy Crystal", price: 2850 }],
    spare: [{ name: "Fleeting Time", price: 1947 }, { name: "Blood Wings", price: 1995 }], tip: "",
  });
  const play = (reads: Observation[], from: Session = EMPTY_SESSION) => reads.reduce((s, obs, i) => sessionReducer(s, { type: "observe", obs, now: 1_000_000 + i * 60_000 }), from);
  const plan = (s: Session) => planBuild({ hero: H("Zetian"), gold: s.gold, ...buildInputs(s) });
  const owned = (s: Session) => plan(s).slots.filter((x) => x.owned).map((x) => x.item.id);

  it("shifts mis-columned enemy rows back, both ways it happened", () => {
    const a = READS[2]!.enemies.find((p) => p.heroId === H("Belerick").id)!;
    expect(a).toMatchObject({ kills: 2, deaths: 6, assists: 10, gold: 4773 });
    const b = READS[5]!.enemies.find((p) => p.heroId === H("Belerick").id)!;
    expect(b).toMatchObject({ kills: 2, deaths: 10, gold: 8063 });
    expect(b.assists).toBeUndefined(); // that column was lost in the read; not invented
    for (const obs of READS) for (const p of obs.enemies) expect(p.kills ?? 0).toBeLessThan(30);
    // The player's own half was read correctly every time and is left alone.
    expect(READS[2]!.allies.find((p) => p.heroId === H("Zetian").id)).toMatchObject({ kills: 3, deaths: 4, assists: 9, gold: 5596 });
    // One impossible row among good ones is not "repaired" on a guess: it just loses its numbers.
    const lone = unscramble([{ heroId: 1, kills: 4773, deaths: 2, assists: 6, gold: 10 }, { heroId: 2, kills: 1, deaths: 1, assists: 1, gold: 900 }, { heroId: 3, kills: 0, deaths: 2, assists: 3, gold: 800 }]);
    expect(lone[0]).toMatchObject({ heroId: 1, kills: undefined, gold: undefined });
    expect(lone[1]).toMatchObject({ kills: 1, gold: 900 });
  });

  it("tells the story of the match from the six scoreboards", () => {
    const s = play(READS);
    expect(s.history).toHaveLength(6);
    expect(s.enemyLive[H("Freya").id]).toMatchObject({ kills: 9, deaths: 8, gold: 8030 });
    // Assists were unreadable on the last board; the earlier figure is kept rather than dropped.
    expect(s.enemyLive[H("Freya").id]!.assists).toBe(4);
    const story = s.story!;
    expect(story).toHaveLength(6);
    expect(story[0]!.text).toMatch(/Freya leads their team \(9\/3\/2\)/);
    expect(story[0]!.text).toMatch(/Your team is ahead by 3\.4k gold/);
    expect(story.at(-1)!.text).toMatch(/You died once\./);
    expect(story.at(-1)!.text).toMatch(/Ixia got 4 kills \(13\/2\/6\)/);
    expect(story.map((b) => b.at)).toEqual([441, 488, 529, 632, 704, 798]);
    // No "4,773 kills" ever reaches the fed check: the threat list is led by a real hero with real numbers.
    const top = plan(s).threat.sources[0]!;
    expect(s.enemyLive[top.heroId]!.kills).toBeLessThan(30);
  });

  it("believes the shop's inventory and learns that the scoreboard left out the starting gold", () => {
    const before = play(READS);
    expect(before.spent).toBe(8664 - 186);
    const s = play([SHOP], before);
    // Five finished items cost 8,776 at the shop's prices: 298 more than "spent". That is the starting gold.
    expect(s.seenItems).toEqual(["arcane_boots", "glowing_wand", "lightning_truncheon", "divine_glaive", "wishing_lantern"]);
    expect(s.seenPartial).toBeUndefined();
    expect(s.goldOffset).toBe(300);
    expect(s.spent).toBe(8478 + 300);
    expect(s.priceFactor).toBe(0.95);
    expect(owned(s)).toEqual(["arcane_boots", "glowing_wand", "lightning_truncheon", "divine_glaive", "wishing_lantern"]);
    // With five slots truly filled, the sixth is the coach's call: a defensive answer to their fed marksman
    // rather than the list's Holy Crystal — priced at the shop's discount, and with where to find it.
    const next = plan(s).next;
    expect(next).toMatchObject({ action: "save", item: { id: "winter_crown" }, goldNeeded: 1814 - 242 });
    expect(next.where).toBe("It's under the Magic tab.");
    expect(plan(s).slots).toHaveLength(6);
    // The next scoreboard keeps the corrected figure.
    const later = play([board("13:50", 300, [["Argus", 6, 1, 4, 10500], ["Zetian", 5, 6, 18, 8900], ["Carmilla", 1, 7, 22, 8200], ["Thamuz", 8, 4, 11, 10900], ["Ixia", 13, 2, 6, 11300]], [["Belerick", 2, 10, 13, 8200], ["Novaria", 0, 6, 12, 7300], ["Layla", 7, 2, 6, 10800], ["Badang", 2, 9, 1, 6600], ["Freya", 9, 8, 4, 8200]])], s);
    expect(later.spent).toBe(8900 - 300 + 300);
  });

  it("assumes the player buys from their own in-game list, never a counter the coach only suggested", () => {
    // The shop was opened early, so the in-game list is known. Freya is 9/3: the coach wants a defensive answer.
    const early: Session = { ...play(READS.slice(0, 2)), plannedBuild: IN_GAME, shopListed: IN_GAME, priceFactor: 0.95, goldOffset: 300, spent: 4465 + 300 };
    const p = plan(early);
    // 4,765 spent pays for exactly the first three items of their list (684 + 1,947 + 2,137 = 4,768).
    expect(p.slots.filter((x) => x.owned).map((x) => x.item.id)).toEqual(["arcane_boots", "glowing_wand", "lightning_truncheon"]);
    // Whatever counters the plan contains, none is marked as bought on the strength of gold alone.
    for (const slot of p.slots) if (!IN_GAME.includes(slot.item.id)) expect(slot.owned).toBe(false);
    // A tap on the dashboard (or a read of the inventory) is what confirms an off-list purchase.
    const tapped = sessionReducer(early, { type: "bought", id: "winter_crown" });
    expect(owned(tapped)).toContain("winter_crown");
  });

  it("fits an inventory read to the gold spent", () => {
    const five = ["arcane_boots", "glowing_wand", "lightning_truncheon", "divine_glaive", "wishing_lantern"];
    // Exactly affordable, or over by no more than the starting gold: believed whole.
    expect(fitOwnItems(five, 8776, 0.95)).toMatchObject({ items: five, over: 0 });
    expect(fitOwnItems(five, 8478, 0.95)).toMatchObject({ items: five, over: 298 });
    expect(fitOwnItems(five, 8478, 0.95)!.partial).toBeUndefined();
    // Well short of the fifth item: its pieces were read as the finished thing.
    expect(fitOwnItems(five, 7300, 0.95)).toMatchObject({ items: five.slice(0, 4), partial: "wishing_lantern" });
    // Nowhere near: a misread, thrown away.
    expect(fitOwnItems(five, 3000, 0.95)).toBeUndefined();
    expect(fitOwnItems(["arcane_boots", "warrior_boots"], 9000)).toBeUndefined();
    expect(fitOwnItems([], 9000)).toBeUndefined();
    // A piece being built is finished before anything else, and the gold already in it counts.
    const p = planBuild({ hero: H("Zetian"), enemies: team("Freya", "Layla", "Belerick"), owned: [], gold: 500, spent: 7300, priceFactor: 0.95, seenItems: five.slice(0, 4), partial: "wishing_lantern", plannedBuild: IN_GAME });
    expect(p.slots.find((x) => !x.owned)).toMatchObject({ item: { id: "wishing_lantern" }, paid: 7300 - 6639 });
    expect(p.next).toMatchObject({ action: "buy-pieces", item: { id: "wishing_lantern" }, goldNeeded: 2137 - 661 - 500 });
  });

  it("holds a scoreboard row whose numbers went down until the next read settles it", () => {
    const base = play(READS.slice(0, 2));
    const freya = H("Freya").id;
    const bad = board("08:30", 700, [["Zetian", 3, 4, 9, 5200]], [["Freya", 4, 3, 2, 2230], ["Belerick", 2, 6, 10, 4500], ["Novaria", 0, 3, 10, 4200], ["Layla", 2, 2, 5, 5200], ["Badang", 1, 5, 0, 3500]]);
    const held = play([bad], base);
    expect(held.enemyLive[freya]).toMatchObject({ kills: 9, gold: 5230 }); // 9 kills do not become 4
    expect(held.doubt?.[freya]).toMatchObject({ kills: 4 });
    expect(held.history.at(-1)!.players[freya]).toMatchObject({ kills: 9, gold: 5230 });
    // The same lower figure twice in a row: the earlier reading was the wrong one.
    const again = board("08:55", 760, [["Zetian", 3, 4, 9, 5300]], [["Freya", 4, 3, 3, 2400], ["Belerick", 2, 6, 10, 4600], ["Novaria", 0, 3, 10, 4300], ["Layla", 2, 2, 5, 5300], ["Badang", 1, 5, 0, 3600]]);
    const settled = play([again], held);
    expect(settled.enemyLive[freya]).toMatchObject({ kills: 4, gold: 2400 });
    expect(settled.doubt?.[freya]).toBeUndefined();
  });
});

describe("AI coach", () => {
  const live = (): Session => {
    const obs = normalizeObservation({
      screen: "scoreboard", gameTime: "08:08", myGold: 627,
      allies: [["Argus", 5, 0, 2, 6487], ["Zetian", 3, 4, 9, 5092], ["Carmilla", 0, 5, 7, 3820], ["Thamuz", 5, 4, 5, 5864], ["Ixia", 4, 1, 3, 6066]].map(([hero, kills, deaths, assists, gold]) => ({ hero, isMe: hero === "Zetian", kills, deaths, assists, gold, level: -1, items: [] })),
      enemies: [["Belerick", 2, 6, 10, 4472], ["Novaria", 0, 3, 10, 4111], ["Layla", 2, 2, 5, 5159], ["Badang", 1, 5, 0, 3465], ["Freya", 9, 3, 2, 5230]].map(([hero, kills, deaths, assists, gold]) => ({ hero, isMe: false, kills, deaths, assists, gold, level: -1, items: [] })),
      myItems: [], recommended: [], spare: [], tip: "",
    });
    return sessionReducer(EMPTY_SESSION, { type: "observe", obs, now: 2_000_000 });
  };

  it("briefs the coach with the whole match in plain text", () => {
    const s = live();
    const brief = coachBrief(s, 2_000_000)!;
    expect(brief).toMatch(/PLAYER: Zetian — Mage, magic damage/);
    expect(brief).toMatch(/3\/4\/9, 5092 gold/);
    expect(brief).toMatch(/Gold in pocket: 627\. Spent so far: about 4465\./);
    expect(brief).toMatch(/- Freya — Fighter, physical damage.*9\/3\/2, 5230 gold\. FED\./);
    expect(brief).toMatch(/TEAM GOLD: the player's team 27329, enemy 22437/);
    expect(brief).toMatch(/STORY SO FAR\n- 8:08 /);
    expect(brief).toMatch(/Match clock 8:08/);
    // Nothing to coach on before the line-ups are known.
    expect(coachBrief(EMPTY_SESSION, 0)).toBeUndefined();
    // The catalog the coach chooses from is the app's own.
    expect(COACH_SYSTEM).toContain("Winter Crown | 1910 | Magic |");
    expect(COACH_SYSTEM.match(/\n[^|\n]+ \| \d+ \| /g)!.length).toBe(ITEMS.length);
  });

  it("checks the coach's answer against the catalog and what the player owns", () => {
    // Gold spent is left out here so the test is about the coach's list, not the spending estimate.
    const s: Session = { ...live(), owned: ["arcane_boots", "glowing_wand"], spent: undefined };
    const out = normalizeCoach(
      {
        situation: "ahead", headline: "  Freya is fed — buy Winter Crown next.  ", do_now: ["Stay behind Argus.", "", "Take the turtle with your team.", "Push mid.", "A fifth line"], avoid: "Do not walk into the river alone.",
        focus_hero: "freya", focus_why: "9/3 and she dives the back line.",
        build: [{ item: "Winter Crown", why: "Freeze when Freya jumps on you." }, { item: "Sword of Infinite Lies", why: "made up" }, { item: "Glowing Wand", why: "x" }, { item: "Tough Boots", why: "second boots" }, { item: "Holy Crystal", why: "Big damage." }, { item: "winter crown", why: "repeat" }, { item: "Divine Glaive", why: "Cuts through magic defense." }],
        story_beat: "Freya reached 9 kills; your team still leads on gold.", story_tone: "bad",
      },
      s, "claude-opus-5-5", 2_000_000,
    )!;
    expect(out.advice).toMatchObject({ situation: "ahead", headline: "Freya is fed — buy Winter Crown next.", doNow: ["Stay behind Argus.", "Take the turtle with your team.", "Push mid."], model: "claude-opus-5-5", clock: 488 });
    expect(out.advice.focus).toEqual({ heroId: H("Freya").id, why: "9/3 and she dives the back line." });
    // Owned items stay in front in the order held; invented items, repeats and second boots are gone.
    expect(out.build!.ids).toEqual(["arcane_boots", "glowing_wand", "winter_crown", "holy_crystal", "divine_glaive"]);
    expect(out.advice.item).toEqual({ id: "winter_crown", why: "Freeze when Freya jumps on you." });
    expect(out.beat).toEqual({ at: 488, text: "Freya reached 9 kills; your team still leads on gold.", tone: "bad" });

    // Applied to the match, the plan follows the coach's order and gives its reasons.
    const coached = sessionReducer(s, { type: "ai", ...out });
    const plan = planBuild({ hero: H("Zetian"), gold: coached.gold, ...buildInputs(coached) });
    expect(slotIds(plan).slice(0, 5)).toEqual(["arcane_boots", "glowing_wand", "winter_crown", "holy_crystal", "divine_glaive"]);
    expect(plan.slots).toHaveLength(6); // the rules fill the slot the coach left open
    expect(plan.slots[2]).toMatchObject({ owned: false, reason: "Freeze when Freya jumps on you." });
    expect(coached.story!.at(-1)).toMatchObject({ text: "Freya reached 9 kills; your team still leads on gold." }); // replaces the rule-made line for that moment
    expect(coached.story).toHaveLength(1);

    // Junk in, nothing out; an enemy name that is not in the match is dropped.
    expect(normalizeCoach({}, s, "m", 1)).toBeUndefined();
    expect(normalizeCoach("not json", s, "m", 1)).toBeUndefined();
    const thin = normalizeCoach({ headline: "Open the scoreboard.", focus_hero: "Gusion", build: [{ item: "Winter Crown" }] }, s, "m", 2_000_000)!;
    expect(thin.advice.focus).toBeUndefined();
    expect(thin.build).toBeUndefined(); // fewer than three real items is not a build
    expect(thin.advice.situation).toBe("even");
  });

  it("starts a new match with a clean slate", () => {
    const s = sessionReducer({ ...live(), owned: ["arcane_boots"] }, { type: "ai", ...normalizeCoach(demoCoach(live()), live(), "demo", 2_000_000)! });
    expect(s.ai).toBeDefined();
    expect(s.aiBuild!.ids.length).toBeGreaterThanOrEqual(3);
    const next = sessionReducer(s, { type: "setStage", stage: "draft", now: 3_000_000 });
    for (const key of ["ai", "aiBuild", "story", "position", "goldOffset", "seenItems", "spent"] as const) expect(next[key]).toBeUndefined();
  });

  it("turns a positioning answer into advice, and says when the map was not open", () => {
    const s = live();
    expect(positionBrief(s, 2_000_000, 2)).toMatch(/The player is Zetian \(Mage\)/);
    expect(positionBrief(s, 2_000_000, 2)).toMatch(/Freya \(9\/3\/2\)/);
    expect(positionBrief(s, 2_000_000, 2)).toMatch(/Picture 2 was taken a few seconds later/);
    expect(positionBrief(s, 2_000_000, 1)).toMatch(/One picture only/);
    const a = normalizePosition({ map_open: true, where: "Mid lane, past the river.", enemies_seen: "Two top, three missing.", risk: "high", say: "Back to your turret.", moves: ["Walk back.", "Clear the wave.", "Wait for Argus.", "extra"] }, "claude-opus-5-5", 5)!;
    expect(a).toMatchObject({ at: 5, summary: "Mid lane, past the river. Two top, three missing.", danger: "High risk where you are standing.", say: "Back to your turret.", model: "claude-opus-5-5" });
    expect(a.moves).toHaveLength(3);
    const b = normalizePosition({ map_open: false, where: "Bottom lane.", enemies_seen: "", risk: "low", say: "Stay where you are.", moves: [] }, "m", 6)!;
    expect(b.danger).toBeUndefined();
    expect(b.summary).toMatch(/map was not open/);
    expect(normalizePosition({ say: "" }, "m", 7)).toBeUndefined();
  });
});

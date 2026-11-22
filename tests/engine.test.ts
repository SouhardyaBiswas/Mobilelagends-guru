import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { StillnessDetector } from "../src/capture/stillness";
import { HERO_CORE, TEMPLATES, templateFor } from "../src/data/builds";
import { findHero, HEROES } from "../src/data/heroes";
import { componentId, findItem, itemById, ITEMS } from "../src/data/items";
import { eventsBetween } from "../src/data/timeline";
import { planBuild } from "../src/engine/build";
import { buyAdvice, fedAdvice, SpokenLog } from "../src/engine/coach";
import { rankCounters } from "../src/engine/draft";
import { analyzeThreat } from "../src/engine/threat";
import { EMPTY_SESSION, orientObservation, sessionReducer, type Session } from "../src/state/store";
import type { Observation, PlayerState } from "../src/types";
import { normalizeObservation, parseGameTime } from "../src/vision/schema";

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
    expect(planBuild({ ...base, owned: withPiece, gold: remaining - 1 }).next.action).toBe("save");
    const finish = planBuild({ ...base, owned: withPiece, gold: remaining });
    expect(finish.next).toMatchObject({ action: "buy", say: "Buy Antique Cuirass now." });
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
    // With nothing threatening there is nothing to improvise: keep saving for the core item.
    const calm = planBuild({ hero: H("Layla"), enemies: team("Tigreal", "Franco"), owned: ["swift_boots"], gold: 1450 });
    expect(calm.next).toMatchObject({ action: "save", item: { id: "windtalker" } });
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
    // Union: an item the model missed must not disappear from the inventory.
    expect(s.owned.sort()).toEqual(["sea_halberd", "swift_boots", "windtalker"]);
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

describe("coach", () => {
  it("keeps one key while only the gold amount changes", () => {
    const base = { hero: H("Layla"), enemies: team(...HEALERS), owned: ["swift_boots"] };
    const a = buyAdvice(planBuild({ ...base, gold: 100 }));
    const b = buyAdvice(planBuild({ ...base, gold: 400 }));
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

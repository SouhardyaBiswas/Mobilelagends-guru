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
import { analyzeThreat } from "../src/engine/threat";
import { briefOn, gamePlan, guessLaneOpponent, skillsOf } from "../src/engine/tips";
import { EMPTY_SESSION, freshSession, orientObservation, sessionReducer, stageOf, type Session } from "../src/state/session";
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
    // Same lineup, same gold, nobody fed: the assassin is only a nice-to-have counter,
    // so the plan still contains the defensive item but does not delay the first damage item for it.
    const unfed = planBuild({ hero: H("Layla"), enemies: team(...HEALERS), owned: ["swift_boots"], gold: 1450 });
    expect(slotIds(unfed)).toContain("rose_gold_meteor");
    expect(unfed.next).toMatchObject({ action: "save", item: { id: "windtalker" } });
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
    expect(s.owned).toEqual(["swift_boots"]); // this game's inventory, not the old one
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
  const plan = (s: Session) =>
    planBuild({ hero: HEROES.find((h) => h.id === s.myHeroId)!, lane: s.lane, enemies: s.enemies.map((id) => s.enemyLive[id] ?? { heroId: id }), owned: s.owned, gold: s.gold, plannedBuild: s.plannedBuild, shopListed: s.shopListed, priceFactor: s.priceFactor });

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
    expect(s.owned).toEqual([componentId("Boots")]);
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
    expect(p.next).toMatchObject({ action: "buy", item: { id: "warrior_boots" }, say: "Buy Warrior Boots now." });
    expect(p.next.where).toBeUndefined(); // it is in their own Recommended list
    // After boots, 1209 - 446 = 763 gold: not enough for Windtalker (1786).
    s = sessionReducer(s, { type: "bought", id: "warrior_boots" });
    expect(s.gold).toBe(1209 - 446);
    expect(plan(s).next).toMatchObject({ action: "save", item: { id: "windtalker" }, goldNeeded: 1786 - 763 });
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
    expect(first.title).toBe("Buy Swift Boots now.");
    expect(first.icon).toBe(`${origin}/items/swift_boots.webp`);
    expect(first.body).toMatch(/You have 1143 gold/);
    // After the shop read, it follows the player's own build instead.
    const shop = normalizeObservation(SHOP);
    s = sessionReducer(s, { type: "observe", obs: shop, now: 2 });
    const second = coachReply(s, shop, new Set(), origin);
    expect(second.title).toBe("Buy Warrior Boots now.");
    expect(second.icon).toBe(`${origin}/items/warrior_boots.webp`);
    expect(second.say).toBe("Buy Warrior Boots now. From the build you chose in game.");
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

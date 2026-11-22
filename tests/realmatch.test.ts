import { describe, expect, it } from "vitest";
import { allowedItems, coachBrief, normalizeCoach } from "../src/ai/coach";
import { normalizeEnemies, withoutShopping } from "../src/ai/enemies";
import { suitableItems, templateFor } from "../src/data/builds";
import { HEROES } from "../src/data/heroes";
import { itemById } from "../src/data/items";
import { coachReply } from "../src/engine/reply";
import { EMPTY_SESSION, sessionReducer, stageOf, type Session } from "../src/state/session";
import { normalizeObservation } from "../src/vision/schema";

/**
 * The third real match (room SOUH77, ranked, Hanabi in the gold lane), replayed from the
 * server's logs. What went wrong in it, and what each test pins down:
 * - every draft read came back with no heroes, so nothing was assigned in hero selection;
 * - a repeated "draft mode" cleared the draft;
 * - the AI coach put Radiant Armor (a frontliner's item) in a marksman's build, and the
 *   enemy tracker told the player to buy "Athena-style items" and armor;
 * - a scoreboard whose pocket gold was not read left the build five minutes behind;
 * - the next match's draft was coached as the old match ("Your lane: Bruno").
 */
const H = (name: string) => {
  const hero = HEROES.find((h) => h.name === name);
  if (!hero) throw new Error(`no hero ${name}`);
  return hero;
};
const ids = (...names: string[]) => names.map((n) => H(n).id);

type Row = [hero: string, kills: number, deaths: number, assists: number, gold: number, isMe?: boolean];
const row = ([hero, kills, deaths, assists, gold, isMe = false]: Row) => ({ hero, isMe, kills, deaths, assists, gold, level: -1, items: [] as string[] });
const raw = (screen: string, extra: Record<string, unknown> = {}) => ({
  screen, gameTime: "", myGold: -1, allies: [], enemies: [], banned: [], myItems: [], recommended: [], spare: [], tip: "", scene: "", ...extra,
});
const board = (clock: string, pocket: number, allies: Row[], enemies: Row[]) =>
  normalizeObservation(raw("scoreboard", { gameTime: clock, myGold: pocket, allies: allies.map(row), enemies: enemies.map(row) }));
const observe = (s: Session, obs: ReturnType<typeof normalizeObservation>, now: number) => sessionReducer(s, { type: "observe", obs, now });
const reply = (s: Session, obs: ReturnType<typeof normalizeObservation>) => coachReply(s, obs, new Set(), "https://coach.test");

const SEC = 1000;
const MIN = 60 * SEC;

describe("hero selection, as the real draft screen shows it", () => {
  it("assigns the picks, the player's own hero and the bans from a draft read", () => {
    // A lane left over from an earlier match: the player last played roam.
    const start: Session = { ...EMPTY_SESSION, lane: "roam", stage: "draft", stageAt: 0 };
    const draft = normalizeObservation(
      raw("draft", {
        allies: [row(["Hanabi", -1, -1, -1, -1, true]), row(["Floryn", -1, -1, -1, -1])],
        enemies: [row(["Julian", -1, -1, -1, -1]), row(["Xavier", -1, -1, -1, -1])],
        banned: ["Beatrix", "Julian", "Not A Hero"],
      }),
    );
    expect(draft.banned).toEqual(ids("Beatrix")); // a banned hero is never also a pick
    expect(draft.unknown).toContain("Not A Hero");
    const s = observe(start, draft, 10 * SEC);
    expect(s.myHeroId).toBe(H("Hanabi").id);
    expect(s.enemies).toEqual(ids("Julian", "Xavier"));
    expect(s.allies).toEqual(ids("Floryn"));
    expect(s.banned).toEqual(ids("Beatrix"));
    // The lane follows the hero: a marksman is not coached as a roamer.
    expect(s.lane).toBe("gold");
    // With the hero known, the reply is about Hanabi's game, not "Can't see your hero yet".
    expect(reply(s, draft).title).not.toMatch(/Can't see your hero|Hero selection/);
  });

  it("bans never come from a screen other than the draft", () => {
    expect(normalizeObservation(raw("scoreboard", { banned: ["Beatrix"] })).banned).toBeUndefined();
  });

  it("lets a later draft read change the player's hero while they are still choosing", () => {
    let s: Session = { ...EMPTY_SESSION, stage: "draft", stageAt: 0 };
    s = observe(s, normalizeObservation(raw("draft", { allies: [row(["Layla", -1, -1, -1, -1, true])] })), 5 * SEC);
    expect(s.myHeroId).toBe(H("Layla").id);
    s = observe(s, normalizeObservation(raw("draft", { allies: [row(["Hanabi", -1, -1, -1, -1, true])] })), 15 * SEC);
    expect(s.myHeroId).toBe(H("Hanabi").id);
  });

  it("replaces a thinner draft roster with a fuller read, and keeps taps a thinner read does not mention", () => {
    let s: Session = { ...EMPTY_SESSION, stage: "draft", stageAt: 0, enemies: ids("Julian") };
    s = observe(s, normalizeObservation(raw("draft", { enemies: [row(["Xavier", -1, -1, -1, -1])] })), 5 * SEC);
    expect(s.enemies).toEqual(ids("Xavier")); // same count: the read is the newer picture
    s = { ...s, enemies: ids("Julian", "Xavier") };
    s = observe(s, normalizeObservation(raw("draft", { enemies: [row(["Bruno", -1, -1, -1, -1])] })), 10 * SEC);
    expect(s.enemies).toEqual(ids("Bruno", "Julian", "Xavier"));
  });

  it("does not clear the draft when 'draft mode' is said again, but does for the next match", () => {
    let s = sessionReducer(EMPTY_SESSION, { type: "setStage", stage: "draft", now: 0 });
    const matchId = s.matchId;
    s = sessionReducer(s, { type: "setTeam", side: "enemies", ids: ids("Julian") });
    s = sessionReducer(s, { type: "setMyHero", id: H("Hanabi").id });
    s = sessionReducer(s, { type: "setStage", stage: "draft", now: 60 * SEC });
    expect(s.enemies).toEqual(ids("Julian"));
    expect(s.myHeroId).toBe(H("Hanabi").id);
    expect(s.matchId).toBe(matchId);
    // Loading, then a new hero selection: a new match.
    const loading = sessionReducer(s, { type: "setStage", stage: "loading", now: 2 * MIN });
    expect(sessionReducer(loading, { type: "setStage", stage: "draft", now: 3 * MIN })).toMatchObject({ enemies: [], matchId: matchId + 1 });
    // A draft left standing far longer than any hero selection lasts is cleared too.
    expect(sessionReducer(s, { type: "setStage", stage: "draft", now: 10 * MIN })).toMatchObject({ enemies: [], matchId: matchId + 1 });
  });

  it("goes back to hero selection when 'In match' was tapped before the match began", () => {
    let s: Session = { ...EMPTY_SESSION, stage: "draft", stageAt: 0, enemies: ids("Julian") };
    s = sessionReducer(s, { type: "setStage", stage: "live", now: 20 * SEC });
    expect(stageOf(s)).toBe("live");
    s = observe(s, normalizeObservation(raw("draft", { enemies: [row(["Julian", -1, -1, -1, -1]), row(["Xavier", -1, -1, -1, -1])] })), 30 * SEC);
    expect(s.phase).toBe("draft");
    expect(stageOf(s)).toBe("draft");
    expect(s.clockStart).toBeUndefined();
    expect(s.enemies).toEqual(ids("Julian", "Xavier"));
  });

  it("leaves out banned heroes from the picks it calls", () => {
    const s: Session = { ...EMPTY_SESSION, stage: "draft", lane: "gold", enemies: ids("Julian"), banned: ids("Beatrix", "Bruno") };
    const answer = reply(s, normalizeObservation(raw("draft")));
    expect(answer.title).toMatch(/^Pick: /);
    expect(answer.title).not.toMatch(/Beatrix|Bruno/);
  });

  it("does not send the player to the scoreboard during hero selection", () => {
    // Logged at 11:48:51 in room SOUH77: a non-game screenshot in hero selection answered
    // "I can't see which hero is yours yet. Open the scoreboard and tap again."
    const other = normalizeObservation(raw("other"));
    const inDraft = reply({ ...EMPTY_SESSION, stage: "draft" }, other);
    expect(inDraft.title).toBe("Not the hero selection screen");
    expect(inDraft.say).not.toMatch(/scoreboard/);
    expect(reply({ ...EMPTY_SESSION, stage: "loading" }, other).say).not.toMatch(/scoreboard/);
    // In the match itself the scoreboard is still the right answer.
    expect(reply({ ...EMPTY_SESSION, stage: "live", phase: "live" }, normalizeObservation(raw("gameplay"))).say).toMatch(/scoreboard/);
  });

  it("says something useful in the draft before the enemy has picked", () => {
    const empty = reply({ ...EMPTY_SESSION, stage: "draft" }, normalizeObservation(raw("draft")));
    expect(empty.title).toBe("Hero selection");
    const mine = reply({ ...EMPTY_SESSION, stage: "draft", myHeroId: H("Hanabi").id, lane: "gold" }, normalizeObservation(raw("draft")));
    expect(mine.title).toBe("You: Hanabi");
  });
});

describe("the SOUH77 match, from the server's logs", () => {
  const ALLIES = (f: [number, number, number, number][]): Row[] =>
    (["Floryn", "Nana", "Fredrinn", "Lukas", "Hanabi"] as const).map((n, i) => [n, ...f[i]!, n === "Hanabi"] as Row);
  const ENEMIES = (f: [number, number, number, number][]): Row[] => (["Julian", "Xavier", "Bruno", "Hilda", "Alpha"] as const).map((n, i) => [n, ...f[i]!] as Row);
  const T0 = 1_795_346_905_326; // "In match" tapped

  // Hero selection as it actually went: the reads named nobody, one enemy was tapped in.
  let s: Session = sessionReducer({ ...EMPTY_SESSION, lane: "gold" }, { type: "setStage", stage: "draft", now: T0 - 4 * MIN });
  s = sessionReducer(s, { type: "setTeam", side: "enemies", ids: ids("Julian") });
  s = sessionReducer(s, { type: "setStage", stage: "draft", now: T0 - 30 * SEC }); // said again: kept
  const afterDraft = s;
  s = sessionReducer(s, { type: "setStage", stage: "live", now: T0 });
  s = observe(s, normalizeObservation(raw("gameplay", { gameTime: "00:04", myGold: 63 })), T0 + 8 * SEC);
  s = observe(s, board("00:11", 63, ALLIES([[0, 0, 0, 300], [0, 0, 0, 300], [0, 0, 0, 300], [0, 0, 0, 300], [0, 0, 0, 300]]), ENEMIES([[0, 0, 0, 300], [0, 0, 0, 300], [0, 0, 0, 300], [0, 0, 0, 300], [0, 0, 0, 300]])), T0 + 16 * SEC);
  const opening = s;
  // 5:09 — the pocket gold could not be read.
  const noPocket = board("05:09", -1, ALLIES([[0, 1, 0, 2176], [1, 0, 0, 2536], [0, 0, 0, 2184], [1, 0, 0, 2863], [0, 2, 0, 3212]]), ENEMIES([[0, 1, 0, 2620], [0, 0, 2, 2882], [1, 1, 1, 3488], [2, 0, 0, 2609], [0, 0, 0, 2723]]));
  s = observe(s, noPocket, T0 + 5 * MIN + 1 * SEC);
  const at509 = s;
  s = observe(s, board("05:23", 53, ALLIES([[0, 1, 0, 2251], [1, 0, 0, 2566], [0, 0, 0, 2334], [1, 0, 0, 2893], [0, 2, 0, 3242]]), ENEMIES([[0, 1, 0, 2650], [0, 0, 2, 2912], [1, 1, 1, 3718], [2, 0, 0, 2715], [0, 0, 0, 2791]])), T0 + 5 * MIN + 11 * SEC);
  const at523 = s;
  s = observe(s, board("10:06", 117, ALLIES([[0, 2, 0, 4245], [1, 2, 0, 4337], [0, 3, 0, 3744], [2, 3, 0, 5120], [0, 4, 0, 5618]]), ENEMIES([[2, 2, 2, 5821], [5, 0, 7, 6754], [2, 1, 6, 7686], [3, 0, 8, 6279], [2, 0, 6, 6817]])), T0 + 10 * MIN);
  const late = s;

  it("kept the tapped enemy through the second 'draft mode'", () => {
    expect(afterDraft.enemies).toEqual(ids("Julian"));
  });

  it("learns the player, both teams and gold spent from the first scoreboard", () => {
    expect(opening.myHeroId).toBe(H("Hanabi").id);
    expect(opening.enemies).toEqual(ids("Julian", "Xavier", "Bruno", "Hilda", "Alpha"));
    expect(opening.lane).toBe("gold");
    expect(opening.spent).toBe(237); // Boots at the emblem's 95%
  });

  it("does not coach a five-minute-old build when the pocket gold is missing", () => {
    // Logged: "Save 420 more gold to finish Swift Boots." at 5:09, with 3212 gold earned.
    expect(at509.spent).toBeGreaterThanOrEqual(2800);
    expect(at509.gold).toBeUndefined();
    const said = reply(at509, noPocket);
    expect(said.title).not.toMatch(/Swift Boots/);
    // The next scoreboard with pocket gold puts the exact figure back.
    expect(at523.spent).toBe(3242 - 53);
    expect(at523.gold).toBe(53);
  });

  it("starts a new match when the next hero selection appears minutes after the last scoreboard", () => {
    // Logged at 11:45:55, seven minutes after the 10:06 scoreboard: "Your lane: Bruno".
    const draft = normalizeObservation(raw("draft"));
    const next = observe(late, draft, T0 + 17 * MIN);
    expect(next.matchId).toBe(late.matchId + 1);
    expect(next.myHeroId).toBeUndefined();
    expect(next.enemies).toEqual([]);
    expect(next.spent).toBeUndefined();
    expect(next.lane).toBe("gold");
    expect(reply(next, draft).title).not.toMatch(/Bruno/);
    // A scoreboard misfiled as the draft, showing this match's heroes, wipes nothing.
    const misfiled = normalizeObservation(raw("draft", { enemies: (["Julian", "Xavier", "Bruno"] as const).map((n) => row([n, -1, -1, -1, -1])) }));
    expect(observe(late, misfiled, T0 + 17 * MIN).matchId).toBe(late.matchId);
  });

  it("keeps the AI coach's build on-role for a marksman", () => {
    // The coach's logged answer at 8:47 and 10:06.
    const answer = {
      situation: "behind",
      headline: "Stop dying: farm safely behind turret, avoid Xavier's beam",
      do_now: ["Farm gold lane waves under your turret only", "Buy Radiant Armor before the next fight", "Stay behind Lukas and Fredrinn in fights"],
      avoid: "Don't walk into bushes alone; Hilda and Julian are hunting you.",
      focus_hero: "Xavier",
      focus_why: "5/0/7 and deletes you with his beam.",
      build: ["Swift Boots", "Windtalker", "Berserker's Fury", "Haas' Claws", "Wind of Nature", "Radiant Armor", "Thunder Belt", "Rose Gold Meteor"].map((item) => ({ item, why: "" })),
      story_beat: "Hanabi dies again at 0/4; Xavier hits 5/0/7.",
      story_tone: "bad",
    };
    const result = normalizeCoach(answer, late, "test", T0 + 10 * MIN + 5 * SEC)!;
    expect(result.build!.ids).not.toContain("radiant_armor");
    expect(result.build!.ids).not.toContain("thunder_belt");
    expect(result.build!.ids).toContain("rose_gold_meteor");
    expect(result.advice.doNow.join(" ")).not.toMatch(/Radiant Armor/);
    expect(result.advice.doNow).toHaveLength(2);
    // The coach is told which items suit the player.
    const brief = coachBrief(late, T0 + 10 * MIN)!;
    expect(brief).toMatch(/ITEMS THAT SUIT Hanabi \(Crit marksman, gold lane\): .*Windtalker/);
    expect(brief).not.toMatch(/ITEMS THAT SUIT[^\n]*Radiant Armor/);
  });

  it("keeps a frontliner's defensive items, and the player's own in-game list, allowed", () => {
    const tank: Session = { ...late, myHeroId: H("Tigreal").id, lane: "roam" };
    expect(allowedItems(tank, H("Tigreal")).has("radiant_armor")).toBe(true);
    expect(allowedItems(tank, H("Tigreal")).has("windtalker")).toBe(false);
    const ownList: Session = { ...late, plannedBuild: ["swift_boots", "radiant_armor", "windtalker"] };
    expect(allowedItems(ownList, H("Hanabi")).has("radiant_armor")).toBe(true);
  });

  it("takes buying advice out of the enemy tracker's notes", () => {
    // Logged notes from this match.
    const intel = normalizeEnemies(
      {
        summary: "Respect Xavier and Bruno.",
        enemies: [
          { hero: "Julian", threat: "low", items: [], note: "Julian dives you with chains; stay behind teammates and buy magic defense like Athena-style items." },
          { hero: "Hilda", threat: "high", items: [], note: "Two kills, will ambush from bushes; stay near turret, buy armor." },
          { hero: "Alpha", threat: "medium", items: [], note: "Dives with his ultimate; save your escape spell until he jumps in." },
        ],
      },
      late,
      undefined,
      "test",
      T0 + 10 * MIN,
    )!;
    const notes = intel.enemies.map((e) => e.note);
    expect(notes.join(" ")).not.toMatch(/buy|Athena|armor/i);
    expect(notes[1]).toBe("Two kills, will ambush from bushes; stay near turret.");
    expect(notes[2]).toBe("Dives with his ultimate; save your escape spell until he jumps in.");
    expect(withoutShopping("Long-range beams poke you; dodge sideways, stay near turret, consider magic defense.")).toBe("Long-range beams poke you; dodge sideways, stay near turret.");
    // From the next match (Bruno), told to a marksman: a tank's item.
    expect(withoutShopping("Snipes you from range with crits; stay behind cover, buy armor like Antique Cuirass.")).toBe("Snipes you from range with crits; stay behind cover.");
  });
});

describe("items that suit each hero", () => {
  it("names only catalog items, and covers every item each hero's own template uses", () => {
    for (const hero of HEROES) {
      const suit = suitableItems(hero, hero.lanes[0]);
      for (const id of suit) expect(itemById(id), `${hero.name}: ${id}`).toBeDefined();
      const tpl = templateFor(hero, hero.lanes[0]);
      for (const id of [tpl.boots, ...tpl.core, ...tpl.filler, tpl.antiheal, ...tpl.defense.physical, ...tpl.defense.magic]) expect(suit.has(id), `${hero.name}: ${id}`).toBe(true);
    }
  });

  it("never offers a marksman a frontliner's or a support's item", () => {
    for (const hero of HEROES.filter((h) => h.archetype.startsWith("mm_") && h.archetype !== "mm_magic")) {
      const suit = suitableItems(hero, "gold");
      for (const id of ["radiant_armor", "thunder_belt", "dominance_ice", "antique_cuirass", "guardian_helmet", "cursed_helmet", "flask_of_the_oasis", "enchanted_talisman", "rapid_boots", "magic_shoes"]) {
        expect(suit.has(id), `${hero.name}: ${id}`).toBe(false);
      }
    }
  });

  it("never offers a tank or a support a carry's damage item", () => {
    for (const hero of HEROES.filter((h) => h.archetype === "tank" || h.archetype === "support" || h.archetype === "support_heal")) {
      const suit = suitableItems(hero, hero.lanes[0]);
      for (const id of ["windtalker", "berserkers_fury", "blade_of_despair", "holy_crystal", "lightning_truncheon"]) expect(suit.has(id), `${hero.name}: ${id}`).toBe(false);
    }
  });
});

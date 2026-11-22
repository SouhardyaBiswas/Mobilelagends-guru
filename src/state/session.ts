/**
 * Match state and how it changes. Pure and framework-free, so the same logic
 * runs in the browser app and in the screenshot endpoint.
 */
import { heroById } from "../data/heroes";
import { COMPONENTS, componentId, itemById, SELL_REFUND } from "../data/items";
import type { Lane, Observation, PlayerState, ShopEntry } from "../types";

export interface LogEntry {
  at: number;
  kind: "say" | "vision" | "error" | "info";
  text: string;
}

/** Where the player says (or the screenshots show) the game is. */
export type Stage = "draft" | "loading" | "live" | "done";

export const STAGE_LABEL: Record<Stage, string> = {
  draft: "Hero selection",
  loading: "Match starting",
  live: "In match",
  done: "Match over",
};

export interface Session {
  phase: "draft" | "live";
  /** Set from the phone's stage buttons, or inferred from what the screenshots show. */
  stage?: Stage;
  myHeroId?: number;
  lane?: Lane;
  allies: number[];
  enemies: number[];
  banned: number[];
  /** Latest scoreboard stats per enemy hero id. */
  enemyLive: Record<number, PlayerState>;
  /** Manual "this enemy is fed / behind" marks for play without screen reading. */
  manualFed: Record<number, 1 | -1>;
  /** Owned item ids; a cheap component is stored as "comp:<slug>". */
  owned: string[];
  gold?: number;
  /** Wall-clock ms that corresponds to 0:00 on the match clock. */
  clockStart?: number;
  log: LogEntry[];
  calls: number;
  costUsd: number;
  tip?: string;
  /** Bumped whenever a new match begins, so per-match memory (what was said) resets. */
  matchId: number;
  /** The build the player chose in game, read from the shop's Recommended list. */
  plannedBuild?: string[];
  /** Everything their shop lists (recommended + spare) — items they can find without hunting. */
  shopListed?: string[];
  /** Shop price relative to list price, learned from the shop screen (emblem discounts). */
  priceFactor?: number;
  /** Enemy the player is laning against, when they have told us. */
  laneOpponentId?: number;
}

export const EMPTY_SESSION: Session = {
  phase: "draft",
  allies: [],
  enemies: [],
  banned: [],
  enemyLive: {},
  manualFed: {},
  owned: [],
  log: [],
  calls: 0,
  costUsd: 0,
  matchId: 0,
};

export type SessionAction =
  | { type: "setTeam"; side: "allies" | "enemies" | "banned"; ids: number[] }
  | { type: "setMyHero"; id?: number }
  | { type: "setLane"; lane?: Lane }
  | { type: "setLaneOpponent"; id?: number }
  | { type: "startMatch"; now: number }
  | { type: "newMatch" }
  | { type: "backToDraft" }
  | { type: "toggleOwned"; id: string }
  | { type: "bought"; id: string }
  | { type: "sold"; id: string }
  | { type: "swap"; sell: string; buy: string }
  | { type: "setGold"; gold?: number }
  | { type: "cycleFed"; heroId: number }
  | { type: "syncClock"; now: number; gameSec: number }
  | { type: "observe"; obs: Observation; now: number; costUsd?: number }
  | { type: "adopt"; session: Session }
  | { type: "setStage"; stage: Stage; now: number }
  | { type: "log"; entry: LogEntry };

const uniq = <T,>(xs: T[]) => [...new Set(xs)];
const LOG_MAX = 60;

/** Owning a finished item makes its component irrelevant; keep the list tidy. */
function tidyOwned(owned: string[]): string[] {
  const full = new Set(owned.filter((id) => !id.startsWith("comp:")));
  const builtFrom = new Set(
    [...full].map((id) => itemById(id)?.component).filter((c) => !!c).map((c) => componentId(c!.name)),
  );
  return uniq(owned).filter((id) => !(id.startsWith("comp:") && builtFrom.has(id)));
}

/** Merge a roster reading. Loading/draft screens print hero names, so they replace; portraits only fill gaps. */
function mergeRoster(current: number[], seen: number[], authoritative: boolean, exclude: number[]): number[] {
  const clean = seen.filter((id) => !exclude.includes(id));
  if (authoritative && clean.length >= 3) return uniq(clean).slice(0, 5);
  return uniq([...current, ...clean]).slice(0, 5);
}

const overlap = (a: number[], b: number[]) => a.filter((id) => b.includes(id)).length;

/**
 * Work out the shop's discount from printed prices. An item the player already
 * holds a piece of shows a much lower price, so only near-list ratios count.
 */
export function learnPriceFactor(entries: ShopEntry[]): number | undefined {
  const ratios = entries
    .map((e) => (e.price && itemById(e.id) ? e.price / itemById(e.id)!.cost : 0))
    .filter((r) => r >= 0.85 && r <= 1.001)
    .sort((a, b) => a - b);
  if (!ratios.length) return undefined;
  return Math.round(ratios[Math.floor(ratios.length / 2)]! * 100) / 100;
}

/**
 * Make sure "allies" really is the user's team. The model can only go by screen
 * position and colour, which is not reliable; what the app already knows is.
 * A flipped read would make the coach itemise against the user's own team.
 */
export function orientObservation(obs: Observation, s: Pick<Session, "myHeroId" | "allies" | "enemies">): Observation {
  const seenAllies = obs.allies.map((p) => p.heroId);
  const seenEnemies = obs.enemies.map((p) => p.heroId);
  const me = s.myHeroId;
  let flipped: boolean;
  if (me !== undefined && (seenAllies.includes(me) || seenEnemies.includes(me))) {
    flipped = seenEnemies.includes(me);
  } else {
    const mine = me !== undefined ? [me, ...s.allies] : s.allies;
    const asRead = overlap(seenAllies, mine) + overlap(seenEnemies, s.enemies);
    const swapped = overlap(seenEnemies, mine) + overlap(seenAllies, s.enemies);
    flipped = swapped > asRead;
  }
  if (!flipped) return obs;
  // After the flip, "me" is only believable if that hero ended up on the user's side.
  const meHeroId = obs.enemies.some((p) => p.heroId === obs.meHeroId) ? obs.meHeroId : undefined;
  return { ...obs, allies: obs.enemies, enemies: obs.allies, meHeroId };
}

/**
 * A screen showing mostly different heroes means the next game has started.
 * The roster check matters: a mid-match screen misread as "loading" still shows
 * the same heroes and must not wipe the match. Loading and draft screens print
 * hero names, so two are enough; a scoreboard only shows portraits, so it needs
 * most of the lobby to disagree before we believe it.
 */
function isNewMatch(s: Session, obs: Observation): boolean {
  const textScreen = obs.screen === "loading" || obs.screen === "draft";
  if (!textScreen && obs.screen !== "scoreboard") return false;
  if (s.phase !== "live" && s.owned.length === 0) return false;
  const seen = [...obs.allies, ...obs.enemies].map((p) => p.heroId);
  const known = [...s.allies, ...s.enemies, ...(s.myHeroId ? [s.myHeroId] : [])];
  return seen.length >= (textScreen ? 2 : 6) && known.length >= 4 && overlap(seen, known) * 3 <= seen.length;
}

function applyObservation(s0: Session, obs0: Observation, now: number, costUsd = 0): Session {
  let s = s0;
  let obs = obs0;
  if (isNewMatch(s, obs)) {
    // Start clean: last game's items, clock and hero must not leak into this one.
    s = { ...EMPTY_SESSION, lane: s.lane, log: s.log, matchId: s.matchId + 1, stage: "draft" };
  } else {
    obs = orientObservation(obs, s);
  }
  const next: Session = { ...s, calls: s.calls + 1, costUsd: s.costUsd + costUsd, tip: obs.tip };
  const textScreen = obs.screen === "loading" || obs.screen === "draft";
  const rosterScreen = textScreen || obs.screen === "scoreboard" || obs.screen === "post_game";

  if (rosterScreen) {
    const seenAllies = obs.allies.map((p) => p.heroId);
    const seenEnemies = obs.enemies.map((p) => p.heroId);
    if (!next.myHeroId && obs.meHeroId) next.myHeroId = obs.meHeroId;
    const me = next.myHeroId;
    next.enemies = mergeRoster(s.enemies, seenEnemies, textScreen, me ? [me] : []);
    next.allies = mergeRoster(s.allies, seenAllies.filter((id) => id !== me), textScreen, [...next.enemies, ...(me ? [me] : [])]);
    if (!next.lane && me) next.lane = heroById(me)?.lanes[0];
  }

  if (obs.screen === "scoreboard") {
    const live = { ...s.enemyLive };
    for (const p of obs.enemies) if (next.enemies.includes(p.heroId)) live[p.heroId] = p;
    next.enemyLive = live;
    const mine = obs.allies.find((p) => p.heroId === next.myHeroId);
    // Union, not replace: an icon the model could not identify must not look like a sold item.
    if (mine?.items?.length) next.owned = tidyOwned([...s.owned, ...mine.items]);
  }

  // Inventory read straight from the shop's bottom row or the player's own scoreboard row.
  if (obs.myItems?.length && (obs.screen === "shop" || obs.screen === "scoreboard")) {
    next.owned = tidyOwned([...next.owned, ...obs.myItems]);
  }
  if (obs.shop) {
    const rec = obs.shop.recommended.map((e) => e.id);
    if (rec.length >= 3) next.plannedBuild = uniq(rec);
    next.shopListed = uniq([...obs.shop.recommended, ...obs.shop.spare].map((e) => e.id));
    next.priceFactor = learnPriceFactor([...obs.shop.recommended, ...obs.shop.spare]) ?? next.priceFactor;
  }
  if (obs.myGold !== undefined) next.gold = obs.myGold;
  if (obs.gameTimeSec !== undefined) next.clockStart = now - obs.gameTimeSec * 1000;
  // Seeing the match is the cue to leave draft mode.
  if ((obs.screen === "scoreboard" || obs.screen === "gameplay" || obs.screen === "shop") && next.myHeroId) {
    next.phase = "live";
    next.clockStart ??= now;
  }
  // Keep the stage in step with what the screen shows, so the buttons rarely need touching.
  if (next.phase === "live") next.stage = "live";
  else if (obs.screen === "loading") next.stage = "loading";
  else if (obs.screen === "draft") next.stage = "draft";
  return next;
}

export function sessionReducer(s: Session, a: SessionAction): Session {
  switch (a.type) {
    case "setTeam":
      return { ...s, [a.side]: uniq(a.ids).slice(0, a.side === "banned" ? 10 : a.side === "allies" ? 4 : 5) };
    case "setMyHero": {
      const hero = a.id ? heroById(a.id) : undefined;
      return {
        ...s,
        myHeroId: a.id,
        lane: hero && (!s.lane || !hero.lanes.includes(s.lane)) ? hero.lanes[0] : s.lane,
        allies: s.allies.filter((id) => id !== a.id),
        owned: a.id === s.myHeroId ? s.owned : [],
      };
    }
    case "setLane":
      return { ...s, lane: a.lane };
    case "setLaneOpponent":
      return { ...s, laneOpponentId: a.id };
    case "startMatch":
      return { ...s, phase: "live", clockStart: a.now, owned: [], gold: undefined, enemyLive: {}, manualFed: {}, tip: undefined, calls: 0, costUsd: 0, matchId: s.matchId + 1 };
    case "newMatch":
      return { ...EMPTY_SESSION, lane: s.lane, matchId: s.matchId + 1 };
    case "backToDraft":
      return { ...s, phase: "draft" };
    case "toggleOwned":
      return { ...s, owned: s.owned.includes(a.id) ? s.owned.filter((id) => id !== a.id) : tidyOwned([...s.owned, a.id]) };
    case "bought": {
      const full = itemById(a.id);
      // Finishing an item only costs the difference when its component is already owned.
      const comp = full?.component;
      const haveComp = !!comp && s.owned.includes(componentId(comp.name));
      const pay = (n: number) => Math.floor(n * (s.priceFactor ?? 1));
      const cost = a.id.startsWith("comp:")
        ? pay(COMPONENTS.get(a.id)?.cost ?? 0)
        : full
          ? pay(haveComp && comp ? full.cost - comp.cost : full.cost)
          : undefined;
      return {
        ...s,
        owned: tidyOwned([...s.owned, a.id]),
        gold: s.gold !== undefined && cost !== undefined ? Math.max(0, s.gold - cost) : s.gold,
      };
    }
    case "sold":
      return { ...s, owned: s.owned.filter((id) => id !== a.id) };
    case "swap": {
      // Sell one item and buy another in a single step (a sell-swap recommendation).
      const refund = Math.round((itemById(a.sell)?.cost ?? 0) * SELL_REFUND);
      const cost = itemById(a.buy)?.cost ?? 0;
      return {
        ...s,
        owned: tidyOwned([...s.owned.filter((id) => id !== a.sell), a.buy]),
        gold: s.gold !== undefined ? Math.max(0, s.gold + refund - cost) : s.gold,
      };
    }
    case "setGold":
      return { ...s, gold: a.gold };
    case "cycleFed": {
      const cur = s.manualFed[a.heroId];
      const manualFed = { ...s.manualFed };
      if (cur === undefined) manualFed[a.heroId] = 1;
      else if (cur === 1) manualFed[a.heroId] = -1;
      else delete manualFed[a.heroId];
      return { ...s, manualFed };
    }
    case "syncClock":
      return { ...s, clockStart: a.now - a.gameSec * 1000 };
    case "observe":
      return applyObservation(s, a.obs, a.now, a.costUsd);
    case "setStage":
      switch (a.stage) {
        case "draft":
          // A new hero selection is a new match: nothing from the last one may leak in.
          return { ...EMPTY_SESSION, lane: s.lane, log: s.log, matchId: s.matchId + 1, stage: "draft" };
        case "loading":
          return { ...s, phase: "draft", stage: "loading" };
        case "live":
          return s.phase === "live" ? { ...s, stage: "live" } : { ...s, phase: "live", stage: "live", clockStart: s.clockStart ?? a.now };
        case "done":
          return { ...s, phase: "draft", stage: "done" };
      }
      return s;
    case "adopt":
      // Match state from the server replaces ours; this device keeps its own log of what was said.
      return { ...EMPTY_SESSION, ...a.session, log: s.log };
    case "log":
      return { ...s, log: [a.entry, ...s.log].slice(0, LOG_MAX) };
    default:
      return s;
  }
}

/** No match lasts this long; a "live" session older than this was left over from an earlier sitting. */
const STALE_MATCH_MS = 60 * 60 * 1000;

/** Drop a restored match that is clearly over, so yesterday's items and enemies don't coach today's game. */
export function freshSession(saved: Session, now: number): Session {
  const stale = saved.phase === "live" && saved.clockStart !== undefined && now - saved.clockStart > STALE_MATCH_MS;
  return stale ? { ...EMPTY_SESSION, lane: saved.lane, matchId: saved.matchId + 1 } : saved;
}

/** Enemy roster with the best available "how fed are they" information attached. */
export function enemyStates(s: Session): PlayerState[] {
  return s.enemies.map((heroId) => {
    const live = s.enemyLive[heroId];
    if (live) return live;
    const mark = s.manualFed[heroId];
    if (mark === 1) return { heroId, kills: 6, deaths: 0 };
    if (mark === -1) return { heroId, kills: 0, deaths: 5 };
    return { heroId };
  });
}

export const gameSeconds = (s: Session, now: number): number | undefined =>
  s.phase === "live" && s.clockStart !== undefined ? Math.max(0, Math.floor((now - s.clockStart) / 1000)) : undefined;


export const stageOf = (s: Session): Stage => s.stage ?? (s.phase === "live" ? "live" : "draft");

/** Actions a controlling device (the phone) may send to the server's copy of the match. */
export const CONTROLLER_ACTIONS: ReadonlySet<SessionAction["type"]> = new Set([
  "setStage", "setTeam", "setMyHero", "setLane", "setLaneOpponent", "startMatch", "newMatch", "backToDraft",
  "toggleOwned", "bought", "sold", "swap", "setGold", "cycleFed", "syncClock",
]);

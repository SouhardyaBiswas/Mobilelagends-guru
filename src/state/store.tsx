import { createContext, useContext, useEffect, useMemo, useReducer, type Dispatch, type ReactNode } from "react";
import type { SpeechSettings } from "../audio/speech";
import { heroById } from "../data/heroes";
import { COMPONENTS, componentId, itemById, SELL_REFUND } from "../data/items";
import type { Lane, Observation, PlayerState } from "../types";
import { DEFAULT_VISION, type VisionSettings } from "../vision";

export interface CaptureSettings {
  /** "auto" waits for a still screen; "interval" analyses on a fixed timer. */
  mode: "auto" | "interval";
  intervalSec: number;
  /** Motion threshold (0-255 mean pixel change) under which the screen counts as still. */
  stillThreshold: number;
  /** Hard cap on vision calls per match, so a stuck loop cannot run up a bill. */
  maxCalls: number;
}

export interface Settings {
  vision: VisionSettings;
  speech: SpeechSettings;
  capture: CaptureSettings;
}

export interface LogEntry {
  at: number;
  kind: "say" | "vision" | "error" | "info";
  text: string;
}

export interface Session {
  phase: "draft" | "live";
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
}

export interface State {
  settings: Settings;
  session: Session;
}

export const DEFAULT_SETTINGS: Settings = {
  vision: DEFAULT_VISION,
  speech: { enabled: true, rate: 1.05, volume: 1 },
  capture: { mode: "auto", intervalSec: 20, stillThreshold: 3, maxCalls: 80 },
};

const EMPTY_SESSION: Session = {
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

export type Action =
  | { type: "settings"; patch: Partial<Settings> }
  | { type: "setTeam"; side: "allies" | "enemies" | "banned"; ids: number[] }
  | { type: "setMyHero"; id?: number }
  | { type: "setLane"; lane?: Lane }
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
 * A loading or draft screen showing mostly different heroes means the next game
 * has started. The roster check matters: a mid-match screen misread as "loading"
 * still shows the same heroes and must not wipe the match.
 */
function isNewMatch(s: Session, obs: Observation): boolean {
  if (obs.screen !== "loading" && obs.screen !== "draft") return false;
  if (s.phase !== "live" && s.owned.length === 0) return false;
  const seen = [...obs.allies, ...obs.enemies].map((p) => p.heroId);
  const known = [...s.allies, ...s.enemies, ...(s.myHeroId ? [s.myHeroId] : [])];
  return seen.length >= 2 && known.length >= 4 && overlap(seen, known) * 3 <= seen.length;
}

function applyObservation(s0: Session, obs0: Observation, now: number, costUsd = 0): Session {
  let s = s0;
  let obs = obs0;
  if (isNewMatch(s, obs)) {
    // Start clean: last game's items, clock and hero must not leak into this one.
    s = { ...EMPTY_SESSION, lane: s.lane, log: s.log, matchId: s.matchId + 1 };
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

  if (obs.myGold !== undefined) next.gold = obs.myGold;
  if (obs.gameTimeSec !== undefined) next.clockStart = now - obs.gameTimeSec * 1000;
  // Seeing the match is the cue to leave draft mode.
  if ((obs.screen === "scoreboard" || obs.screen === "gameplay" || obs.screen === "shop") && next.myHeroId) {
    next.phase = "live";
    next.clockStart ??= now;
  }
  return next;
}

function sessionReducer(s: Session, a: Action): Session {
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
      const cost = a.id.startsWith("comp:") ? COMPONENTS.get(a.id)?.cost : full ? full.cost - (haveComp && comp ? comp.cost : 0) : undefined;
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
    case "log":
      return { ...s, log: [a.entry, ...s.log].slice(0, LOG_MAX) };
    default:
      return s;
  }
}

function reducer(state: State, a: Action): State {
  if (a.type === "settings") return { ...state, settings: { ...state.settings, ...a.patch } };
  const session = sessionReducer(state.session, a);
  return session === state.session ? state : { ...state, session };
}

const KEY_SETTINGS = "mlbb-guru:settings:v1";
const KEY_SESSION = "mlbb-guru:session:v1";

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...(JSON.parse(raw) as Partial<T>) } : fallback;
  } catch {
    return fallback;
  }
}

function initialState(): State {
  const saved = load<Settings>(KEY_SETTINGS, DEFAULT_SETTINGS);
  return {
    settings: {
      vision: { ...DEFAULT_SETTINGS.vision, ...saved.vision },
      speech: { ...DEFAULT_SETTINGS.speech, ...saved.speech },
      capture: { ...DEFAULT_SETTINGS.capture, ...saved.capture },
    },
    session: load<Session>(KEY_SESSION, EMPTY_SESSION),
  };
}

const Ctx = createContext<{ state: State; dispatch: Dispatch<Action> } | undefined>(undefined);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  useEffect(() => {
    try {
      localStorage.setItem(KEY_SETTINGS, JSON.stringify(state.settings));
    } catch {
      /* private mode: settings just won't persist */
    }
  }, [state.settings]);
  useEffect(() => {
    try {
      localStorage.setItem(KEY_SESSION, JSON.stringify(state.session));
    } catch {
      /* ignore */
    }
  }, [state.session]);
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useStore must be used inside StoreProvider");
  return ctx;
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

export { sessionReducer, EMPTY_SESSION };

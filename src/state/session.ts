/**
 * Match state and how it changes. Pure and framework-free, so the same logic
 * runs in the browser app and in the screenshot endpoint.
 */
import { heroById } from "../data/heroes";
import { COMPONENTS, componentId, itemById, SELL_REFUND } from "../data/items";
import { storyBeat } from "../engine/story";
import type { AiAdvice, AiBuild, EnemyIntel, Lane, Observation, PlayerState, PositionAdvice, ShopEntry, StoryBeat } from "../types";

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

/** One scoreboard reading, kept so the coach can tell how the match is moving, not just where it stands. */
export interface Snapshot {
  /** Match clock in seconds when it was read. */
  at: number;
  players: Record<number, { gold?: number; kills?: number; deaths?: number; assists?: number }>;
}

const HISTORY_MAX = 40;
const STORY_MAX = 40;
const SCENES_MAX = 6;
/** With screenshots arriving every few seconds, this many in a row with no game on them means the player has left the match. */
const IDLE_FRAMES_END = 8;
/** Pocket gold read within this long of the last reading can be checked against it. */
const GOLD_CHECK_MS = 30_000;

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
  /** Latest scoreboard stats for the player's own team (including the player). */
  allyLive: Record<number, PlayerState>;
  /** Every scoreboard reading this match, oldest first: the match's memory. */
  history: Snapshot[];
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
  /**
   * Gold the player has spent so far: total earned (their scoreboard row) minus what is in
   * their pocket (top-right corner). Both are printed numbers, so this is the trustworthy
   * measure of how far along the build they are — unlike item icons, which get misread.
   */
  spent?: number;
  /** The player's items as last read from icons, kept only when it fits what they have spent. */
  seenItems?: string[];
  /** Remaining prices printed in the shop, and the spend level they were read at. */
  shopPrices?: Record<string, number>;
  shopPricesSpent?: number;
  /** A clock reading that disagreed with ours; adopted only if the next reading agrees with it. */
  pendingClock?: number;
  /** True once the clock came from a screenshot. A clock started by a tap or a guess yields to the first real reading. */
  clockSure?: boolean;
  /** The item the player is part-way through buying (its pieces sit in their inventory), when a read showed it. */
  seenPartial?: string;
  /** An icon read of the player's items that did not agree with the last one; believed if the next read confirms it. */
  pendingSeen?: string[];
  /**
   * Gold the scoreboard leaves out of a player's total. Some matches print totals without the
   * starting gold; a believed inventory that costs about that much more than "spent" shows it.
   */
  goldOffset?: number;
  /** Wall-clock ms of the scoreboard that "spent" was last measured from. Later than that it is only a floor. */
  spentAt?: number;
  /** Scoreboard rows that went backwards (a misread); held until the next read says which was right. */
  doubt?: Record<number, PlayerState>;
  /** The storyboard: one line per scoreboard, oldest first. */
  story?: StoryBeat[];
  /** The AI coach's latest read of the match, and the build order it chose. */
  ai?: AiAdvice;
  aiBuild?: AiBuild;
  /** The latest answer to "help me position". */
  position?: PositionAdvice;
  /** What the enemy-tracking specialist last concluded. */
  intel?: EnemyIntel;
  /** Where the player has been lately, as the reader described each battlefield frame: hints for the positioning specialist. */
  scenes?: Array<{ at: number; text: string }>;
  /** When pocket gold was last believed, and a reading that disagreed with it and awaits a second opinion. */
  goldAt?: number;
  pendingGold?: number;
  /** Frames in a row that showed no game at all. Enough of them and the match is taken to be over. */
  idleFrames?: number;
}

/** List value of a set of item / component ids. */
const valueOf = (ids: string[]): number =>
  ids.reduce((sum, id) => sum + (id.startsWith("comp:") ? (COMPONENTS.get(id)?.cost ?? 0) : (itemById(id)?.cost ?? 0)), 0);

/**
 * Is an icon reading believable? Small item icons are the one thing vision models
 * misread, usually by naming an expensive finished item where a cheap piece sits.
 * Gold is printed text and reliable, so: nobody owns more than they have earned,
 * two pairs of boots, or the same item twice.
 */
export function believableItems(ids: string[] | undefined, budget: number | undefined, slack = 300): boolean {
  if (!ids?.length) return true;
  const finished = ids.filter((id) => !id.startsWith("comp:"));
  if (new Set(finished).size !== finished.length) return false;
  if (finished.filter((id) => itemById(id)?.category === "boots").length > 1) return false;
  return budget === undefined || valueOf(ids) <= budget + slack;
}

const keepBelievable = (p: PlayerState): PlayerState => (believableItems(p.items, p.gold) ? p : { ...p, items: undefined });

/** Starting gold, which some scoreboards leave out of a player's total. */
const START_GOLD = 300;
/** How long after a scoreboard its "gold spent" still describes the present. */
const SPENT_FRESH_MS = 45_000;
/** Nobody earns faster than this, even far ahead late in a match. */
const MAX_GOLD_PER_SEC = 25;

const priceOf = (id: string, factor = 1): number => Math.floor((id.startsWith("comp:") ? (COMPONENTS.get(id)?.cost ?? 0) : (itemById(id)?.cost ?? 0)) * factor);
const inventoryValue = (ids: string[], factor = 1): number => ids.reduce((sum, id) => sum + priceOf(id, factor), 0);
/** An inventory never holds the same finished item twice, or two pairs of boots. */
function possibleInventory(ids: string[]): boolean {
  const finished = ids.filter((id) => !id.startsWith("comp:"));
  return new Set(finished).size === finished.length && finished.filter((id) => itemById(id)?.category === "boots").length <= 1 && ids.length <= 6;
}

/**
 * Fit an icon read of the player's own items to what they have spent. Returns the
 * finished items, the one still being built when the list only fits that way (its
 * pieces were read as the finished item), and how far the list exceeds the spending.
 */
export function fitOwnItems(ids: string[] | undefined, spent: number | undefined, factor = 1): { items: string[]; partial?: string; over: number } | undefined {
  if (!ids?.length || !possibleInventory(ids)) return undefined;
  const finished = ids.filter((id) => !id.startsWith("comp:"));
  if (spent === undefined) return { items: ids, over: 0 };
  const cost = (id: string) => priceOf(id, factor);
  const value = inventoryValue(ids, factor);
  if (value <= spent + START_GOLD + 50) return { items: ids, over: Math.max(0, value - spent) };
  // One item too many for the gold: the newest one is probably still in pieces.
  for (const id of [...finished].reverse()) {
    const rest = value - cost(id);
    if (rest <= spent + 60 && spent - rest < cost(id)) return { items: ids.filter((x) => x !== id), partial: id, over: 0 };
  }
  return undefined;
}

const NUMBERS = ["gold", "kills", "deaths", "assists"] as const;
/** Scoreboard numbers only ever go up within a match. */
const wentBackwards = (prev: PlayerState | undefined, p: PlayerState): boolean =>
  !!prev && NUMBERS.some((k) => prev[k] !== undefined && p[k] !== undefined && p[k]! < prev[k]!);

/**
 * Decide what to believe about one scoreboard row. A row whose numbers went down
 * is a misread — unless the next read agrees with it, in which case the earlier
 * figure was the wrong one.
 */
function settleRow(prev: PlayerState | undefined, read: PlayerState, doubt: Record<number, PlayerState>): PlayerState {
  const p = keepBelievable(read);
  const merged = (): PlayerState => ({
    ...p,
    gold: p.gold ?? prev?.gold,
    kills: p.kills ?? prev?.kills,
    deaths: p.deaths ?? prev?.deaths,
    assists: p.assists ?? prev?.assists,
    level: p.level ?? prev?.level,
    items: p.items?.length ? p.items : prev?.items,
  });
  if (!wentBackwards(prev, p)) {
    delete doubt[p.heroId];
    return merged();
  }
  const held = doubt[p.heroId];
  if (held && !wentBackwards(held, p)) {
    delete doubt[p.heroId];
    return p;
  }
  doubt[p.heroId] = p;
  return prev!;
}

export const EMPTY_SESSION: Session = {
  phase: "draft",
  allies: [],
  enemies: [],
  banned: [],
  enemyLive: {},
  allyLive: {},
  history: [],
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
  | { type: "ai"; advice: AiAdvice; beat?: StoryBeat; build?: AiBuild }
  | { type: "position"; advice: PositionAdvice }
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

/** Merge a roster reading. Screens that print hero names replace what we had; portrait-only reads just fill gaps. */
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
  // A highlighted row on a screen that prints names already tells us which side is the player's;
  // a hero we stored earlier (possibly a draft misread) must not overrule it.
  if (obs.meHeroId !== undefined && (obs.screen === "scoreboard" || obs.screen === "loading")) return obs;
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
  // The scoreboard and loading screen print every hero's name. Draft slots are bare portraits (and a
  // hero can be previewed before it is locked), so a draft read never overrules a printed one.
  const printed = obs.screen === "scoreboard" || obs.screen === "loading" || obs.screen === "post_game";
  const rosterScreen = printed || obs.screen === "draft";

  if (rosterScreen) {
    const seenAllies = obs.allies.map((p) => p.heroId);
    const seenEnemies = obs.enemies.map((p) => p.heroId);
    // The highlighted row on a printed screen is the truth about who the player is.
    if (obs.meHeroId && (printed || !next.myHeroId)) next.myHeroId = obs.meHeroId;
    const me = next.myHeroId;
    next.enemies = mergeRoster(s.enemies, seenEnemies, printed, me ? [me] : []);
    next.allies = mergeRoster(s.allies, seenAllies.filter((id) => id !== me), printed, [...next.enemies, ...(me ? [me] : [])]);
    if (!next.lane && me) next.lane = heroById(me)?.lanes[0];
  }

  if (obs.screen === "scoreboard") {
    // Item lists that cost more than the player has earned are icon misreads: keep the numbers, drop the items.
    // Numbers that went down since the last scoreboard are misreads too: keep the earlier row.
    const doubt = { ...(s.doubt ?? {}) };
    const live = { ...s.enemyLive };
    for (const p of obs.enemies) if (next.enemies.includes(p.heroId)) live[p.heroId] = settleRow(s.enemyLive[p.heroId], p, doubt);
    next.enemyLive = live;
    const mineLive = { ...s.allyLive };
    for (const p of obs.allies) mineLive[p.heroId] = settleRow(s.allyLive[p.heroId], p, doubt);
    next.allyLive = mineLive;
    next.doubt = doubt;
    // How much the player has spent: total earned minus what is in their pocket. Both are printed numbers.
    const mine = obs.allies.find((p) => p.heroId === next.myHeroId);
    if (mine?.gold !== undefined && obs.myGold !== undefined && mine.gold >= obs.myGold && !doubt[mine.heroId]) {
      next.spent = mine.gold - obs.myGold + (next.goldOffset ?? 0);
      next.spentAt = now;
    }
  }
  // Pocket gold from a single battlefield frame can be a misread, and with frames arriving every few
  // seconds one misread would look like a purchase. A reading far from the last one (a big drop, or
  // a jump no kill explains) is held until the next frame agrees with it. A scoreboard is believed
  // outright, and so is any reading when the last one is too old to compare with.
  let goldBelieved = obs.myGold !== undefined;
  if (obs.myGold !== undefined && obs.screen !== "scoreboard" && s.gold !== undefined && s.goldAt !== undefined && now - s.goldAt <= GOLD_CHECK_MS) {
    const delta = obs.myGold - s.gold;
    const ordinary = delta >= -150 && delta <= 800;
    const confirmed = s.pendingGold !== undefined && Math.abs(obs.myGold - s.pendingGold) <= 300;
    if (!ordinary && !confirmed) {
      goldBelieved = false;
      next.pendingGold = obs.myGold;
    }
  }
  if (goldBelieved) next.pendingGold = undefined;
  if (goldBelieved && obs.screen !== "scoreboard" && obs.myGold !== undefined && s.gold !== undefined && s.spent !== undefined && obs.myGold < s.gold - 150) {
    // Between scoreboards, a (believed) drop in pocket gold is a purchase.
    next.spent = s.spent + (s.gold - obs.myGold);
  }

  // The shop's printed prices show the discount in force; it is needed to price the inventory below.
  if (obs.shop) next.priceFactor = learnPriceFactor([...obs.shop.recommended, ...obs.shop.spare]) ?? next.priceFactor;
  // The player's own items as icons (their scoreboard row, or the shop's inventory row):
  // believed only when they fit what has been spent.
  // "Spent" is exact only at the moment of a scoreboard. Minutes later, with purchases in between
  // that no screenshot showed, it is merely the least the player can have spent.
  const spentIsCurrent = next.spentAt !== undefined && now - next.spentAt <= SPENT_FRESH_MS;
  if (obs.screen === "shop" && obs.myItems?.length && !spentIsCurrent) {
    // So an inventory read in the shop cannot be checked against it. Believe it if it is a possible
    // inventory at all and not more than could have been earned since, and raise the floor to its cost.
    const ids = uniq(obs.myItems);
    const value = inventoryValue(ids, next.priceFactor);
    const earned = next.myHeroId !== undefined ? s.allyLive[next.myHeroId]?.gold : undefined;
    const ceiling = earned !== undefined && next.spentAt !== undefined ? earned + START_GOLD + 150 + ((now - next.spentAt) / 1000) * MAX_GOLD_PER_SEC : undefined;
    if (possibleInventory(ids) && (ceiling === undefined || value <= ceiling)) {
      next.seenItems = ids;
      next.seenPartial = undefined;
      next.pendingSeen = undefined;
      next.spent = Math.max(next.spent ?? 0, value);
    }
  } else if (obs.screen === "shop" || obs.screen === "scoreboard") {
    const mineRow = obs.screen === "scoreboard" ? obs.allies.find((p) => p.heroId === next.myHeroId) : undefined;
    const read = obs.myItems?.length ? obs.myItems : mineRow?.items;
    const fit = fitOwnItems(read, next.spent ?? mineRow?.gold, next.priceFactor);
    if (fit) {
      const now = uniq(fit.items);
      const grows = (base: string[] | undefined) => !!base?.length && base.every((id) => now.includes(id));
      // The shop's inventory row is large and reliable. A scoreboard row is tiny: believe it when it
      // builds on what was seen before, or when two reads in a row agree.
      const trusted = obs.screen === "shop" || (!s.seenItems?.length && !fit.partial) || grows(s.seenItems) || grows(s.pendingSeen);
      if (trusted) {
        next.seenItems = now;
        next.seenPartial = fit.partial;
        next.pendingSeen = undefined;
        // A believed inventory worth about the starting gold more than "spent": this scoreboard leaves it out.
        if (obs.screen === "shop" && !next.goldOffset && next.spent !== undefined && fit.over >= START_GOLD - 100) {
          next.goldOffset = START_GOLD;
          next.spent += START_GOLD;
        }
      } else {
        next.pendingSeen = now;
      }
    }
  }
  if (obs.shop) {
    const rec = obs.shop.recommended.map((e) => e.id);
    if (rec.length >= 3) next.plannedBuild = uniq(rec);
    const listed = [...obs.shop.recommended, ...obs.shop.spare];
    next.shopListed = uniq(listed.map((e) => e.id));
    // Prices printed in the shop already account for the pieces the player owns.
    next.shopPrices = Object.fromEntries(listed.filter((e) => e.price !== undefined && e.price > 0).map((e) => [e.id, e.price!]));
    next.shopPricesSpent = next.spent;
  }
  if (obs.myGold !== undefined && goldBelieved) {
    next.gold = obs.myGold;
    next.goldAt = now;
  }
  // The match clock only appears on in-match screens; a draft countdown or anything else is not it.
  const inMatch = obs.screen === "scoreboard" || obs.screen === "gameplay" || obs.screen === "map" || obs.screen === "shop";
  if (obs.gameTimeSec !== undefined && inMatch) {
    const candidate = now - obs.gameTimeSec * 1000;
    if (next.clockStart === undefined || !next.clockSure || Math.abs(candidate - next.clockStart) <= 120_000) {
      next.clockStart = candidate;
      next.clockSure = true;
      next.pendingClock = undefined;
    } else if (next.pendingClock !== undefined && Math.abs(candidate - next.pendingClock) <= 30_000) {
      // Two readings in a row agree with each other and not with us: we were the ones who were wrong.
      next.clockStart = candidate;
      next.pendingClock = undefined;
    } else {
      // One reading far from our clock is more likely a misread timer than a real jump.
      next.pendingClock = candidate;
    }
  }
  // Seeing the match is the cue to leave draft mode.
  if (inMatch && next.myHeroId) {
    next.phase = "live";
    next.clockStart ??= now;
  }
  // Remember this scoreboard so later ones can be compared against it.
  if (obs.screen === "scoreboard") {
    // The clock printed on this very scoreboard is the best timestamp for it.
    const at = obs.gameTimeSec ?? (next.clockStart !== undefined ? Math.max(0, Math.round((now - next.clockStart) / 1000)) : 0);
    const players: Snapshot["players"] = {};
    for (const seen of [...obs.allies, ...obs.enemies]) {
      // Remember what was believed about the row, not a figure that was thrown out.
      const p = next.allyLive[seen.heroId] ?? next.enemyLive[seen.heroId] ?? seen;
      if (p.gold !== undefined || p.kills !== undefined) players[p.heroId] = { gold: p.gold, kills: p.kills, deaths: p.deaths, assists: p.assists };
    }
    if (Object.keys(players).length) {
      const history = [...next.history];
      // Two reads of the same open scoreboard are one moment, not two.
      const last = history.at(-1);
      const same = !!last && Math.abs(last.at - at) < 20;
      if (same) history[history.length - 1] = { at, players };
      else history.push({ at, players });
      next.history = history.slice(-HISTORY_MAX);
      // One storyboard line per scoreboard: what changed since the one before.
      const beat = storyBeat(next);
      if (beat) next.story = addBeat(next.story, beat);
    }
  }
  // Where the player was, as the reader described this frame.
  if (obs.scene && next.clockStart !== undefined) {
    const at = obs.gameTimeSec ?? Math.max(0, Math.round((now - next.clockStart) / 1000));
    next.scenes = [...(s.scenes ?? []), { at, text: obs.scene }].slice(-SCENES_MAX);
  }
  // Keep the stage in step with what the screen shows, so the buttons rarely need touching.
  if (next.phase === "live") next.stage = "live";
  else if (obs.screen === "loading") next.stage = "loading";
  else if (obs.screen === "draft") next.stage = "draft";
  // The results screen, or a run of frames with no game on them, ends the match: reading pauses
  // and a repeating shortcut is told to stop, instead of photographing the lobby until it runs out.
  next.idleFrames = obs.screen === "other" ? (s.idleFrames ?? 0) + 1 : 0;
  const wasPlaying = stageOf(s) === "live" || stageOf(s) === "loading";
  if (obs.screen === "post_game" || (wasPlaying && next.idleFrames >= IDLE_FRAMES_END)) {
    next.phase = "draft";
    next.stage = "done";
    next.idleFrames = 0;
  }
  return next;
}

/** Add a line to the storyboard; a line for the same moment replaces the one already there. */
export function addBeat(story: StoryBeat[] | undefined, beat: StoryBeat): StoryBeat[] {
  const lines = [...(story ?? [])];
  const last = lines.at(-1);
  if (last && Math.abs(last.at - beat.at) < 20) lines[lines.length - 1] = beat;
  else lines.push(beat);
  return lines.slice(-STORY_MAX);
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
      return {
        ...s, phase: "live", clockStart: a.now, owned: [], gold: undefined, enemyLive: {}, allyLive: {}, history: [], manualFed: {}, tip: undefined, calls: 0, costUsd: 0, matchId: s.matchId + 1,
        spent: undefined, spentAt: undefined, seenItems: undefined, seenPartial: undefined, pendingSeen: undefined, goldOffset: undefined, doubt: undefined, story: undefined, ai: undefined, aiBuild: undefined, position: undefined,
        intel: undefined, scenes: undefined, goldAt: undefined, pendingGold: undefined, idleFrames: undefined,
      };
    case "newMatch":
      return { ...EMPTY_SESSION, lane: s.lane, matchId: s.matchId + 1 };
    case "backToDraft":
      return { ...s, phase: "draft" };
    case "toggleOwned":
      return { ...s, owned: s.owned.includes(a.id) ? s.owned.filter((id) => id !== a.id) : tidyOwned([...s.owned, a.id]) };
    case "bought": {
      const full = itemById(a.id);
      const pay = (n: number) => Math.floor(n * (s.priceFactor ?? 1));
      // What it costs right now: the shop's own printed price if still current, else list price
      // less a piece the player already holds.
      const comp = full?.component;
      const haveComp = !!comp && [...s.owned, ...(s.seenItems ?? [])].includes(componentId(comp.name));
      const quoted = buildInputs(s).shopPrices?.[a.id];
      const cost = a.id.startsWith("comp:")
        ? pay(COMPONENTS.get(a.id)?.cost ?? 0)
        : full
          ? (quoted ?? pay(haveComp && comp ? full.cost - comp.cost : full.cost))
          : undefined;
      return {
        ...s,
        owned: tidyOwned([...s.owned, a.id]),
        gold: s.gold !== undefined && cost !== undefined ? Math.max(0, s.gold - cost) : s.gold,
        // Keep the spend tally in step so the same purchase is not counted twice.
        spent: s.spent !== undefined && cost !== undefined ? s.spent + cost : s.spent,
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
      // The player set the clock by hand: trust it like a reading.
      return { ...s, clockStart: a.now - a.gameSec * 1000, clockSure: true, pendingClock: undefined };
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
    case "ai":
      return { ...s, ai: a.advice, aiBuild: a.build ?? s.aiBuild, story: a.beat ? addBeat(s.story, a.beat) : s.story };
    case "position":
      return { ...s, position: a.advice };
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

/** Everything the build planner needs from a session, in one place so every caller agrees. */
export function buildInputs(s: Session) {
  // Shop prices stay valid until the player has spent more.
  const fresh = s.shopPrices && Math.abs((s.spent ?? 0) - (s.shopPricesSpent ?? 0)) <= 100;
  return {
    lane: s.lane,
    enemies: enemyStates(s),
    owned: s.owned,
    seenItems: s.seenItems,
    spent: s.spent,
    shopPrices: fresh ? s.shopPrices : undefined,
    plannedBuild: s.plannedBuild,
    shopListed: s.shopListed,
    priceFactor: s.priceFactor,
    partial: s.seenPartial,
    aiBuild: s.aiBuild,
  };
}

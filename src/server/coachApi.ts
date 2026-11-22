/**
 * Screenshot-in, advice-out endpoint for the Shortcuts on the device that plays
 * (deployed as a Vercel Function at /api/coach). It holds no secret: the caller
 * sends their own model API key with each request, so a public URL costs the
 * owner nothing.
 *
 * How a frame is handled
 * 1. A fast reader model transcribes the screenshot and says what kind of screen
 *    it is (battlefield, map, scoreboard, shop…). This happens before the answer
 *    is sent, so a shortcut sending frames in a loop can never get ahead of it.
 * 2. The rule engine folds that into the room: gold spent, what is owned, who is
 *    fed, where the player has been.
 * 3. Specialists — each a call to a strong model — run when their own input has
 *    changed: the coach (build order and calls) after a scoreboard, shop or
 *    loading screen; the enemy tracker after a scoreboard; positioning about once
 *    a minute from battlefield frames. Where the host allows it they run after
 *    the answer has gone out, so the frame loop is not held up.
 *
 * Who writes what
 * The store shared by all copies of this function has no compare-and-swap, and
 * can hand back the previous value for a moment after a write. So every piece of
 * memory has exactly one kind of writer: frames and taps own the room; each
 * specialist owns its own entry; spoken answers own theirs. The dashboard's poll
 * puts them together.
 */
import { waitUntil } from "@vercel/functions";
import { COACH_SCHEMA, COACH_SYSTEM, coachBrief, demoCoach, normalizeCoach } from "../ai/coach";
import { demoEnemies, ENEMY_SCHEMA, ENEMY_SYSTEM, enemyBrief, normalizeEnemies } from "../ai/enemies";
import { demoPosition, normalizePosition, POSITION_SCHEMA, POSITION_SYSTEM, positionBrief, type PositionPicture } from "../ai/position";
import { HEROES, heroName } from "../data/heroes";
import type { AiAdvice, AiBuild, EnemyIntel, Observation, PositionAdvice, StoryBeat } from "../types";
import { planBuild } from "../engine/build";
import { answerQuestion, ASK_TOPICS, coachReply, type AskTopic } from "../engine/reply";
import { CONTROLLER_ACTIONS, EMPTY_SESSION, gameSeconds, sessionReducer, stageOf, type Session, type SessionAction, type Stage } from "../state/session";
import { claudeAsk, claudeVision } from "../vision/claude";
import { demoVision } from "../vision/demo";
import { geminiAsk, geminiVision } from "../vision/gemini";
import { normalizeObservation } from "../vision/schema";
import { VisionError, type AskJson, type VisionCall, type VisionImage } from "../vision/types";
import { storeForRequest, type KeyValue } from "./store";

const MAX_BYTES = 4_000_000;
const ROOM_TTL_SEC = 3 * 60 * 60;
const DEFAULT_MODEL = { gemini: "gemini-3.8-flash", claude: "claude-opus-5-5" } as const;
/** Two screenshots this close together on the match clock show the same moment: the coach is not asked twice. */
const COACH_GAP_SEC = 20;
/** How often positioning is reviewed from battlefield frames, and how soon again after the player opens the map. */
const POSITION_EVERY_MS = 60_000;
const POSITION_AFTER_MAP_MS = 20_000;
/** The enemy tracker reads the scoreboard picture no more often than this. */
const ENEMIES_EVERY_MS = 45_000;
/** A specialist that started this recently is still working: do not start it again. */
const STILL_RUNNING_MS = 15_000;
/** How long the first positioning picture waits for the second, and how long an opened-map picture stays useful. */
const POSITION_WAIT_MS = 120_000;
/**
 * The function may run for 60 seconds, and the shortcut needs a proper answer either way.
 * The reader gets most of that; a specialist is optional, so it gets a short deadline and is
 * skipped altogether when the read already took long.
 */
const READER_DEADLINE_MS = 38_000;
const SPECIALIST_DEADLINE_MS = 18_000;
const SPECIALIST_LATEST_START_MS = 30_000;
/** A picture is only parked in the shared store when it fits: entries go up to 2 MB. */
const PARK_MAX_BASE64 = 1_800_000;

function within<T>(job: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new VisionError(message, "network")), ms);
  });
  return Promise.race([job, deadline]).finally(() => clearTimeout(timer));
}

/** The match as the frames and taps have built it. Specialists never write here. */
interface Room {
  session: Session;
  /** Fed enemies already called out this match. */
  called: number[];
  matchId: number;
  /** When the last screenshot was successfully read (0 = none yet). */
  at: number;
  /** The most recent screenshots and what each one turned out to be: the room's log. */
  reads: ReadLog[];
  /** Counts the changes made to the room itself. */
  version: number;
  /** When this copy was written (see `stamp`). */
  stamp: number;
  /** Why the most recent screenshot could not be read — shown on the following device. */
  error?: { message: string; at: number };
  /** What the most recent screenshot turned out to be, so the follower gets feedback even when it was no use. */
  read?: { screen: string; title: string; body: string };
}

/** What each specialist last concluded. One store entry each, written only by that specialist. */
interface CoachSide {
  stamp: number;
  matchId: number;
  advice: AiAdvice;
  build?: AiBuild;
  /** The coach's storyboard lines this match, oldest first. */
  beats: StoryBeat[];
}
interface PositionSide {
  stamp: number;
  matchId: number;
  advice: PositionAdvice;
}
interface EnemySide {
  stamp: number;
  matchId: number;
  intel: EnemyIntel;
}
interface Sides {
  coach?: CoachSide;
  position?: PositionSide;
  enemies?: EnemySide;
  /** Something to say out loud on the following device right now. */
  say?: { id: number; text: string };
}
type Specialist = "coach" | "position" | "enemies";

/** One line of the room's log. No picture is kept — only what was understood from it. */
export interface ReadLog {
  at: number;
  screen?: string;
  /** Match clock read from the screenshot, in seconds. */
  clock?: number;
  /** Pocket gold read from the screenshot. */
  gold?: number;
  allies?: number;
  enemies?: number;
  /** Names the reader produced that matched no hero or item. */
  unknown?: string[];
  /** How long the read took, in milliseconds. */
  ms?: number;
  model?: string;
  error?: string;
}
const READS_MAX = 30;

/**
 * One line per event in the host's own logs (kept about an hour on the free
 * plan), so a match can be examined afterwards. No key and no picture is ever
 * written — only what was understood.
 */
function record(event: Record<string, unknown>): void {
  try {
    console.log(`COACH ${JSON.stringify(event)}`);
  } catch {
    /* logging must never break a read */
  }
}

const rowsFor = (players: Observation["allies"]) =>
  players.map((p) => ({ hero: heroName(p.heroId), kda: `${p.kills ?? "?"}/${p.deaths ?? "?"}/${p.assists ?? "?"}`, gold: p.gold, items: p.items }));

const K = {
  room: (id: string) => `room:${id}`,
  /** The newest stamp written for the room: the dashboard polls only this. */
  latest: (id: string) => `v:${id}`,
  side: (id: string, name: Specialist) => `side:${id}:${name}`,
  say: (id: string) => `say:${id}`,
  /** When a specialist last started. */
  ran: (id: string, name: Specialist) => `ran:${id}:${name}`,
  /** The first picture of "help me position", waiting for the second. */
  parked: (id: string) => `pos:${id}`,
  /** The last picture taken with the map opened. */
  map: (id: string) => `img:${id}:map`,
};

/**
 * A number that says "this was written now": later writes get bigger numbers.
 * It is never derived from a read, so two writers cannot hand out the same one
 * by both starting from a stale copy.
 */
const stamp = (): number => Date.now() * 1000 + Math.floor(Math.random() * 1000);

const blankRoom = (): Room => ({ session: EMPTY_SESSION, called: [], matchId: 0, at: 0, version: 0, stamp: 0, reads: [] });

/**
 * What this copy of the function wrote in the last few seconds. Measured on the live
 * site, the shared cache now and then hands back the previous value for up to a second
 * after a write, so a copy trusts its own latest write over an older answer.
 */
const justWritten = new Map<string, { room: Room; at: number }>();
const WRITE_MEMORY_MS = 5000;

async function loadRoom(store: KeyValue, roomId: string): Promise<Room | undefined> {
  const value = await store.get(K.room(roomId));
  const cached = value && typeof value === "object" ? (value as Room) : undefined;
  const mine = justWritten.get(roomId);
  if (mine && Date.now() - mine.at > WRITE_MEMORY_MS) justWritten.delete(roomId);
  else if (mine && mine.room.stamp > (cached?.stamp ?? 0)) return mine.room;
  return cached;
}

async function loadSides(store: KeyValue, roomId: string): Promise<Sides> {
  const [coach, position, enemies, say] = await Promise.all([store.get(K.side(roomId, "coach")), store.get(K.side(roomId, "position")), store.get(K.side(roomId, "enemies")), store.get(K.say(roomId))]);
  return { coach: coach as CoachSide | undefined, position: position as PositionSide | undefined, enemies: enemies as EnemySide | undefined, say: say as Sides["say"] };
}

/** The match as the dashboard and the engine see it: the room, plus what the specialists concluded about this match. */
function compose(session: Session, sides: Sides): Session {
  const mine = <T extends { matchId: number }>(side: T | undefined): T | undefined => (side && side.matchId === session.matchId ? side : undefined);
  const coach = mine(sides.coach);
  return {
    ...session,
    ai: coach?.advice,
    aiBuild: coach?.build,
    story: mergeBeats(session.story, coach?.beats ?? []),
    position: mine(sides.position)?.advice,
    intel: mine(sides.enemies)?.intel,
  };
}

/** Lay the coach's storyboard lines over the rule-made ones: a line for the same moment replaces it, others slot in by time. */
function mergeBeats(story: StoryBeat[] | undefined, beats: StoryBeat[]): StoryBeat[] | undefined {
  if (!beats.length) return story;
  const out = [...(story ?? [])];
  for (const beat of beats) {
    const same = out.findIndex((line) => Math.abs(line.at - beat.at) < 20);
    if (same >= 0) out[same] = beat;
    else out.push(beat);
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Tell the dashboard something changed. Written blind: the newest stamp wins. */
const touch = (store: KeyValue, roomId: string, at: number) => store.set(K.latest(roomId), at, ROOM_TTL_SEC);

/** Changes to one room are applied one after another within this copy of the function. */
const queues = new Map<string, Promise<unknown>>();

/**
 * Apply a change to the room as it is *now*. A read takes seconds; whatever the
 * dashboard did meanwhile must survive, so never write back a copy taken earlier.
 */
function update(store: KeyValue, roomId: string, change: (room: Room) => Partial<Room>): Promise<Room> {
  const job = async () => {
    const current = (await loadRoom(store, roomId)) ?? blankRoom();
    const next: Room = { ...current, ...change(current), version: current.version + 1, stamp: stamp() };
    await store.set(K.room(roomId), next, ROOM_TTL_SEC);
    if (store.kind === "shared") justWritten.set(roomId, { room: next, at: Date.now() });
    await touch(store, roomId, next.stamp);
    return next;
  };
  const tail = (queues.get(roomId) ?? Promise.resolve()).catch(() => undefined).then(job);
  queues.set(roomId, tail);
  void tail.catch(() => undefined).finally(() => {
    if (queues.get(roomId) === tail) queues.delete(roomId);
  });
  return tail;
}

/** Hand a line to the following device to say out loud. */
async function sayAloud(store: KeyValue, roomId: string, text: string): Promise<void> {
  const id = stamp();
  await store.set(K.say(roomId), { id, text }, ROOM_TTL_SEC);
  await touch(store, roomId, id);
}

/** True where the host keeps this function running after the answer has been sent. */
function canWorkAfterAnswering(): boolean {
  const holder = (globalThis as unknown as Record<symbol, { get?: () => { waitUntil?: unknown } | undefined } | undefined>)[Symbol.for("@vercel/request-context")];
  return typeof holder?.get?.()?.waitUntil === "function";
}

/** The scripted demo reader walks through a match; each room gets its own walk. */
const demos = new Map<string, VisionCall>();
const demoFor = (roomId: string): VisionCall => {
  let reader = demos.get(roomId);
  if (!reader) demos.set(roomId, (reader = demoVision()));
  return reader;
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "access-control-allow-origin": "*" },
  });

/** Friendly failure the Shortcut can still speak and show. */
const fail = (status: number, say: string) => json(status, { title: "Coach problem", body: say, say, error: true });

function sniff(bytes: Uint8Array): VisionImage["mediaType"] | undefined {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return undefined;
}

async function readImage(request: Request): Promise<Uint8Array> {
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const body = (await request.json()) as { image?: string };
    return Uint8Array.from(Buffer.from(String(body.image ?? "").replace(/^data:[^,]+,/, ""), "base64"));
  }
  if (type.includes("multipart/form-data")) {
    const form = await request.formData();
    for (const value of form.values()) if (typeof value !== "string") return new Uint8Array(await value.arrayBuffer());
    return new Uint8Array();
  }
  return new Uint8Array(await request.arrayBuffer());
}

/** Which provider and key the caller sent. The key is used for this request only and never stored or logged. */
function caller(request: Request) {
  const key = (request.headers.get("x-vision-key") ?? "").trim();
  const asked = (request.headers.get("x-vision-provider") ?? "").trim().toLowerCase();
  const provider = asked || (key.startsWith("sk-ant") ? "claude" : key ? "gemini" : "");
  const readerModel = (request.headers.get("x-vision-model") ?? "").trim();
  const coachModel = (request.headers.get("x-coach-model") ?? "").trim();
  const coachOff = /^(off|no|0|false)$/i.test((request.headers.get("x-coach") ?? "").trim());
  const demoScreen = (request.headers.get("x-demo-screen") ?? "").trim().toLowerCase();
  return { key, provider, readerModel, coachModel, coachOff, demoScreen };
}

function pickVision(request: Request, roomId: string): { vision: VisionCall; asked: string } {
  const { key, provider, readerModel } = caller(request);
  if (provider === "demo") return { vision: demoFor(roomId), asked: "demo" };
  if (provider === "claude") return { vision: claudeVision(key, readerModel || DEFAULT_MODEL.claude), asked: readerModel || DEFAULT_MODEL.claude };
  if (provider === "gemini") return { vision: geminiVision(key, readerModel || DEFAULT_MODEL.gemini), asked: readerModel || DEFAULT_MODEL.gemini };
  throw new VisionError("Add your API key to the shortcut as the x-vision-key header.", "config");
}

/** The model the specialists use. Defaults to the strongest model for the caller's key. */
function pickCoach(request: Request, session: () => Session): { ask: AskJson; asked: string } | undefined {
  const { key, provider, readerModel, coachModel, coachOff } = caller(request);
  if (coachOff) return undefined;
  if (provider === "demo") {
    const scripted: AskJson = async ({ schema }) => {
      const raw = schema === (POSITION_SCHEMA as unknown) ? demoPosition() : schema === (ENEMY_SCHEMA as unknown) ? demoEnemies(session()) : demoCoach(session());
      return { raw, model: "demo" };
    };
    return { asked: "demo", ask: scripted };
  }
  if (provider === "claude") return { ask: claudeAsk(key, coachModel || DEFAULT_MODEL.claude), asked: coachModel || DEFAULT_MODEL.claude };
  if (provider === "gemini") return { ask: geminiAsk(key, coachModel || readerModel || DEFAULT_MODEL.gemini), asked: coachModel || readerModel || DEFAULT_MODEL.gemini };
  return undefined;
}

/** Words a voice command may use for each stage. */
const STAGE_WORDS: Record<string, Stage> = {
  draft: "draft", pick: "draft", picks: "draft", selection: "draft",
  loading: "loading", enter: "loading", entering: "loading",
  live: "live", start: "live", started: "live", on: "live", match: "live",
  done: "done", over: "done", off: "done", stop: "done", end: "done", pause: "done",
};
const STAGE_SAY: Record<Stage, string> = {
  draft: "Hero selection. Show me the draft and I will call the picks.",
  loading: "Match starting. I am reading both teams.",
  live: "Coaching is on.",
  done: "Coaching paused. Say draft mode when the next match starts.",
};

/** What a specialist needs to do its work after the frame has been read. */
interface Review {
  store: KeyValue;
  roomId: string;
  coach: { ask: AskJson; asked: string };
  /** The frame that set this off. */
  image: VisionImage;
  screen: Observation["screen"];
  /** When the frame arrived. */
  now: number;
  /** When the request began, for the time budget. */
  started: number;
}

/** The freshest view of the match a specialist can get before it starts thinking. */
async function viewNow(store: KeyValue, roomId: string): Promise<{ session: Session; sides: Sides }> {
  const [room, sides] = await Promise.all([loadRoom(store, roomId), loadSides(store, roomId)]);
  return { session: compose(room?.session ?? EMPTY_SESSION, sides), sides };
}

/**
 * Run one specialist and file its conclusion under its own entry. Returns a line
 * worth showing in the frame's own answer, when there is one. A failure is logged
 * and changes nothing: the rules' answer already stands.
 */
async function runSpecialist(name: Specialist, r: Review): Promise<string | undefined> {
  const began = Date.now();
  const { store, roomId, coach } = r;
  if (began - r.started > SPECIALIST_LATEST_START_MS) return undefined;
  const ask = (input: Parameters<AskJson>[0]) => within(coach.ask(input), SPECIALIST_DEADLINE_MS, `The ${name} specialist took too long.`);
  try {
    const { session, sides } = await viewNow(store, roomId);
    if (stageOf(session) === "done") return undefined;

    if (name === "coach") {
      const brief = coachBrief(session, r.now);
      if (!brief) return undefined;
      const answered = await ask({ system: COACH_SYSTEM, user: brief, schema: COACH_SCHEMA as unknown as Record<string, unknown> });
      const fresh = (await viewNow(store, roomId)).session;
      const result = normalizeCoach(answered.raw, fresh, answered.model ?? coach.asked, Date.now());
      if (!result || fresh.matchId !== session.matchId) return undefined;
      const earlier = sides.coach?.matchId === session.matchId ? sides.coach.beats : [];
      const beats = result.beat ? (mergeBeats(earlier, [result.beat]) ?? []).slice(-12) : earlier;
      const side: CoachSide = { stamp: stamp(), matchId: session.matchId, advice: result.advice, build: result.build, beats };
      await store.set(K.side(roomId, "coach"), side, ROOM_TTL_SEC);
      await touch(store, roomId, side.stamp);
      record({ t: "coach", room: roomId, ms: Date.now() - began, asked: coach.asked, model: result.advice.model, situation: result.advice.situation, headline: result.advice.headline, doNow: result.advice.doNow, avoid: result.advice.avoid, focus: result.advice.focus ? heroName(result.advice.focus.heroId) : undefined, build: result.build?.ids, beat: result.beat?.text });
      return result.advice.headline;
    }

    if (name === "enemies") {
      const hasPicture = r.screen === "scoreboard";
      const brief = enemyBrief(session, r.now, hasPicture);
      if (!brief) return undefined;
      const answered = await ask({ system: ENEMY_SYSTEM, user: brief, images: hasPicture ? [r.image] : [], schema: ENEMY_SCHEMA as unknown as Record<string, unknown> });
      const fresh = (await viewNow(store, roomId)).session;
      const intel = normalizeEnemies(answered.raw, fresh, fresh.intel, answered.model ?? coach.asked, Date.now());
      if (!intel || fresh.matchId !== session.matchId) return undefined;
      const side: EnemySide = { stamp: stamp(), matchId: session.matchId, intel };
      await store.set(K.side(roomId, "enemies"), side, ROOM_TTL_SEC);
      await touch(store, roomId, side.stamp);
      record({ t: "enemies", room: roomId, ms: Date.now() - began, asked: coach.asked, model: intel.model, summary: intel.summary, enemies: intel.enemies.map((e) => ({ hero: heroName(e.heroId), threat: e.threat, items: e.items, maybe: e.maybe, note: e.note })) });
      return undefined;
    }

    // Positioning: this frame, plus the last picture taken with the map open if it is recent enough to mean anything.
    const pictures: VisionImage[] = [r.image];
    const kinds: PositionPicture[] = [r.screen === "map" ? { kind: "map" } : { kind: "battlefield" }];
    if (r.screen !== "map") {
      const kept = (await store.get(K.map(roomId))) as (VisionImage & { at: number }) | undefined;
      if (kept && r.now - kept.at < POSITION_WAIT_MS) {
        pictures.push({ base64: kept.base64, mediaType: kept.mediaType });
        kinds.push({ kind: "map", agoSec: (r.now - kept.at) / 1000 });
      }
    }
    const answered = await ask({ system: POSITION_SYSTEM, user: positionBrief(session, r.now, kinds), images: pictures, schema: POSITION_SCHEMA as unknown as Record<string, unknown> });
    const advice = normalizePosition(answered.raw, answered.model ?? coach.asked, Date.now());
    if (!advice) return undefined;
    const side: PositionSide = { stamp: stamp(), matchId: session.matchId, advice };
    await store.set(K.side(roomId, "position"), side, ROOM_TTL_SEC);
    await touch(store, roomId, side.stamp);
    // Unasked-for positioning is only said aloud when the player is in real danger; the dashboard shows the rest.
    if (advice.risk === "high") await sayAloud(store, roomId, advice.say);
    record({ t: "position", room: roomId, auto: true, pictures: kinds.map((k) => k.kind), ms: Date.now() - began, asked: coach.asked, model: advice.model, risk: advice.risk, said: advice.say });
    return undefined;
  } catch (err) {
    record({ t: `${name}-fail`, room: roomId, ms: Date.now() - began, asked: coach.asked, error: err instanceof Error ? err.message : String(err) });
    return undefined;
  }
}

/** Has this specialist started within `gapMs`? If not, note that it is starting now. */
async function claim(store: KeyValue, roomId: string, name: Specialist, gapMs: number, now: number): Promise<boolean> {
  const last = Number((await store.get(K.ran(roomId, name))) ?? 0);
  if (now - last < gapMs) return false;
  await store.set(K.ran(roomId, name), now, 600);
  return true;
}

async function handle(request: Request): Promise<Response> {
  const started = Date.now();
  const url = new URL(request.url);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,OPTIONS" } });
  }
  const store = storeForRequest();
  const roomParam = (url.searchParams.get("room") ?? request.headers.get("x-coach-room") ?? "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32).toUpperCase();

  // A voice command asking a question: answered from what the room already knows — no screenshot, no AI call.
  const ask = (url.searchParams.get("ask") ?? "").toLowerCase();
  if (roomParam && ask && ask !== "position") {
    if (!(ASK_TOPICS as readonly string[]).includes(ask)) return json(400, { ok: false, say: `I don't know that question. Try: ${[...ASK_TOPICS, "position"].join(", ")}.` });
    const answer = answerQuestion((await viewNow(store, roomParam)).session, ask as AskTopic);
    // Hand the answer to the following device so the dashboard says it too.
    await sayAloud(store, roomParam, answer.say);
    record({ t: "ask", room: roomParam, topic: ask, said: answer.say });
    return json(200, { ...answer, body: answer.say });
  }

  // A voice command moving the match along: "draft mode", "entering the match", "coach on", "coach off".
  const stageWord = (url.searchParams.get("stage") ?? "").toLowerCase();
  let stageSet: Stage | undefined;
  if (roomParam && stageWord) {
    const stage = STAGE_WORDS[stageWord];
    if (!stage) return json(400, { ok: false, say: "I don't know that stage. Use draft, loading, live or done." });
    await update(store, roomParam, (room) => {
      const session = sessionReducer(room.session, { type: "setStage", stage, now: started });
      return { session, matchId: session.matchId, called: session.matchId === room.matchId ? room.called : [] };
    });
    await sayAloud(store, roomParam, STAGE_SAY[stage]);
    record({ t: "stage", room: roomParam, stage });
    stageSet = stage;
    // With a screenshot attached (a POST), carry on and read it; otherwise this was the whole command.
    if (request.method !== "POST") return json(200, { ok: true, title: STAGE_SAY[stage], body: STAGE_SAY[stage], say: STAGE_SAY[stage], stage });
  }

  // A follower (the dashboard) asking what the room has become.
  if (request.method === "GET" && roomParam) {
    const wantLog = url.searchParams.has("log");
    const have = url.searchParams.get("v");
    if (have !== null && !wantLog) {
      // One small read. A follower holding this stamp (or a newer one) has nothing to fetch.
      const latest = Number((await store.get(K.latest(roomParam))) ?? 0);
      if (Number(have) >= latest) return json(200, { ok: true, version: Number(have), unchanged: true });
    }
    const [room, sides] = await Promise.all([loadRoom(store, roomParam), loadSides(store, roomParam)]);
    if (!room) return json(200, { ok: true, version: 0 });
    // The version describes what is actually being sent. If the store handed over a slightly old
    // copy, the follower's next poll will not match the newest stamp and it will fetch again.
    const version = Math.max(room.stamp, sides.coach?.stamp ?? 0, sides.position?.stamp ?? 0, sides.enemies?.stamp ?? 0, sides.say?.id ?? 0);
    return json(200, {
      ok: true, version, revision: room.version, at: room.at || undefined, error: room.error?.message, errorAt: room.error?.at, read: room.read,
      announce: sides.say, session: compose(room.session, sides), reads: room.reads,
    });
  }
  if (request.method === "GET") {
    // Health check that exercises the real engine, so "it's deployed" also means "it can think".
    const layla = HEROES.find((h) => h.name === "Layla")!;
    const estes = HEROES.find((h) => h.name === "Estes")!;
    const sample = planBuild({ hero: layla, enemies: [{ heroId: estes.id }], owned: [], gold: 300 }).next.say;
    return json(200, { ok: true, heroes: HEROES.length, sample, store: store.kind, background: canWorkAfterAnswering(), usage: "POST a screenshot with an x-vision-key header." });
  }
  if (request.method !== "POST") return fail(405, "Send the screenshot with a POST request.");

  const now = Date.now();
  const roomId = roomParam || "DEFAULT";
  const stream = url.searchParams.has("stream");
  /** A failed read is remembered on the room so the dashboard can say why nothing is arriving. */
  const failRead = async (status: number, message: string) => {
    await update(store, roomId, (room) => ({ error: { message, at: Date.now() }, reads: [...room.reads, { at: Date.now(), error: message }].slice(-READS_MAX) }));
    record({ t: "fail", room: roomId, error: message });
    return fail(status, message);
  };
  if (url.searchParams.has("reset")) {
    await Promise.all([K.room(roomId), K.latest(roomId), K.side(roomId, "coach"), K.side(roomId, "position"), K.side(roomId, "enemies"), K.say(roomId), K.parked(roomId), K.map(roomId)].map((key) => store.delete(key)));
    justWritten.delete(roomId);
    return json(200, { title: "New match", body: "Cleared.", say: "Ready for a new match." });
  }
  if (url.searchParams.has("action")) {
    // The dashboard is the controller: stage buttons, "bought it", lane and hero choices all land here.
    const body = (await request.json().catch(() => ({}))) as { action?: SessionAction };
    const action = body.action;
    if (!action || !CONTROLLER_ACTIONS.has(action.type)) return json(400, { ok: false, error: "Unknown action." });
    const after = await update(store, roomId, (room) => {
      const session = sessionReducer(room.session, action);
      return { session, matchId: session.matchId, called: session.matchId === room.matchId ? room.called : [] };
    });
    record({ t: "action", room: roomId, action });
    return json(200, { ok: true, version: after.stamp, revision: after.version });
  }
  if (url.searchParams.has("restore")) {
    // The store dropped the room; a follower hands back its copy.
    const body = (await request.json().catch(() => ({}))) as { session?: Session };
    const existing = await loadRoom(store, roomId);
    if (!existing?.version && body.session && typeof body.session === "object") {
      // Only the match itself comes back. What the specialists concluded lives in their own entries;
      // putting the follower's copy of it into the room would freeze old advice there.
      const { ai: _ai, aiBuild: _build, position: _position, intel: _intel, ...match } = body.session;
      const session = { ...EMPTY_SESSION, ...match, log: [] };
      const after = await update(store, roomId, () => ({ session, matchId: session.matchId }));
      return json(200, { ok: true, version: after.stamp, revision: after.version });
    }
    return json(200, { ok: true, version: existing?.stamp ?? 0, revision: existing?.version ?? 0 });
  }

  let bytes: Uint8Array;
  try {
    bytes = await readImage(request);
  } catch {
    return failRead(400, "I couldn't read that upload.");
  }
  const upMs = Date.now() - started;
  // A stage command sent as a POST with nothing attached is still just a stage command.
  if (stageSet && !bytes.length) return json(200, { ok: true, title: STAGE_SAY[stageSet], body: STAGE_SAY[stageSet], say: STAGE_SAY[stageSet], stage: stageSet });

  const roomSession = async () => (await loadRoom(store, roomId))?.session ?? EMPTY_SESSION;
  if (stageOf(await roomSession()) === "done") {
    // "Match over" pauses reading, so a repeating shortcut stops spending the key.
    const say = "Paused. Say coach on, or tap In match on the dashboard, to start again.";
    return json(200, { title: "Paused", body: say, say: "", stop: true, halt: "yes", screen: "other" });
  }

  let reader: ReturnType<typeof pickVision>;
  try {
    reader = pickVision(request, roomId);
  } catch (err) {
    return failRead(400, err instanceof Error ? err.message : "Missing API key.");
  }
  const mediaType = sniff(bytes);
  if (reader.asked !== "demo") {
    if (!mediaType) return failRead(400, "That doesn't look like a screenshot. In the shortcut, set Request Body to File and choose the converted image.");
    if (bytes.length > MAX_BYTES) return failRead(413, "The screenshot is too large. Add Resize Image and Convert to JPEG steps to the shortcut.");
  }
  const image: VisionImage = { base64: Buffer.from(bytes).toString("base64"), mediaType: mediaType ?? "image/jpeg" };
  let latest: Session = (await viewNow(store, roomId)).session;
  const coach = pickCoach(request, () => latest);

  // "Help me position", asked by voice: a picture of the fight, then one with the map open, then advice.
  if (ask === "position") {
    const shot = url.searchParams.get("shot");
    const waiting = (await store.get(K.parked(roomId))) as (VisionImage & { at: number }) | undefined;
    const first = waiting && now - waiting.at < POSITION_WAIT_MS ? waiting : undefined;
    if (shot === "1" || (!shot && !first)) {
      // If the picture cannot be parked (too big, or the store refuses), the second one is answered on its own.
      let parked = false;
      if (image.base64.length <= PARK_MAX_BASE64) {
        parked = await store.set(K.parked(roomId), { ...image, at: now }, Math.ceil(POSITION_WAIT_MS / 1000)).then(() => true, () => false);
      }
      if (!parked) record({ t: "position-unparked", room: roomId, bytes: bytes.length });
      const say = "Open the map.";
      await sayAloud(store, roomId, say);
      record({ t: "position", room: roomId, shot: 1, bytes: bytes.length, upMs });
      return json(200, { title: "Positioning", body: "Open the map. I take the second picture in a moment.", say, shot: 1 });
    }
    if (!coach) return failRead(400, "Positioning needs your API key in the x-vision-key header.");
    try {
      const pictures = first ? [{ base64: first.base64, mediaType: first.mediaType }, image] : [image];
      const kinds: PositionPicture[] = first ? [{ kind: "battlefield" }, { kind: "map" }] : [{ kind: "battlefield" }];
      const reply = await within(coach.ask({ system: POSITION_SYSTEM, user: positionBrief(latest, now, kinds), images: pictures, schema: POSITION_SCHEMA as unknown as Record<string, unknown> }), READER_DEADLINE_MS, "The model took too long to answer. Try again.");
      await store.delete(K.parked(roomId));
      const advice = normalizePosition(reply.raw, reply.model ?? coach.asked, Date.now());
      if (!advice) return failRead(502, "I couldn't work out your position from those pictures.");
      const side: PositionSide = { stamp: stamp(), matchId: latest.matchId, advice };
      await store.set(K.side(roomId, "position"), side, ROOM_TTL_SEC);
      await sayAloud(store, roomId, advice.say);
      record({ t: "position", room: roomId, shot: 2, pictures: pictures.length, bytes: bytes.length, upMs, ms: Date.now() - now, asked: coach.asked, model: advice.model, risk: advice.risk, said: advice.say, summary: advice.summary, moves: advice.moves });
      return json(200, { title: "Positioning", body: [advice.summary, ...advice.moves].join(" "), say: advice.say, moves: advice.moves, model: advice.model });
    } catch (err) {
      const message = err instanceof VisionError ? err.message : "Something went wrong working out your position.";
      return failRead(err instanceof VisionError && (err.kind === "auth" || err.kind === "config") ? 401 : 502, message);
    }
  }

  try {
    const before = latest;
    const { demoScreen } = caller(request);
    const reply = await within(
      reader.vision(image, { stage: stageOf(before), myHeroId: before.myHeroId, allies: before.allies, enemies: before.enemies, step: before.calls, force: demoScreen || undefined }),
      READER_DEADLINE_MS,
      "The model took too long to read the screenshot. Try again.",
    );
    const obs = normalizeObservation(reply.raw);
    // The read took seconds. Whatever the dashboard did meanwhile (bought an item, ended the match)
    // must survive, so apply the observation to the room as it is now, not as it was.
    if (stageOf(await roomSession()) === "done") return json(200, { title: "Paused", body: "", say: "", stop: true, halt: "yes", screen: obs.screen });
    const readAt = Date.now();
    const sides = await loadSides(store, roomId);
    let answer: ReturnType<typeof coachReply> | undefined;
    const afterRead = await update(store, roomId, (room) => {
      // Time the observation by when the screenshot arrived, not when the read finished:
      // the clock on it was already a few seconds old by then.
      const session = sessionReducer(room.session, { type: "observe", obs, now });
      // A new match forgets which fed enemies were already called out.
      const called = new Set(session.matchId === room.matchId ? room.called : []);
      answer = coachReply(compose(session, sides), obs, called, url.origin);
      const read = { screen: obs.screen, title: answer.title, body: answer.body };
      const entry: ReadLog = { at: readAt, screen: obs.screen, clock: obs.gameTimeSec, gold: obs.myGold, allies: obs.allies.length, enemies: obs.enemies.length, unknown: obs.unknown.slice(0, 6), ms: readAt - now, model: reply.model };
      return { session, called: [...called], matchId: session.matchId, at: readAt, error: undefined, read, reads: [...room.reads, entry].slice(-READS_MAX) };
    });
    latest = compose(afterRead.session, sides);
    const ended = stageOf(latest) === "done";
    const battlefield = obs.screen === "gameplay" || obs.screen === "map";
    if (battlefield && stream) {
      // Battlefield frames arrive every few seconds; one short line each keeps the log readable.
      record({ t: "frame", room: roomId, screen: obs.screen, clock: obs.gameTimeSec, gold: obs.myGold, bytes: bytes.length, upMs, ms: readAt - now, model: reply.model, scene: obs.scene });
    } else {
      record({
        t: "read", room: roomId, store: store.kind, screen: obs.screen, clock: obs.gameTimeSec, gold: obs.myGold, bytes: bytes.length, upMs, ms: readAt - now, asked: reader.asked, model: reply.model,
        me: obs.meHeroId ? heroName(obs.meHeroId) : undefined, allies: rowsFor(obs.allies), enemies: rowsFor(obs.enemies),
        myItems: obs.myItems, shop: obs.shop, scene: obs.scene, unknown: obs.unknown,
        // What the rules concluded from it.
        spent: latest.spent, owned: latest.owned, seen: latest.seenItems, partial: latest.seenPartial, said: answer?.title,
      });
    }

    // A picture with the map open is worth keeping for the next positioning review.
    if (obs.screen === "map" && image.base64.length <= PARK_MAX_BASE64) {
      await store.set(K.map(roomId), { ...image, at: now }, Math.ceil(POSITION_WAIT_MS / 1000)).catch(() => undefined);
    }

    // Which specialists have something new to think about?
    const due: Specialist[] = [];
    if (coach && !ended) {
      const sec = gameSeconds(latest, readAt);
      const last = latest.ai;
      // The coach: after a screen that changes the picture, unless it already answered for this moment —
      // or the shop just taught us the player's list or inventory.
      const learned = JSON.stringify([before.plannedBuild, before.seenItems]) !== JSON.stringify([latest.plannedBuild, latest.seenItems]);
      const answered = !!last && !learned && (obs.screen === "loading" ? last.clock === undefined : last.clock !== undefined && sec !== undefined && Math.abs(sec - last.clock) < COACH_GAP_SEC);
      if ((obs.screen === "scoreboard" || obs.screen === "shop" || obs.screen === "loading") && !answered && coachBrief(latest, readAt)) due.push("coach");
      // The enemy tracker: a fresh scoreboard picture to read.
      if (obs.screen === "scoreboard" && readAt - (latest.intel?.at ?? 0) >= ENEMIES_EVERY_MS && enemyBrief(latest, readAt, true)) due.push("enemies");
      // Positioning: about once a minute while the battlefield is on screen, sooner when the map was just opened.
      const sincePosition = readAt - (latest.position?.at ?? 0);
      if (battlefield && stageOf(latest) === "live" && latest.myHeroId && sincePosition >= (obs.screen === "map" ? POSITION_AFTER_MAP_MS : POSITION_EVERY_MS)) due.push("position");
    }
    const review: Review | undefined = coach ? { store, roomId, coach, image, screen: obs.screen, now, started } : undefined;
    const work = async (): Promise<string | undefined> => {
      if (!review) return undefined;
      const claimed: Specialist[] = [];
      for (const name of due) if (await claim(store, roomId, name, STILL_RUNNING_MS, readAt)) claimed.push(name);
      const lines = await Promise.all(
        claimed.map(async (name) => {
          try {
            return await runSpecialist(name, review);
          } finally {
            // Finished (or failed): the next frame with something new for this specialist may start it again.
            await store.set(K.ran(roomId, name), 0, 600).catch(() => undefined);
          }
        }),
      );
      return lines.find(Boolean);
    };

    let headline: string | undefined;
    if (due.length && canWorkAfterAnswering()) {
      // The frame loop must not wait for the specialists: answer now, think afterwards.
      waitUntil(work().catch(() => undefined));
    } else if (due.length) {
      headline = await work();
    }
    const halt = ended ? { stop: true, halt: "yes" } : { stop: false };
    if (stream) return json(200, { ok: true, screen: obs.screen, say: "", ...halt });
    return json(200, { ...answer, say: [headline, answer?.say].filter(Boolean).join(" "), coach: headline, ...halt, model: reply.model, unknown: obs.unknown });
  } catch (err) {
    const message = err instanceof VisionError ? err.message : "Something went wrong reading the screen.";
    const status = err instanceof VisionError && (err.kind === "auth" || err.kind === "config") ? 401 : 502;
    return failRead(status, message);
  }
}

export default { fetch: handle };

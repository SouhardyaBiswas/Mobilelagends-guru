/**
 * Screenshot-in, advice-out endpoint for the Shortcut on the device that plays
 * (deployed as a Vercel Function at /api/coach). It holds no secret: the caller
 * sends their own model API key with each request, so a public URL costs the
 * owner nothing.
 *
 * One request does up to three things: a reader model transcribes the screenshot,
 * the rule engine works out the numbers (gold spent, what is owned, who is fed),
 * and a coach model decides the build order and the calls for the next minutes.
 * The room — the match as understood so far — is kept in a store every copy of
 * this function shares (see store.ts), and the dashboard polls it.
 */
import { COACH_SCHEMA, COACH_SYSTEM, coachBrief, demoCoach, normalizeCoach } from "../ai/coach";
import { demoPosition, normalizePosition, POSITION_SCHEMA, POSITION_SYSTEM, positionBrief } from "../ai/position";
import { HEROES, heroName } from "../data/heroes";
import type { Observation } from "../types";
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
/** How long the first positioning picture waits for the second. */
const POSITION_WAIT_MS = 120_000;

interface Room {
  session: Session;
  /** Fed enemies already called out this match. */
  called: number[];
  matchId: number;
  /** When the last screenshot was successfully read (0 = none yet). */
  at: number;
  /** The most recent screenshots and what each one turned out to be: the room's log. */
  reads: ReadLog[];
  /** Bumped on every change so a follower knows there is something new. */
  version: number;
  /** Why the most recent screenshot could not be read — shown on the following device. */
  error?: { message: string; at: number };
  /** What the most recent screenshot turned out to be, so the follower gets feedback even when it was no use. */
  read?: { screen: string; title: string; body: string };
  /** Something to say out loud on the following device right now. */
  announce?: { id: number; text: string };
}

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

const blankRoom = (): Room => ({ session: EMPTY_SESSION, called: [], matchId: 0, at: 0, version: 0, reads: [] });

/**
 * What this copy of the function wrote in the last few seconds. Measured on the live
 * site, the shared cache now and then hands back the previous value for up to a second
 * after a write. A read and the coach's answer are two writes a moment apart in one
 * request, so without this the second would be built on the copy from before the first.
 */
const justWritten = new Map<string, { room: Room; at: number }>();
const WRITE_MEMORY_MS = 5000;

async function loadRoom(store: KeyValue, roomId: string): Promise<Room | undefined> {
  const value = await store.get(`room:${roomId}`);
  const cached = value && typeof value === "object" ? (value as Room) : undefined;
  const mine = justWritten.get(roomId);
  if (mine && Date.now() - mine.at > WRITE_MEMORY_MS) justWritten.delete(roomId);
  else if (mine && mine.room.version > (cached?.version ?? 0)) return mine.room;
  return cached;
}

/** Changes to one room are applied one after another within this copy of the function. */
const queues = new Map<string, Promise<unknown>>();

/**
 * Apply a change to the room as it is *now*. A read takes seconds; whatever the
 * dashboard did meanwhile must survive, so never write back a copy taken earlier.
 */
function update(store: KeyValue, roomId: string, change: (room: Room) => Partial<Room>): Promise<Room> {
  const job = async () => {
    const current = (await loadRoom(store, roomId)) ?? blankRoom();
    const next: Room = { ...current, ...change(current), version: current.version + 1 };
    await store.set(`room:${roomId}`, next, ROOM_TTL_SEC);
    if (store.kind === "shared") justWritten.set(roomId, { room: next, at: Date.now() });
    // A tiny companion entry: the dashboard polls this, and only fetches the room when it moved.
    await store.set(`v:${roomId}`, next.version, ROOM_TTL_SEC);
    return next;
  };
  const tail = (queues.get(roomId) ?? Promise.resolve()).catch(() => undefined).then(job);
  queues.set(roomId, tail);
  void tail.catch(() => undefined).finally(() => {
    if (queues.get(roomId) === tail) queues.delete(roomId);
  });
  return tail;
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
  return { key, provider, readerModel, coachModel, coachOff };
}

function pickVision(request: Request, roomId: string): { vision: VisionCall; asked: string } {
  const { key, provider, readerModel } = caller(request);
  if (provider === "demo") return { vision: demoFor(roomId), asked: "demo" };
  if (provider === "claude") return { vision: claudeVision(key, readerModel || DEFAULT_MODEL.claude), asked: readerModel || DEFAULT_MODEL.claude };
  if (provider === "gemini") return { vision: geminiVision(key, readerModel || DEFAULT_MODEL.gemini), asked: readerModel || DEFAULT_MODEL.gemini };
  throw new VisionError("Add your API key to the shortcut as the x-vision-key header.", "config");
}

/** The model that decides (build order, calls, positioning). Defaults to the strongest model for the caller's key. */
function pickCoach(request: Request, session: () => Session): { ask: AskJson; asked: string } | undefined {
  const { key, provider, readerModel, coachModel, coachOff } = caller(request);
  if (coachOff) return undefined;
  if (provider === "demo") {
    return { asked: "demo", ask: async ({ schema }) => ({ raw: schema === (POSITION_SCHEMA as unknown) ? demoPosition() : demoCoach(session()), model: "demo" }) };
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

async function handle(request: Request): Promise<Response> {
  const started = Date.now();
  const url = new URL(request.url);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,OPTIONS" } });
  }
  const store = storeForRequest();
  const roomParam = (url.searchParams.get("room") ?? request.headers.get("x-coach-room") ?? "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32).toUpperCase();
  const announce = (room: Room, text: string) => ({ announce: { id: (room.announce?.id ?? 0) + 1, text } });

  // A voice command asking a question: answered from what the room already knows — no screenshot, no AI call.
  const ask = (url.searchParams.get("ask") ?? "").toLowerCase();
  if (roomParam && ask && ask !== "position") {
    if (!(ASK_TOPICS as readonly string[]).includes(ask)) return json(400, { ok: false, say: `I don't know that question. Try: ${[...ASK_TOPICS, "position"].join(", ")}.` });
    const answer = answerQuestion((await loadRoom(store, roomParam))?.session ?? EMPTY_SESSION, ask as AskTopic);
    // Hand the answer to the following device so the dashboard says it too.
    await update(store, roomParam, (room) => announce(room, answer.say));
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
      return { session, matchId: session.matchId, called: session.matchId === room.matchId ? room.called : [], ...announce(room, STAGE_SAY[stage]) };
    });
    record({ t: "stage", room: roomParam, stage });
    stageSet = stage;
    // With a screenshot attached (a POST), carry on and read it; otherwise this was the whole command.
    if (request.method !== "POST") return json(200, { ok: true, title: STAGE_SAY[stage], body: STAGE_SAY[stage], say: STAGE_SAY[stage], stage });
  }

  // A follower (the dashboard) asking what the room's screenshots have produced so far.
  if (request.method === "GET" && roomParam) {
    const wantLog = url.searchParams.has("log");
    const have = url.searchParams.get("v");
    if (have !== null && !wantLog) {
      const current = Number((await store.get(`v:${roomParam}`)) ?? 0);
      if (String(current) === have) return json(200, { ok: true, version: current, unchanged: true });
    }
    const room = await loadRoom(store, roomParam);
    if (!room) return json(200, { ok: true, version: 0 });
    return json(200, { ok: true, version: room.version, at: room.at || undefined, error: room.error?.message, errorAt: room.error?.at, read: room.read, announce: room.announce, session: room.session, reads: room.reads });
  }
  if (request.method === "GET") {
    // Health check that exercises the real engine, so "it's deployed" also means "it can think".
    const layla = HEROES.find((h) => h.name === "Layla")!;
    const estes = HEROES.find((h) => h.name === "Estes")!;
    const sample = planBuild({ hero: layla, enemies: [{ heroId: estes.id }], owned: [], gold: 300 }).next.say;
    return json(200, { ok: true, heroes: HEROES.length, sample, store: store.kind, usage: "POST a screenshot with an x-vision-key header." });
  }
  if (request.method !== "POST") return fail(405, "Send the screenshot with a POST request.");

  const now = Date.now();
  const roomId = roomParam || "DEFAULT";
  const sessionNow = async () => (await loadRoom(store, roomId))?.session ?? EMPTY_SESSION;
  /** A failed read is remembered on the room so the dashboard can say why nothing is arriving. */
  const failRead = async (status: number, message: string) => {
    await update(store, roomId, (room) => ({ error: { message, at: Date.now() }, reads: [...room.reads, { at: Date.now(), error: message }].slice(-READS_MAX) }));
    record({ t: "fail", room: roomId, error: message });
    return fail(status, message);
  };
  if (url.searchParams.has("reset")) {
    await store.delete(`room:${roomId}`);
    await store.delete(`v:${roomId}`);
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
    return json(200, { ok: true, version: after.version });
  }
  if (url.searchParams.has("restore")) {
    // The server has no memory of the room (the cache dropped it); a follower hands back its copy.
    const body = (await request.json().catch(() => ({}))) as { session?: Session };
    const existing = await loadRoom(store, roomId);
    if (!existing?.version && body.session && typeof body.session === "object") {
      const session = { ...EMPTY_SESSION, ...body.session, log: [] };
      const after = await update(store, roomId, () => ({ session, matchId: session.matchId }));
      return json(200, { ok: true, version: after.version });
    }
    return json(200, { ok: true, version: existing?.version ?? 0 });
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

  const pausedNow = async () => stageOf(await sessionNow()) === "done";
  if (await pausedNow()) {
    // "Match over" pauses reading, so an auto-repeating shortcut stops spending the key.
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
  let latest: Session = await sessionNow();
  const coach = pickCoach(request, () => latest);

  // "Help me position": a picture of the fight, then one with the map open, then advice.
  if (ask === "position") {
    const shot = url.searchParams.get("shot");
    const waiting = (await store.get(`pos:${roomId}`)) as (VisionImage & { at: number }) | undefined;
    const first = waiting && now - waiting.at < POSITION_WAIT_MS ? waiting : undefined;
    if (shot === "1" || (!shot && !first)) {
      await store.set(`pos:${roomId}`, { ...image, at: now }, Math.ceil(POSITION_WAIT_MS / 1000));
      const say = "Open the map.";
      await update(store, roomId, (room) => announce(room, say));
      record({ t: "position", room: roomId, shot: 1, bytes: bytes.length, upMs });
      return json(200, { title: "Positioning", body: "Open the map. I take the second picture in a moment.", say, shot: 1 });
    }
    if (!coach) return failRead(400, "Positioning needs your API key in the x-vision-key header.");
    try {
      const pictures = first ? [{ base64: first.base64, mediaType: first.mediaType }, image] : [image];
      const reply = await coach.ask({ system: POSITION_SYSTEM, user: positionBrief(latest, now, pictures.length), images: pictures, schema: POSITION_SCHEMA as unknown as Record<string, unknown> });
      await store.delete(`pos:${roomId}`);
      const advice = normalizePosition(reply.raw, reply.model ?? coach.asked, Date.now());
      if (!advice) return failRead(502, "I couldn't work out your position from those pictures.");
      await update(store, roomId, (room) => ({ session: sessionReducer(room.session, { type: "position", advice }), ...announce(room, advice.say) }));
      record({ t: "position", room: roomId, shot: 2, pictures: pictures.length, bytes: bytes.length, upMs, ms: Date.now() - now, asked: coach.asked, model: advice.model, said: advice.say, summary: advice.summary, moves: advice.moves });
      return json(200, { title: "Positioning", body: [advice.summary, ...advice.moves].join(" "), say: advice.say, moves: advice.moves, model: advice.model });
    } catch (err) {
      const message = err instanceof VisionError ? err.message : "Something went wrong working out your position.";
      return failRead(err instanceof VisionError && (err.kind === "auth" || err.kind === "config") ? 401 : 502, message);
    }
  }

  try {
    const before = latest;
    const reply = await reader.vision(image, { stage: stageOf(before), myHeroId: before.myHeroId, allies: before.allies, enemies: before.enemies });
    const obs = normalizeObservation(reply.raw);
    // The read took seconds. Whatever the dashboard did meanwhile (bought an item, ended the match)
    // must survive, so apply the observation to the room as it is now, not as it was.
    if (await pausedNow()) return json(200, { title: "Paused", body: "", say: "", stop: true, halt: "yes", screen: obs.screen });
    const readAt = Date.now();
    let answer: ReturnType<typeof coachReply> | undefined;
    const afterRead = await update(store, roomId, (room) => {
      // Time the observation by when the screenshot arrived, not when the read finished:
      // the clock on it was already a few seconds old by then.
      const session = sessionReducer(room.session, { type: "observe", obs, now });
      // A new match forgets which fed enemies were already called out.
      const called = new Set(session.matchId === room.matchId ? room.called : []);
      answer = coachReply(session, obs, called, url.origin);
      const read = { screen: obs.screen, title: answer.title, body: answer.body };
      const entry: ReadLog = { at: readAt, screen: obs.screen, clock: obs.gameTimeSec, gold: obs.myGold, allies: obs.allies.length, enemies: obs.enemies.length, unknown: obs.unknown.slice(0, 6), ms: readAt - now, model: reply.model };
      return { session, called: [...called], matchId: session.matchId, at: readAt, error: undefined, read, reads: [...room.reads, entry].slice(-READS_MAX) };
    });
    latest = afterRead.session;
    record({
      t: "read", room: roomId, store: store.kind, screen: obs.screen, clock: obs.gameTimeSec, gold: obs.myGold, bytes: bytes.length, upMs, ms: readAt - now, asked: reader.asked, model: reply.model,
      me: obs.meHeroId ? heroName(obs.meHeroId) : undefined, allies: rowsFor(obs.allies), enemies: rowsFor(obs.enemies),
      myItems: obs.myItems, shop: obs.shop, unknown: obs.unknown,
      // What the rules concluded from it.
      spent: latest.spent, owned: latest.owned, seen: latest.seenItems, partial: latest.seenPartial, said: answer?.title,
    });

    // The coach model decides on screens that change the picture: both teams' numbers, the shop's list, the line-ups.
    let headline: string | undefined;
    const worthCoaching = obs.screen === "scoreboard" || obs.screen === "shop" || obs.screen === "loading";
    const sec = gameSeconds(latest, readAt);
    const last = latest.ai;
    // Already answered for this moment? A second look at the loading screen, or the same scoreboard seconds later, adds nothing —
    // unless the shop just taught us the player's list or inventory.
    const learned = JSON.stringify([before.plannedBuild, before.seenItems]) !== JSON.stringify([latest.plannedBuild, latest.seenItems]);
    const answered = !!last && !learned && (obs.screen === "loading" ? last.clock === undefined : last.clock !== undefined && sec !== undefined && Math.abs(sec - last.clock) < COACH_GAP_SEC);
    const brief = coach && worthCoaching && !answered ? coachBrief(latest, readAt) : undefined;
    if (coach && brief) {
      const askedAt = Date.now();
      try {
        const answered = await coach.ask({ system: COACH_SYSTEM, user: brief, schema: COACH_SCHEMA as unknown as Record<string, unknown> });
        const result = normalizeCoach(answered.raw, await sessionNow(), answered.model ?? coach.asked, Date.now());
        if (result && !(await pausedNow())) {
          const afterCoach = await update(store, roomId, (room) => ({ session: sessionReducer(room.session, { type: "ai", ...result }) }));
          latest = afterCoach.session;
          headline = result.advice.headline;
          record({ t: "coach", room: roomId, ms: Date.now() - askedAt, asked: coach.asked, model: result.advice.model, situation: result.advice.situation, headline, doNow: result.advice.doNow, avoid: result.advice.avoid, focus: result.advice.focus ? heroName(result.advice.focus.heroId) : undefined, build: result.build?.ids, beat: result.beat?.text });
        }
      } catch (err) {
        // The rules' answer already stands; a coach that fails just leaves it as it is.
        record({ t: "coach-fail", room: roomId, ms: Date.now() - askedAt, asked: coach.asked, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return json(200, { ...answer, say: [headline, answer?.say].filter(Boolean).join(" "), coach: headline, stop: false, model: reply.model, unknown: obs.unknown });
  } catch (err) {
    const message = err instanceof VisionError ? err.message : "Something went wrong reading the screen.";
    const status = err instanceof VisionError && (err.kind === "auth" || err.kind === "config") ? 401 : 502;
    return failRead(status, message);
  }
}

export default { fetch: handle };

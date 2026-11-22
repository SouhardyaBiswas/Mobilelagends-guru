/**
 * Screenshot-in, advice-out endpoint for the iPad Shortcut (deployed as a
 * Vercel Function at /api/coach). It holds no secret: the caller sends their own
 * vision API key with each request, so a public URL costs the owner nothing.
 *
 * Match memory lives in this instance's memory only. A scoreboard screenshot is
 * self-contained (both teams, items, gold, clock), so losing memory just means
 * the next shop read asks for the scoreboard once.
 */
import { HEROES } from "../data/heroes";
import { planBuild } from "../engine/build";
import { answerQuestion, ASK_TOPICS, coachReply, type AskTopic } from "../engine/reply";
import { CONTROLLER_ACTIONS, EMPTY_SESSION, sessionReducer, stageOf, type Session, type SessionAction } from "../state/session";
import { claudeVision } from "../vision/claude";
import { demoVision } from "../vision/demo";
import { geminiVision } from "../vision/gemini";
import { normalizeObservation } from "../vision/schema";
import { VisionError, type VisionCall, type VisionImage } from "../vision/types";

const MAX_BYTES = 4_000_000;
const ROOM_TTL_MS = 3 * 60 * 60 * 1000;
const DEFAULT_MODEL = { gemini: "gemini-3.8-flash", claude: "claude-opus-5-5" } as const;

interface Room {
  session: Session;
  called: Set<number>;
  matchId: number;
  /** When the last screenshot was successfully read (0 = none since this server started). */
  at: number;
  /** Last time anything touched the room; idle rooms are dropped. */
  seen: number;
  /** The most recent screenshots and what each one turned out to be: the room's log. */
  reads: ReadLog[];
  /** Bumped on every change so a follower knows there is something new. */
  version: number;
  /** Why the most recent screenshot could not be read — shown on the following device. */
  error?: { message: string; at: number };
  /** What the most recent screenshot turned out to be, so the follower gets feedback even when it was no use. */
  read?: { screen: string; title: string; body: string };
  /** Something to say out loud on the following device right now (the answer to a voice question). */
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

const blankRoom = (now: number): Room => ({ session: EMPTY_SESSION, called: new Set<number>(), matchId: 0, at: 0, seen: now, version: 0, reads: [] });

/** Apply a change to the room as it is *now*. Reads take seconds; never write back a stale copy. */
function update(roomId: string, now: number, change: (room: Room) => Partial<Room>): Room {
  const current = rooms.get(roomId) ?? blankRoom(now);
  const next = { ...current, ...change(current), seen: Date.now() };
  rooms.set(roomId, next);
  return next;
}
const rooms = new Map<string, Room>();
const demo = demoVision();

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

function pickVision(request: Request): VisionCall {
  const key = (request.headers.get("x-vision-key") ?? "").trim();
  const asked = (request.headers.get("x-vision-provider") ?? "").trim().toLowerCase();
  const provider = asked || (key.startsWith("sk-ant") ? "claude" : key ? "gemini" : "");
  const model = (request.headers.get("x-vision-model") ?? "").trim();
  if (provider === "demo") return demo;
  if (provider === "claude") return claudeVision(key, model || DEFAULT_MODEL.claude);
  if (provider === "gemini") return geminiVision(key, model || DEFAULT_MODEL.gemini);
  throw new VisionError("Add your API key to the shortcut as the x-vision-key header.", "config");
}

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,OPTIONS" } });
  }
  const roomParam = (url.searchParams.get("room") ?? request.headers.get("x-coach-room") ?? "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32).toUpperCase();

  // A voice command asking a question: answered from what the room already knows — no screenshot, no AI call.
  const ask = (url.searchParams.get("ask") ?? "").toLowerCase();
  if (roomParam && ask) {
    if (!(ASK_TOPICS as readonly string[]).includes(ask)) return json(400, { ok: false, say: `I don't know that question. Try: ${ASK_TOPICS.join(", ")}.` });
    const answer = answerQuestion(rooms.get(roomParam)?.session ?? EMPTY_SESSION, ask as AskTopic);
    // Hand the answer to the following device so the phone says it too.
    update(roomParam, Date.now(), (room) => ({ announce: { id: (room.announce?.id ?? 0) + 1, text: answer.say } }));
    return json(200, { ...answer, body: answer.say });
  }

  // A follower (the phone) asking what the room's screenshots have produced so far.
  if (request.method === "GET" && roomParam) {
    const room = rooms.get(roomParam);
    if (!room) return json(200, { ok: true, version: 0 });
    const info = { ok: true, version: room.version, at: room.at || undefined, error: room.error?.message, errorAt: room.error?.at, read: room.read, announce: room.announce };
    const wantLog = url.searchParams.has("log");
    if (url.searchParams.get("v") === String(room.version)) return json(200, { ...info, unchanged: true, ...(wantLog ? { reads: room.reads } : {}) });
    return json(200, { ...info, session: room.session, reads: room.reads });
  }
  if (request.method === "GET") {
    // Health check that exercises the real engine, so "it's deployed" also means "it can think".
    const layla = HEROES.find((h) => h.name === "Layla")!;
    const estes = HEROES.find((h) => h.name === "Estes")!;
    const sample = planBuild({ hero: layla, enemies: [{ heroId: estes.id }], owned: [], gold: 300 }).next.say;
    return json(200, { ok: true, heroes: HEROES.length, sample, usage: "POST a screenshot with an x-vision-key header." });
  }
  if (request.method !== "POST") return fail(405, "Send the screenshot with a POST request.");

  const now = Date.now();
  for (const [id, room] of rooms) if (now - room.seen > ROOM_TTL_MS) rooms.delete(id);
  const roomId = roomParam || "DEFAULT";
  /** A failed read is remembered on the room so the phone can say why nothing is arriving. */
  const failRead = (status: number, message: string) => {
    update(roomId, now, (room) => ({ error: { message, at: Date.now() }, reads: [...room.reads, { at: Date.now(), error: message }].slice(-READS_MAX) }));
    return fail(status, message);
  };
  if (url.searchParams.has("reset")) {
    rooms.delete(roomId);
    return json(200, { title: "New match", body: "Cleared.", say: "Ready for a new match." });
  }
  if (url.searchParams.has("action")) {
    // The phone is the controller: stage buttons, "bought it", lane and hero choices all land here.
    const body = (await request.json().catch(() => ({}))) as { action?: SessionAction };
    const action = body.action;
    if (!action || !CONTROLLER_ACTIONS.has(action.type)) return json(400, { ok: false, error: "Unknown action." });
    const after = update(roomId, now, (room) => {
      const session = sessionReducer(room.session, action);
      return { session, matchId: session.matchId, called: session.matchId === room.matchId ? room.called : new Set<number>(), version: room.version + 1 };
    });
    return json(200, { ok: true, version: after.version });
  }
  if (url.searchParams.has("restore")) {
    // This instance has no memory of the room (it restarted); a follower hands back its copy.
    const body = (await request.json().catch(() => ({}))) as { session?: Session };
    if (!rooms.get(roomId)?.version && body.session && typeof body.session === "object") {
      const session = { ...EMPTY_SESSION, ...body.session, log: [] };
      update(roomId, now, () => ({ session, matchId: session.matchId, version: 1 }));
    }
    return json(200, { ok: true, version: rooms.get(roomId)?.version ?? 0 });
  }

  const paused = () => stageOf(rooms.get(roomId)?.session ?? EMPTY_SESSION) === "done";
  if (paused()) {
    // "Match over" on the phone pauses reading, so an auto-repeating shortcut stops spending the key.
    const say = "Paused. Tap Hero selection on your phone when the next match starts.";
    return json(200, { title: "Paused", body: say, say: "", stop: true, screen: "other" });
  }

  let bytes: Uint8Array;
  try {
    bytes = await readImage(request);
  } catch {
    return failRead(400, "I couldn't read that upload.");
  }
  let vision: VisionCall;
  try {
    vision = pickVision(request);
  } catch (err) {
    return failRead(400, err instanceof Error ? err.message : "Missing API key.");
  }
  const mediaType = sniff(bytes);
  if (vision !== demo) {
    if (!mediaType) return failRead(400, "That doesn't look like a screenshot. In the shortcut, set Request Body to File and choose the converted image.");
    if (bytes.length > MAX_BYTES) return failRead(413, "The screenshot is too large. Add Resize Image and Convert to JPEG steps to the shortcut.");
  }

  try {
    const before = rooms.get(roomId)?.session ?? EMPTY_SESSION;
    const reply = await vision(
      { base64: Buffer.from(bytes).toString("base64"), mediaType: mediaType ?? "image/jpeg" },
      { stage: stageOf(before), myHeroId: before.myHeroId, allies: before.allies, enemies: before.enemies },
    );
    const obs = normalizeObservation(reply.raw);
    // The read took seconds. Whatever the phone did meanwhile (bought an item, ended the match)
    // must survive, so apply the observation to the room as it is now, not as it was.
    if (paused()) return json(200, { title: "Paused", body: "", say: "", stop: true, screen: obs.screen });
    const readAt = Date.now();
    let answer: ReturnType<typeof coachReply> | undefined;
    update(roomId, readAt, (room) => {
      // Time the observation by when the screenshot arrived, not when the read finished:
      // the clock on it was already a few seconds old by then.
      const session = sessionReducer(room.session, { type: "observe", obs, now });
      // A new match forgets which fed enemies were already called out.
      const called = session.matchId === room.matchId ? room.called : new Set<number>();
      answer = coachReply(session, obs, called, url.origin);
      const read = { screen: obs.screen, title: answer.title, body: answer.body };
      const entry: ReadLog = { at: readAt, screen: obs.screen, clock: obs.gameTimeSec, gold: obs.myGold, allies: obs.allies.length, enemies: obs.enemies.length, unknown: obs.unknown.slice(0, 6), ms: readAt - now, model: reply.model };
      return { session, called, matchId: session.matchId, at: readAt, version: room.version + 1, error: undefined, read, reads: [...room.reads, entry].slice(-READS_MAX) };
    });
    return json(200, { ...answer, stop: false, model: reply.model, unknown: obs.unknown });
  } catch (err) {
    const message = err instanceof VisionError ? err.message : "Something went wrong reading the screen.";
    const status = err instanceof VisionError && (err.kind === "auth" || err.kind === "config") ? 401 : 502;
    return failRead(status, message);
  }
}

export default { fetch: handle };

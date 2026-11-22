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
import { coachReply } from "../engine/reply";
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
  /** When the last screenshot was read. */
  at: number;
  /** Bumped on every read so a follower knows there is something new. */
  version: number;
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

  // A follower (the phone) asking what the room's screenshots have produced so far.
  if (request.method === "GET" && roomParam) {
    const room = rooms.get(roomParam);
    if (!room) return json(200, { ok: true, version: 0 });
    if (url.searchParams.get("v") === String(room.version)) return json(200, { ok: true, version: room.version, unchanged: true, at: room.at });
    return json(200, { ok: true, version: room.version, at: room.at, session: room.session });
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
  for (const [id, room] of rooms) if (now - room.at > ROOM_TTL_MS) rooms.delete(id);
  const roomId = roomParam || "DEFAULT";
  const room: Room = rooms.get(roomId) ?? { session: EMPTY_SESSION, called: new Set<number>(), matchId: 0, at: now, version: 0 };
  if (url.searchParams.has("reset")) {
    rooms.delete(roomId);
    return json(200, { title: "New match", body: "Cleared.", say: "Ready for a new match." });
  }
  if (url.searchParams.has("action")) {
    // The phone is the controller: stage buttons, "bought it", lane and hero choices all land here.
    const body = (await request.json().catch(() => ({}))) as { action?: SessionAction };
    const action = body.action;
    if (!action || !CONTROLLER_ACTIONS.has(action.type)) return json(400, { ok: false, error: "Unknown action." });
    const session = sessionReducer(room.session, action);
    const called = session.matchId === room.matchId ? room.called : new Set<number>();
    rooms.set(roomId, { session, called, matchId: session.matchId, at: room.at, version: room.version + 1 });
    return json(200, { ok: true, version: room.version + 1 });
  }
  if (url.searchParams.has("restore")) {
    // This instance has no memory of the room (it restarted); a follower hands back its copy.
    if (!rooms.has(roomId)) {
      const body = (await request.json().catch(() => ({}))) as { session?: Session };
      if (body.session && typeof body.session === "object") {
        const session = { ...EMPTY_SESSION, ...body.session, log: [] };
        rooms.set(roomId, { session, called: new Set(), matchId: session.matchId, at: now, version: 1 });
      }
    }
    return json(200, { ok: true, version: rooms.get(roomId)?.version ?? 0 });
  }

  if (stageOf(room.session) === "done") {
    // "Match over" on the phone pauses reading, so an auto-repeating shortcut stops spending the key.
    const say = "Paused. Tap Hero selection on your phone when the next match starts.";
    return json(200, { title: "Paused", body: say, say: "", stop: true, screen: "other" });
  }

  let bytes: Uint8Array;
  try {
    bytes = await readImage(request);
  } catch {
    return fail(400, "I couldn't read that upload.");
  }
  let vision: VisionCall;
  try {
    vision = pickVision(request);
  } catch (err) {
    return fail(400, err instanceof Error ? err.message : "Missing API key.");
  }
  const mediaType = sniff(bytes);
  if (vision !== demo) {
    if (!mediaType) return fail(400, "That doesn't look like a screenshot. Send a JPEG or PNG image.");
    if (bytes.length > MAX_BYTES) return fail(413, "The screenshot is too large. Add Resize Image and Convert to JPEG steps to the shortcut.");
  }

  try {
    const s = room.session;
    const reply = await vision(
      { base64: Buffer.from(bytes).toString("base64"), mediaType: mediaType ?? "image/jpeg" },
      { stage: stageOf(s), myHeroId: s.myHeroId, allies: s.allies, enemies: s.enemies },
    );
    const obs = normalizeObservation(reply.raw);
    const session = sessionReducer(s, { type: "observe", obs, now });
    // A new match forgets which fed enemies were already called out.
    const called = session.matchId === room.matchId ? room.called : new Set<number>();
    const answer = coachReply(session, obs, called, url.origin);
    rooms.set(roomId, { session, called, matchId: session.matchId, at: now, version: room.version + 1 });
    return json(200, { ...answer, stop: false, model: reply.model, unknown: obs.unknown });
  } catch (err) {
    const message = err instanceof VisionError ? err.message : "Something went wrong reading the screen.";
    const status = err instanceof VisionError && (err.kind === "auth" || err.kind === "config") ? 401 : 502;
    return fail(status, message);
  }
}

export default { fetch: handle };

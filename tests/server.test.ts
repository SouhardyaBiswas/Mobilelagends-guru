import { afterEach, describe, expect, it, vi } from "vitest";
import api from "../src/server/coachApi";
import type { Session } from "../src/state/session";

/**
 * The screenshot endpoint, driven the way the two devices drive it: an "iPad"
 * posting screenshots (read by the scripted demo reader, which takes half a
 * second — long enough to overlap with the phone) and a "phone" following and
 * controlling the room.
 */
const call = async (method: string, path: string, init: RequestInit = {}) => {
  const res = await api.fetch(new Request(`https://coach.test/api/coach${path}`, { method, ...init }));
  // `version` is a write stamp that only ever grows; `revision` counts the changes made to the match itself.
  return { status: res.status, body: (await res.json()) as Record<string, unknown> & { session?: Session; version?: number; revision?: number } };
};
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]);
const ipad = (room: string, headers: Record<string, string> = { "x-vision-provider": "demo" }) =>
  call("POST", `?room=${room}`, { headers: { "content-type": "image/png", ...headers }, body: PNG });
const phone = (room: string, action: unknown) =>
  call("POST", `?room=${room}&action=1`, { headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
const state = async (room: string) => (await call("GET", `?room=${room}&v=-1`)).body;

describe("screenshot endpoint", () => {
  it("answers a health check with real advice", async () => {
    const { status, body } = await call("GET", "");
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, heroes: 133 });
    expect(String(body.sample)).toMatch(/^Buy Boots now/);
  });

  it("keeps the phone's tap when a screenshot is being read at the same time", async () => {
    const room = "RACE01";
    await ipad(room); // loading screen: establishes the match
    const v0 = (await state(room)).revision!;
    // The next screenshot (a scoreboard) takes ~0.5s to read. The phone taps "Done" meanwhile.
    const reading = ipad(room);
    await phone(room, { type: "bought", id: "comp:boots" });
    const reply = await reading;
    expect(reply.body.stop).toBe(false);
    const after = await state(room);
    expect(after.session!.owned).toContain("comp:boots"); // the tap survived
    expect(after.session!.gold).toBe(620); // and so did the read
    expect(after.session!.phase).toBe("live");
    expect(after.revision).toBe(v0 + 2); // the tap and the read both changed the match; the coach keeps its conclusions in its own entry
    expect(after.session!.ai).toBeDefined();
  });

  it("drops a read that finishes after the phone ended the match", async () => {
    const room = "RACE02";
    await ipad(room);
    const reading = ipad(room);
    await phone(room, { type: "setStage", stage: "done", now: 1 });
    expect((await reading).body).toMatchObject({ stop: true, title: "Paused" });
    expect((await state(room)).session!.stage).toBe("done");
    // While paused, further screenshots are not read at all.
    expect((await ipad(room)).body.stop).toBe(true);
    // "Hero selection" resumes with a clean match.
    await phone(room, { type: "setStage", stage: "draft", now: 2 });
    const fresh = (await state(room)).session!;
    expect(fresh).toMatchObject({ stage: "draft", enemies: [], owned: [] });
    expect((await ipad(room)).body.stop).toBe(false);
  });

  it("tells the phone why a screenshot could not be read, and clears it on success", async () => {
    const room = "FAIL01";
    const missingKey = await ipad(room, {});
    expect(missingKey.status).toBe(400);
    expect(String((await state(room)).error)).toMatch(/x-vision-key/);
    const notAnImage = await call("POST", `?room=${room}`, { headers: { "x-vision-key": "AIzaFAKE" }, body: "hello" });
    expect(notAnImage.status).toBe(400);
    expect(String((await state(room)).error)).toMatch(/Request Body to File/);
    await ipad(room);
    const ok = await state(room);
    expect(ok.error).toBeUndefined();
    // The room keeps a log of every screenshot: the two failures, then the success.
    const reads = ok.reads as Array<{ error?: string; screen?: string; ms?: number }>;
    expect(reads).toHaveLength(3);
    expect(reads[0]!.error).toMatch(/x-vision-key/);
    expect(reads[2]).toMatchObject({ screen: expect.any(String), ms: expect.any(Number) });
    // The follower is also told what the screenshot showed, even when it leads to no advice.
    expect(ok.read).toMatchObject({ screen: expect.any(String), title: expect.any(String), body: expect.any(String) });
  });

  it("answers voice questions from memory and hands the answer to the phone", async () => {
    const room = "ASK01";
    // Before anything is known, it says what it needs instead of guessing.
    expect(String((await call("GET", `?room=${room}&ask=buy`)).body.say)).toMatch(/haven't seen your scoreboard/);
    expect(String((await call("GET", `?room=${room}&ask=picks`)).body.say)).toMatch(/Take the hero you play best/);
    await ipad(room);
    await ipad(room);
    const s = (await state(room)).session!;
    expect(s.myHeroId).toBeDefined();
    expect(s.enemies.length).toBe(5);
    const before = await state(room);
    const buy = await call("GET", `?room=${room}&ask=buy`);
    const firstNote = (await state(room)).announce as { id: number };
    expect(String(buy.body.say)).toMatch(/Buy|Next item|Save/);
    expect(String((await call("GET", `?room=${room}&ask=plan`)).body.say).length).toBeGreaterThan(20);
    expect(String((await call("GET", `?room=${room}&ask=threat`)).body.say)).toMatch(/biggest threat/);
    const status = await call("GET", `?room=${room}&ask=status`);
    // The phone is told to say the latest answer, with a new id each time, without disturbing the match.
    const after = await state(room);
    expect(after.announce).toMatchObject({ text: status.body.say });
    expect((after.announce as { id: number }).id).toBeGreaterThan(firstNote.id); // a new id each time, so each answer is spoken once
    // Each answer moves the version (so the dashboard fetches it), but the match itself is untouched.
    expect(after.version!).toBeGreaterThan(before.version!);
    expect(after.revision).toBe(before.revision);
    expect(after.session).toEqual(s);
    expect((await call("GET", `?room=${room}&ask=nonsense`)).status).toBe(400);
  });

  it("rejects actions it does not know and keeps rooms apart", async () => {
    expect((await phone("SAFE01", { type: "observe", obs: {}, now: 1 })).status).toBe(400);
    expect((await phone("SAFE01", { type: "adopt", session: {} })).status).toBe(400);
    await ipad("ROOMA1");
    expect((await state("ROOMB1")).version).toBe(0);
  });
});

describe("voice commands", () => {
  it("moves the match along by stage, pauses and resumes reading", async () => {
    const room = "VOICE1";
    const on = await call("GET", `?room=${room}&stage=live`);
    expect(on.body).toMatchObject({ ok: true, stage: "live", say: "Coaching is on." });
    let now = await state(room);
    expect(now.session!.stage).toBe("live");
    expect(now.announce).toMatchObject({ text: "Coaching is on." }); // the dashboard says it too
    // Spoken words are accepted as well as the stage names.
    expect((await call("GET", `?room=${room}&stage=off`)).body).toMatchObject({ stage: "done" });
    // Paused: a screenshot is not read (no key is spent) and the looping shortcut is told to stop.
    const skipped = await ipad(room);
    expect(skipped.body).toMatchObject({ title: "Paused", stop: true, halt: "yes" });
    expect((await state(room)).session!.calls).toBe(0);
    // "Draft mode" starts a fresh match.
    await call("GET", `?room=${room}&stage=draft`);
    now = await state(room);
    expect(now.session!.stage).toBe("draft");
    const read = await ipad(room);
    expect(read.body.stop).toBe(false);
    expect(read.body.halt).toBeUndefined();
    expect((await call("GET", `?room=${room}&stage=banana`)).status).toBe(400);
  });

  it("sets the stage and reads the screenshot in one request", async () => {
    const room = "VOICE2";
    const res = await call("POST", `?room=${room}&stage=entering`, { headers: { "content-type": "image/png", "x-vision-provider": "demo" }, body: PNG });
    expect(res.status).toBe(200);
    const now = await state(room);
    expect(now.session!.enemies.length).toBe(5); // the loading screen was read
    expect(now.session!.stage).toBe("loading");
    // A stage command sent as a POST with nothing attached is still only a stage command.
    const bare = await call("POST", `?room=${room}&stage=live`);
    expect(bare.body).toMatchObject({ ok: true, stage: "live" });
  });

  it("answers a poll with one number when nothing has changed", async () => {
    const room = "POLL01";
    expect((await call("GET", `?room=${room}&v=0`)).body).toEqual({ ok: true, version: 0, unchanged: true });
    await ipad(room);
    const full = await state(room);
    expect(full.session).toBeDefined();
    const same = await call("GET", `?room=${room}&v=${full.version}`);
    expect(same.body).toEqual({ ok: true, version: full.version, unchanged: true });
    // Anything at all moves the version: a failed read, a voice answer, a tap.
    await call("POST", `?room=${room}`, { headers: { "content-type": "image/png" }, body: PNG }); // no key: fails
    const moved = await call("GET", `?room=${room}&v=${full.version}`);
    expect(moved.body.version as number).toBeGreaterThan(full.version!);
    expect(String(moved.body.error)).toMatch(/API key/);
  });
});

describe("AI coach and positioning on the endpoint", () => {
  it("adds the coach's call, build and a storyboard line after a scoreboard", async () => {
    const room = "COACH1";
    await ipad(room); // loading screen
    const first = await ipad(room); // early scoreboard
    expect(typeof first.body.coach).toBe("string");
    expect(String(first.body.say)).toContain(String(first.body.coach)); // the shortcut can speak it
    let s = (await state(room)).session!;
    expect(s.ai).toMatchObject({ model: "demo", situation: "even" });
    expect(s.ai!.doNow.length).toBeGreaterThan(0);
    expect(s.aiBuild!.ids.length).toBeGreaterThanOrEqual(3);
    expect(s.story!.length).toBe(1);
    await ipad(room); // late scoreboard: Gusion has snowballed
    s = (await state(room)).session!;
    expect(s.story!.length).toBe(2);
    expect(s.story!.at(-1)!.text).toMatch(/Gusion/);
    // The coach can be switched off per request; the rules still answer.
    const plain = await ipad("COACH2", { "x-vision-provider": "demo", "x-coach": "off" });
    expect(plain.body.coach).toBeUndefined();
    await ipad("COACH2", { "x-vision-provider": "demo", "x-coach": "off" });
    expect((await state("COACH2")).session!.ai).toBeUndefined();
  });

  it("walks through 'help me position': first picture, open the map, second picture, advice", async () => {
    const room = "POS001";
    await ipad(room);
    await ipad(room);
    const shot = (n: number) => call("POST", `?room=${room}&ask=position&shot=${n}`, { headers: { "content-type": "image/png", "x-vision-provider": "demo" }, body: PNG });
    const one = await shot(1);
    expect(one.body).toMatchObject({ title: "Positioning", say: "Open the map.", shot: 1 });
    expect((await state(room)).announce).toMatchObject({ text: "Open the map." });
    expect((await state(room)).session!.position).toBeUndefined();
    const two = await shot(2);
    expect(String(two.body.say)).toMatch(/Step back to your turret/);
    const now = await state(room);
    expect(now.session!.position).toMatchObject({ model: "demo", danger: "Some risk where you are standing." });
    expect(now.session!.position!.moves).toHaveLength(3);
    expect(now.announce).toMatchObject({ text: two.body.say }); // spoken on the dashboard
    // The match itself is untouched by the question.
    expect(now.session!.enemies.length).toBe(5);
    // Without saying which picture it is: the first call stores, the second answers.
    const a = await call("POST", `?room=${room}&ask=position`, { headers: { "content-type": "image/png", "x-vision-provider": "demo" }, body: PNG });
    expect(a.body.shot).toBe(1);
    const b = await call("POST", `?room=${room}&ask=position`, { headers: { "content-type": "image/png", "x-vision-provider": "demo" }, body: PNG });
    expect(String(b.body.say)).toMatch(/turret/);
  });
});

describe("room memory shared between copies of the server", () => {
  const CONTEXT = Symbol.for("@vercel/request-context");
  const holder = globalThis as unknown as Record<symbol, unknown>;
  afterEach(() => {
    delete holder[CONTEXT];
    vi.resetModules();
  });

  it("lets a second copy see what the first one read", async () => {
    // Stand-in for Vercel's Runtime Cache: one store, reached through the request context, JSON in and out.
    const backing = new Map<string, string>();
    const cache = {
      get: async (key: string) => (backing.has(key) ? JSON.parse(backing.get(key)!) : null),
      set: async (key: string, value: unknown) => void backing.set(key, JSON.stringify(value)),
      delete: async (key: string) => void backing.delete(key),
      expireTag: async () => undefined,
    };
    holder[CONTEXT] = { get: () => ({ cache }) };
    const copy = async () => {
      vi.resetModules();
      const mod = (await import("../src/server/coachApi")).default;
      return async (method: string, path: string, init: RequestInit = {}) => (await (await mod.fetch(new Request(`https://coach.test/api/coach${path}`, { method, ...init }))).json()) as Record<string, unknown> & { session?: Session; version?: number };
    };
    const a = await copy();
    const b = await copy();
    expect(await a("GET", "")).toMatchObject({ ok: true, store: "shared" });
    const shot = { headers: { "content-type": "image/png", "x-vision-provider": "demo" }, body: PNG };
    await a("POST", "?room=SHARE1", shot);
    // Copy B never handled a request for this room, yet it answers with what copy A read.
    const seen = await b("GET", "?room=SHARE1&v=-1");
    expect(seen.version).toBeGreaterThanOrEqual(1);
    expect(seen.session!.enemies.length).toBe(5);
    // A tap handled by B is there when A reads the next screenshot.
    await b("POST", "?room=SHARE1&action=1", { headers: { "content-type": "application/json" }, body: JSON.stringify({ action: { type: "bought", id: "comp:boots" } }) });
    await a("POST", "?room=SHARE1", shot);
    const after = await b("GET", "?room=SHARE1&v=-1");
    expect(after.session!.owned).toContain("comp:boots");
    expect(after.session!.history.length).toBe(1);
    expect((await a("GET", `?room=SHARE1&v=${after.version}`)).unchanged).toBe(true);
    expect(backing.size).toBeGreaterThanOrEqual(2); // the room and its version number really went through the cache
  });

  it("does not lose a read when the shared cache answers with the previous copy for a moment", async () => {
    // Measured on the live site: for up to a second after a write, a read can return the value from before it.
    const versions = new Map<string, Array<{ at: number; json: string }>>();
    const LAG_MS = 300;
    const cache = {
      get: async (key: string) => {
        const all = versions.get(key) ?? [];
        const settled = all.filter((v) => Date.now() - v.at >= LAG_MS).at(-1);
        return settled ? JSON.parse(settled.json) : null;
      },
      set: async (key: string, value: unknown) => void versions.set(key, [...(versions.get(key) ?? []), { at: Date.now(), json: JSON.stringify(value) }]),
      delete: async (key: string) => void versions.delete(key),
      expireTag: async () => undefined,
    };
    holder[CONTEXT] = { get: () => ({ cache }) };
    vi.resetModules();
    const mod = (await import("../src/server/coachApi")).default;
    const go = async (method: string, path: string, init: RequestInit = {}) => (await (await mod.fetch(new Request(`https://coach.test/api/coach${path}`, { method, ...init }))).json()) as Record<string, unknown> & { session?: Session; version?: number };
    const shot = { headers: { "content-type": "image/png", "x-vision-provider": "demo" }, body: PNG };
    // One request, two writes a moment apart: the read, then the coach's answer built on it.
    await go("POST", "?room=LAGGY1", shot);
    await go("POST", "?room=LAGGY1", shot);
    await new Promise((r) => setTimeout(r, LAG_MS + 50));
    const after = await go("GET", "?room=LAGGY1&v=-1");
    expect(after.revision).toBe(2); // both reads applied, neither built on a copy from before the other
    expect(after.session!.calls).toBe(2);
    expect(after.session!.history.length).toBe(1); // the scoreboard read is there
    expect(after.session!.ai).toBeDefined();
    expect(after.session!.gold).toBe(620);
  });

  it("falls back to its own memory where there is no shared cache", async () => {
    const mod = (await import("../src/server/coachApi")).default;
    const res = (await (await mod.fetch(new Request("https://coach.test/api/coach"))).json()) as { store: string };
    expect(res.store).toBe("memory");
  });
});

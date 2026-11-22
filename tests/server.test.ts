import { describe, expect, it } from "vitest";
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
  return { status: res.status, body: (await res.json()) as Record<string, unknown> & { session?: Session; version?: number } };
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
    const v0 = (await state(room)).version!;
    // The next screenshot (a scoreboard) takes ~0.5s to read. The phone taps "Done" meanwhile.
    const reading = ipad(room);
    await phone(room, { type: "bought", id: "comp:boots" });
    const reply = await reading;
    expect(reply.body.stop).toBe(false);
    const after = await state(room);
    expect(after.session!.owned).toContain("comp:boots"); // the tap survived
    expect(after.session!.gold).toBe(620); // and so did the read
    expect(after.session!.phase).toBe("live");
    expect(after.version).toBe(v0 + 2); // two changes, two versions: the phone will see both
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
    const before = (await state(room)).version;
    const buy = await call("GET", `?room=${room}&ask=buy`);
    expect(String(buy.body.say)).toMatch(/Buy|Next item|Save/);
    expect(String((await call("GET", `?room=${room}&ask=plan`)).body.say).length).toBeGreaterThan(20);
    expect(String((await call("GET", `?room=${room}&ask=threat`)).body.say)).toMatch(/biggest threat/);
    const status = await call("GET", `?room=${room}&ask=status`);
    // The phone is told to say the latest answer, with a new id each time, without disturbing the match.
    const after = await state(room);
    expect(after.announce).toMatchObject({ text: status.body.say });
    expect((after.announce as { id: number }).id).toBeGreaterThanOrEqual(4);
    expect(after.version).toBe(before);
    expect((await call("GET", `?room=${room}&ask=nonsense`)).status).toBe(400);
  });

  it("rejects actions it does not know and keeps rooms apart", async () => {
    expect((await phone("SAFE01", { type: "observe", obs: {}, now: 1 })).status).toBe(400);
    expect((await phone("SAFE01", { type: "adopt", session: {} })).status).toBe(400);
    await ipad("ROOMA1");
    expect((await state("ROOMB1")).version).toBe(0);
  });
});

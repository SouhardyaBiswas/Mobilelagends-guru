import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * In the first real match every draft read came back with no heroes. These tests stand in
 * for Claude: the fast model sees the draft and names nobody (as it did), the strong model
 * names the picks. The endpoint must end up with the strong model's roster.
 */
const calls: string[] = [];
let strongFails = false;
const pick = (hero: string, isMe = false) => ({ hero, isMe, kills: -1, deaths: -1, assists: -1, gold: -1, level: -1, items: [] });
const draft = (allies: ReturnType<typeof pick>[], enemies: ReturnType<typeof pick>[], banned: string[] = []) => ({
  screen: "draft", gameTime: "", myGold: -1, allies, enemies, banned, myItems: [], recommended: [], spare: [], tip: "", scene: "",
});

vi.mock("../src/vision/claude", () => ({
  claudeVision: (_key: string, model: string, effort?: string) => async () => {
    calls.push(`${model}${effort ? `:${effort}` : ""}`);
    if (model.includes("haiku")) return { raw: draft([], []), model };
    if (strongFails) throw new Error("overloaded");
    return { raw: draft([pick("Hanabi", true), pick("Floryn")], [pick("Julian"), pick("Xavier"), pick("Bruno")], ["Beatrix"]), model };
  },
  claudeAsk: () => async () => {
    throw new Error("the specialists are off in these tests");
  },
}));

const { default: api } = await import("../src/server/coachApi");

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]);
const call = async (method: string, path: string, init: RequestInit = {}) => {
  const res = await api.fetch(new Request(`https://coach.test/api/coach${path}`, { method, ...init }));
  return (await res.json()) as Record<string, any>;
};
const shot = (room: string, query = "", headers: Record<string, string> = {}) =>
  call("POST", `?room=${room}${query}`, { headers: { "content-type": "image/png", "x-vision-key": "sk-ant-test", "x-coach": "off", ...headers }, body: PNG });
const phone = (room: string, action: unknown) =>
  call("POST", `?room=${room}&action=1`, { headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
const state = async (room: string) => (await call("GET", `?room=${room}&v=-1`)).session;

beforeEach(() => {
  calls.length = 0;
  strongFails = false;
});

describe("reading hero selection", () => {
  it("reads the draft with the strong model when the room is in hero selection, even from the frame loop", async () => {
    await phone("ROST01", { type: "setStage", stage: "draft", now: Date.now() });
    await shot("ROST01", "&stream=1");
    expect(calls).toEqual(["claude-opus-5-5:medium"]);
    const s = await state("ROST01");
    expect(s.myHeroId).toBeDefined();
    expect(s.enemies).toHaveLength(3);
    expect(s.allies).toHaveLength(1);
    expect(s.banned).toHaveLength(1);
    expect(s.lane).toBe("gold");
  });

  it("re-reads with the strong model when a fast read turns out to be the draft", async () => {
    // "In match" tapped early, so frames go to the fast model; the next frame is still the draft.
    await phone("ROST02", { type: "setStage", stage: "live", now: Date.now() });
    const answer = await shot("ROST02", "&stream=1");
    expect(answer.screen).toBe("draft");
    expect(calls).toEqual(["claude-haiku-5-5", "claude-opus-5-5:medium"]);
    const s = await state("ROST02");
    expect(s.enemies).toHaveLength(3);
    expect(s.stage).toBe("draft"); // and the early tap is undone
    expect(s.phase).toBe("draft");
  });

  it("re-reads when the shortcut asks for the fast model by name", async () => {
    await phone("ROST03", { type: "setStage", stage: "draft", now: Date.now() });
    const answer = await shot("ROST03", "", { "x-vision-model": "claude-haiku-5-5" });
    expect(calls).toEqual(["claude-haiku-5-5", "claude-opus-5-5:medium"]);
    expect(answer.title).toMatch(/^Your lane: |^You: |Bruno|Julian|Xavier/);
    expect((await state("ROST03")).enemies).toHaveLength(3);
  });

  it("keeps the first read when the strong re-read fails", async () => {
    strongFails = true;
    await phone("ROST04", { type: "setStage", stage: "draft", now: Date.now() });
    const answer = await shot("ROST04", "", { "x-vision-model": "claude-haiku-5-5" });
    expect(answer.error).toBeUndefined();
    expect(answer.title).toBe("Hero selection");
  });

  it("keeps the picks when 'draft mode' is said again with a screenshot", async () => {
    await phone("ROST05", { type: "setStage", stage: "draft", now: Date.now() });
    await shot("ROST05");
    await phone("ROST05", { type: "setLane", lane: "gold" });
    strongFails = true; // the second screenshot cannot be read by the strong model
    await shot("ROST05", "&stage=draft", { "x-vision-model": "claude-haiku-5-5" });
    expect((await state("ROST05")).enemies).toHaveLength(3);
  });
});

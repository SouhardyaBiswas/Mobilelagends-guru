// Browser check for MLBB Guru. Needs Playwright with Chromium available to `require`.
// Run from the repository root:  npm run build && (npx vite preview --port 4173 --strictPort &) && node scripts/e2e/voice.cjs
// The iPad dashboard (1180x820) following a room: does it SPEAK, and do the specialists' panels fill in,
// when driven the way the phone drives it — voice stage commands, single shots, the positioning flow and a frame loop?
const { chromium } = require("playwright");
const OUT = require("node:path").join(__dirname, "out");
require("node:fs").mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:4173";
const ROOM = "VOICE9";
const results = [];
const check = (name, ok, extra = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + String(extra).replace(/\s+/g, " ").slice(0, 200) : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const api = (await import(require("node:path").resolve(__dirname, "../../api/coach.js"))).default;
  const server = async (method, query, headers = {}) => (await api.fetch(new Request(`${BASE}/api/coach?room=${ROOM}${query}`, { method, headers: { "x-vision-provider": "demo", "content-type": "image/png", ...headers }, body: method === "POST" ? new Uint8Array([0x89, 0x50, 0x4e, 0x47]) : undefined }))).json();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(() => {
    window.__spoken = [];
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { getVoices: () => [], addEventListener() {}, removeEventListener() {}, cancel() {}, speak(u) { if (u.text.trim()) window.__spoken.push(u.text); setTimeout(() => u.onend && u.onend(), 20); } } });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route("**/api/coach*", async (route) => {
    const req = route.request();
    const res = await api.fetch(new Request(req.url(), { method: req.method(), headers: req.headers(), body: req.method() === "GET" ? undefined : req.postDataBuffer() }));
    await route.fulfill({ status: res.status, contentType: "application/json", body: await res.text() });
  });
  const spoken = () => page.evaluate(() => window.__spoken);
  const said = async (re, ms = 15000) => { try { await page.waitForFunction((src) => window.__spoken.some((t) => new RegExp(src).test(t)), re.source, { timeout: ms }); return true; } catch { return false; } };

  await page.goto(`${BASE}/?room=${ROOM.toLowerCase()}`);
  await page.waitForSelector(".dash");
  await page.getByRole("button", { name: /Turn on voice/ }).first().click();
  await sleep(3500); // let the first poll land: what was said before the dashboard opened is not replayed

  // "Draft mode", then "entering the match" with the loading screen attached.
  await server("GET", "&stage=draft");
  check("voice command 'draft mode' is confirmed out loud on the iPad", await said(/Hero selection\. Show me the draft/));
  await sleep(1000); // in a real match the next command is a minute away, not a millisecond
  await server("POST", "&stage=loading");
  check("loading screen: hero, spell and lane plan are spoken", await said(/Playing Layla\. Battle spell: Flicker/));
  check("…and the coach's pre-match call is spoken", await said(/Farm your lane and take safe fights/));

  // "Coach on", then a scoreboard shot.
  await server("GET", "&stage=live");
  check("voice command 'coach on' is confirmed out loud", await said(/Coaching is on\./));
  await server("POST", "");
  check("scoreboard: the next purchase is spoken", await said(/Buy pieces of Windtalker now/));
  await page.waitForSelector(".dash .enemy-note", { timeout: 15000 });
  check("enemy tracker: notes sit in the enemy team panel", /Keep your distance|Stay behind your tank/.test(await page.locator(".dash .enemies").innerText()), await page.locator(".dash .enemy-note").first().innerText());
  check("storyboard has its first line", (await page.locator(".dash .beats li").count()) >= 1, await page.locator(".dash .beats").innerText());
  check("AI coach card shows the coach's call", /Farm your lane and take safe fights/.test(await page.locator(".dash .ai-card").innerText()));

  // A question by voice: answered from memory and said on the iPad.
  const buy = await server("GET", "&ask=buy");
  check("a voice question is answered out loud", await said(new RegExp(buy.say.slice(0, 30).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))), buy.say);

  // "Help me position": two pictures, the prompt in between, the answer spoken and shown.
  await server("POST", "&ask=position&shot=1");
  check("positioning: 'Open the map.' is spoken after the first picture", await said(/Open the map\./));
  await server("POST", "&ask=position&shot=2");
  check("positioning: the advice is spoken", await said(/Three enemies are missing\. Step back to your turret/));
  await page.waitForSelector(".dash .pos-card", { timeout: 15000 });
  check("positioning: the card shows the summary, the risk and the moves", /Where to stand/.test(await page.locator(".dash .pos-card").innerText()) && (await page.locator(".dash .pos-card ol li").count()) === 3, await page.locator(".dash .pos-card").innerText());

  // The frame loop: battlefield frames are filed without chatter.
  const before = (await spoken()).length;
  for (const kind of ["gameplay", "gameplay", "map", "gameplay"]) await server("POST", "&stream=1", { "x-demo-screen": kind });
  await sleep(4000);
  const after = await spoken();
  check("four battlefield frames in a row add nothing spoken", after.length === before, after.slice(before).join(" | "));
  const fits = await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight);
  check("the dashboard still fits one window with every panel filled", fits);
  await sleep(500);
  await page.screenshot({ path: `${OUT}/dash-final-early.png` });

  // The late scoreboard: a fed enemy.
  await server("POST", "", { "x-demo-screen": "late" });
  check("late scoreboard: the fed enemy is called out", await said(/Gusion is fed/));
  check("…and the coach's new call is spoken", await said(/Gusion is fed\. Stay with your team\./));
  await page.waitForFunction(() => document.querySelectorAll(".dash .beats li").length >= 2, null, { timeout: 15000 }).catch(() => {});
  check("storyboard has a second line", (await page.locator(".dash .beats li").count()) >= 2, await page.locator(".dash .beats").innerText());
  await sleep(700);
  await page.screenshot({ path: `${OUT}/dash-final-late.png` });

  // "Coach off".
  await server("GET", "&stage=done");
  check("voice command 'coach off' is confirmed and the dashboard pauses", (await said(/Coaching paused/)) && /Coaching is paused/.test(await page.locator(".dash").innerText()));
  check("no page errors", errors.length === 0, errors.join(" | "));
  console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
  console.log("SPOKEN, in order:\n" + (await spoken()).map((t, i) => `  ${i + 1}. ${t}`).join("\n"));
  await browser.close();
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error("SCRIPT ERROR", e.message); process.exit(1); });

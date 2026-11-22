// Browser check for MLBB Guru. Needs Playwright with Chromium available to `require`.
// Run from the repository root:  npm run build && (npx vite preview --port 4173 --strictPort &) && node scripts/e2e/follow.cjs
const { chromium } = require("playwright");
const OUT = require("node:path").join(__dirname, "out");
require("node:fs").mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, extra = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const api = (await import(require("node:path").resolve(__dirname, "../../api/coach.js"))).default;
  const server = async (method, path, init = {}) => (await api.fetch(new Request(`http://localhost:4173/api/coach${path}`, { method, ...init }))).json();
  const ipadShot = () => server("POST", "?room=TEST01", { headers: { "x-vision-provider": "demo", "content-type": "image/png" }, body: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) });

  const browser = await chromium.launch();
  // iPhone-sized "phone" that follows the room.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(() => {
    window.__spoken = [];
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { getVoices: () => [], addEventListener() {}, removeEventListener() {}, cancel() {}, speak(u) { if (u.text.trim()) window.__spoken.push(u.text); setTimeout(() => u.onend && u.onend(), 20); } } });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  // The preview server has no functions; hand /api/coach to the real bundled endpoint.
  await page.route("**/api/coach*", async (route) => {
    const req = route.request();
    const res = await api.fetch(new Request(req.url(), { method: req.method(), headers: req.headers(), body: req.method() === "GET" ? undefined : req.postDataBuffer() }));
    await route.fulfill({ status: res.status, contentType: "application/json", body: await res.text() });
  });

  await page.goto("http://localhost:4173/?room=test01");
  await page.waitForSelector(".roombar");
  check("phone link opens in follow mode for the room", /Following room TEST01/.test(await page.locator(".roombar").innerText()) && /waiting for the first screenshot/.test(await page.locator(".roombar").innerText()));
  await page.getByRole("button", { name: "Hero selection" }).click();

  await ipadShot(); // loading screen: both teams with names
  await page.waitForFunction(() => window.__spoken.some((t) => /Playing Layla/.test(t)), null, { timeout: 15000 });
  let spoken = await page.evaluate(() => window.__spoken);
  check("pre-match: phone speaks the hero, spell and lane plan", /Playing Layla\. Battle spell: Flicker\. In lane you face Karrie/.test(spoken.join(" | ")), spoken.join(" | ").slice(0, 170));
  check("stage moved to Match starting by itself", (await page.locator(".stages .chip.on").innerText()) === "Match starting");

  await ipadShot(); // early scoreboard: gold 620, clock 3:10
  await page.waitForSelector(".now h1", { timeout: 15000 });
  await page.waitForFunction(() => window.__spoken.some((t) => /Windtalker/.test(t)), null, { timeout: 15000 });
  // 1,500 earned and 620 in pocket means 880 spent: boots are paid for, Windtalker is next.
  check("in match: phone works out progress from gold spent and speaks the next purchase", /Windtalker/.test(await page.locator(".now h1").innerText()) && (await page.locator(".build-slot.owned").count()) === 1 && (await page.locator(".stages .chip.on").innerText()) === "In match", await page.locator(".now h1").innerText());
  check("item picture shows on the phone", await page.evaluate(() => { const i = document.querySelector(".now img.item-icon"); return !!i && i.complete && i.naturalWidth > 0; }));
  await page.screenshot({ path: `${OUT}/phone-follow.png` });

  await page.getByRole("button", { name: /I bought Windtalker anyway/ }).click();
  await sleep(600);
  const afterBuy = await server("GET", "?room=TEST01&v=0");
  check("confirming a purchase on the phone updates the server's copy", (afterBuy.session.owned || []).includes("windtalker"), JSON.stringify(afterBuy.session.owned));

  await ipadShot(); // late scoreboard: Gusion fed
  await page.waitForFunction(() => window.__spoken.some((t) => /Gusion is fed/.test(t)), null, { timeout: 15000 });
  check("fed enemy announced on the phone", true, (await page.evaluate(() => window.__spoken)).slice(-2).join(" | ").slice(0, 160));
  const kept = await server("GET", "?room=TEST01&v=0");
  check("the phone's purchase survives the next screenshot", (kept.session.owned || []).includes("windtalker"));
  await page.waitForSelector("text=Recent screenshots");
  const logText = await page.locator("section:has-text('Recent screenshots')").last().innerText();
  check("phone lists what each screenshot was understood to be", /the scoreboard · clock 9:40 · 1450 gold/.test(logText) && /the loading screen/.test(logText), logText.split("\n").slice(1, 4).join(" | ").slice(0, 160));

  // Two scoreboards have been read by now: the match memory should show on the phone.
  await page.waitForSelector(".standings tr", { timeout: 10000 });
  const storyText = await page.locator("section:has(.standings)").innerText();
  check("phone shows the match so far, from memory of earlier scoreboards", /2 scoreboards remembered/.test(storyText) && /Your team is|The teams are/.test(storyText) && (await page.locator(".standings tr").count()) === 10, storyText.split("\n").slice(2, 4).join(" / ").slice(0, 170));
  await page.locator("section:has(.standings)").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/phone-story.png` });

  await page.getByRole("button", { name: "Match over" }).click();
  await sleep(600);
  const paused = await ipadShot();
  check("Match over pauses reading (shortcut is told to stop)", paused.stop === true && paused.title === "Paused");

  await page.getByRole("button", { name: "Hero selection" }).click();
  await sleep(600);
  const fresh = await server("GET", "?room=TEST01&v=0");
  check("Hero selection starts a clean match", fresh.session.enemies.length === 0 && fresh.session.owned.length === 0 && fresh.session.stage === "draft" && !fresh.session.myHeroId);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("no sideways scrolling on the phone", overflow <= 1, `overflow ${overflow}px`);
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await browser.close();
  console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error("SCRIPT ERROR", e.message.slice(0, 400)); process.exit(2); });

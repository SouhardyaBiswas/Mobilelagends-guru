// Browser check for MLBB Guru. Needs Playwright with Chromium available to `require`.
// Run from the repository root:  npm run build && (npx vite preview --port 4173 --strictPort &) && node scripts/e2e/run.cjs
const { chromium } = require("playwright");
const OUT = require("node:path").join(__dirname, "out");
require("node:fs").mkdirSync(OUT, { recursive: true });
const URL = "http://localhost:4173/";
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`); };

(async () => {
  const browser = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, permissions: ["camera"] });
  // Record what the coach says: headless Chromium has no voices, so stand in for speechSynthesis.
  await ctx.addInitScript(() => {
    window.__spoken = [];
    const synth = {
      speaking: false,
      getVoices: () => [],
      addEventListener() {}, removeEventListener() {},
      cancel() {},
      speak(u) { if (u.text.trim()) window.__spoken.push(u.text); setTimeout(() => u.onend && u.onend(), 30); },
    };
    Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(m.text()); });

  await page.goto(URL);
  await page.getByRole("button", { name: "Load a sample draft" }).click();
  check("sample draft fills enemy team", (await page.locator(".tone-enemy .slot.filled").count()) === 5);
  await page.getByRole("button", { name: "Gold lane" }).click();
  const firstCounter = await page.locator(".counters .counter-name").first().innerText();
  check("counter picks listed for gold lane", (await page.locator(".counters li").count()) >= 5, firstCounter.replace(/\s+/g, " "));

  await page.getByRole("button", { name: /Choose your hero/ }).click();
  await page.getByPlaceholder("Search hero…").fill("layla");
  await page.keyboard.press("Enter");
  await page.waitForSelector("text=3 · Plan for Layla");
  const draftBuild = await page.locator(".build .build-name").allInnerTexts();
  check("draft plan shows six items incl. anti-heal", draftBuild.length === 6 && draftBuild.some((t) => t.includes("Sea Halberd")), draftBuild.map((t) => t.split("\n")[0]).join(" > "));
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/1-draft.png`, fullPage: true });

  await page.setViewportSize({ width: 1180, height: 820 });
  await page.locator("text=4 · How to play this game").scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/ipad-guide.png` });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole("button", { name: /Start match/ }).click();
  await page.waitForSelector(".now h1");
  check("live tab opens with a next-item call", /Swift Boots/.test(await page.locator(".now h1").innerText()), await page.locator(".now h1").innerText());
  await page.waitForFunction(() => window.__spoken.length >= 3);
  let spoken = await page.evaluate(() => window.__spoken);
  check("coach speaks setup, the game plan, then the first item", /Playing Layla\. Battle spell: Flicker/.test(spoken[0]) && /^In lane you face Karrie/.test(spoken[1]) && /^Next item: Swift Boots\./.test(spoken[2]), spoken.join(" | "));
  const pics = await page.evaluate(() => [...document.querySelectorAll("img.item-icon")].map((i) => i.complete && i.naturalWidth > 0));
  check("item pictures load in the build list and next-item card", pics.length >= 7 && pics.every(Boolean), `${pics.filter(Boolean).length}/${pics.length} loaded`);
  check("guide shows the lane opponent first, opened", /Karrie/.test(await page.locator(".guide .brief[open] .brief-name").first().innerText()) && (await page.locator(".guide .brief[open] .skills li").count()) >= 1);

  await page.getByRole("button", { name: /Done — got Swift Boots/ }).click();
  await page.waitForFunction(() => /Windtalker/.test(document.querySelector(".now h1")?.textContent ?? ""));
  check("marking an item bought advances the plan", true, await page.locator(".now h1").innerText());

  // Demo vision: loading screen → early scoreboard → late scoreboard with a fed enemy.
  const step = async () => {
    const before = await page.locator(".log li").count();
    await page.getByRole("button", { name: /Run demo step|Read now/ }).click();
    await page.waitForFunction((n) => document.querySelectorAll(".log .log-vision").length > n, await page.locator(".log .log-vision").count());
    return before;
  };
  await step();
  check("read 1 = loading screen", /Read loading screen/.test(await page.locator(".log .log-vision").first().innerText()));
  await step();
  const goldAfterEarly = await page.locator("input.gold").inputValue();
  check("read 2 = scoreboard, gold and clock synced", goldAfterEarly === "620" && /3:(0|1)\d/.test(await page.locator(".big").innerText()), `gold ${goldAfterEarly}, clock ${await page.locator(".big").innerText()}`);
  await step();
  await page.waitForSelector(".enemies li.fed");
  const fedName = await page.locator(".enemies li.fed .enemy-name").first().innerText();
  const nowText = await page.locator(".now h1").innerText();
  check("read 3 = fed enemy flagged and build adapts", /Gusion/.test(fedName) && /(Legion Sword|Magic Blade|Sea Halberd|Rose Gold Meteor)/.test(nowText), `${fedName.replace(/\s+/g, " ")} → "${nowText}"`);
  spoken = await page.evaluate(() => window.__spoken);
  check("coach announces the fed enemy", spoken.some((t) => /Gusion is fed/.test(t)), spoken.slice(2).join(" | "));
  const build = await page.locator(".build .build-name").allInnerTexts();
  console.log("      build now:", build.map((t) => t.split("\n")[0]).join(" > "));
  await page.waitForTimeout(600);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.setViewportSize({ width: 1280, height: 1180 });
  await page.screenshot({ path: `${OUT}/mlbb-guru-live.png` });
  await page.setViewportSize({ width: 1280, height: 800 });

  // Uploading a real screenshot in demo mode must be refused, not answered with the scripted match.
  const readsBefore = await page.locator(".log .log-vision").count();
  await page.locator('input[type="file"]').setInputFiles(`${OUT}/1-draft.png`);
  await page.waitForSelector(".error");
  check("demo mode refuses a real screenshot instead of faking a read", /Demo mode can't read real screenshots/.test(await page.locator(".error").first().innerText()) && (await page.locator(".log .log-vision").count()) === readsBefore);

  // Real capture path with Chromium's fake camera: stream → frames → read.
  await page.getByRole("button", { name: /Point camera at screen/ }).click();
  await page.waitForSelector(".meter");
  // A still camera picture triggers an automatic read (demo step 4: the loading screen again, same heroes).
  await page.waitForFunction(() => document.querySelectorAll(".log .log-vision").length >= 4, null, { timeout: 15000 });
  const meter = await page.locator(".meter span").first().innerText();
  check("camera stream runs, motion is measured, still frame auto-reads", /moving|still/.test(meter), `${meter} | ${await page.locator(".log .log-vision").first().innerText()}`);
  check("same-roster loading read does not reset the match", /Layla/.test(await page.locator("h2", { hasText: "build path" }).first().innerText()) && (await page.locator(".build-slot.owned").count()) >= 1);
  await page.getByRole("button", { name: /Stop camera/ }).click();

  // Settings + persistence across reload.
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Claude", exact: true }).click();
  check("settings: Claude provider shows key + model fields", (await page.getByPlaceholder("sk-ant-…").count()) === 1 && (await page.locator("select").first().inputValue()) === "claude-opus-5-5");
  await page.screenshot({ path: `${OUT}/3-settings.png`, fullPage: true });
  await page.getByRole("button", { name: "Live coach" }).click();
  await page.getByRole("button", { name: "Read now" }).click();
  await page.waitForSelector(".error");
  check("real provider with nothing shared explains what to do", /Nothing to read yet/.test(await page.locator(".error").first().innerText()));
  // Upload a screenshot with no key set: exercises image decoding and the lazily loaded provider code.
  await page.locator('input[type="file"]').setInputFiles(`${OUT}/1-draft.png`);
  await page.waitForFunction(() => /API key/.test(document.querySelector(".error")?.textContent ?? ""));
  check("Claude without a key fails with a clear message", /Add your Claude API key in Settings/.test(await page.locator(".error").first().innerText()));
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Gemini", exact: true }).click();
  await page.getByRole("button", { name: "Live coach" }).click();
  await page.locator('input[type="file"]').setInputFiles(`${OUT}/1-draft.png`);
  await page.waitForFunction(() => /Gemini API key/.test(document.querySelector(".error")?.textContent ?? ""));
  check("Gemini without a key fails with a clear message", true, await page.locator(".error").first().innerText());
  await page.reload();
  await page.waitForSelector(".now h1");
  check("match state survives a reload", /Layla/.test(await page.locator("h2", { hasText: "build path" }).first().innerText()));

  // Phone-width layout.
  await page.setViewportSize({ width: 390, height: 800 });
  await page.waitForTimeout(200);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("no horizontal scroll at phone width", overflow <= 1, `overflow ${overflow}px`);
  await page.screenshot({ path: `${OUT}/4-phone.png` });

  check("no uncaught page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("SCRIPT ERROR", e); process.exit(2); });

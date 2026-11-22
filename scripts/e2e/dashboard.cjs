// Browser check for MLBB Guru. Needs Playwright with Chromium available to `require`.
// Run from the repository root:  npm run build && (npx vite preview --port 4173 --strictPort &) && node scripts/e2e/dashboard.cjs
// Dashboard layout (follow mode on a wide screen), driven like follow.cjs: the bundled endpoint
// answers /api/coach through page.route, and the demo reader stands in for a real model.
const { chromium } = require("playwright");
const OUT = require("node:path").join(__dirname, "out");
require("node:fs").mkdirSync(OUT, { recursive: true });
const WORKTREE = require("node:path").resolve(__dirname, "../..");
const BASE = "http://localhost:4173";
const ROOM = "DASH01";
const results = [];
const check = (name, ok, extra = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const heroes = require(`${WORKTREE}/src/data/generated/heroes.json`);
const heroId = (name) => heroes.find((h) => h.name === name).id;

// Sample AI-coach fields. The demo reader does not produce them, so they are added to the session
// on its way from the endpoint to the page. "stale" uses old timestamps to show the aged states.
// Beat times are fractions of the match clock, so they fit whatever the clock reads when they are injected.
const BEATS = [
  { at: 0.17, text: "Even start: both gold lanes are farming.", tone: "neutral" },
  { at: 0.38, text: "Gusion picked up two early kills in mid.", tone: "bad" },
  { at: 0.55, text: "Your team took the first Turtle.", tone: "good" },
  { at: 0.72, text: "You lost the outer gold-lane turret.", tone: "bad" },
  { at: 0.88, text: "Team fight won in the river: three for one.", tone: "good" },
  { at: 1, text: "Gusion is 8/0/3 and far richer than anyone else.", tone: "bad" },
];
function extras(session, mode) {
  const now = Date.now();
  const clock = session.clockStart ? Math.round((now - session.clockStart) / 1000) : 0;
  const old = mode === "stale";
  const late = (session.history || []).length >= 2; // the second scoreboard is the one where Gusion is fed
  return {
    ai: {
      at: now - (old ? 4 * 60_000 : 40_000), clock, model: "sample", situation: late ? "behind" : "even",
      headline: late ? "Stop fighting alone — Gusion is hunting you." : "Farm safely until Windtalker is done.",
      doNow: late
        ? ["Farm the gold lane under your turret.", "Follow Tigreal into fights; never go first.", "Finish Sea Halberd before the next Lord."]
        : ["Last-hit minions; don't trade with Karrie yet.", "Back off when Gusion is missing from mid."],
      avoid: "Walking through the river without a teammate.",
      focus: { heroId: heroId("Gusion"), why: late ? "8/0/3 and bursting. Stay out of his dash range." : "two early kills. He will come for your lane." },
      item: { id: "sea_halberd", why: "Cuts Estes and Uranus healing." },
    },
    story: BEATS.slice(0, late ? 6 : 3).map((b) => ({ ...b, at: Math.round(b.at * (late ? 1 : 0.5) * clock) })),
    position: {
      at: now - (old ? 3 * 60_000 : 20_000), model: "sample", say: "Stand behind Tigreal on the turret side.",
      summary: "Stand behind Tigreal on the turret side of the lane, at the edge of your range.",
      danger: "Gusion can reach you from the river bush.",
      moves: ["Hug the wall away from the river.", "Hit whoever Tigreal stuns, then step back.", "Keep Flicker for Gusion's dash."],
    },
  };
}

(async () => {
  const api = (await import(`${WORKTREE}/api/coach.js`)).default;
  const server = async (method, path, init = {}) => (await api.fetch(new Request(`${BASE}/api/coach${path}`, { method, ...init }))).json();
  const ipadShot = () => server("POST", `?room=${ROOM}`, { headers: { "x-vision-provider": "demo", "content-type": "image/png" }, body: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) });
  const act = (action) => server("POST", `?room=${ROOM}&action=1`, { headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
  const roomNow = () => server("GET", `?room=${ROOM}&v=0`);

  const browser = await chromium.launch();
  const speechStub = () => {
    window.__spoken = [];
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { getVoices: () => [], addEventListener() {}, removeEventListener() {}, cancel() {}, speak(u) { if (u.text.trim()) window.__spoken.push(u.text); setTimeout(() => u.onend && u.onend(), 20); } } });
  };
  /** A device following the room. `inject` says which sample AI fields ride along: "fresh", "stale" or "none". */
  async function follower(viewport, inject) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 });
    await ctx.addInitScript(speechStub);
    const page = await ctx.newPage();
    const state = { inject, sent: [], errors: [] };
    page.on("pageerror", (e) => state.errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|net::ERR/.test(m.text())) state.errors.push(m.text()); });
    await page.route("**/api/coach*", async (route) => {
      const req = route.request();
      if (req.method() === "POST" && /[?&]action=1/.test(req.url())) state.sent.push(JSON.parse(req.postData() || "{}").action);
      const res = await api.fetch(new Request(req.url(), { method: req.method(), headers: req.headers(), body: req.method() === "GET" ? undefined : req.postDataBuffer() }));
      let text = await res.text();
      if (state.inject !== "none") {
        const body = JSON.parse(text);
        if (body.session && body.session.phase === "live") {
          Object.assign(body.session, extras(body.session, state.inject));
          text = JSON.stringify(body);
        }
      } else {
        // A room whose coach is switched off (x-coach: off) sends none of the specialists' fields.
        const body = JSON.parse(text);
        if (body.session) {
          for (const key of ["ai", "aiBuild", "position", "intel"]) delete body.session[key];
          body.session.story = undefined;
          text = JSON.stringify(body);
        }
      }
      await route.fulfill({ status: res.status, contentType: "application/json", body: text });
    });
    await page.goto(`${BASE}/?room=${ROOM.toLowerCase()}`);
    return { page, state };
  }

  const { page, state } = await follower({ width: 1180, height: 820 }, "fresh");
  const spoken = () => page.evaluate(() => window.__spoken);
  const stageOn = () => page.locator(".stages .chip.on").innerText();
  const shot = async (name) => { await sleep(500); await page.screenshot({ path: `${OUT}/dash-${name}.png` }); };

  /** The page itself must not scroll: one window, nothing below the fold. */
  const pageFits = (p = page) => p.evaluate(() => {
    window.scrollTo(0, 500);
    const moved = window.scrollY;
    window.scrollTo(0, 0);
    const d = document.documentElement;
    return { ok: d.scrollHeight <= window.innerHeight && document.body.scrollHeight <= window.innerHeight && moved === 0 && d.scrollWidth <= window.innerWidth, text: `scrollHeight ${d.scrollHeight} vs window ${window.innerHeight}, scrolled ${moved}px` };
  });
  /** "" when every match of the selector is fully inside the window and inside every scrolling ancestor; else why not. */
  const hidden = (selector, p = page) => p.evaluate((sel) => {
    const els = [...document.querySelectorAll(sel)];
    if (!els.length) return `${sel}: missing`;
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return `${sel}: has no size`;
      if (r.top < -0.5 || r.left < -0.5 || r.bottom > window.innerHeight + 0.5 || r.right > window.innerWidth + 0.5) return `${sel}: outside the window (bottom ${Math.round(r.bottom)})`;
      for (let a = el.parentElement; a; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (!/auto|scroll|hidden|clip/.test(cs.overflowY + cs.overflowX)) continue;
        const ar = a.getBoundingClientRect();
        if (r.top < ar.top - 0.5 || r.bottom > ar.bottom + 0.5 || r.left < ar.left - 0.5 || r.right > ar.right + 0.5) return `${sel}: cut off by <${a.tagName.toLowerCase()} class="${a.className}"> (needs ${Math.round(r.bottom - ar.bottom)}px more)`;
      }
    }
    return "";
  }, selector);
  const allVisible = async (selectors, p = page) => (await Promise.all(selectors.map((s) => hidden(s, p)))).filter(Boolean);
  /** Every piece of visible text on the dashboard, smallest first: nothing may be under 14px. */
  const smallText = (p = page) => p.evaluate(() => {
    const out = [];
    const walker = document.createTreeWalker(document.querySelector(".dash"), NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode.textContent.trim();
      const el = walker.currentNode.parentElement;
      if (!text || el.closest(".hero-icon, .item-icon")) continue; // initials behind a portrait
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (!r.width || !r.height || cs.visibility === "hidden") continue;
      const px = parseFloat(cs.fontSize);
      if (px < 14) out.push(`${px}px "${text.slice(0, 24)}" .${el.className || el.tagName}`);
    }
    return [...new Set(out)];
  });
  const typeCheck = async (label, p = page) => { const small = await smallText(p); check(`${label}: no text under 14px`, small.length === 0, small.slice(0, 4).join(" | ")); };
  const fitCheck = async (label, p = page) => { const fit = await pageFits(p); check(`${label}: the page does not scroll`, fit.ok, fit.text); };

  // ── Waiting ────────────────────────────────────────────────────────────────
  await page.waitForSelector(".dash");
  check("wide follower shows the dashboard instead of the tabs", (await page.locator(".tabs").count()) === 0 && (await page.locator(".roombar").count()) === 0 && (await page.locator(".dash-grid, .dash-center").count()) === 1);
  const bar = await page.locator(".dash-bar").innerText();
  check("top bar: room code, four stage buttons, clock, last-screenshot status, voice, settings", /DASH01/.test(bar) && (await page.locator(".dash-bar .stages .chip").count()) === 4 && /--:--/.test(bar) && /Waiting/.test(bar) && /Turn on voice/.test(bar) && /Settings/.test(bar), bar.replace(/\s+/g, " ").slice(0, 150));
  const waitingText = await page.locator(".dash-calm").innerText();
  check("before the first screenshot: a calm waiting state that says what to do on the phone", /Waiting for your phone/.test(waitingText) && /On your phone/i.test(waitingText) && /draft mode/.test(waitingText) && (await page.locator(".dash .panel").count()) === 0, waitingText.replace(/\s+/g, " ").slice(0, 120));
  await fitCheck("waiting");
  await typeCheck("waiting");
  await shot("1-waiting");

  await page.getByRole("button", { name: /Turn on voice for this device/ }).click();
  await page.waitForFunction(() => window.__spoken.some((t) => /Voice is on/.test(t)));
  check("one tap turns voice on and the top bar shows it", /Voice on/.test(await page.locator(".dash-bar .voice").innerText()) && (await page.getByRole("button", { name: /Turn on voice for this device/ }).count()) === 0);

  // ── Hero selection ─────────────────────────────────────────────────────────
  await page.getByRole("button", { name: "Hero selection" }).click();
  await sleep(600);
  check("stage button is sent to the server (Hero selection)", state.sent.some((a) => a.type === "setStage" && a.stage === "draft") && (await roomNow()).session.stage === "draft");
  // Two enemies lock in. (The demo reader has no draft screen, so the picks arrive as controller actions.)
  await act({ type: "setTeam", side: "enemies", ids: [heroId("Gusion"), heroId("Karrie")] });
  await page.waitForSelector(".dash .counters li", { timeout: 15000 });
  const draftText = await page.locator(".dash-grid").innerText();
  check("hero selection: counter picks replace the build", (await page.locator(".dash .counters li").count()) >= 5 && /Best into this enemy team/i.test(draftText) && /2 of 5 enemies known/i.test(draftText) && (await page.locator(".dash .now, .dash .build").count()) === 0 && (await stageOn()) === "Hero selection", (await page.locator(".dash .counter-name").first().innerText()).replace(/\s+/g, " "));
  const draftHidden = await allVisible([".dash .counters li:nth-child(-n+5)", ".dash .team-row", ".dash-col:nth-child(3) .dash-quiet", ".dash-col:nth-child(3) .panel"]);
  check("hero selection: picks, both team rows and the guide column are on screen", draftHidden.length === 0, draftHidden.join(" | "));
  await fitCheck("hero selection");
  await typeCheck("hero selection");
  await shot("2-hero-selection");

  // ── Match starting (demo read 1: loading screen) ───────────────────────────
  await ipadShot();
  await page.waitForFunction(() => window.__spoken.some((t) => /Playing Layla/.test(t)), null, { timeout: 15000 });
  await page.waitForSelector(".dash-setup");
  check("match starting: stage moved by itself and the plan is spoken", (await stageOn()) === "Match starting" && /Playing Layla\. Battle spell: Flicker\. In lane you face Karrie/.test((await spoken()).join(" | ")));
  const setupText = await page.locator(".dash-col:nth-child(1)").innerText();
  check("match starting: hero, battle spell, emblem and the lane plan", /Layla/.test(await page.locator(".dash-setup h1").innerText()) && /Battle spell\s+Flicker/i.test(setupText) && /Emblem/i.test(setupText) && /In lane you face Karrie/.test(await page.locator(".dash-col:nth-child(1) .plan").innerText()), setupText.replace(/\s+/g, " ").slice(0, 110));
  const loadHidden = await allVisible([".dash-setup", ".dash-col:nth-child(1) .plan li", ".dash .build-slot", ".dash .team-strip", ".dash .enemies li", ".dash .brief.lane > summary"]);
  check("match starting: setup, plan, build, teams, threats and lane card are on screen", loadHidden.length === 0, loadHidden.join(" | "));
  await fitCheck("match starting");
  await typeCheck("match starting");
  await shot("3-match-starting");

  // ── In match (demo read 2: early scoreboard) ───────────────────────────────
  await ipadShot();
  await page.waitForSelector(".dash .now h1", { timeout: 15000 });
  await page.waitForFunction(() => window.__spoken.some((t) => /Windtalker/.test(t)), null, { timeout: 15000 });
  const liveCore = [".dash .now", ".dash .build-slot", ".dash-col:nth-child(2) .dash-cell:first-of-type .panel", ".dash .enemies li", ".dash .brief.lane > summary"];
  const liveChecks = async (label, p = page) => {
    await fitCheck(label, p);
    const gone = await allVisible(liveCore, p);
    check(`${label}: NowCard, build list, Match so far, threat panel and lane card are visible without scrolling`, gone.length === 0, gone.join(" | "));
    await typeCheck(label, p);
  };
  const now1 = await page.evaluate(() => {
    const h1 = document.querySelector(".dash .now h1");
    const img = document.querySelector(".dash .now img.item-icon");
    return { text: h1.innerText, h1: parseFloat(getComputedStyle(h1).fontSize), icon: img ? img.getBoundingClientRect().width : 0, loaded: !!img && img.complete && img.naturalWidth > 0 };
  });
  check("in match: NowCard is large (picture ≥ 96px, headline ≥ 28px) and names the next purchase", /Windtalker/.test(now1.text) && now1.h1 >= 28 && now1.icon >= 96 && now1.loaded && (await stageOn()) === "In match", `"${now1.text}" · headline ${now1.h1}px · picture ${now1.icon}px`);
  const paid = await page.evaluate(() => { const bar = document.querySelector(".dash .build .paid"); return bar ? { text: bar.textContent, width: bar.querySelector("i").getBoundingClientRect().width, full: bar.getBoundingClientRect().width } : { text: "", width: 0, full: 0 }; });
  check("in match: six-item build with pictures and paid progress", (await page.locator(".dash .build-slot").count()) === 6 && (await page.locator(".dash .build-slot img.item-icon").count()) === 6 && (await page.locator(".dash .build-slot.owned").count()) === 1 && paid.width > 0 && paid.width < paid.full && /160 of 1880 gold paid/.test(paid.text), `${paid.text} (bar ${Math.round(paid.width)} of ${Math.round(paid.full)}px)`);
  check("in match: clock runs in the top bar and the last screenshot is named", /3:\d\d/.test(await page.locator(".dash-clock").innerText()) && /The scoreboard/.test(await page.locator(".dash-read").innerText()) && /ago|just now/.test(await page.locator(".dash-read").innerText()), (await page.locator(".dash-clock").innerText()) + " · " + (await page.locator(".dash-read").innerText()).replace(/\s+/g, " "));
  const earlyHidden = await allVisible([".dash .ai-card .ai-headline", ".dash .ai-card .how li", ".dash .ai-card .ai-avoid", ".dash .ai-card .ai-focus"]);
  check("in match (early): the whole AI card is on screen", earlyHidden.length === 0, earlyHidden.join(" | "));
  await liveChecks("in match (early)");
  await shot("4-in-match-early");

  await page.getByRole("button", { name: /I bought Windtalker anyway/ }).click();
  await sleep(600);
  check("a tap on the dashboard reaches the server (bought Windtalker)", ((await roomNow()).session.owned || []).includes("windtalker"));

  // ── In match (demo read 3: late scoreboard, Gusion fed) ────────────────────
  await ipadShot();
  await page.waitForFunction(() => window.__spoken.some((t) => /Gusion is fed/.test(t)), null, { timeout: 15000 });
  await page.waitForSelector(".dash .standings tr");
  const ai = await page.locator(".dash .ai-card").innerText();
  check("AI coach card: headline, do-now list, avoid, focus hero, situation tag and age", /Gusion is hunting you/.test(ai) && (await page.locator(".dash .ai-card .how li").count()) === 3 && /Avoid:/.test(ai) && /Gusion — 8\/0\/3/.test(ai) && /behind/i.test(ai) && /\d+s ago/.test(ai) && (await page.locator(".dash .ai-card.stale").count()) === 0, ai.replace(/\s+/g, " ").slice(0, 120));
  const beats = await page.locator(".dash .beats li").allInnerTexts();
  check("storyboard: beats newest first, with the match clock and a tone", beats.length === 6 && /^3:\d\d\s+Gusion is 8\/0\/3/.test(beats[0]) && /^0:\d\d\s+Even start/.test(beats[5]) && (await page.locator(".dash .beats .beat-bad").count()) === 3 && (await page.locator(".dash .beats .beat-good").count()) === 2, beats[0].replace(/\s+/g, " "));
  const pos = await page.locator(".dash .pos-card").innerText();
  check("positioning card: summary, danger and numbered moves", /Stand behind Tigreal/.test(pos) && /river bush/.test(await page.locator(".dash .pos-danger").innerText()) && (await page.locator(".dash .pos-card ol li").count()) === 3 && (await page.locator(".dash-quiet").count()) === 0);
  const story = await page.locator(".dash-col:nth-child(2) .dash-cell:first-of-type").innerText();
  check("match so far keeps its memory: gold split, sentences and all ten players", /2 scoreboards remembered/.test(story) && /Your team is|The teams are/.test(story) && (await page.locator(".dash .standings tr").count()) === 10);
  check("threat panel flags the fed enemy; lane card is the lane opponent", /Gusion/.test(await page.locator(".dash .enemies li.fed .enemy-name").first().innerText()) && /Karrie/.test(await page.locator(".dash .brief.lane .brief-name").innerText()));
  check("recent screenshots are logged at the bottom of the third column", /the scoreboard · clock 9:40 · 1450 gold/.test(await page.locator(".dash-col:nth-child(3) .dash-cell.log").innerText()));
  const extraHidden = await allVisible([".dash .ai-card .ai-headline", ".dash .ai-card .how li", ".dash .ai-card .ai-avoid", ".dash .ai-card .ai-focus", ".dash .beats li:first-child", ".dash .pos-card"]);
  check("the whole AI card (headline, do-now, avoid, focus hero), the newest beat and the positioning card are on screen", extraHidden.length === 0, extraHidden.join(" | "));
  await liveChecks("in match (late)");
  await shot("5-in-match");

  for (const [w, h] of [[1024, 768], [1366, 1024]]) {
    await page.setViewportSize({ width: w, height: h });
    await sleep(400);
    await fitCheck(`in match at ${w}x${h}`);
    const gone = await allVisible(liveCore);
    check(`in match at ${w}x${h}: the five core panels are visible without scrolling`, gone.length === 0, gone.join(" | "));
    await typeCheck(`in match at ${w}x${h}`);
    const aiGone = await allVisible([".dash .ai-card .ai-headline", ".dash .ai-card .how li", ".dash .ai-card .ai-avoid", ".dash .ai-card .ai-focus"]);
    console.log(`INFO  in match at ${w}x${h}: AI card ${aiGone.length ? "scrolls inside itself — " + aiGone.join(" | ") : "is on screen whole"}`);
    await shot(`5-in-match-${w}x${h}`);
  }
  await page.setViewportSize({ width: 1180, height: 820 });

  // Old advice: the AI card dims after three minutes, the positioning card gives way to its hint after two.
  state.inject = "stale";
  await act({ type: "setLaneOpponent", id: heroId("Karrie") });
  await page.waitForSelector(".dash .ai-card.stale", { timeout: 15000 });
  check("old AI advice is dimmed and says how old it is; stale positioning gives way to the hint", /4 min ago/.test(await page.locator(".dash .ai-card").innerText()) && (await page.locator(".dash .pos-card").count()) === 0 && /Say "help me position" on your phone/.test(await page.locator(".dash-quiet").innerText()));
  const oldHidden = await allVisible([".dash .ai-card .ai-headline", ".dash .ai-card .how li", ".dash .ai-card .ai-avoid", ".dash .ai-card .ai-focus", ".dash-quiet"]);
  check("in match (old advice): the dimmed AI card and the positioning hint are on screen", oldHidden.length === 0, oldHidden.join(" | "));
  await liveChecks("in match (old advice)");
  await shot("6-in-match-old-advice");

  // A device whose server sends none of the AI fields: the rule-based content stands in.
  const plain = await follower({ width: 1180, height: 820 }, "none");
  await plain.page.waitForSelector(".dash .now h1", { timeout: 15000 });
  await plain.page.waitForSelector(".dash .standings tr");
  const read = await plain.page.locator(".dash .ai-card").innerText();
  const plainNow = await plain.page.locator(".dash .now").innerText();
  check("without AI fields: the NowCard keeps its explanation", /Anti-heal — cuts the healing/.test(plainNow) && (await allVisible([".dash .now > p"], plain.page)).length === 0, plainNow.replace(/\s+/g, " ").slice(0, 110));
  check("without AI fields: Coach's read shows session.tip, no storyboard, positioning hint only", /Coach's read/i.test(read) && /Gusion is far ahead — group up/.test(read) && (await plain.page.locator(".dash .beats").count()) === 0 && (await plain.page.locator(".dash .pos-card").count()) === 0 && (await plain.page.locator(".dash-quiet").count()) === 1, read.replace(/\s+/g, " "));
  await liveChecks("in match (no AI fields)", plain.page);
  await sleep(500);
  await plain.page.screenshot({ path: `${OUT}/dash-7-in-match-no-ai.png` });
  check("no page errors on the second device", plain.state.errors.length === 0, plain.state.errors.slice(0, 2).join(" | "));
  await plain.page.context().close();

  // ── Settings and back ──────────────────────────────────────────────────────
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.waitForSelector(".dash-settings");
  check("Settings opens inside the dashboard", /Phone plays, iPad shows the coach/.test(await page.locator(".dash-settings").innerText()) && (await page.locator(".dash-grid").count()) === 0);
  await fitCheck("settings");
  await shot("x-settings");
  await page.getByRole("button", { name: "Back to the dashboard" }).click();
  await page.waitForSelector(".dash-grid");
  check("…and the same button comes back to the dashboard", (await page.locator(".dash-settings").count()) === 0 && (await page.locator(".dash .now").count()) === 1);

  // ── A phone-sized window on the same URL keeps the stacked layout ─────────
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForSelector(".roombar");
  const phone = await page.evaluate(() => ({ dash: document.querySelectorAll(".dash").length, tabs: document.querySelectorAll(".tabs .tab").length, bar: document.querySelector(".roombar").innerText, now: !!document.querySelector(".grid.live .now h1"), cols: getComputedStyle(document.querySelector(".grid.live")).gridTemplateColumns.split(" ").length, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, icon: document.querySelector(".now .item-icon").getBoundingClientRect().width }));
  check("390px wide: the old stacked layout, tabs and room bar", phone.dash === 0 && phone.tabs === 3 && /Following room DASH01/.test(phone.bar) && phone.now && phone.cols === 1 && phone.overflow <= 1 && phone.icon === 84, JSON.stringify({ ...phone, bar: phone.bar.slice(0, 40) }));
  await page.screenshot({ path: `${OUT}/dash-9-phone-390.png` });
  await page.setViewportSize({ width: 899, height: 820 });
  await sleep(300);
  check("899px wide is still the tabbed layout; 900px is the dashboard", (await page.locator(".dash").count()) === 0 && (await page.setViewportSize({ width: 900, height: 820 }), await sleep(300), await page.locator(".dash").count()) === 1);
  await fitCheck("900px wide");
  await shot("x-in-match-900x820");
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.waitForSelector(".dash .now");

  // ── Match over, then a fresh match ─────────────────────────────────────────
  await page.getByRole("button", { name: "Match over" }).click();
  await page.waitForSelector(".dash-say");
  await sleep(600);
  const paused = await ipadShot();
  check("stage button is sent to the server (Match over pauses reading)", state.sent.some((a) => a.type === "setStage" && a.stage === "done") && paused.stop === true && paused.title === "Paused" && (await roomNow()).session.stage === "done");
  const over = await page.locator(".dash-calm").innerText();
  check("match over: a short paused state that says what to say next", /Coaching is paused/.test(over) && /"draft mode"/.test(over) && (await stageOn()) === "Match over" && (await page.locator(".dash .now").count()) === 0, over.replace(/\s+/g, " ").slice(0, 110));
  await fitCheck("match over");
  await typeCheck("match over");
  await shot("8-match-over");

  await page.getByRole("button", { name: "In match" }).click();
  await page.waitForSelector(".dash .now");
  check("stage button is sent to the server (In match resumes)", (await roomNow()).session.stage === "live" && (await stageOn()) === "In match");
  await page.getByRole("button", { name: "Match starting" }).click();
  await page.waitForSelector(".dash-setup");
  check("stage button is sent to the server (Match starting)", (await sleep(400), await roomNow()).session.stage === "loading" && (await stageOn()) === "Match starting");
  await page.getByRole("button", { name: "Hero selection" }).click();
  await sleep(600);
  const fresh = (await roomNow()).session;
  check("Hero selection starts a clean match on the server and on screen", fresh.enemies.length === 0 && fresh.owned.length === 0 && fresh.stage === "draft" && !fresh.myHeroId && (await page.locator(".dash .counters li").count()) >= 5 && /Strong this patch/i.test(await page.locator(".dash-grid").innerText()));
  await fitCheck("fresh hero selection");
  await page.getByRole("button", { name: "Add to Enemy team" }).click();
  await page.getByPlaceholder("Search hero…").fill("gus");
  await shot("x-hero-picker");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await sleep(500);
  check("a pick made by hand on the dashboard reaches the server", (await roomNow()).session.enemies.length === 1 && (await page.locator(".dash .tone-enemy .slot.filled").count()) === 1);

  // ── A screenshot that cannot be read (no API key on the shortcut) ─────────
  await server("POST", `?room=${ROOM}`, { headers: { "content-type": "image/png" }, body: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) });
  await page.waitForSelector(".dash-alert", { timeout: 15000 });
  check("a read error is shown in full under the top bar, and flagged in it", /could not be read: Add your API key/.test(await page.locator(".dash-alert").innerText()) && /Screenshot not read/.test(await page.locator(".dash-read.bad").innerText()), (await page.locator(".dash-alert").innerText()).slice(0, 90));
  await fitCheck("read error");
  await typeCheck("read error");
  await shot("x-read-error");

  check("no page errors", state.errors.length === 0, state.errors.slice(0, 2).join(" | "));
  await browser.close();
  console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error("SCRIPT ERROR", String(e && e.stack || e).slice(0, 900)); process.exit(2); });

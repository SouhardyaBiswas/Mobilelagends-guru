# MLBB Guru

A coach for Mobile Legends: Bang Bang, built for a new player. It tells you, in plain words and out loud:

- **In draft** — which heroes are best into the enemy picks for your lane (your lane opponent counts double), and what to take if you pick first.
- **Before the match** — battle spell, emblem, and a game plan: who is in your lane, how to play against them, who to kill first, what to watch out for.
- **During the match** — the one thing to do with your gold right now, with the item's picture and where to find it in the shop. It re-plans when an enemy gets fed.

Every enemy gets a card with the skills to recognise (real names and descriptions from the game's own data) and how to play against them.

> **Status:** the advice engine, guide, pictures, voice and the screenshot endpoint are tested (53 unit tests, 34 scripted browser checks). Reading *real* screenshots with a live vision model has **not** been run yet — see [What is and isn't verified](#what-is-and-isnt-verified).

## iPad plays, phone coaches (no laptop)

The iPad runs the game and sends screenshots by itself. This site reads them and works out the advice. Your phone, beside you, is the dashboard and the voice — and the controller, with stage buttons for *Hero selection → Match starting → In match → Match over*.

### 1. Put it online — free

1. Open **vercel.com/new** in Safari and sign in.
2. Tap **Continue with GitHub** and approve it (Vercel must be connected to GitHub before it can see the repository), then choose this repository and press **Deploy**. Leave every setting alone.
3. Open the address it gives you.

Every later update to this repository redeploys by itself. The free Hobby plan is enough.

### 2. Get a free key

Google AI Studio → *Get API key*. This is what reads the screenshots. It goes into the iPad shortcut, not onto the site.

### 3. Set up the two devices

On the site open **Settings → iPad plays, phone coaches**. It shows your room code, the link for the phone and the address for the shortcut, with copy buttons and a *Test server* button.

**iPad — build the shortcut once** (Shortcuts app → +):

1. *Repeat* — 60 times. Put the next five actions inside it.
2. *Take Screenshot*
3. *Resize Image* — width 1600
4. *Convert Image* — JPEG
5. *Get Contents of URL* — the shortcut address from Settings; method POST; header `x-vision-key` = your key; request body = File → the converted image
6. *Wait* — 15 seconds

**Phone:** open the phone link from Settings, tap **Turn on voice**, and keep the page on screen.

### 4. Play

1. When hero selection starts, tap **Hero selection** on the phone and run the shortcut on the iPad.
2. As enemies lock in, the phone calls out the best picks. Once you have picked, it tells you how to play your lane.
3. In the match it tracks your gold and the clock from ordinary gameplay screenshots, and says what to buy, with the item's picture and where it is in the shop. Open the scoreboard now and then so it sees everyone's items; open the shop once so it learns the build you chose.
4. Tap **Done** on the phone when you buy something. Tap **Match over** to pause reading.

The stage moves on by itself as the screenshots change; the buttons are there for when it guesses wrong.

**First run:** build the shortcut without *Repeat* and *Wait*, open the scoreboard in a match and run it once with the phone watching. That proves the key, the server and the read in one step. If nothing arrives, the bar at the top of the phone says why (wrong key, quota, wrong upload). Then add *Repeat* and *Wait*.

**Hero selection:** the coach can only suggest picks once enemy heroes are actually shown. In modes where the enemy side stays hidden ("Player 1–5") until the loading screen, advice starts at the loading screen.

**If the repeating shortcut stops by itself:** iPadOS decides how long a shortcut may keep running behind a game, and that has only been reasoned about, not tried. If it stops, remove *Repeat* and *Wait*, assign the four-action shortcut to an AssistiveTouch double-tap (Settings → Accessibility → Touch → AssistiveTouch → Custom Actions), and double-tap when you open the scoreboard. One double-tap takes and sends the screenshot; nothing is shared by hand.

### What an iPad cannot do

| Wanted | Reality |
|---|---|
| A web page that watches the game | Not possible in Safari on iPad. The Shortcut is the only route without a native app. |
| A pop-up drawn over the game | Not possible from a web page. The phone is the display; a true overlay needs a native app, built with a Mac. |
| Guaranteed memory of the match on the server | The free setup keeps the match in the server's memory. If the server restarts, the phone hands its copy back; if both lose it, the next scoreboard screenshot rebuilds everything. |

### Other ways to use it

- **Phone only, by hand:** Draft tab → tap in the enemy heroes → pick yours → Start match. No key needed.
- **Upload a screenshot:** Settings → Screen reading → paste the key → Live coach → Upload screenshot.
- **Laptop:** Live coach → Share game screen, which watches a game window continuously.

## How it decides

- **Counters** — each candidate's measured win-rate edge against every enemy pick (Moonton's ranked stats), lane opponent doubled, half-weight synergy with teammates, a small patch-strength nudge, plus the game's own hero notes.
- **Threat** — each enemy's share of their team's kill pressure, raised for whoever is really ahead (at least 700 gold or 3 kills clear). That re-weights the physical/magic split and flags healing, burst, crowd control and tankiness.
- **Build** — your in-game build if a shop screenshot was read, otherwise a short core for your hero type; then counters for this enemy team. Carries get at most two defensive items.
- **Next step** — buy if you can afford it; otherwise an urgent counter you *can* afford, or a cheap piece that already carries part of its effect; otherwise save. Every step says where the item is: your Recommended list, a shop tab, or inside another item's build path.
- **Guide** — skill names, cooldowns and descriptions come from synced game data, so new heroes are covered. The advice lines follow from what a kit does (crowd control, burst, healing, dashes), not from memory of the hero.
- **Voice** — speaks when the advice changes, never on a loop.

## Data

| What | Source | Refresh |
|---|---|---|
| 133 heroes: roles, lanes, skills, portraits | Moonton's public stats API | `npm run sync-data` |
| ~2,900 hero-vs-hero win-rate records | Same API, all ranks | `npm run sync-data` |
| Item pictures | Mobile Legends Fandom wiki | `npm run sync-icons` |
| Items, costs, build paths | `src/data/items.ts`, checked against patch 2.2.23 and against real shop prices | Edit after big patches |
| Build templates, spells, emblems | `src/data/builds.ts` | Edit to taste |

## What is and isn't verified

**Verified here**
- 53 unit tests: counters, threat weighting, build planning, the buy / piece / save / sell flow, the guide for all 133 heroes, catalog and picture coverage, and session handling.
- Tests transcribed by hand from real match screenshots: one scoreboard yields the hero, both teams, gold and inventory; the shop yields the in-game build; all eight shop prices match the catalog at the emblem's 95%.
- 34 scripted browser checks in demo mode: the single-device flow, and the two-device flow with a simulated iPad posting screenshots while a phone-sized page follows, speaks, sends purchases back and switches stages.
- The screenshot endpoint, run locally: health check, error answers, a scripted match, and the cases that matter with two devices — a tap on the phone landing while a screenshot is still being read, ending the match mid-read, and failed reads being reported to the phone.

**Not verified**
- **A real vision model reading a real screenshot.** No API key was available while building.
- **The endpoint running on Vercel.** It is one self-contained file to keep that simple; *Settings → Test endpoint* confirms it once deployed.
- **The Shortcut on a real iPad**, in particular whether a repeating shortcut keeps running behind the game.
- **Voice on iPhone and iPad Safari.**

## Fair-play note

Moonton's terms prohibit third-party tools that give an unfair advantage, and they decide what counts. This reads what you can already see and never automates or modifies anything — the same category as a build guide on a second screen — but using it in ranked is your call and your risk.

## For development

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests
npm run build      # site in dist/ and the endpoint in api/coach.js
```

Node 20+. Screen sharing (**Share game screen**) works on a laptop browser, where the app can watch a game window continuously.

```
scripts/           data and picture sync
src/data/          generated hero data, item catalog, build templates, timers
src/engine/        threat, counters, build planner, guide, coach lines, endpoint replies
src/vision/        prompt, answer schema, Gemini / Claude / demo readers
src/state/         match state (shared by the app and the endpoint)
src/server/        the screenshot endpoint, bundled to api/coach.js
src/ui/            Draft, Live coach, Settings
tests/             unit tests
```

Not affiliated with or endorsed by Moonton. Hero and item names, pictures and statistics belong to Moonton.

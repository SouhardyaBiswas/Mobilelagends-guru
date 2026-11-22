# MLBB Guru

A voice coach for Mobile Legends: Bang Bang. It runs next to the game and tells you, out loud:

- **In draft** — which heroes counter the enemy picks for your lane, and why.
- **Before the match** — battle spell, emblem and a six-item plan built against *this* enemy team.
- **During the match** — the one thing to do with your gold right now: buy this, buy the cheap piece first, save, or sell-and-swap. It re-plans when an enemy gets fed.

The item logic follows how strong players itemise: a short fixed core, then answers to whoever is actually hurting you — and a cheap counter piece now rather than gold sitting in your pocket.

> **Status:** the recommendation engine, UI, voice and capture loop are tested (33 unit tests plus a scripted browser run). Reading *real* game screenshots with a live API key has **not** been tested yet — see [What is and isn't verified](#what-is-and-isnt-verified).

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
```

Open it, go to **Draft → Load a sample draft**, choose your hero, press **Start match**, then on the **Live coach** tab press **Run demo step** three times. That plays a scripted match (loading screen → early scoreboard → an enemy gets fed) with no API key, so you can hear how it behaves.

```bash
npm test             # unit tests
npm run build        # static site in dist/
npm run sync-data    # refresh heroes + matchup stats after a patch
```

Requires Node 20+.

## Using it for real

### On a laptop (recommended)

1. Run the game in its emulator / Google Play Games window, and open MLBB Guru in Chrome or Edge.
2. **Settings** → pick Gemini or Claude and paste your API key.
3. **Live coach → Share game screen** and choose the game window.
4. Play. When you open the **scoreboard** (or the shop, draft, or loading screen), the picture holds still; the app notices, reads it, and speaks. Live gameplay never holds still, so it is ignored.

The app only looks at pixels you share with the browser. It does not touch the game's memory, network traffic or inputs.

### On a tablet

A web page cannot capture another app's screen on Android or iPadOS, so the tablet cannot watch itself. Options, best first:

| Option | How | Trade-off |
|---|---|---|
| Second device as camera | Open the app on a phone, **Point camera at screen**, prop it facing the tablet | Works anywhere; needs a stand and decent light |
| Mirror to the laptop | Mirror the tablet (e.g. scrcpy for Android) and share that window | Most accurate; needs the laptop nearby |
| Manual | Run the app in split view; tap enemies as fed, tap items as bought, type gold | No screen reading, no API cost |
| Screenshots | Take a screenshot in game, **Upload screenshot** | Too slow mid-fight; fine between games |

A native Android overlay (screen capture inside the tablet itself) is the real fix and is not built yet.

### Without screen reading

Everything except the automatic reading works with no key: counters, spell, emblem, build plan, timers and voice. Mark enemies **Fed / Behind** by tapping, tap **Done** when you buy, and type your gold for exact "buy now / save" calls.

## Screen reading: keys, models, cost

Keys live in this browser's local storage and are sent only to the provider you pick. There is no server.

| Provider | Default model | Key from |
|---|---|---|
| Gemini | `gemini-3.8-flash` | Google AI Studio |
| Claude | `claude-opus-5-5` | Anthropic Console |

Rough cost per read with Claude, from list prices (about 3k input tokens for the image and prompt, well under 1k output) — an estimate, not a measurement:

| Model | Per read | Per match (~25 reads) |
|---|---|---|
| `claude-opus-5-5` | ~$0.03 | ~$0.70 |
| `claude-sonnet-5-5` | ~$0.015 | ~$0.35 |
| `claude-haiku-5-5` | under $0.001 | ~$0.02 |

Opus is the default because item icons are small; try Haiku and keep it if it reads your screen correctly. For Gemini, check current AI Studio pricing. **Settings → Maximum reads per match** is a hard cap, and the Live tab shows a running count and cost.

With Claude Opus/Sonnet, requests opt into the API's server-side fallback, so a declined request is retried on another model within the same call.

## How it decides

- **Counters** — for each candidate, the sum of its measured win-rate edge against every enemy pick (Moonton's ranked stats), half-weight synergy with your teammates, a small patch-strength nudge, and a bonus when the game's own hero notes name the matchup. Filtered to your lane.
- **Threat** — each enemy's share of their team's kill pressure, from role and offense rating, multiplied by how fed they are (gold and K/D from the scoreboard, or your manual marks). That re-weights the physical/magic split and flags healing, burst, crowd control, tankiness and basic-attack reliance.
- **Build** — boots, first core item, urgent counters, the rest of the core, other counters, then damage. Carries get at most two defensive items; tanks split resistances by the enemy's damage mix.
- **Next step** — buy if you can afford it; otherwise a counter you *can* afford, or a cheap piece that already carries part of the effect (Dreadnaught Armor, Fury Hammer, Magic Blade…); otherwise save. With six items, it suggests a sell-swap only for a real problem.
- **Voice** — speaks when the recommendation changes, never on a loop. Fed-enemy alerts interrupt; "save" lines never do.

## Data

| What | Source | Refresh |
|---|---|---|
| 133 heroes: roles, lanes, skills, portraits | Moonton's public stats API (the one behind the official hero pages) | `npm run sync-data` |
| ~2,900 hero-vs-hero win-rate records | Same API, all ranks, five trailing-day windows | `npm run sync-data` |
| Items, costs, build paths | `src/data/items.ts`, hand-maintained, checked against patch 2.2.23 (Nov 2026) | Edit after big patches |
| Build templates, spells, emblems | `src/data/builds.ts` | Edit to taste |
| Objective timers | `src/data/timeline.ts` | Edit if a patch moves them |

Behind a proxy, run the sync as `NODE_USE_ENV_PROXY=1 npm run sync-data`.

## What is and isn't verified

**Verified here**
- Engine behaviour: 33 unit tests covering counters, threat weighting, build planning, the buy/component/save/sell flow, catalog integrity and session handling.
- The whole app in headless Chromium: draft → plan → live coaching → demo reads → fed-enemy re-plan → spoken lines, plus a fake camera stream through the capture loop, both missing-key error paths, reload persistence and phone-width layout.
- Hero and matchup data pulled live from Moonton's API.

**Not verified**
- **Reading real screenshots.** No API key was available while building, so neither provider has been called and accuracy on a real scoreboard is unknown. Expect the loading and draft screens (hero names are printed) to read well, and small item icons on the scoreboard to be the weak spot. The app drops names it cannot match rather than guessing, and corrects flipped teams from what it already knows.
- **Stillness thresholds** against a real game window. If the scoreboard never triggers a read, raise *Stillness sensitivity* in Settings or switch to *On a timer*.
- **Voice in a background tab.** Desktop Chrome and Edge normally keep speaking when the tab is not focused; Android pauses pages that leave the screen.

## Fair-play note

Moonton's terms prohibit third-party tools that give an unfair advantage, and they decide what counts. This app is a second-screen advisor: it reads what you can already see and never automates or modifies anything. That is the same category as having a build guide open, but using it in ranked is your call and your risk.

## Deploy

It is a static site. Screen capture and camera need HTTPS (localhost is exempt), so deploy it to use it from a tablet or phone.

```bash
npm run build
npx vercel deploy --prod dist          # Vercel
# or
npx firebase-tools deploy --only hosting   # Firebase Hosting, with "public": "dist"
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| No voice | Press **Voice on**, then **Settings → Test voice**. Browsers only allow speech after a click. |
| "Share game screen" is disabled | Phones and tablets can't capture other apps. Use camera, mirroring or manual mode. |
| Shared window is black | Share the whole screen instead of the window, or run the game windowed. |
| Scoreboard never triggers a read | Raise *Stillness sensitivity*, or use **Read now** / *On a timer*. |
| Wrong hero or item read | Tap to correct it. A known roster (from draft or the loading screen) makes later reads much more reliable. |
| Coach recommends an item that no longer exists | Update `src/data/items.ts`; `npm test` checks that every build references real items. |
| Counters look stale after a patch | `npm run sync-data` |

## Layout

```
scripts/sync-data.mjs     pull heroes + matchups from Moonton's API
src/data/                 generated hero data, item catalog, build templates, timers
src/engine/               threat analysis, counter ranking, build planner, coach lines
src/vision/               prompt, answer schema, Claude / Gemini / demo providers
src/capture/              screen + camera frames, still-screen detector, background ticker
src/audio/                speech queue
src/state/                session store (persists across reloads)
src/ui/                   Draft, Live coach, Settings
tests/                    unit tests
```

Not affiliated with or endorsed by Moonton. Hero names, portraits and statistics belong to Moonton.

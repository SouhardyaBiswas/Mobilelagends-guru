# MLBB Guru

A coach for Mobile Legends: Bang Bang, built for a new player. It tells you, in plain words and out loud:

- **In draft** — which heroes are best into the enemy picks for your lane (your lane opponent counts double), and what to take if you pick first.
- **Before the match** — battle spell, emblem, and a game plan: who is in your lane, how to play against them, who to kill first, what to watch out for.
- **During the match** — the one thing to do with your gold right now, with the item's picture and where to find it in the shop. It re-plans when an enemy gets fed.

Every enemy gets a card with the skills to recognise (real names and descriptions from the game's own data) and how to play against them.

> **Status:** the advice engine, guide, pictures, voice and the screenshot endpoint are tested (45 unit tests, 22 scripted browser checks). Reading *real* screenshots with a live vision model has **not** been run yet — see [What is and isn't verified](#what-is-and-isnt-verified).

## Use it with only an iPad (no laptop)

### 1. Put it online — free, about a minute

1. Open **vercel.com/new** in Safari and sign in.
2. Under *Import Git Repository* choose this repository and press **Deploy**. Leave every setting alone.
3. Open the address it gives you. Add it to your Home Screen from the share menu if you like.

Every later update to this repository redeploys by itself. The free Hobby plan is enough.

### 2. What works straight away

Open the site on your **iPhone next to the iPad** (or on the iPad between matches):

- **Draft** tab → tap in the enemy heroes as they lock in → best picks, your build with pictures, and the *How to play this game* guide.
- **Start match** → the Live coach speaks the plan and each purchase. Tap **Done** when you buy, tap an enemy **Even → Fed** when they pull ahead.
- First check: **Settings → Test voice**. Phones only speak after you tap something, and only while the page is on screen.

### 3. Let it read your screenshots

1. Get a free key: Google AI Studio → *Get API key*.
2. **Settings → Screen reading → Gemini** → paste the key.
3. **Live coach → Upload screenshot** and pick a scoreboard or shop screenshot from Photos.

The scoreboard alone is enough: it prints every hero's name, your items, everyone's score and your gold. The shop screenshot adds the build you chose in game, which the coach then follows, at the shop's real prices.

If it says the model was not found, change the model name in Settings — the default (`gemini-3.8-flash`) is the one the Google SDK documents, but it has not been called from here.

### 4. Read the game without leaving it (Shortcut)

Safari cannot look at another app on an iPad, and no web page can draw on top of a game. What an iPad does allow is a **Shortcut** that takes a screenshot, sends it to this site, speaks the answer and shows it as a banner at the top of the screen.

**First, a two-minute test** — it tells us whether this route works on your iPad at all. In the Shortcuts app make a shortcut with three actions:

1. *Take Screenshot*
2. *Show Notification* — text "Coach test", and attach the screenshot if the action offers it
3. *Speak Text* — "Coach test, can you hear me?"

Then Settings → Accessibility → Touch → AssistiveTouch → on; *Custom Actions → Double-Tap* → your shortcut. Open Mobile Legends, start any match, and double-tap the floating button. Note three things: did a banner appear at the top, did you hear the voice over the game, and does the screenshot show the game (not the Shortcuts app).

**If that works**, build the real one. The exact steps and your endpoint address are in the app under **Settings → Reading the game on an iPad**, with a *Test endpoint* button:

1. *Take Screenshot*
2. *Resize Image* — width 1600
3. *Convert Image* — JPEG
4. *Get Contents of URL* — `https://<your-site>/api/coach`, method POST, header `x-vision-key` = your key, request body = File → the converted image
5. *Get Dictionary Value* `say` → *Speak Text*
6. *Get Dictionary Value* `title` and `body` → *Show Notification*

In a match: open the scoreboard, double-tap. The reply also carries `icon`, the address of the item's picture, if you want it in the banner.

Your key travels in the request and is not stored on the site. The endpoint remembers the current match only while it stays warm; if it forgets, it asks you to open the scoreboard once.

### What an iPad cannot do

| Wanted | Reality |
|---|---|
| A pop-up drawn over the game by the app | Not possible from a web page. The banner comes from the Shortcut's notification. A true floating overlay needs a native app built with a Mac. |
| The coach watching the screen continuously | Not possible from a web page. Each read is one double-tap. |
| iPad reads showing up live on the iPhone | Not built yet — it needs storage on the server. For now the phone is used by tapping picks in. |

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
- 45 unit tests: counters, threat weighting, build planning, the buy / piece / save / sell flow, the guide for all 133 heroes, catalog and picture coverage, and session handling.
- Tests transcribed by hand from real match screenshots: one scoreboard yields the hero, both teams, gold and inventory; the shop yields the in-game build; all eight shop prices match the catalog at the emblem's 95%.
- 22 scripted browser checks in demo mode, including pictures loading and spoken lines.
- The screenshot endpoint, run locally: health check, error answers, and a scripted match.

**Not verified**
- **A real vision model reading a real screenshot.** No API key was available while building.
- **The endpoint running on Vercel.** It is one self-contained file to keep that simple; *Settings → Test endpoint* confirms it once deployed.
- **The Shortcut route on a real iPad** — hence the two-minute test above.
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

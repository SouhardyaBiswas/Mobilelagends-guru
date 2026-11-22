# MLBB Guru

A coach for Mobile Legends: Bang Bang, built for a new player. You play on your phone and talk to it; an iPad beside you shows the whole match in one window and says, in plain words:

- **In draft** — which heroes are best into the enemy picks for your lane, and what to take if you pick first.
- **Before the match** — your build, battle spell and emblem, who is in your lane and how to play against them.
- **During the match** — the one thing to do with your gold right now, with the item's picture and where to find it in the shop; what the AI coach would do for the next two minutes; who to focus or stay away from; and a storyboard of how the match has gone.
- **On request** — "help me position": it looks at the fight and the map and tells you where to stand.

It reads only what is on your own screen, through screenshots you trigger. It never touches the game.

> **Status:** the engine, the endpoint, the continuous-screenshot flow, the voice commands and the dashboard are covered by 91 unit tests and 125 scripted browser checks, and the reader has been run on real matches. The three specialists (coach, enemy tracker, positioning) have **not** yet been run against a real model — see [What is and isn't verified](#what-is-and-isnt-verified).

## Phone plays, iPad shows the coach

The phone runs the game and a handful of Apple Shortcuts, started by voice. Each shortcut sends a screenshot or a command to this site. The site reads it, the rules work out the numbers, an AI coach decides, and the iPad — open on the dashboard — shows everything in one window and says it out loud.

```
phone (game + Shortcuts) ──screenshot / command──▶ /api/coach ──▶ reader model: what is on screen
                                                        │         rules: gold spent, what you own, who is fed
                                                        │         coach model: build order, calls, storyboard line
iPad dashboard  ◀──────────── polls the room ───────────┘
```

### 1. It is online

**https://mlbb-guru.vercel.app** — on Vercel's free plan.

It was deployed without linking Vercel to GitHub: Vercel's build fetches this public repository and builds the latest commit. An update only goes live when the project is redeployed (Vercel dashboard → the project → Deployments → ⋯ → Redeploy). To get automatic redeploys, connect GitHub under Vercel's account settings and import the repository at vercel.com/new.

### 2. A model key

The shortcuts send your own key with each screenshot (`x-vision-key` header); the site stores none. A Claude key (`sk-ant…`) or a Google AI Studio key both work.

| Header | What it sets | Default with a Claude key |
|---|---|---|
| `x-vision-key` | Your API key | — |
| `x-vision-model` | The model that reads the screenshot | `claude-opus-5-5` for a single shot; `claude-haiku-5-5` for frames in continuous mode (`&stream=1`) |
| `x-coach-model` | The model the specialists use | `claude-opus-5-5` |
| `x-coach` | `off` uses the built-in rules only | on |

### 3. Set up the two devices

Open **Settings → Phone plays, iPad shows the coach** on the site. It shows your room code, the dashboard link, the shortcut address and the exact address for every voice command.

**iPad:** open the dashboard link (`/?room=CODE`) in landscape and tap **Turn on voice**.

**Phone — the screenshot block.** Every screenshot command is the same four actions with a different address:

1. *Take Screenshot*
2. *Resize Image* — width 1600 (a full-size screenshot takes seconds to upload from a phone)
3. *Convert Image* — JPEG
4. *Get Contents of URL* — Method POST; header `x-vision-key` = your key; Request Body = File → the converted image

**Voice commands.** One shortcut per row; give each a phrase under iPhone Settings → Accessibility → Vocal Shortcuts.

| Say | When | Shortcut |
|---|---|---|
| "Draft mode" | Hero selection on screen | Screenshot block → `…&stage=draft` |
| "Entering the match" | Loading screen | Screenshot block → `…&stage=loading` |
| "Coach on" | Match started | `…&stage=live` → *Wait* 1 s → *Repeat* 150: [screenshot block → `…&stream=1` → *Get Dictionary Value* `halt` → *If* it has any value: *Stop This Shortcut* → *Wait* 5 s] |
| "Coach now" | Scoreboard or shop open | Screenshot block → the plain address |
| "Help me position" | Any time in the match | Screenshot block → `…&ask=position&shot=1` → *Speak Text* "Open the map" → *Wait* 3 s → screenshot block again → `…&ask=position&shot=2` |
| "Coach off" | Match over | One action: `…&stage=done` |
| "What do I buy?" and five more | Any time | One action: `…&ask=buy` (`status`, `threat`, `lane`, `plan`, `picks`) |

The questions in the last row are answered from what the room already knows — no screenshot, no AI call, no cost.

**Continuous mode.** "Coach on" sends a screenshot about every 10 seconds for the whole match (5 seconds of waiting plus the time to take, upload and read one). You just play; whenever the scoreboard, shop or map happens to be open, the next frame picks it up. The loop stops by itself on the results screen (seen on two frames running), after eight frames in a row with no game on them, or when you say "coach off". Whether iOS keeps a long repeat alive behind the game has to be tried on your phone: run it for two minutes in a match first.

**What happens to each frame.** A fast model sorts it (battlefield, map, scoreboard, shop) and reads it before the next frame is accepted. Three specialists — each a stronger model with its own panel on the dashboard — then work only when there is something new for them:

| Specialist | Runs after | Looks at | Produces |
|---|---|---|---|
| Coach | a scoreboard, shop or loading frame | the whole match as text | build order with reasons, calls for the next two minutes, a storyboard line |
| Enemy tracker | a scoreboard frame | the scoreboard picture and the numbers | per enemy: threat, items (believed once two reads name them), how to deal with them |
| Positioning | a battlefield frame, about once a minute; sooner after the map is opened | that frame, your last opened map, where you have been | where to stand, the risk, up to three moves — spoken only when the risk is high |

They run after the frame's answer has gone out, so the loop is never held up by them.

### 4. A match, start to finish

1. Hero selection: say **"draft mode"**. The iPad calls the best picks. Say "coach now" again as enemies lock in.
2. Loading screen: say **"entering the match"**. You get your build, battle spell and lane plan.
3. Match starts: say **"coach on"**. Screenshots now go out by themselves.
4. Early on, open the shop once so the coach learns your in-game list and what you own. Open the scoreboard for a few seconds after fights; open the map when you want positioning looked at.
5. Any time: **"coach now"** for an immediate read, **"help me position"**, or one of the questions.
6. End: the results screen stops it, or say **"coach off"**.

**No hero selection (bot or tutorial matches):** open the scoreboard once the match starts and say "coach now"; it shows both teams, your hero and your gold.

### What a phone and an iPad cannot do

| Wanted | Reality |
|---|---|
| A web page that watches the game | Not possible in Safari. A Shortcut taking screenshots is the only route without a native app. |
| A pop-up drawn over the game | Not possible from a web page. The iPad is the display. |
| Instant advice | A read is a photo upload plus one or two model calls: several seconds. Good for what to buy and where to be; not for reacting inside a fight. |
| Guaranteed memory on the server | The match is kept in Vercel's shared cache, which can drop an entry. If it does, the dashboard hands its copy back. |

### Other ways to use it

- **By hand, one device:** Draft tab → tap in the enemy heroes → pick yours → Start match. No key needed.
- **Upload a screenshot:** Settings → Screen reading → paste the key → Live coach → Upload screenshot.
- **Laptop:** Live coach → Share game screen, which watches a game window continuously.

## How it decides

Three layers, each checking the one before.

**1. The reader** (a vision model) transcribes the screenshot: screen type, clock, pocket gold, each row's hero, kills / deaths / assists and gold, the shop's lists and prices, your inventory. It is never asked for advice.

**2. The rules** turn that into facts, and distrust what is known to go wrong:

- **Gold spent** — your total on the scoreboard minus the gold in your pocket. Some matches print totals without the 300 starting gold; a believed inventory that costs about that much more than "spent" reveals it, and the figure is corrected for the rest of the match.
- **What you own** — the shop's inventory row is believed when it fits the gold spent. Scoreboard icons are tiny, so that row is believed only when it builds on what was seen before or two reads agree. Gold not yet accounted for is assumed to have gone into your own in-game list, in order — the game's quick-buy button offers exactly that. A counter the coach merely suggested is never assumed bought.
- **Misreads** — a score row with gold in the kills column is shifted back; a row whose numbers went down is held until the next read settles it; item lists that cost more than their owner earned are dropped.
- **Threat** — each enemy's share of their team's kill pressure, raised for whoever is really ahead (700 gold or 3 kills clear).
- **Next step** — buy if you can afford it; otherwise a named piece, or "buy pieces" when there is gold in hand; "save" only when the pocket is nearly empty.

**3. The AI coach** (a strong model, text only) gets the whole match as plain text — both teams with roles, kits and numbers, what you own and are part-way through, your in-game list, the rules' plan, the storyboard — and answers with a six-item build order with a reason per item, the calls for the next two minutes, who to focus or avoid, and one storyboard line. Before any of it is shown: unknown item and hero names are dropped, repeats and second boots removed, and what you already own stays at the front. If the coach fails or is switched off, the rules' answer stands.

**Storyboard** — one line per scoreboard: who got kills, whether you died, how the gold lead moved. Written by the rules at once and replaced by the coach's line when it arrives.

**Positioning** — "help me position" sends a picture of the fight and one with the map open to the coach model, which is told to describe only what it can see and to say so when the map is not open.

**Counters in draft** — each candidate's measured win-rate edge against every enemy pick (Moonton's ranked stats), lane opponent doubled, half-weight synergy with teammates, plus the game's own hero notes.

**Voice** — speaks when the advice changes, never on a loop.

## Data

| What | Source | Refresh |
|---|---|---|
| 133 heroes: roles, lanes, skills, portraits | Moonton's public stats API | `npm run sync-data` |
| ~2,900 hero-vs-hero win-rate records | Same API, all ranks | `npm run sync-data` |
| Item pictures | Mobile Legends Fandom wiki | `npm run sync-icons` |
| Items, costs, build paths | `src/data/items.ts`, checked against patch 2.2.23 and against real shop prices | Edit after big patches |
| Build templates, spells, emblems | `src/data/builds.ts` | Edit to taste |

## What is and isn't verified

**Verified on the live site**
- The site loads and the server answers with real advice.
- Match memory is shared between server copies. Before the fix, polls made while a screenshot was being read came back empty from a copy that knew nothing; the same test now returns the room every time. The shared cache does occasionally return the previous copy for under a second after a write (2 of 84 polls in one measurement); the server and the dashboard both guard against that.
- Work continues after the answer has been sent (a marker written 18 seconds after the response arrived on schedule), which is what lets the specialists run without holding up the frame loop.
- The continuous flow, with the scripted demo reader standing in for the models: eight frames a second apart, each answered in under a second, all eight applied in order, both scoreboards remembered, coach, enemy tracker and positioning all filled in, no poll ever empty, and the results screen stopping the loop.
- Real reads from real matches reach the reader model and come back (Claude Haiku so far).

**Verified here**
- 91 unit tests: counters, threat weighting, build planning, the buy / piece / save / sell flow, the guide for all 133 heroes, the endpoint with two devices, voice stages, the frame loop and its auto-stop, the positioning flow, each specialist's answer being checked against the catalog and the match, the two-frame rule for pocket gold, and two server copies sharing one room through a cache that lags.
- Tests transcribed from two real matches. One from screenshots: a scoreboard and the shop, with all eight prices matching the catalog at the emblem's 95%. One from the server's logs: six scoreboards and a shop read from a ranked match, including the three that came back with shifted columns and the missing starting gold.
- 125 scripted browser checks: the single-device flow (22), a phone-sized follower (14), the iPad dashboard at 1180×820, 1024×768 and 1366×1024 in every stage with nothing scrolling off the page (70), and the dashboard driven by voice commands, single shots, the positioning flow and a frame loop while listening to what it says (19).

**Learned from real matches**
- Claude Haiku reads hero names, the clock and gold correctly, shifted the enemy columns on half the scoreboards, and its item icons are noise (the same inventory read as four different sets of items in four reads).
- Its read of the shop's large inventory row matched the gold spent to within 2 gold.
- In that ranked match the scoreboard's gold totals were about 300 short of what had been spent (the starting gold); in an earlier match they were not. The coach works out which case it is from the shop read rather than assuming.
- Uploads took 2 to 8 seconds on top of the model's own time when the screenshot was not resized.

**Not verified**
- **The specialists against a real model.** Their instructions, the checking of their answers and the whole request flow are tested with scripted answers; how good the coach's build, the enemy tracker's item reads and the positioning advice are on a real match is unknown until one is played. The server logs every one of their answers so the first match can be examined.
- **A long repeating shortcut behind the game.** iOS decides how long it may run. Try it for two minutes in a match before relying on it.
- **Rate limits.** Up to three specialist calls can start at once; a low API tier may refuse some. A refusal is logged and the rules' answer stands.
- **Voice on iPad Safari.**

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

Browser checks (they need Playwright with Chromium installed where `require("playwright")` can find it):

```bash
npm run build && (npx vite preview --port 4173 --strictPort &)
node scripts/e2e/run.cjs        # single-device flow
node scripts/e2e/follow.cjs     # a phone-sized follower
node scripts/e2e/dashboard.cjs  # the iPad dashboard, every stage, three screen sizes
node scripts/e2e/voice.cjs      # the dashboard driven by voice commands and a frame loop, listening to what it says
```

```
scripts/           data and picture sync; e2e/ holds the browser checks
src/data/          generated hero data, item catalog, build templates, timers
src/engine/        threat, counters, build planner, guide, coach lines, endpoint replies
src/vision/        the reader: prompt, answer schema, Gemini / Claude / demo
src/ai/            the coach and the positioning helper: instructions, answer checks
src/state/         match state (shared by the app and the endpoint)
src/server/        the endpoint and its shared room store, bundled to api/coach.js
src/ui/            Draft, Live coach, Settings
tests/             unit tests
```

Not affiliated with or endorsed by Moonton. Hero and item names, pictures and statistics belong to Moonton.

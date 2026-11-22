# Legal, ToS, IP, and App-Platform Risk of Commercially Selling "MLBB Guru" (third-party MLBB coaching tool)

Research date: 22 November 2026. These are research notes, not legal advice. Items marked [LAWYER] need review by qualified counsel (IP/games counsel, plus privacy counsel in India and target SEA markets). Items marked [POSSIBLY SUPERSEDED] come from sources older than ~12 months or could not be checked against the live primary text.

Method note: Moonton's own ToS page (mobilelegends.com) renders client-side. Its content comes from `api.gms.moontontech.com` through POST calls flagged `withSign` (signed requests), as seen when I inspected the site's JS bundle on 22 Nov 2026. So I could not fetch the ToS text directly, and the Moonton ToS quotes below come from a secondary reproduction (NeuralBoost, which says it read the pages in October 2026). The founder should open the live ToS in a browser and confirm the exact wording before relying on it.

---

## 1. What do Moonton's ToS / fair-play / anti-cheat policies say about third-party tools, overlays, assist apps, screen-reading, and real-time advantage? What is the enforcement history, and has Moonton said anything about AI tools?

### Takeaway
Moonton publishes **no third-party developer / API / overlay policy** (none found). Its ToS has broad catch-all bans on cheats and on "automated scripts, software, code or systems to collect information from or otherwise interact with the Services", and its penalty scale punishes merely "install[ing] unauthorized software". Real enforcement has gone hard after tools that **reveal hidden information** (map hacks, "drone-style vision": 30-year bans, police raids in Indonesia in 2026). I found no case of Moonton banning players for guide, stats, or coaching apps, and no Moonton statement on AI coaching tools.

### Cited Findings
**ToS and penalty text (secondary reproduction; verify live)**
- MLBB Terms of Service, Section 11 "Code of Conduct" (reported as last updated 20 June 2025), "You may not" list includes: "use or attempt to use/exploit any cheats, bots, hacks, bugs, errors, or design flaws". — [NeuralBoost reproduction of Moonton ToS](https://neuralboost.gg/blog/mobile-legends-cheating-bans-what-moontons-notices-say); official URL cited there: [mobilelegends.com ToS newsid=2690368](https://www.mobilelegends.com/news/articleldetail?newsid=2690368)
- Same ToS list: "use automated scripts, software, code or systems to collect information from or otherwise interact with the Services". — [NeuralBoost](https://neuralboost.gg/blog/mobile-legends-cheating-bans-what-moontons-notices-say)
- Same ToS list: "interfere with or attempt to interfere with the proper working of the Services". — [NeuralBoost](https://neuralboost.gg/blog/mobile-legends-cheating-bans-what-moontons-notices-say)
- Moonton's "Common Violations and Penalty Scales" page has a row "Install unauthorized software": warning or account suspension of 7–30 days. Scripts carry account or **device** suspension from 7 days to permanent. Promoting or selling cheat-related videos: 7 days to permanent. — [NeuralBoost](https://neuralboost.gg/blog/mobile-legends-cheating-bans-what-moontons-notices-say), citing [mobilelegends.com newsid=2729660](https://www.mobilelegends.com/news/articleldetail?newsid=2729660)
- Caveat: NeuralBoost sells boosting services (a commercial interest), and the quotes are its reproduction, not text I fetched from Moonton. — [WebSearch summary of sources](https://neuralboost.gg/blog/mobile-legends-cheating-bans-what-moontons-notices-say)
- A third-party ban-appeal guide summarises Moonton's prohibited conduct as including "Using unauthorized applications that modify gameplay" and "Using unauthorized software or hacks to gain unfair advantages". This is paraphrase, not ToS text. — [Esports Legal News, 14 Mar 2025](https://esportslegal.news/2025/03/14/a-guide-to-mobile-legends-bang-bang-ban-appeals-incl-template/) [POSSIBLY SUPERSEDED]

**Enforcement history: hidden-information cheats**
- 8 April 2026, Moonton official: Central Java Regional Police (Directorate of Cyber Crimes), Moonton, and counsel SKC Law dismantled the "Senpai Mod" cheat supply chain. Its tools were "primarily designed for ranked gameplay in MLBB" with "map hacks, drone-style vision, and other exploitative functions". "Several thousand MLBB accounts have been penalised for the use of Senpai Mod-related cheats." The operators undertook to "Immediately cease all development, sale, and distribution of cheat software" and to "Permanently shut down all related websites and social media accounts". Moonton "will continue strengthening both its technical anti-cheat systems and legal enforcement efforts." — [Moonton news, 8 Apr 2026](https://en.moonton.com/news/322.html)
- The investigation began in 2023 after player reports. Developers of "Senpai Mod" and "NUI Mod" signed legal undertakings, and transaction records suggest reach across SEA. — [GosuGamers](https://www.gosugamers.net/mobile-legends/news/78242-mobile-legends-cheating-network-dismantled-by-moonton-and-indonesian-police); [GamingOnPhone](https://gamingonphone.com/news/moonton-cracks-down-on-mlbb-cheats-as-major-network-is-dismantled-with-central-java-police-support)
- Moonton's recurring "Punishment for Cheating" notices (Sept–Oct 2026) say Moonton "recently detected that some players were using cheats to reveal enemy hero positions throughout matches". Sample penalty rows read "Account Ban: 30 years", with the warning "Please do not trust information about third-party cheats". — [NeuralBoost](https://neuralboost.gg/blog/mobile-legends-cheating-bans-what-moontons-notices-say), citing e.g. [newsid=3505455](https://www.mobilelegends.com/news/articleldetail?newsid=3505455) and [newsid=3506862](https://www.mobilelegends.com/news/articleldetail?newsid=3506862)
- Earlier map-hack crackdown (c. 2020): Moonton warned against the plug-in. Bans can be permanent, there is "no such thing as 'white list'", and punishment applies even if the tool was only installed. Moonton posted banned IDs weekly on Facebook. — [VPEsports](https://vpesports.com/mobilelegends/mobile-legends-bang-bang-cracking-down-on-map-hack-users-perma-bans-on-the-menu) [POSSIBLY SUPERSEDED: undated, c. 2020]

**AI**
- I found no Moonton statement on third-party AI coaching or assistant apps. The AI-related controversies found were (a) fan backlash over a possibly AI-generated Layla main-menu art on the Advanced Server, which Moonton did not confirm, and (b) a Change.org petition about suspected AI bots in ranked. — [esports.gg](https://esports.gg/news/mobile-legends-bang-bang/mlbb-ai-generated-main-menu-layla-backlash/); [Change.org](https://www.change.org/p/moonton-remove-bots-from-ranked-matches-and-bring-back-real-5v5)

### Inferences
- **The strongest defence:** MLBB Guru reads only what is already on the player's own screen (own gold, scoreboard, items), runs on a separate device, and never touches the game client. That puts it in a different category from what Moonton actually prosecutes: map hacks and drone view, which expose hidden information and modify the client. Detection risk for users is low, because nothing is installed on the game device (the iPad Shortcut just takes screenshots).
- **The weakest point:** The ToS clause banning "automated ... software ... to collect information from or otherwise interact with the Services" is broad enough that Moonton could argue it covers (a) automated screenshot-to-Gemini extraction of match state and (b) programmatic pulls from Moonton's stats API (see Q4). Because Moonton has no developer policy, there is no safe harbor to point to. [LAWYER] There is also the question of whether a company that sells a tool encouraging users to breach the ToS faces contract-interference or "inducing breach" claims. This is jurisdiction-specific (Moonton is Shanghai-based and operates via Singapore and Indonesian entities).
- **The "Install unauthorized software" row** (7–30 day suspension) is a real, if low-probability, risk for users who run a browser screen-share on the same laptop as an emulator. It does not obviously apply to a second-device setup.
- Moonton has shown it will use criminal law and police (Indonesia, 2026) against **commercial sellers** of cheats. A paid real-time advantage tool is the kind of product that could attract attention if Moonton decided to classify it as a cheat. This is a reputational and enforcement risk, not a certainty.

### Gaps
- I could not retrieve the verbatim live MLBB ToS, EULA, or Privacy Policy (JS-rendered, signed API). I also could not confirm whether the ToS has a separate IP licence or "no commercial use of game content" clause, or a minimum-age clause. The founder should screenshot or archive the live ToS.
- I found no Moonton statement either tolerating or banning stats, guide, or coaching apps, and no ban wave tied to a non-cheat companion app.
- I found no Moonton statement on AI tools.

---

## 2. Is real-time in-match advice cheating under MLBB esports rules (MPL/MSC) or for ranked? How do other publishers draw the line (Riot, Valve, Tencent)?

### Takeaway
In **official MLBB esports** (MSC 2026 rulebook) this is plainly prohibited: no wireless devices in the match area, in-match communication limited to teammates, and a ban on "any kind of cheating device ... or any similar cheating method". Among publishers, the clearest line comes from **Riot**: post-game reflection and coaching is fine, but real-time prompts that change behaviour immediately ("go here now") or "dictate player action based on the current game state" are not. "Buy this item next" during a live match falls on the prohibited side of Riot's line. Moonton has not published an equivalent rule for ranked.

### Cited Findings
**MLBB esports (MSC 2026, Moonton's MSC Committee)**
- 10.1.6 Unauthorized Communications: "All mobile phones, tablets and other voice-enabled and/or 'ringing' electronic devices must be removed from the play area before the Game ... During the Match, communication by a Starter shall be limited to the Players on the Starter's Team." — [MSC at EWC 2026 Official Rules](https://cdn.esportsworldcup.com/resources/uploads/MSC_at_EWC_26_Rulebook_c5937d8775.pdf)
- 10.1.1.7 Cheating Methods: "The use of any kind of cheating device and/or cheat program, or any similar cheating method such as signaling devices, hand signals, etc." — [MSC 2026 Rules](https://cdn.esportsworldcup.com/resources/uploads/MSC_at_EWC_26_Rulebook_c5937d8775.pdf)
- 8.2 Wireless devices: "Wireless devices except the wireless devices provided by MSC Committees, including mobile phones and tablets, are not allowed in the Match Area." — [MSC 2026 Rules](https://cdn.esportsworldcup.com/resources/uploads/MSC_at_EWC_26_Rulebook_c5937d8775.pdf)
- 10.1.1.5 Spectator Monitors: players may not look at a screen showing an observer-level view of the game. 7.1.3: only the head coach may bring paper notes, and only during the draft. — [MSC 2026 Rules](https://cdn.esportsworldcup.com/resources/uploads/MSC_at_EWC_26_Rulebook_c5937d8775.pdf)
- MPL Philippines Season 18 has its own rulebook (Aug 2026) covering MPL and MDL. I did not extract its specific clauses. — [ph-mpl.com/rules](https://ph-mpl.com/rules)
- Grassroots MLBB tournament rules commonly ban "unauthorized third-party software" and stream sniping. — [ZSML rules (Google Doc)](https://docs.google.com/document/d/133ZsEio7c8YO2wxxPgrnd1m59o2_OgSN/export?format=pdf); [Snapdragon Pro Series MLBB General Rules](https://cdn.eslgaming.com/files/ta/emea/sps/mlbb/General.pdf)

**Riot Games (League of Legends / Valorant)**
- Riot General Policies: "Products cannot create an unfair advantage for players, like a cheating program". Products should not remove game decisions, but may highlight important decisions and offer choices. "All products must be registered in, and audited by Riot Games through the Developer Portal". The fetched page said last updated 29 May 2025, while the search snippet showed "March 11, 2025", so the date is unresolved. — [Riot Developer Policies](https://developer.riotgames.com/policies/general)
- Riot "Third Party Applications – Riot's Stance" (posted 10 Feb 2025): Riot takes issue with apps that give a measurable advantage, such as "Exposing information that's intentionally obfuscated", "Taking actions on your behalf (botting or scripting)", "Altering your field of intelligence (zoomhacks or global ult alerts)". On live analysis: "we want to see you play the game first, then analyze and reflect later!" Penalties can be permanent for "consistent, blatant use", including loss of ranked rewards. — [Riot Support](https://support.riotgames.com/en-us/riot/events/third-party-applications)
- Valorant Developer API Policy, unapproved use cases: "In-game apps and overlays that include any real-time data that would improve a player's performance immediately by altering player behavior (i.e. 'go here now'), vs altering it upon reflection, learning and coaching the player game over game." — [Riot Valorant developer docs](https://developer.riotgames.com/docs/valorant)
- Overwolf's Riot compliance guide (LoL) lists as "strictly prohibited": "Notifications that dictate player action based on the current game state", power-spike notifications, and tracking enemy ability or summoner-spell cooldowns. "The use of Ultimate timers is strictly forbidden." All Riot-title apps need Riot approval even without using the Riot API. — [Overwolf dev docs – Riot Games](https://dev.overwolf.com/ow-native/guides/game-compliance/riot-games)
- In a 29 May 2025 policy change, Riot also banned third-party in-game ads, including in overlays. — [Overwolf blog](https://blog.overwolf.com/supporting-creators-in-riots-ecosystem-our-response-and-commitment/)
- Riot monetisation rules: you "must have a free tier of access for players", "Your content must be transformative if you are charging players for it", and the product must be registered on the Developer Portal. — [Riot Developer Policies](https://developer.riotgames.com/policies/general)

**Valve (Dota 2)**
- Valve has stated it does "not support or condone the use of any third-party modifications during matchmade games" (2018 statement as reported). Its stance has been described as neutral toward gray-area tools that charge memberships. — [Sportskeeda](https://www.sportskeeda.com/esports/should-tools-like-overwolf-dotaplus-allowed-dota-2); [Dot Esports](https://dotesports.com/?p=1113722) [POSSIBLY SUPERSEDED]
- Valve shipped a patch that hid player profiles until the draft ends, specifically breaking an Overwolf app's pre-game scouting. — [game-tournaments.com](https://game-tournaments.com/en/dota-2/news/44348-player-profiles-in-dota-2-now-cannot-be-seen-before-draft-ends-after-patch-to-make-overwolf-app-stop-working); [esports.gg](https://esports.gg/news/dota-2/dota-2-update-kills-third-party-applications-including-overwolf) (date not confirmed)
- Pros and casual players have called on Valve to ban "Overplus" for real-time stats on other players. I found no record of a Valve ban. — [Dot Esports](https://vip-develop.dotesports.com/?p=1113722); [esports.net](https://www.esports.net/news/dota/is-overplus-pay-to-win-in-dota-2/)

**Tencent (Honor of Kings)**
- Not researched in depth. No source found.

### Inferences
- MLBB Guru's core feature ("buy this item next", spoken during a live match, based on current gold and scoreboard) is close to word-for-word what Riot and Overwolf prohibit for LoL: "Notifications that dictate player action based on the current game state". No publisher sets the norm for Moonton, but if Moonton ever writes a policy, this is the likely template.
- It does **not** expose hidden information (it reads the player's own visible screen), which is the line Riot, Moonton's enforcement, and Valve's patches care about most. So it sits in a gray zone, not in "hack" territory.
- **The safer product line:** make post-match, between-match, and draft-time coaching the paid core. Real-time voice prompts should be available only in non-ranked modes (Classic, custom, vs-AI) and labelled "practice mode". Add a "Do not use in ranked or tournaments" disclaimer and an in-app toggle. This mirrors Riot's "reflect later" principle and is easier to defend publicly.
- For esports, the product must never be marketed to MPL/MDL/MSC competitors for in-match use. It would clearly breach 10.1.6, 10.1.1.7 and 8.2.

### Gaps
- No Moonton rule specific to ranked about real-time advice from a second device (not found).
- MPL PH S18 / MPL ID clauses not extracted.
- Tencent Honor of Kings third-party policy not researched.
- Unverified: Valve's own paid Dota Plus is commonly described as giving in-game hero and item suggestions (a publisher-sanctioned "real-time advice" precedent). Not verified in this session.

---

## 3. IP: can a commercial product use MLBB hero names, portraits, item icons, and Moonton stats data? Does Moonton have a fan-content or developer policy? What does the Fandom CC BY-SA licence mean for Moonton-copyrighted images? What is the trademark risk of "MLBB Guru"? Any takedown examples?

### Takeaway
I found no Moonton fan-content, developer, or API licence, so **there is no permission to use hero portraits or item icons commercially**. Fandom's CC BY-SA covers **wiki text only, not images**, which remain Moonton's copyright, so "scraped from Fandom" gives no licence. "MLBB" is **not** a live US registered mark (application abandoned 2021), but "MOBILE LEGENDS: BANG BANG" and "MOONTON" are registered. Apple's guidelines explicitly bar using another developer's brand in an app name without approval. Moonton is an active IP litigant (versus Riot, 2017 and 2022).

### Cited Findings
**Moonton policy**
- No dedicated Moonton fan-content or commercial-use policy surfaced. The closest official channel is a 2026 Global Skin Design Contest. — [Moonton news](https://en.moonton.com/news/337.html)
- Liquipedia states that Moonton Games has allowed it to use in-game images and MPL photos, and "all rights to the images remain in the hands of Moonton Games". This means permission is granted case by case. — [Liquipedia file page](https://liquipedia.net/mobilelegends/File:MLBB_10th_Anniversary.jpg)
- Moonton's Code of Conduct for External Service Providers (Feb 2023) restricts contracted KOLs and moderators, including using Moonton's name or logo in publicity without prior written consent and using unapproved third-party software. It applies to contractors, not the public, but shows how Moonton controls its brand. — [Moonton PDF](https://cn.moonton.com/upload/file/20230221/3a564ee32f37588851e0269440bfc259.pdf) [POSSIBLY SUPERSEDED]
- Fan sites disclaim ownership, e.g. MLBBHub states that hero artwork, in-game assets, and trademarks belong to Moonton. — [MLBBHub terms](https://mlbbhub.com/terms)
- For comparison, other publishers' fan policies typically forbid selling fan content: EA "don't sell your content", Epic limits fan content to personal non-commercial works, and Jagex requires approval for commercial use. — [EA content policy](https://help.ea.com/en/articles/security-and-rules/ea-content-policy/); [Epic fan content policy](https://www.epicgames.com/site/fan-art-policy); [Jagex fan content policy](https://legal.jagex.com/docs/policies/fan-content-policy)
- Riot's model is the commercial benchmark: it allows monetised products only if registered, transformative, and with a free tier. Its IP may be used only where "such use is inevitable to serve the core value of the product", and products must post a non-endorsement disclaimer. — [Riot Developer Policies](https://developer.riotgames.com/policies/general)

**Fandom licensing**
- Fandom's CC BY-SA disclaimer applies only to text, "not other media like images, sounds, and video". Uploading images "does not necessarily mean they are released under the CC-BY-SA". (Direct fetch blocked with HTTP 402; quoted from search snippets.) — [Fandom Help:Licensing](https://community.fandom.com/wiki/Help:Licensing); [fandom.com/licensing](https://www.fandom.com/Licensing)
- Wikimedia Commons' summary of Fandom: "all non-text media on Fandom is presumed to be copyrighted". — [Commons: Free depictions of non-free works](https://commons.wikimedia.org/wiki/Commons:Free_depictions_of_non-free_works)
- Game wikis treat screenshots and art as the publisher's copyright, used under fair use. Liquipedia: images "are not automatically licensed under CC-BY-SA". — [SmashWiki image copyrights](https://www.ssbwiki.com/SW:IMGCR); [Liquipedia reuse help](https://liquipedia.net/starcraft/Help:Reusing_and_remixing_Liquipedia_content)

**Trademarks (US records via Justia; verify on USPTO TSDR)**
- "MOBILE LEGENDS: BANG BANG": US Reg. No. 6318189 (Serial 88666723), registered 13 Apr 2021. Serial 88666748 is also on the Principal Register (13 Oct 2020). — [Justia 88666723](https://trademarks.justia.com/886/66/mobile-legends-bang-88666723.html); [Justia 88666748](https://trademarks.justia.com/886/66/mobile-legends-bang-88666748.html)
- "MLBB": US Serial 88666755, "Abandoned – Failure To Respond", 29 Nov 2021. — [Justia MLBB](https://trademark.justia.com/886/66/mlbb-88666755.html)
- "MOBILE LEGENDS" (word): US Serial 87299474, "Abandoned – After Inter-Partes Decision", 21 Aug 2020. — [Justia](https://trademark.justia.com/872/99/mobile-87299474.html); related TTAB opposition: [TTABVue 91235584](https://ttabvue.uspto.gov/ttabvue/ttabvue-91235584-OPP-1.pdf)
- "MOONTON": US Reg. No. 5311073 (17 Oct 2017). — [Justia](https://trademarks.justia.com/873/88/moonton-87388591.html)
- Australia: a Moonton figurative mark in classes 9 and 41, registered 24 Jul 2025. — [IP Australia 2507254](https://search.ipaustralia.gov.au/trademarks/search/view/2507254/details)

**Moonton as an IP litigant**
- Riot sued Moonton in 2017 (copyright and trademark) and reportedly asked Google Play and Apple to remove Moonton's titles. — [PC Gamer](https://pcgamer.com/riot-sues-mobile-legends-bang-bang-maker-for-reasons-you-can-probably-guess); [Inquirer](https://technology.inquirer.net/64986/league-legends-creator-sues-mobile-legends-developer-copyright-infringement)
- Riot sued again in 2022 over Wild Rift. A US court dismissed it on forum grounds (China better placed). Outcome reports conflict. — [ABS-CBN](https://abs-cbn.com/business/11/11/22/us-court-dismisses-riot-copyright-lawsuit-vs-moonton); [PocketGamer.biz](https://www.pocketgamer.biz/riot-games-sues-moonton-over-sustained-wift-rift-copyright-infringement)
- Moonton's 2017 response included threatening the press with lawsuits. — [Techdirt](https://www.techdirt.com/?p=91101) [POSSIBLY SUPERSEDED]
- Moonton says its game copyright "has already been registered and protected in multiple countries". — [Inquirer](https://technology.inquirer.net/?p=65039)

**Takedowns of MLBB fan apps**
- None found. See Gaps.

### Inferences
- **Hero and item names** used to refer to the game's elements (e.g., "Ling counters") are lower risk. That is classic nominative or descriptive use, especially with a clear non-affiliation disclaimer. **Hero portraits, item icons, and skill icons** are Moonton's copyrighted artwork. Using them in a paid product without a licence is the clearest IP exposure, and Fandom's licence does not cure it. Fair use (US) and fair-dealing (India, SEA) arguments are weak for a commercial product reproducing the art itself. [LAWYER]
- **Mitigations:** (a) Replace art with text labels, original icons, or abstract colour-coded tiles. (b) Seek written permission from Moonton (Liquipedia shows Moonton grants case-by-case rights). (c) At minimum, hotlink nothing, keep thumbnails small, add a prominent "not affiliated with or endorsed by Moonton" disclaimer, and set up a DMCA-style takedown contact.
- **Naming:** "MLBB Guru" puts Moonton's de facto brand first in the product name. Even with the US "MLBB" application abandoned, Moonton likely has rights elsewhere (unregistered or common-law rights, passing-off, and possible registrations in PH, ID, MY, or IN, which were not checked). It is also an explicit ground for rejection on Apple (4.1(c)) and for suspension on Google Play (trademark policy, see Q5). A safer pattern is a distinct brand plus a descriptive tagline, e.g. "[Brand] – coach for Mobile Legends: Bang Bang players (unofficial)". [LAWYER: trademark clearance in IN, PH, ID, MY]
- Stats data: facts (win rates) are generally not copyrightable, but the method of collection may breach the ToS (see Q1 and Q4). Also, database rights apply in the EU (sui generis database right), though not in most of Asia.

### Gaps
- No Moonton fan-content, IP-licensing, or API policy was found. It may not exist publicly. The founder could email Moonton (legal@moonton.com appears in Moonton's 2023 PDF) to ask.
- No documented takedowns of MLBB fan or companion apps (Play/App Store or DMCA) were found. This does not mean none happened.
- Trademark status of "MLBB" in the Philippines, Indonesia, Malaysia, India (and the Moba Legends brand) was not checked.

---

## 4. Moonton's public stats API: is it officially documented or licensed for third-party use? Rate limits, risk of being blocked?

### Takeaway
I found **no official Moonton API documentation, licence, or developer programme**. The "public stats API" is the undocumented backend of Moonton's own website (`api.gms.moontontech.com`, using signed requests), plus community wrappers that call themselves "unofficial". There are no published rate limits, so access can be throttled, changed, or blocked at any time, and the ToS anti-automation clause arguably covers it.

### Cited Findings
- The MLBB website's HTML references `https://api.gms.moontontech.com` and `https://api.moba5v5.com/r`. Its JS bundle calls `/api/gms/source/{a}/{b}` via POST with a `withSign: true` flag (request signing). — My inspection of [mobilelegends.com page](https://www.mobilelegends.com/news/articleldetail?newsid=2690368) and its `/assets/index-06f6d0af.js` bundle on 22 Nov 2026.
- The most-used community wrapper, ridwaanhall/api-mobilelegends ("Rone Arena"), says: "Rone Arena is an unofficial, community-maintained project." It is "not affiliated with, endorsed by, sponsored by, or associated with Shanghai Moonton Technology Co., Ltd." Data comes "from publicly accessible endpoints and provided for informational, educational, and analytical purposes only". It is BSD-3 licensed and requires attribution to Moonton. No rate limits are stated. It requires a `RONE_DEV_ACCESS_KEY` or endpoints return 503. — [GitHub ridwaanhall/api-mobilelegends](https://github.com/ridwaanhall/api-mobilelegends); [PyPI rone-arena](https://pypi.org/project/rone-arena/)
- Other wrappers and marketplaces: [p3hndrx/MLBB-API](https://github.com/p3hndrx/MLBB-API), [mrpatricko/mobile-legends-api](https://github.hscsec.cn/mrpatricko/mobile-legends-api) (notes that equipment endpoints were not found), [mlbb.io API on parse.bot](https://parse.bot/marketplace/879b30c0-0d94-42ed-b8c3-627077b98d25/mlbb-io-api), [Zyla Labs MLBB character API](https://www.zylalabs.com/api-marketplace/video+games/mobile+legends+character+data+api/2138). A PyPI package "openmlbb" is titled "Official Python SDK for the MLBB Public Data API". This appears to mean official for a community API, not Moonton. Unverified. — [PyPI openmlbb](https://pypi.org/project/openmlbb/)
- MLBB ToS reportedly bars "automated scripts, software, code or systems to collect information from or otherwise interact with the Services". — [NeuralBoost reproduction](https://neuralboost.gg/blog/mobile-legends-cheating-bans-what-moontons-notices-say)
- Comparator: Riot offers an official, documented API with registration and audit, and Valve and Riot have both changed game or API data access to kill third-party features (e.g., Dota 2 hiding profiles pre-draft, Riot removing minor rune data from its API). — [Riot Developer Policies](https://developer.riotgames.com/policies/general); [Overwolf Riot compliance](https://dev.overwolf.com/ow-native/guides/game-compliance/riot-games); [game-tournaments.com](https://game-tournaments.com/en/dota-2/news/44348-player-profiles-in-dota-2-now-cannot-be-seen-before-draft-ends-after-patch-to-make-overwolf-app-stop-working)

### Inferences
- **Business-continuity risk is high:** signing keys, endpoints, or bot detection can change on any patch, breaking the product without notice. **Legal risk is moderate:** accessing public, non-authenticated web endpoints is generally lower-risk than circumventing access controls. However, request signing looks like a technical access measure, and reverse-engineering it to sell a commercial product increases exposure (ToS breach and, in some jurisdictions, computer-misuse or anti-circumvention theories). [LAWYER]
- **Mitigations:** cache and aggregate server-side at a low request rate. Never proxy user requests one-to-one. Do not use player account tokens. Keep a fallback dataset (e.g., your own patch-note-derived item and skill data). Don't build features on per-player lookups of other users (de-anonymisation is a Riot red line). Consider asking Moonton for a data partnership.
- Relying on a third-party wrapper (Rone Arena etc.) adds a second dependency whose own terms (HOSTED_API_TERMS.md, not read) may forbid commercial use.

### Gaps
- No official Moonton statement on third-party use of `api.gms.moontontech.com`. I found no reports of Moonton blocking community API projects.
- I did not read Rone Arena's HOSTED_API_TERMS.md for commercial-use limits.

---

## 5. Google Play and Apple App Store policies: third-party IP, screen capture, overlays, subscriptions and in-app payment. Does a web app or PWA sidestep store policies?

### Takeaway
As a **web app on Vercel sold via its own checkout**, MLBB Guru is outside App Store and Play review and fees entirely. A PWA added to the home screen is not a store listing. If it is ever wrapped as a store app: (a) Apple 4.1(c) and 5.2.1 and Google's IP and trademark policies make "MLBB" in the name and Moonton art likely rejection or suspension triggers. (b) Apple 5.2.2 requires you to be "specifically permitted" by a third-party service's terms to use its content. (c) Digital subscriptions need IAP, except that US-storefront apps may link out. (d) Android overlays (SYSTEM_ALERT_WINDOW) and AccessibilityService are restricted permissions with declaration requirements.

### Cited Findings
**Apple App Store Review Guidelines (current page as fetched 22 Nov 2026; last-updated date not captured)**
- 4.1(c): "You cannot use another developer's icon, brand, or product name in your app's icon or name, without approval from the developer." 4.1(b): impersonating other apps or services may result in removal from the Developer Program. — [Apple Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- 5.2.1: "Don't use protected third-party material such as trademarks, copyrighted works, or patented ideas in your app without permission". — [Apple Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- 5.2.2: "If your app uses, accesses, monetizes access to, or displays content from a third-party service, ensure that you are specifically permitted to do so under the service's terms of use. Authorization must be provided upon request." — [Apple Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- 3.1.1: unlocking features or subscriptions requires IAP. 3.1.1(a): "In all other storefronts, except for the United States storefront, where this prohibition does not apply, apps and their metadata may not include buttons, external links, or other calls to action that direct customers to purchasing mechanisms other than in-app purchase". Entitlements "are not required for developers to include buttons, external links, or other calls to action in their United States storefront apps." 3.1.3(b): multiplatform services may unlock web-bought content if it is also available as IAP. — [Apple Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- 2.5.14: apps must get explicit consent and give a clear indicator when "recording, logging, or otherwise making a record of user activity", including screen recordings. — [Apple Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- 5.1.2(i): "You must clearly disclose where personal data will be shared with third parties, including with third-party AI, and obtain explicit permission before doing so." — [Apple Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- 1.3 Kids Category: no third-party analytics or ads, and no links out or purchases without a parental gate. — [Apple Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- I found no Apple guideline specifically on "game cheating" companion apps.

**Google Play**
- IP policy: "We don't allow apps that infringe copyright." Listed violations include "Cover art for music albums, video games, and books", "Marketing images from movies, television, or video games", and "Reproductions or 'fan art' indistinguishable from the original work under copyright". "If your app uses another party's trademarks in a way that is likely to cause confusion, your app may be suspended." "Don't use another party's trademarks, such as logos or brand names without permission." — [Google Play IP policy](https://support.google.com/googleplay/android-developer/answer/9888072)
- SYSTEM_ALERT_WINDOW is a special permission. Apps should direct users to system settings for approval. — [Google Play policy pages](https://support.google.com/googleplay/android-developer/answer/16558241?hl=en)
- AccessibilityService: requires a prominent in-app disclosure, affirmative consent, and a Permission Declaration Form. Newer policy text says apps must use "more narrowly scoped APIs and permissions in lieu of the Accessibility API when possible". — [Google Play AccessibilityService policy](https://support.google.com/googleplay/android-developer/answer/10964491?hl=en); [Policy preview](https://support.google.com/googleplay/android-developer/answer/13986130)
- MediaProjection (screen capture of other apps): no specific Play policy found.
- US payments: Google's help page says developers in the US external content links and alternative billing programs must report transactions and pay service fees. One summary dates this to 1 Oct 2026. Reported fees: 10% subscriptions and 20% other, plus per-install fees of $2.85 for apps and $3.65 for games. Other reports cite 9–15% or 9%/20% under the Epic settlement. These figures conflict. — [Google Play Console Help 15582165](https://support.google.com/googleplay/android-developer/answer/15582165?hl=en); [MacRumors, 24 Jun 2026](https://macrumors.com/2026/06/24/google-play-store-fee-change/); [FKKS](https://technologylaw.fkks.com/post/102mp7y/update-your-app-external-purchase-developments-for-apple-google); [Engadget](https://engadget.com/apps/google-ends-its-30-percent-app-store-fee-and-welcomes-third-party-app-stores-185248647.html)

**MLBB's own store rating**
- MLBB's App Store listing shows a 12+ rating. — [Apple App Store MLBB](https://apps.apple.com/kh/app/id1160056295)

### Inferences
- **Web-first is the right call.** Selling via the founder's own website (e.g., Stripe or Razorpay) avoids IAP, the 15–30% fee, and app review. The PWA is not distributed through a store, so store policies don't apply. One caveat: if a native iOS or Android wrapper is later built that unlocks the paid subscription, IAP and Play Billing rules apply (except the US link-out allowances).
- **The iOS Shortcut approach** (user-built Shortcut taking screenshots) is not an App Store app, so Apple review doesn't apply. A native iOS app cannot continuously capture another app's screen except via a user-initiated ReplayKit broadcast extension. This is general platform knowledge, not verified here. It would face 2.5.14 indicator requirements and 5.1.2(i) AI-sharing consent.
- **An Android overlay version** (floating bubble over MLBB) would need SYSTEM_ALERT_WINDOW and likely MediaProjection. Accessibility-based screen reading is the highest-risk route for Play rejection. A second-device web design avoids all of this.
- If listed in stores at all, the brand should not contain "MLBB" or "Mobile Legends", and the listing should not show Moonton art (Apple 4.1(c), 5.2.1, 5.2.2; Google IP policy). Apple 5.2.2's "specifically permitted" test would also be hard to meet given the Moonton ToS anti-automation clause.

### Gaps
- Apple guidelines' last-updated date not captured. The section after 5.2.5 was not read.
- No current Google Play Impersonation policy text was fetched.
- The exact US Play external-links fee figures conflict across sources.
- EU DMA alternative-distribution rules not researched.

---

## 6. Data and privacy: sending game screenshots to Google Gemini. Obligations under PH DPA, Indonesia PDP, Malaysia PDPA, India DPDP, GDPR; minors; Gemini API terms (commercial use, under-18, free-tier data use).

### Takeaway
**This is the most concrete, contract-based blocker.** Gemini API Additional Terms (effective 23 March 2026) say you "must be 18 years of age or older to use the APIs" and must not use them in an API client "directed towards or is likely to be accessed by individuals under the age of 18". A coaching app for a 12+-rated game played by many teens is, on its face, "likely to be accessed" by minors. The **unpaid tier** lets Google use prompts and responses to improve products, with human review. It must not receive personal information and cannot be used for EEA, UK, or Swiss users. Separately, India's DPDP Rules require verifiable parental consent for under-18s, and Indonesia and the Philippines are tightening child-data rules in 2026–27.

### Cited Findings
**Gemini API Additional Terms of Service (effective 23 March 2026)**
- "You must be 18 years of age or older to use the APIs." You will not use the Services in an API Client "that is directed towards or is likely to be accessed by individuals under the age of 18." — [Gemini API Terms (aistudio.google.com/docs/terms)](https://aistudio.google.com/docs/terms)
- Unpaid Services: "Google uses the content you submit to the Services and any generated responses to provide, improve, and develop" its products. "human reviewers may read, annotate, and process your API input and output." "Do not submit sensitive, confidential, or personal information to the Unpaid Services." — [Gemini API Terms](https://aistudio.google.com/docs/terms)
- Paid Services: "Google doesn't use your prompts or responses to improve our products". Google logs prompts and responses "for a limited period of time, solely for detecting and preventing violations" (and legal disclosures). The API is "Paid" only via a Cloud project with an active billing account. — [Gemini API Terms](https://aistudio.google.com/docs/terms); [Archived 18 Dec 2025 terms](https://ai.google.dev/gemini-api/terms-archive/terms_12_18_25)
- "You may use only Paid Services when making API Clients available to users in the European Economic Area", Switzerland, or the UK. — [Gemini API Terms](https://aistudio.google.com/docs/terms)
- Services are "for developers building with Google AI models for professional or business purposes, not for consumer use" (meaning the developer's own use; building consumer-facing apps is not expressly banned). — [Gemini API Terms](https://aistudio.google.com/docs/terms)
- A newer preview version of the terms exists. Its content was not confirmed. — [Gemini terms preview](https://ai.google.dev/gemini-api/terms_preview)

**India: DPDP Act 2023 and DPDP Rules 2025**
- DPDP Rules notified 13/14 Nov 2025. Rule 10 requires verifiable parental consent before processing personal data of anyone under 18, with age and identity checked via authorised entities or digital tokens. Rollout is phased: Data Protection Board provisions are immediate, consent-manager provisions take ~12 months, and most obligations are reported to apply ~18 months after notification (≈ May 2027). That timeline is not confirmed for Rule 10 specifically. — [LiveLaw](https://www.livelaw.in/amp/top-stories/digital-personal-data-protection-rules-2025-notified-309928); [Bar & Bench](https://www.barandbench.com/view-point/meity-notifies-final-digital-personal-data-protection-rules-2025); [Biometric Update](https://www.biometricupdate.com/202511/india-notifies-its-sweeping-digital-personal-data-protection-rules); [BDO India](https://www.bdo.in/en-gb/news/2025/digital-personal-data-protection-rules-2025-%E2%80%94-check-provisions,-implementation-plan,-penalties); [Legal500 / Saga Legal](https://www.legal500.com/firms/237811-saga-legal/c-india/news-and-developments/the-privacy-timer-starts-now-analysing-the-dpdp-rules-and-its-18-month-countdown)

**Indonesia: PDP Law (UU 27/2022), GR 33/2026, GR 17/2025**
- GR 33/2026 (implementing the PDP Law) was issued 16 Jul 2026 and is effective 16 Jan 2027. Controllers must identify children, obtain parent or guardian consent, and verify it. Consent bundled with general terms is invalid. The PDP Authority was not yet established as of publication. — [PwC Indonesia](https://www.pwc.com/id/en/pwc-publications/services-publications/digital-publications/government-regulation-33-2026-personal-data-protection.html); [Conventus Law](https://conventuslaw.com/report/indonesia-personal-data-protection-under-2026-implementing-regulation/)
- GR 17/2025 (child protection in electronic systems): parental consent for under-17s and a DPIA before a child uses the system. A reported compliance deadline is 27 Mar 2027. — [Mondaq](https://www.mondaq.com/data-protection/1633198/gr-172025-indonesia-imposes-child-protection-duties-on-online-platforms); [Baker McKenzie](https://insightplus.bakermckenzie.com/bm/technology-media-telecommunications_1/indonesia-regulation-on-online-child-safety-issued-new-obligations-to-protect-the-younger-generation)
- The PDP Law includes administrative fines, criminal penalties, and a private right of action. — [DLA Piper](https://www.dlapiperdataprotection.com/?c=ID&t=law)

**Philippines: Data Privacy Act 2012 and NPC**
- NPC Advisory 2024-03, Guidelines on Child-Oriented Transparency (17 Dec 2024): the focus is transparency, and consent "still rests on those exercising parental authority". — [NPC Advisory PDF](https://privacy.gov.ph/wp-content/uploads/2024/12/Advisory-2024.12.17-Guidelines-on-Child-Oriented-Transparency-w-SGD.pdf); [NPC FAQ](https://privacy.gov.ph/wp-content/uploads/2024/12/FAQs-Advisory-on-Guidelines-on-Child-Oriented-Transparency.pdf)
- On 23 Sep 2026 the NPC adopted a public advisory on processing children's personal data aimed at operators of social media, platforms, digital services **and games** used by minors. Full text not retrieved. — [Digital Policy Alert](https://digitalpolicyalert.org/event/43940-national-privacy-commission-adopted-advisory-on-processing-of-childrens-personal-data)
- The NPC also issued AI guidelines (Dec 2024). — [NPC AI Advisory PDF](https://privacy.gov.ph/wp-content/uploads/2024/12/Advisory-2024.12.19-Guidelines-on-Artificial-Intelligence-w-SGD.pdf)
- Secondary sources conflict on the age threshold for parental consent (under 18 vs. "understand the consequences"). — [Chambers / ACCRA Law](https://chambers.com/articles/raising-digitally-mature-children-data-privacy-for-the-next-generation); [Respicio](https://www.respicio.ph/commentaries/data-privacy-law-for-minors-under-13-in-the-philippines)

**Malaysia: PDPA (Amendment) Act 2024**
- Phased in force on 1 Apr 2025 and 1 Jun 2025. The cross-border "whitelist" was replaced with a risk-based regime, and the Cross Border Personal Data Transfer Guidelines were issued 29 Apr 2025. Consent remains a valid transfer basis. — [Mayer Brown, Jul 2025](https://www.mayerbrown.com/en/insights/publications/2025/07/from-legislative-reform-to-practical-guidance-key-amendments-to-malaysias-pdpa-and-the-launch-of-cross-border-transfer-guidelines); [CMS](https://cms.law/en/int/legal-updates/malaysian-guidelines-on-cross-border-data-transfers); [Baker McKenzie](https://insightplus.bakermckenzie.com/bm/data-technology/malaysia-personal-data-protection-amendment-act-2024-to-come-into-force)

**US: COPPA (if US users under 13)**
- Amended COPPA Rule effective 23 Jun 2025, full compliance 22 Apr 2026. It requires separate parental consent before disclosing children's data to third parties. On 25 Feb 2026 the FTC limited enforcement where general-audience services collect data solely for age verification. — [Federal Register, 22 Apr 2025](https://www.federalregister.gov/documents/2025/04/22/2025-05904/childrens-online-privacy-protection-rule); [Finnegan, May 2026](https://www.finnegan.com/en/insights/articles/coppas-amended-rule-is-now-in-full-effect-what-operators-need-to-know.html); [Davis Polk](https://www.davispolk.com/insights/client-update/ftc-prioritizes-coppa-enforcement-new-compliance-obligations-take-effect)

### Inferences
- **Gemini under-18 clause:** MLBB is rated 12+ and widely played by teens, so a coaching app for it is plausibly "likely to be accessed" by under-18s. Using Gemini API for it is a probable breach of Google's terms regardless of local privacy law. Google could suspend the API key, which would kill the product. Options: (a) strict 18+ gating, with age declaration at signup, an 18+ ToS, adult-oriented marketing, and no school or student promotions (reduces but may not eliminate "likely to be accessed" risk); (b) switch the vision step to a provider or deployment whose terms allow teen users (e.g., Google Cloud Vertex AI is governed by different Google Cloud terms; not verified here); (c) do the gold, item, and scoreboard extraction with on-device OCR or template matching, so no screenshots leave the device. [LAWYER, plus check the Vertex AI or alternative provider terms]
- **Never use the free or unpaid Gemini tier in production.** It allows training use and human review of user screenshots. Screenshots can contain in-game usernames, player IDs, chat, and the device's notification banners, which is personal data the terms say not to send. It is also prohibited for EEA, UK, or Swiss users.
- **Data minimisation:** crop screenshots to the gold, item, and scoreboard regions client-side before upload. Blur names and chat. Don't store images (or set a short TTL). Disclose Gemini as a sub-processor and cross-border transfer (to Google/US) in the privacy policy. Get explicit consent in the UI, mirroring Apple 5.1.2(i)'s "third-party AI" disclosure norm, which is good practice even on the web.
- **India-based founder:** DPDP applies to the founder's processing of Indian users. Verifiable parental consent for under-18s is a heavy lift for a small startup, which reinforces an 18+-only product, at least in India. Indonesia (GR 33/2026 from Jan 2027; GR 17/2025 by Mar 2027) and the Philippines (NPC Sept 2026 advisory targeting games) point the same way.
- **GDPR:** general knowledge, not fetched this session. If EU users are accepted, GDPR Art. 8 sets a digital-consent age of 13–16 depending on the member state. A lawful basis, a DPA with Google (paid tier), and SCCs for transfers would be needed. Simplest early-stage option: geo-block the EEA, UK, and Switzerland until ready (which also satisfies the Gemini paid-only rule there).

### Gaps
- Moonton's own privacy policy and minimum-age terms for MLBB were not retrieved.
- Vertex AI (Google Cloud) terms on minors and data use were not checked as an alternative.
- The full text of the PH NPC 23 Sep 2026 children's-data advisory was not retrieved.
- Exact DPDP Rule 10 commencement date not confirmed (≈ 18 months from Nov 2025 per secondary sources).
- GDPR Art. 8 details not fetched in this session.
- No data found on what share of MLBB players are under 18.

---

## 7. MLBB's status in India: banned in 2020 under the IT Act. Has it returned by 2026?

### Takeaway
**Yes, effectively, but under a different name.** MLBB operates in India as "**Moba Legends: 5v5!**" (publisher listed as Vizta Games, first reported on Google Play in April 2024). India has an official Moonton-recognised MSC 2026 slot via the "MLMS 5V5 Season 1" champion, and Indian accounts are reported to share servers with global MLBB. I found **no public revocation** of the original 2020 Section 69A blocking order. The relaunch appears to rely on the new localized title, not a formal unban.

### Cited Findings
- April 2024: "Moba Legends: 5v5" appeared as the Indian version of MLBB. It is "the same game with a different name", published by Vizta Games, Android-only at the time (iOS "very soon"), with existing accounts carrying over and Indian players from both versions apparently pooled in matchmaking. Moonton declined to comment. — [GamingOnPhone, 24 Apr 2024](https://gamingonphone.com/news/moba-legends-5v5-is-the-official-indian-version-of-mobile-legends-bang-bang) [POSSIBLY SUPERSEDED]
- Conflicting report: Blockport (28 Apr 2026) says MLBB "returned" in March 2026 as Moba Legends: 5v5! via Vizta Games, restoring pre-2020 accounts. It cites ~32.4M monthly players without a clear source. — [Blockport](https://blockport.io/latest-news/mobile-legends-returns-india-32-4m-monthly-players/) (low-reliability source; dates conflict with GamingOnPhone)
- The official MSC 2026 rulebook (Moonton's MSC Committee) lists a slot for "India – 1 – MLMS 5V5 Season 1 – Champion". — [MSC 2026 Rules](https://cdn.esportsworldcup.com/resources/uploads/MSC_at_EWC_26_Rulebook_c5937d8775.pdf)
- MLMS 2026 is "India's first publisher-backed national tournament", with a ₹46 lakh prize pool and a direct MSC 2026 Main Stage slot. — [EarlyGame India](https://earlygame.in/news/esports/mlms-2026-format-teams-prize-pool-and-more-of-moba-legends-masters-series-2026); [GamingOnPhone](https://gamingonphone.com/esports/moba-legends-master-series-mlms-debuts-with-a-direct-slot-to-the-msc-2026/); [Outlook Respawn](https://respawn.outlookindia.com/gaming/gaming-news/india-joins-global-moba-esports-with-moba-legends-master-series)
- Team True Rippers placed Top 16 at MSC (EWC 2026), the first Indian team at the event. India's team is competing in MOBA Legends: 5v5! at the Esports Nations Cup in Riyadh, 23–29 Nov 2026. — [Khel Now](https://khelnow.com/gaming/india-secures-a-direct-invite-for-moba-legends-5v5-at-esports-nation-cup-202608); [MyKhel](https://www.mykhel.com/more-sports/india-names-dota-2-and-moba-legends-5v5-teams-for-esports-nations-cup-2026-011-437859.html)
- Moonton's global MLBB website HTML references `api.moba5v5.com`, which links the Indian title to Moonton's web infrastructure. — My inspection of [mobilelegends.com](https://www.mobilelegends.com/news/articleldetail?newsid=2690368), 22 Nov 2026
- Background: MLBB has been banned in India on national-security grounds since 2020. — [Sportskeeda](https://sportskeeda.com/esports/news-mlbb-finally-unbanned-usa-48-hours)
- Comparable pattern: other blocked games returned via localized relaunches (BGMI by Krafton in 2023, Free Fire India by Garena reported in Oct 2026). — [TechCrunch – BGMI](https://techcrunch.com/2023/05/18/krafton-to-relaunch-bgmi-mobile-game-in-india-a-year-after-ban); [TechCrunch – Free Fire India, 28 Oct 2026](https://techcrunch.com/2026/10/28/free-fire-returns-to-india-as-garena-launches-localized-version-four-years-after-ban/)

### Inferences
- An India-based founder can lawfully market to Indian players of **Moba Legends: 5v5!**. The product should reference that title for Indian users, and avoid suggesting users sideload or VPN into the blocked original "Mobile Legends: Bang Bang" app, which could be framed as facilitating access to a blocked app.
- The Indian title has its own publisher (Vizta Games), so IP and trademark permissions in India may sit with a different entity than Moonton Singapore or Shanghai. Its ToS should be checked separately. [LAWYER]
- Residual regulatory risk: Section 69A blocking orders are confidential and can be reissued. The product's India revenue depends on the Indian title staying available.

### Gaps
- No official MeitY statement on revocation of the 2020 block was found.
- I did not confirm the Indian title's iOS availability in 2026, its exact launch date (2024 vs. 2026 conflict), or Vizta Games' corporate relationship with Moonton.
- The Moba Legends: 5v5! ToS (third-party tool clauses) was not retrieved.

---

## 8. Overall risk ranking and what would make MLBB Guru safer to sell

### Takeaway
Ranked by likelihood × impact: (1) **Gemini API terms** (under-18 and unpaid-tier rules) are a concrete, near-term contractual risk that could get the API key suspended. (2) **IP in hero and item art plus "MLBB" in the name** is the most likely trigger for a takedown or store rejection. (3) **Moonton ToS and "real-time advantage"** is a gray zone: low enforcement history against non-hack tools, but no safe harbor. (4) **Undocumented stats API** is a continuity risk. (5) **Child-privacy law** (DPDP, ID, PH) is rising through 2027. A post-match-first, 18+, art-free, distinctly branded web product cuts most of these risks.

### Cited Findings
- Gemini: 18+ and "likely to be accessed by individuals under the age of 18" prohibition; unpaid-tier training and human review; paid-only for EEA, UK, CH. — [Gemini API Terms, effective 23 Mar 2026](https://aistudio.google.com/docs/terms)
- Store IP rules: Apple 4.1(c), 5.2.1, 5.2.2; Google Play copyright and trademark policy. — [Apple Guidelines](https://developer.apple.com/app-store/review/guidelines/); [Google Play IP policy](https://support.google.com/googleplay/android-developer/answer/9888072)
- Fandom images are not CC BY-SA. — [Fandom Help:Licensing](https://community.fandom.com/wiki/Help:Licensing)
- Industry line on real-time advice: Riot "reflect later" and "go here now" prohibitions; Overwolf bans notifications that "dictate player action based on the current game state". — [Riot Support](https://support.riotgames.com/en-us/riot/events/third-party-applications); [Riot Valorant docs](https://developer.riotgames.com/docs/valorant); [Overwolf Riot compliance](https://dev.overwolf.com/ow-native/guides/game-compliance/riot-games)
- Moonton enforcement targets hidden-information cheats with long bans and police action. — [Moonton, 8 Apr 2026](https://en.moonton.com/news/322.html)
- Riot's commercial model for third-party tools (registration, free tier, transformative, non-endorsement disclaimer) is a template a cautious developer can voluntarily follow. — [Riot Developer Policies](https://developer.riotgames.com/policies/general)

### Inferences (safer-to-sell checklist)
1. **Rebrand** away from "MLBB" as the lead word. Use "unofficial companion for Mobile Legends: Bang Bang players" descriptively, plus a Riot-style non-affiliation disclaimer ("not endorsed by or affiliated with Moonton...").
2. **Remove Moonton artwork** (portraits, item and skill icons) from the paid product, or get written permission. Keep a takedown contact.
3. **Product shape:** make post-match review, draft planning, and between-game coaching the paid core. Restrict live voice prompts to non-ranked practice modes with clear "not for ranked/tournament use" terms. Never read or infer hidden information. Never automate input.
4. **AI pipeline:** paid Gemini tier only (or a provider whose terms allow teen users). Use 18+ account gating if staying on Gemini API. Crop and redact screenshots client-side, set no or short retention, disclose AI sub-processing, and get explicit consent. Consider on-device OCR for numeric reads.
5. **Data sourcing:** low-rate cached aggregation, no user-token use, a fallback dataset, and outreach to Moonton for a data or partner arrangement.
6. **Distribution:** stay web or PWA with own checkout (no store fees or review). If native apps are later needed, expect IAP (non-US) and Play Billing rules and IP review scrutiny.
7. **Privacy compliance:** a privacy policy covering India DPDP, PH DPA, ID PDP, and MY PDPA cross-border transfers. Geo-block EEA, UK, and CH (and possibly the US under-13 audience) at launch. Plan for DPDP Rule 10 (≈ 2027) and Indonesia GR 33/2026 and GR 17/2025 (2027).
8. **[LAWYER]** before launch: (a) ToS-inducement exposure under Singapore, Indonesian, Philippine, and Indian law; (b) trademark clearance; (c) whether the signed-request API access raises computer-misuse issues; (d) Gemini or alternative AI terms versus a teen audience.

### Gaps
- There is no precedent (found) of Moonton acting against a non-cheat MLBB companion or coaching app, so the true enforcement probability is unknown.
- Moonton's position on AI coaching is unknown. A direct inquiry to Moonton would be the only way to reduce this uncertainty.

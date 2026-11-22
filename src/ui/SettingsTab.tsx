import { useEffect, useState } from "react";
import { speaker } from "../audio/speech";
import { useStore } from "../state/store";
import { CLAUDE_MODELS, type ProviderId } from "../vision";
import meta from "../data/generated/meta.json";

const PROVIDERS: Array<{ id: ProviderId; label: string; note: string }> = [
  { id: "demo", label: "Demo", note: "No key needed. Plays a scripted match so you can try the whole flow." },
  { id: "gemini", label: "Gemini", note: "Google AI Studio key. Fast and has a free tier." },
  { id: "claude", label: "Claude", note: "Anthropic API key." },
];

export function SettingsTab() {
  const { state, dispatch } = useStore();
  const { vision, speech, capture } = state.settings;
  const [voices, setVoices] = useState(() => speaker.voices());

  useEffect(() => {
    if (!speaker.supported) return;
    const update = () => setVoices(speaker.voices());
    update();
    window.speechSynthesis.addEventListener("voiceschanged", update);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", update);
  }, []);

  const setVision = (patch: Partial<typeof vision>) => dispatch({ type: "settings", patch: { vision: { ...vision, ...patch } } });
  const setSpeech = (patch: Partial<typeof speech>) => dispatch({ type: "settings", patch: { speech: { ...speech, ...patch } } });
  const setCapture = (patch: Partial<typeof capture>) => dispatch({ type: "settings", patch: { capture: { ...capture, ...patch } } });

  return (
    <div className="grid two">
      <section className="panel">
        <h2>Screen reading</h2>
        <p className="fine">A vision model reads your scoreboard so you don't have to type anything mid-match. Keys are stored only in this browser and sent only to the provider you choose.</p>
        <div className="chips">
          {PROVIDERS.map((p) => (
            <button key={p.id} className={`chip ${vision.provider === p.id ? "on" : ""}`} onClick={() => setVision({ provider: p.id })}>
              {p.label}
            </button>
          ))}
        </div>
        <p className="hint">{PROVIDERS.find((p) => p.id === vision.provider)?.note}</p>

        {vision.provider === "gemini" && (
          <>
            <label className="field">
              <span>Gemini API key</span>
              <input className="input" type="password" autoComplete="off" value={vision.geminiKey} onChange={(e) => setVision({ geminiKey: e.target.value })} placeholder="AIza…" />
            </label>
            <label className="field">
              <span>Model</span>
              <input className="input" value={vision.geminiModel} onChange={(e) => setVision({ geminiModel: e.target.value })} />
            </label>
          </>
        )}
        {vision.provider === "claude" && (
          <>
            <label className="field">
              <span>Claude API key</span>
              <input className="input" type="password" autoComplete="off" value={vision.claudeKey} onChange={(e) => setVision({ claudeKey: e.target.value })} placeholder="sk-ant-…" />
            </label>
            <label className="field">
              <span>Model</span>
              <select className="input" value={vision.claudeModel} onChange={(e) => setVision({ claudeModel: e.target.value })}>
                {CLAUDE_MODELS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </label>
            <p className="fine">Opus is the default for accuracy on small item icons. Haiku is far cheaper and faster if it reads your screen well enough.</p>
          </>
        )}

        <h3>When to read the screen</h3>
        <div className="chips">
          <button className={`chip ${capture.mode === "auto" ? "on" : ""}`} onClick={() => setCapture({ mode: "auto" })}>When a panel opens</button>
          <button className={`chip ${capture.mode === "interval" ? "on" : ""}`} onClick={() => setCapture({ mode: "interval" })}>On a timer</button>
        </div>
        {capture.mode === "auto" ? (
          <label className="field">
            <span>Stillness sensitivity: {capture.stillThreshold.toFixed(1)} <small>(raise it if the scoreboard never triggers a read)</small></span>
            <input type="range" min={1} max={12} step={0.5} value={capture.stillThreshold} onChange={(e) => setCapture({ stillThreshold: Number(e.target.value) })} />
          </label>
        ) : (
          <label className="field">
            <span>Read every {capture.intervalSec} seconds</span>
            <input type="range" min={8} max={90} step={2} value={capture.intervalSec} onChange={(e) => setCapture({ intervalSec: Number(e.target.value) })} />
          </label>
        )}
        <label className="field">
          <span>Maximum reads per match: {capture.maxCalls}</span>
          <input type="range" min={10} max={300} step={10} value={capture.maxCalls} onChange={(e) => setCapture({ maxCalls: Number(e.target.value) })} />
        </label>
      </section>

      <section className="panel">
        <h2>Voice</h2>
        {!speaker.supported && <p className="error">This browser has no speech synthesis. Advice will still show on screen.</p>}
        <label className="check">
          <input type="checkbox" checked={speech.enabled} onChange={(e) => setSpeech({ enabled: e.target.checked })} />
          <span>Speak advice out loud</span>
        </label>
        <label className="field">
          <span>Voice</span>
          <select className="input" value={speech.voiceURI ?? ""} onChange={(e) => setSpeech({ voiceURI: e.target.value || undefined })}>
            <option value="">System default</option>
            {voices.map((v) => (
              <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Speed: {speech.rate.toFixed(2)}×</span>
          <input type="range" min={0.8} max={1.5} step={0.05} value={speech.rate} onChange={(e) => setSpeech({ rate: Number(e.target.value) })} />
        </label>
        <label className="field">
          <span>Volume: {Math.round(speech.volume * 100)}%</span>
          <input type="range" min={0.1} max={1} step={0.05} value={speech.volume} onChange={(e) => setSpeech({ volume: Number(e.target.value) })} />
        </label>
        <button
          className="btn"
          onClick={() => {
            speaker.settings = { ...speech, enabled: true };
            speaker.unlock();
            speaker.say("Buy Dreadnaught Armor now. It builds into Antique Cuirass.", 2);
          }}
        >
          🔊 Test voice
        </button>

        <h3>Data</h3>
        <p className="fine">
          {meta.heroes} heroes and {meta.versusPairs.toLocaleString()} matchup records from Moonton's ranked stats, synced {new Date(meta.syncedAt).toLocaleDateString()} (newest hero: {meta.newestHero}). Run <code>npm run sync-data</code> after a patch.
        </p>
        <button className="btn" onClick={() => dispatch({ type: "newMatch" })}>Reset current match</button>
      </section>
      <IpadSetup />
    </div>
  );
}

/** Two-device setup: the phone plays and runs the shortcuts, this site reads and decides, the iPad shows and speaks the coach. */
function IpadSetup() {
  const { state, dispatch } = useStore();
  const { sync } = state.settings;
  const origin = window.location.origin;
  const endpoint = `${origin}/api/coach?room=${sync.room}`;
  const dashboardLink = `${origin}/?room=${sync.room}`;
  const [check, setCheck] = useState<string>();
  const setSync = (patch: Partial<typeof sync>) => dispatch({ type: "settings", patch: { sync: { ...sync, ...patch } } });
  const copy = (text: string) => void navigator.clipboard?.writeText(text);
  const test = async () => {
    setCheck("Checking…");
    try {
      const res = await fetch(`${origin}/api/coach`);
      const body = (await res.json()) as { ok?: boolean; heroes?: number; sample?: string; store?: string };
      setCheck(
        body.ok
          ? `Working — ${body.heroes} heroes loaded, match memory is ${body.store === "shared" ? "shared between server copies" : "in this server's memory only"}. Sample advice: "${body.sample}"`
          : `Unexpected answer (HTTP ${res.status}).`,
      );
    } catch {
      setCheck("Not reachable. This only works on the deployed site, not on a local preview.");
    }
  };
  const Address = ({ query }: { query: string }) => <code className="endpoint">{`${endpoint}${query}`}</code>;
  /** The four actions that take a screenshot and send it. Every screenshot command is this block with a different address. */
  const SEND = (
    <>
      <strong>Take Screenshot</strong> → <strong>Resize Image</strong> (width 1600) → <strong>Convert Image</strong> (JPEG) → <strong>Get Contents of URL</strong>
    </>
  );
  return (
    <section className="panel span">
      <h2>Phone plays, iPad shows the coach</h2>
      <p className="hint">
        The phone runs the game and a handful of Apple Shortcuts, started by voice. Each one sends a screenshot or a command to this site; the site reads it, an AI coach decides, and the iPad — open on the dashboard link — shows everything and says it out loud.
      </p>

      <div className="setup-grid">
        <div className="setup-card">
          <span className="eyebrow">Room code</span>
          <input className="input" value={sync.room} onChange={(e) => setSync({ room: e.target.value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32).toUpperCase() })} aria-label="Room code" />
          <p>Links the two devices. Keep it to yourself.</p>
        </div>
        <div className="setup-card">
          <span className="eyebrow">This device</span>
          <label className="check">
            <input type="checkbox" checked={sync.follow} onChange={(e) => setSync({ follow: e.target.checked })} />
            <span>Follow this room (show and speak the coach here)</span>
          </label>
          <p>On for the iPad dashboard. The phone does not need this page open at all.</p>
        </div>
      </div>

      <div className="field">
        <span>1 · Open this on the iPad, in landscape, and tap Turn on voice</span>
        <code className="endpoint">{dashboardLink}</code>
      </div>
      <div className="field">
        <span>2 · Every shortcut on the phone talks to this address</span>
        <code className="endpoint">{endpoint}</code>
      </div>
      <div className="row wrap">
        <button className="btn" onClick={() => copy(dashboardLink)}>Copy dashboard link</button>
        <button className="btn" onClick={() => copy(endpoint)}>Copy shortcut address</button>
        <button className="btn" onClick={() => void test()}>Test server</button>
      </div>
      {check && <p className="fine">{check}</p>}

      <h3>The screenshot block</h3>
      <p className="fine">
        Every screenshot command below is the same four actions with a different address: {SEND}. In <em>Get Contents of URL</em>: Show More → Method <em>POST</em>; Headers → <code>x-vision-key</code> = your API key; Request Body → <em>File</em> → the Converted Image. Resizing matters: a full-size screenshot takes
        seconds to upload from a phone.
      </p>
      <p className="fine">
        Models: with a Claude key both the reader and the coach default to the strongest model. To choose, add the headers <code>x-vision-model</code> (reads the screenshot) and <code>x-coach-model</code> (decides items and calls), or <code>x-coach</code> = <code>off</code> to use the built-in rules only.
      </p>

      <h3>Voice commands</h3>
      <p className="fine">
        Make one shortcut per row, then give each a phrase under iPhone Settings → Accessibility → Vocal Shortcuts. Rows marked <em>address only</em> are a single <em>Get Contents of URL</em> action with nothing else to set.
      </p>
      <table className="standings asks">
        <tbody>
          <tr>
            <td className="who">“Draft mode”<br /><span className="fine">hero selection is on screen</span></td>
            <td>The screenshot block, sent to <Address query="&stage=draft" /><span className="fine">Starts a fresh match and calls the picks. Say “coach now” again as enemies lock in.</span></td>
          </tr>
          <tr>
            <td className="who">“Entering the match”<br /><span className="fine">loading screen, all ten heroes</span></td>
            <td>The screenshot block, sent to <Address query="&stage=loading" /><span className="fine">Reads both teams; the coach answers with your build, spell and lane plan.</span></td>
          </tr>
          <tr>
            <td className="who">“Coach on”<br /><span className="fine">match started</span></td>
            <td>
              <strong>Get Contents of URL</strong> <Address query="&stage=live" /> → <strong>Wait</strong> 1 second → <strong>Repeat</strong> 150 times: [ the screenshot block, sent to <Address query="&stream=1" /> → <strong>Get Dictionary Value</strong> <code>halt</code> from its result → <strong>If</strong> it has any value: <strong>Stop This Shortcut</strong> → <strong>Wait</strong> 5 seconds ]
              <span className="fine">This is the continuous mode: a screenshot about every 10 seconds for the whole match. Just play — open the scoreboard, the shop or the map whenever you like and the next frame picks it up. It stops by itself on the results screen, or when you say “coach off”.</span>
            </td>
          </tr>
          <tr>
            <td className="who">“Coach now”<br /><span className="fine">scoreboard or shop open</span></td>
            <td>The screenshot block, sent to <Address query="" /><span className="fine">The scoreboard gives the coach both teams’ numbers; the shop gives it your list and what you own.</span></td>
          </tr>
          <tr>
            <td className="who">“Help me position”</td>
            <td>
              The screenshot block, sent to <Address query="&ask=position&shot=1" /> → <strong>Speak Text</strong> “Open the map” → <strong>Wait</strong> 3 seconds → the screenshot block again, sent to <Address query="&ask=position&shot=2" />
              <span className="fine">That is the four-action block twice (resize included), each with its own address. Open the map when you hear the prompt; the answer is spoken on the iPad.</span>
            </td>
          </tr>
          <tr>
            <td className="who">“Coach off”<br /><span className="fine">match over</span></td>
            <td><em>Address only:</em> <Address query="&stage=done" /><span className="fine">Pauses reading, so a repeating shortcut stops spending your key.</span></td>
          </tr>
          {[
            ["“What do I buy?”", "buy"],
            ["“How are we doing?”", "status"],
            ["“Who do I watch?”", "threat"],
            ["“How do I play my lane?”", "lane"],
            ["“What's the plan?”", "plan"],
            ["“Help me pick”", "picks"],
          ].map(([label, topic]) => (
            <tr key={topic}>
              <td className="who">{label}</td>
              <td><em>Address only:</em> <Address query={`&ask=${topic}`} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="fine">
        The six questions at the bottom are answered from what the room already knows: no screenshot, no AI call, no cost. Everything else that sends a picture uses your key.
      </p>

      <h3>What happens to each screenshot</h3>
      <p className="fine">
        A fast model sorts every frame — battlefield, map, scoreboard, shop — and reads it. Then three specialists, each a stronger model, work only when there is something new for them: the <strong>coach</strong> (your build order and the calls for the next two minutes) after a scoreboard or shop frame; the <strong>enemy tracker</strong> (who is dangerous, what they have built) after a scoreboard frame; <strong>positioning</strong> about once a minute from battlefield frames, using your last opened map. Each has its own panel on the dashboard.
      </p>

      <h3>A match, start to finish</h3>
      <ol className="steps">
        <li>iPad: dashboard link open, voice on.</li>
        <li>Hero selection: say <em>“draft mode”</em>. The iPad calls the best picks.</li>
        <li>Loading screen: say <em>“entering the match”</em>. You get your build, battle spell and lane plan.</li>
        <li>Match starts: say <em>“coach on”</em>. Screenshots now go out by themselves.</li>
        <li>Early on, open the shop once so the coach learns your in-game list and what you own. Open the scoreboard for a few seconds after fights; open the map when you want positioning looked at.</li>
        <li>Any time: <em>“coach now”</em> for an immediate read of what is on screen, <em>“help me position”</em>, or one of the questions.</li>
        <li>End: the results screen stops it, or say <em>“coach off”</em>.</li>
      </ol>
    </section>
  );
}

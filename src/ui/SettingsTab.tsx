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

/** Two-device setup: the iPad sends screenshots, this site reads them, the phone shows and speaks the coach. */
function IpadSetup() {
  const { state, dispatch } = useStore();
  const { sync } = state.settings;
  const origin = window.location.origin;
  const endpoint = `${origin}/api/coach?room=${sync.room}`;
  const phoneLink = `${origin}/?room=${sync.room}`;
  const [check, setCheck] = useState<string>();
  const setSync = (patch: Partial<typeof sync>) => dispatch({ type: "settings", patch: { sync: { ...sync, ...patch } } });
  const copy = (text: string) => void navigator.clipboard?.writeText(text);
  const test = async () => {
    setCheck("Checking…");
    try {
      const res = await fetch(`${origin}/api/coach`);
      const body = (await res.json()) as { ok?: boolean; heroes?: number; sample?: string };
      setCheck(body.ok ? `Working — ${body.heroes} heroes loaded. Sample advice: "${body.sample}"` : `Unexpected answer (HTTP ${res.status}).`);
    } catch {
      setCheck("Not reachable. This only works on the deployed site, not on a local preview.");
    }
  };
  return (
    <section className="panel span">
      <h2>iPad plays, phone coaches</h2>
      <p className="hint">
        Safari on an iPad can't look at the game, so the screenshots come from an Apple Shortcut. It sends each one to this site, the site works out the advice, and your phone — following the same room — shows the dashboard and says it out loud.
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
          <p>Turn this on for the phone. Leave it off on the iPad.</p>
        </div>
      </div>

      <div className="field">
        <span>1 · Open this on your phone</span>
        <code className="endpoint">{phoneLink}</code>
      </div>
      <div className="field">
        <span>2 · The iPad shortcut sends screenshots here</span>
        <code className="endpoint">{endpoint}</code>
      </div>
      <div className="row wrap">
        <button className="btn" onClick={() => copy(phoneLink)}>Copy phone link</button>
        <button className="btn" onClick={() => copy(endpoint)}>Copy shortcut address</button>
        <button className="btn" onClick={() => void test()}>Test server</button>
      </div>
      {check && <p className="fine">{check}</p>}

      <h3>Build the shortcut on the iPad (Shortcuts app → +)</h3>
      <ol className="steps">
        <li><strong>Repeat</strong> — 60 times. Put the next five actions inside it.</li>
        <li><strong>Take Screenshot</strong></li>
        <li><strong>Resize Image</strong> — width 1600, height auto</li>
        <li><strong>Convert Image</strong> — to JPEG</li>
        <li>
          <strong>Get Contents of URL</strong> — the shortcut address above. Show More → Method <em>POST</em>. Headers → add <code>x-vision-key</code> with your Gemini API key. Request Body → <em>File</em> → choose the Converted Image.
        </li>
        <li><strong>Wait</strong> — 15 seconds</li>
      </ol>
      <p className="fine">
        That sends a screenshot every 15 seconds for about 15 minutes with no tapping. Ordinary gameplay still shows your gold and the match clock, and whenever you open the scoreboard or shop the next screenshot picks it up. Run it again for a longer match.
      </p>
      <h3>Voice commands (optional)</h3>
      <p className="fine">
        Each of these is a one-action shortcut: <em>Get Contents of URL</em> with the address below, nothing else. Run it and the phone answers out loud, from what it already knows — no screenshot, no cost. Give each one a spoken phrase under iPad Settings → Accessibility → Vocal Shortcuts.
      </p>
      <table className="standings asks">
        <tbody>
          {[
            ["What do I buy?", "buy"],
            ["How are we doing?", "status"],
            ["How do I play my lane?", "lane"],
            ["What's the plan?", "plan"],
            ["Who do I watch?", "threat"],
            ["Help me pick a hero", "picks"],
          ].map(([label, topic]) => (
            <tr key={topic}>
              <td className="who">{label}</td>
              <td><code className="endpoint">{`${endpoint}&ask=${topic}`}</code></td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Play</h3>
      <ol className="steps">
        <li>Phone: open the phone link, tap <em>Turn on voice</em>, and keep it on screen beside you. The stage buttons at the top are yours: <em>Hero selection</em> starts a fresh match, <em>Match over</em> pauses reading.</li>
        <li>iPad: when hero selection starts, run the shortcut (from the Home Screen, or assign it to AssistiveTouch: Settings → Accessibility → Touch → AssistiveTouch → Custom Actions).</li>
        <li>Play. Open the scoreboard now and then so the coach sees everyone's items.</li>
      </ol>
      <p className="fine">
        <strong>If the repeating shortcut stops by itself</strong> — iPadOS decides how long a shortcut may run behind a game, and that has to be tried on your iPad — remove the Repeat and Wait, assign the four-action shortcut to an AssistiveTouch double-tap, and tap it when you open the scoreboard. One double-tap takes the screenshot and sends it; there is nothing to share by hand.
      </p>
    </section>
  );
}

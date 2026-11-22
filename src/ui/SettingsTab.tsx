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
    </div>
  );
}

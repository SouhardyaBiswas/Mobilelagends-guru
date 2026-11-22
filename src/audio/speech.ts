export interface SpeechSettings {
  enabled: boolean;
  rate: number;
  volume: number;
  voiceURI?: string;
}

interface Queued {
  text: string;
  priority: number;
}

/**
 * Small queue on top of the browser's speechSynthesis.
 * - Higher priority lines interrupt lower ones.
 * - Works in a tab that is not focused (desktop Chrome/Edge); on Android the
 *   page must stay on screen (split view or a second device).
 */
export class Speaker {
  private queue: Queued[] = [];
  private speaking: Queued | undefined;
  settings: SpeechSettings = { enabled: true, rate: 1.05, volume: 1 };

  get supported(): boolean {
    return typeof window !== "undefined" && "speechSynthesis" in window;
  }

  voices(): SpeechSynthesisVoice[] {
    if (!this.supported) return [];
    return window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith("en"));
  }

  /** Call from a click handler once so the browser unlocks audio for later lines. */
  unlock(): void {
    if (!this.supported) return;
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    window.speechSynthesis.speak(u);
  }

  say(text: string, priority = 1): void {
    if (!this.supported || !this.settings.enabled || !text.trim()) return;
    if (this.speaking && priority > this.speaking.priority) {
      // Urgent line: drop whatever is playing and anything less important.
      this.queue = this.queue.filter((q) => q.priority >= priority);
      this.queue.unshift({ text, priority });
      window.speechSynthesis.cancel(); // fires onend → pump()
      this.speaking = undefined;
      this.pump();
      return;
    }
    this.queue.push({ text, priority });
    this.queue.sort((a, b) => b.priority - a.priority);
    // Never let a backlog build up: stale advice is worse than none.
    if (this.queue.length > 3) this.queue.length = 3;
    this.pump();
  }

  stop(): void {
    this.queue = [];
    this.speaking = undefined;
    if (this.supported) window.speechSynthesis.cancel();
  }

  private pump(): void {
    if (this.speaking || !this.queue.length) return;
    const next = this.queue.shift()!;
    const u = new SpeechSynthesisUtterance(next.text);
    u.rate = this.settings.rate;
    u.volume = this.settings.volume;
    const voice = this.voices().find((v) => v.voiceURI === this.settings.voiceURI);
    if (voice) u.voice = voice;
    u.lang = voice?.lang ?? "en-US";
    const done = () => {
      clearTimeout(watchdog);
      if (this.speaking !== next) return;
      this.speaking = undefined;
      this.pump();
    };
    u.onend = done;
    u.onerror = done;
    // Some browsers and voices never fire "end"; without this one lost event would mute the coach for good.
    const watchdog = setTimeout(() => {
      if (this.speaking !== next) return;
      window.speechSynthesis.cancel();
      done();
    }, 2500 + next.text.length * 110);
    this.speaking = next;
    window.speechSynthesis.speak(u);
  }
}

export const speaker = new Speaker();

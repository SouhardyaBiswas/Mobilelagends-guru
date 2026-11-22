/**
 * Decides when a captured frame is worth sending to the vision model.
 *
 * Live gameplay never stops moving (minions, camera, effects). The scoreboard,
 * shop, draft and loading screens are static panels. So: wait for the picture
 * to hold still, and only fire when it is a *different* still picture from the
 * one analysed last. That keeps API calls to a handful per match instead of
 * one every few seconds.
 */
export interface StillnessOptions {
  /** Mean per-pixel change (0-255) below which two frames count as "the same". */
  stillThreshold: number;
  /** Consecutive still samples required before firing. */
  stableSamples: number;
  /** How different a still frame must be from the last analysed one. */
  changeThreshold: number;
  /** Never fire more often than this. */
  minIntervalMs: number;
}

export const DEFAULT_STILLNESS: StillnessOptions = {
  stillThreshold: 3,
  stableSamples: 2,
  changeThreshold: 8,
  minIntervalMs: 5000,
};

/** Mean absolute difference between two equal-length grayscale thumbnails. */
export function frameDiff(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  if (!n) return 255;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.abs(a[i]! - b[i]!);
  return sum / n;
}

export interface StillnessResult {
  fire: boolean;
  /** Change versus the previous sample — shown as the motion meter. */
  motion: number;
  still: boolean;
}

export class StillnessDetector {
  private prev: Uint8Array | undefined;
  private lastAnalysed: Uint8Array | undefined;
  private stillCount = 0;
  private lastFireAt = -Infinity;

  constructor(public options: StillnessOptions = DEFAULT_STILLNESS) {}

  push(sig: Uint8Array, now: number): StillnessResult {
    const motion = this.prev ? frameDiff(sig, this.prev) : 255;
    this.prev = sig;
    const still = motion < this.options.stillThreshold;
    this.stillCount = still ? this.stillCount + 1 : 0;

    const settled = this.stillCount >= this.options.stableSamples;
    const isNew = !this.lastAnalysed || frameDiff(sig, this.lastAnalysed) > this.options.changeThreshold;
    const rested = now - this.lastFireAt >= this.options.minIntervalMs;
    const fire = settled && isNew && rested;
    if (fire) {
      this.lastAnalysed = sig;
      this.lastFireAt = now;
    }
    return { fire, motion, still };
  }

  /** Forget the last analysed frame so the same screen can be analysed again. */
  reset(): void {
    this.lastAnalysed = undefined;
    this.stillCount = 0;
    this.lastFireAt = -Infinity;
  }
}

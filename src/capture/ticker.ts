/**
 * setInterval that keeps firing when the tab is in the background.
 * Browsers throttle page timers in hidden/occluded tabs (down to once a minute);
 * timers inside a Web Worker are not throttled the same way, so the worker
 * keeps time and pings the page.
 */
const WORKER_SRC = `
  let id;
  onmessage = (e) => {
    clearInterval(id);
    if (e.data > 0) id = setInterval(() => postMessage(0), e.data);
  };
`;

export class Ticker {
  private worker: Worker | undefined;
  private fallback: ReturnType<typeof setInterval> | undefined;

  start(intervalMs: number, onTick: () => void): void {
    this.stop();
    try {
      const url = URL.createObjectURL(new Blob([WORKER_SRC], { type: "text/javascript" }));
      this.worker = new Worker(url);
      URL.revokeObjectURL(url);
      this.worker.onmessage = onTick;
      this.worker.postMessage(intervalMs);
    } catch {
      this.fallback = setInterval(onTick, intervalMs);
    }
  }

  stop(): void {
    this.worker?.terminate();
    this.worker = undefined;
    if (this.fallback !== undefined) clearInterval(this.fallback);
    this.fallback = undefined;
  }
}

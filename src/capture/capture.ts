export type CaptureKind = "screen" | "camera";

export interface Frame {
  /** Base64 JPEG (no data: prefix) sized for the vision model. */
  jpegBase64: string;
  /** Tiny grayscale thumbnail used for motion detection. */
  signature: Uint8Array;
  width: number;
  height: number;
}

const SIG_W = 48;
const SIG_H = 27;

function toSignature(source: CanvasImageSource): Uint8Array {
  const c = document.createElement("canvas");
  c.width = SIG_W;
  c.height = SIG_H;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, SIG_W, SIG_H);
  const { data } = ctx.getImageData(0, 0, SIG_W, SIG_H);
  const sig = new Uint8Array(SIG_W * SIG_H);
  for (let i = 0; i < sig.length; i++) {
    const o = i * 4;
    sig[i] = (data[o]! * 299 + data[o + 1]! * 587 + data[o + 2]! * 114) / 1000;
  }
  return sig;
}

function toFrame(source: CanvasImageSource, srcW: number, srcH: number, maxWidth: number, quality: number): Frame {
  const scale = Math.min(1, maxWidth / srcW);
  const width = Math.round(srcW * scale);
  const height = Math.round(srcH * scale);
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  c.getContext("2d")!.drawImage(source, 0, 0, width, height);
  const jpegBase64 = c.toDataURL("image/jpeg", quality).split(",")[1] ?? "";
  return { jpegBase64, signature: toSignature(c), width, height };
}

export function captureSupport(): { screen: boolean; camera: boolean } {
  const md = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
  return { screen: !!md?.getDisplayMedia, camera: !!md?.getUserMedia };
}

/**
 * Wraps a screen-share or camera stream and hands out frames on demand.
 * The <video> element always holds the latest frame, so a static screen (which
 * is exactly what we want to read) can still be grabbed.
 */
export class FrameSource {
  private stream: MediaStream | undefined;
  private video: HTMLVideoElement | undefined;
  kind: CaptureKind | undefined;
  onEnded: (() => void) | undefined;

  get active(): boolean {
    return !!this.stream?.active;
  }

  async start(kind: CaptureKind): Promise<void> {
    this.stop();
    const md = navigator.mediaDevices;
    this.stream =
      kind === "screen"
        ? await md.getDisplayMedia({ video: { frameRate: { ideal: 5, max: 10 } }, audio: false })
        : await md.getUserMedia({
            video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
            audio: false,
          });
    this.kind = kind;
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = this.stream;
    await video.play();
    this.video = video;
    this.stream.getVideoTracks()[0]?.addEventListener("ended", () => {
      this.stop();
      this.onEnded?.();
    });
  }

  /** Live element for an on-page preview. */
  get element(): HTMLVideoElement | undefined {
    return this.video;
  }

  /** Cheap motion thumbnail — safe to call several times a second. */
  sample(): Uint8Array | undefined {
    const v = this.video;
    return v && v.videoWidth ? toSignature(v) : undefined;
  }

  grab(maxWidth = 1568, quality = 0.82): Frame | undefined {
    const v = this.video;
    if (!v || !v.videoWidth) return undefined;
    return toFrame(v, v.videoWidth, v.videoHeight, maxWidth, quality);
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = undefined;
    if (this.video) this.video.srcObject = null;
    this.video = undefined;
    this.kind = undefined;
  }
}

/** Turn an uploaded / pasted screenshot into the same Frame shape. */
export async function frameFromBlob(blob: Blob, maxWidth = 1568, quality = 0.85): Promise<Frame> {
  const bitmap = await createImageBitmap(blob);
  try {
    return toFrame(bitmap, bitmap.width, bitmap.height, maxWidth, quality);
  } finally {
    bitmap.close();
  }
}

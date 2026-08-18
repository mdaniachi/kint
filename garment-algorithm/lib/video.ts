/**
 * WebM recording of an animated composite.
 *
 * MediaRecorder over canvas.captureStream is the only encoder the browser
 * ships natively — no dependency, no wasm. It records in real time, so the
 * total wait equals the clip length; frames are rendered on a timer and
 * blitted onto the recorded canvas. GIF would need a bundled encoder and is
 * deliberately out — WebM loops everywhere a GIF would.
 */
export function recordWebM(opts: {
  width: number;
  height: number;
  frames: number;
  fps: number;
  /** Render frame `f` (0-based). Called once per frame, in order. */
  renderFrame: (f: number) => HTMLCanvasElement;
}): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width = opts.width;
    canvas.height = opts.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      reject(new Error("Could not create a recording canvas."));
      return;
    }
    if (typeof MediaRecorder === "undefined") {
      reject(new Error("This browser has no MediaRecorder."));
      return;
    }

    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : "video/webm";
    const recorder = new MediaRecorder(canvas.captureStream(opts.fps), {
      mimeType: mime,
      videoBitsPerSecond: 12_000_000
    });

    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => resolve(new Blob(chunks, { type: "video/webm" }));
    recorder.onerror = () => reject(new Error("Recording failed."));

    const frameDur = 1000 / opts.fps;
    let f = 0;

    const tick = () => {
      try {
        const src = opts.renderFrame(f);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
      } catch (err) {
        recorder.stop();
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      f += 1;
      if (f >= opts.frames) {
        // Hold the last frame for its full duration before stopping.
        window.setTimeout(() => recorder.stop(), frameDur);
      } else {
        window.setTimeout(tick, frameDur);
      }
    };

    recorder.start();
    tick();
  });
}

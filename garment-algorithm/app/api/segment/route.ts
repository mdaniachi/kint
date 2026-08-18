import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const DEFAULT_MODEL = "mattmdjaga/segformer_b2_clothes";

/**
 * Segmentation provider: Hugging Face Inference API (image-segmentation).
 * Returns [{ label, score, mask }] where mask is a base64 PNG the size of
 * the input image. Swap providers by replacing this route — the client
 * only depends on that response shape.
 */
export async function POST(req: Request) {
  const token = process.env.HF_TOKEN;
  if (!token) {
    return NextResponse.json(
      {
        code: "missing_credentials",
        error:
          "No segmentation credentials configured. Add HF_TOKEN to .env.local (see .env.example) and restart the dev server."
      },
      { status: 501 }
    );
  }

  let body: { image?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { code: "bad_request", error: "Expected JSON body with an image field." },
      { status: 400 }
    );
  }

  const dataUrl = body.image ?? "";
  const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
  if (!base64) {
    return NextResponse.json(
      { code: "bad_request", error: "No image provided." },
      { status: 400 }
    );
  }

  const model = process.env.SEGMENTATION_MODEL ?? DEFAULT_MODEL;
  const bytes = Buffer.from(base64, "base64");

  try {
    // Host novo do HF. O antigo (api-inference.huggingface.co) foi desligado
    // e hoje nem resolve DNS — qualquer requisição morria em network_error.
    const res = await fetch(
      `https://router.huggingface.co/hf-inference/models/${model}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/octet-stream",
          // Block until the model is warm instead of returning 503.
          "x-wait-for-model": "true"
        },
        body: bytes
      }
    );

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      const code =
        res.status === 401 || res.status === 403
          ? "invalid_credentials"
          : res.status === 503
            ? "model_loading"
            : "provider_error";
      return NextResponse.json(
        {
          code,
          error: `Segmentation provider returned ${res.status}. ${detail.slice(0, 300)}`
        },
        { status: 502 }
      );
    }

    const segments = await res.json();
    if (!Array.isArray(segments)) {
      return NextResponse.json(
        { code: "provider_error", error: "Unexpected provider response." },
        { status: 502 }
      );
    }
    return NextResponse.json({ segments });
  } catch (err) {
    return NextResponse.json(
      {
        code: "network_error",
        error: `Could not reach the segmentation provider: ${
          err instanceof Error ? err.message : "unknown error"
        }`
      },
      { status: 502 }
    );
  }
}

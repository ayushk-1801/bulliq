import { type NextRequest, NextResponse } from "next/server";

const UPSTREAM_CHAT_URL = "http://127.0.0.1:8002/chat";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as unknown;

    let upstream: Response;

    try {
      upstream = await fetch(UPSTREAM_CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (fetchErr) {
      const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      return NextResponse.json(
        {
          error: `Unable to reach chat service at ${UPSTREAM_CHAT_URL}`,
          detail: msg,
        },
        { status: 502 },
      );
    }

    const contentType = upstream.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
      const data: unknown = await upstream.json();
      return NextResponse.json(data, { status: upstream.status });
    }

    const text = await upstream.text();
    return NextResponse.json(
      {
        error: "Chat service returned a non-JSON response",
        detail: text,
      },
      { status: upstream.status || 502 },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Unexpected server error", detail: msg },
      { status: 500 },
    );
  }
}

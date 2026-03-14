import { type NextRequest, NextResponse } from "next/server";
import { env } from "~/env";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      stock_symbol: string;
      timeframe?: string;
    };

    if (!body.stock_symbol || typeof body.stock_symbol !== "string") {
      return NextResponse.json(
        { error: "stock_symbol is required" },
        { status: 400 },
      );
    }

    const payload = {
      stock_symbol: body.stock_symbol.trim().toUpperCase(),
      timeframe: body.timeframe ?? "1d",
    };

    let upstream: Response;

    try {
      upstream = await fetch(`${env.STOCK_ANALYSIS_API_URL}/api/v1/analyze`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
        // Analysis can take a while — allow up to 5 minutes
        signal: AbortSignal.timeout(300_000),
      });
    } catch (fetchErr) {
      // Surface network-level errors with a useful message
      const msg =
        fetchErr instanceof Error ? fetchErr.message : String(fetchErr);

      const isConnRefused =
        msg.includes("ECONNREFUSED") ||
        msg.includes("Connection refused") ||
        msg.includes("connect ECONNREFUSED");

      const isTimeout =
        (fetchErr instanceof DOMException &&
          fetchErr.name === "TimeoutError") ||
        msg.includes("timed out") ||
        msg.includes("ETIMEDOUT");

      const isUnreachable =
        msg.includes("EHOSTUNREACH") ||
        msg.includes("ENETUNREACH") ||
        msg.includes("ENOTFOUND");

      if (isConnRefused) {
        return NextResponse.json(
          {
            error: `Cannot reach the analysis backend at ${env.STOCK_ANALYSIS_API_URL}. Make sure the server is running.`,
          },
          { status: 502 },
        );
      }

      if (isTimeout) {
        return NextResponse.json(
          {
            error:
              "Analysis request timed out. The backend is taking too long — please try again.",
          },
          { status: 504 },
        );
      }

      if (isUnreachable) {
        return NextResponse.json(
          {
            error: `Network unreachable: cannot connect to ${env.STOCK_ANALYSIS_API_URL}. Check the IP/port in your .env file.`,
          },
          { status: 502 },
        );
      }

      // Unknown network error
      console.error("[/api/analyze] Fetch error:", fetchErr);
      return NextResponse.json(
        { error: `Network error: ${msg}` },
        { status: 502 },
      );
    }

    if (!upstream.ok) {
      const errorText = await upstream.text().catch(() => "(no body)");
      console.error(
        `[/api/analyze] Upstream returned ${upstream.status}:`,
        errorText,
      );
      return NextResponse.json(
        {
          error: `Analysis service returned ${upstream.status}: ${upstream.statusText}`,
          detail: errorText,
        },
        { status: upstream.status },
      );
    }

    const data: unknown = await upstream.json();
    return NextResponse.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/api/analyze] Unexpected error:", err);
    return NextResponse.json(
      { error: `Unexpected server error: ${msg}` },
      { status: 500 },
    );
  }
}

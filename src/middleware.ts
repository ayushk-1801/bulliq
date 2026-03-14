import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  
  // Exclude static paths and API routes that aren't our concern
  if (
    pathname.startsWith("/api") || 
    pathname.startsWith("/login") || 
    pathname.startsWith("/signup") || 
    pathname.startsWith("/_next")
  ) {
    return NextResponse.next();
  }

  const cookie = request.headers.get("cookie") || "";
  if (!cookie) {
    return NextResponse.next();
  }

  // Use the native fetch API to check session from the Better Auth endpoint
  const origin = request.nextUrl.origin;
  const sessionUrl = new URL("/api/auth/get-session", origin);
  const knowledgeStatusUrl = new URL("/api/auth/knowledge-status", origin);
  try {
    const res = await fetch(sessionUrl.toString(), {
      cache: "no-store",
      headers: {
        cookie,
      },
    });
    
    if (res.ok) {
      const sessionData = await res.json();
      const session = sessionData as { session: any, user: any } | null;

      let hasPassedKnowledgeCheck = session?.user?.hasPassedKnowledgeCheck;

      // In some deployments, custom user fields may not be present in get-session payloads.
      // Fallback to an authenticated DB-backed endpoint for a definitive value.
      if (session?.user && typeof hasPassedKnowledgeCheck !== "boolean") {
        const statusRes = await fetch(knowledgeStatusUrl.toString(), {
          cache: "no-store",
          headers: {
            cookie,
          },
        });

        if (statusRes.ok) {
          const statusData = await statusRes.json() as { hasPassedKnowledgeCheck?: boolean };
          hasPassedKnowledgeCheck = statusData.hasPassedKnowledgeCheck;
        }
      }
      
      // If user is logged in, but hasn't passed the knowledge check
      if (session?.user && hasPassedKnowledgeCheck === false) {
        if (pathname !== "/knowledge") {
          return NextResponse.redirect(new URL("/knowledge", request.url));
        }
      } else if (session?.user && hasPassedKnowledgeCheck === true && pathname === "/knowledge") {
        return NextResponse.redirect(new URL("/", request.url));
      }
    }
  } catch {
    // Gracefully skip knowledge redirects if internal auth fetch fails.
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};

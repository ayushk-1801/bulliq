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

  // Use the native fetch API to check session from the Better Auth endpoint
  const sessionUrl = new URL("/api/auth/get-session", request.url);
  try {
    const res = await fetch(sessionUrl.toString(), {
      headers: {
        cookie: request.headers.get("cookie") || "",
      },
    });
    
    if (res.ok) {
      const sessionData = await res.json();
      const session = sessionData as { session: any, user: any } | null;
      
      // If user is logged in, but hasn't passed the knowledge check
      if (session?.user && session.user.hasPassedKnowledgeCheck === false) {
        if (pathname !== "/knowledge") {
          return NextResponse.redirect(new URL("/knowledge", request.url));
        }
      } else if (session?.user && session.user.hasPassedKnowledgeCheck && pathname === "/knowledge") {
        return NextResponse.redirect(new URL("/", request.url));
      }
    }
  } catch (error) {
    console.error("Error checking session in middleware:", error);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};

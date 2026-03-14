import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "~/components/ui/button";

import { auth } from "~/server/better-auth";
import { getSession } from "~/server/better-auth/server";

export default async function Home() {
  const session = await getSession();

  return (
    <main className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-4xl items-center justify-center px-4 py-16 sm:px-6">
      <section className="w-full rounded-2xl border border-border/70 bg-card/40 p-8 text-center backdrop-blur sm:p-10">
        <p className="font-mono text-[10px] tracking-[0.25em] text-muted-foreground uppercase">
          BullIQ
        </p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">
          Invest with clarity.
        </h1>
        <p className="mx-auto mt-3 max-w-2xl text-sm text-muted-foreground sm:text-base">
          Stock discovery, intraday ideas, and long-term outlook in one place.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          {!session ? (
            <>
              <Link href="/signup">
                <Button size="lg" className="min-w-36">Get Started</Button>
              </Link>
              <Link href="/login">
                <Button size="lg" variant="outline" className="min-w-36">Sign In</Button>
              </Link>
            </>
          ) : (
            <>
              <Link href="/discover">
                <Button size="lg" className="min-w-36">Open Discover</Button>
              </Link>
              <Link href="/compete">
                <Button size="lg" variant="outline" className="min-w-36">Open Compete</Button>
              </Link>
            </>
          )}
        </div>

        {session && (
          <div className="mt-5 flex flex-col items-center gap-2">
            <p className="text-xs text-muted-foreground">
              Signed in as {session.user?.name ?? session.user?.email ?? "Trader"}
            </p>
            <form>
              <button
                className="text-xs text-muted-foreground underline-offset-4 transition hover:text-foreground hover:underline"
                formAction={async () => {
                  "use server";
                  await auth.api.signOut({
                    headers: await headers(),
                  });
                  redirect("/");
                }}
              >
                Sign Out
              </button>
            </form>
          </div>
        )}
      </section>
    </main>
  );
}

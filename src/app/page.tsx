import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "~/components/ui/button";
import { ModeToggle } from "~/components/mode-toggle";

import { auth } from "~/server/better-auth";
import { getSession } from "~/server/better-auth/server";

export default async function Home() {
  const session = await getSession();

  return (
    <main className="relative min-h-[calc(100vh-4rem)] overflow-hidden bg-background text-foreground selection:bg-primary selection:text-primary-foreground">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-size-[40px_40px] mask-[radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)]" />
        <svg className="absolute top-1/4 left-0 h-64 w-full opacity-[0.03] dark:opacity-[0.05]" viewBox="0 0 1000 100" aria-hidden>
          <path d="M0 50 L100 45 L200 55 L300 30 L400 60 L500 40 L600 70 L700 35 L800 50 L900 45 L1000 55" fill="none" stroke="currentColor" strokeWidth="0.5" />
          <rect x="95" y="40" width="10" height="15" fill="currentColor" />
          <rect x="195" y="50" width="10" height="10" fill="currentColor" />
          <rect x="295" y="25" width="10" height="20" fill="currentColor" />
          <rect x="395" y="55" width="10" height="15" fill="currentColor" />
        </svg>
      </div>

      <section className="relative flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center px-6 pt-20 text-center">
        <div className="max-w-5xl">
          <h1 className="mb-10 bg-linear-to-b from-foreground to-foreground/50 bg-clip-text text-5xl leading-[0.95] font-bold tracking-tighter text-transparent md:text-7xl lg:text-[96px]">
            Invest with Intelligence, <br className="hidden md:block" /> Not Emotion.
          </h1>
          <p className="mx-auto mb-12 max-w-3xl text-lg leading-relaxed font-medium text-muted-foreground md:text-xl">
            Master the markets through AI-powered simulations and risk-free execution.
          </p>

          <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
            {session ? (
              <>
                <Button asChild size="lg" className="h-14 rounded-full px-10 text-xs font-bold tracking-[0.2em] uppercase shadow-2xl shadow-primary/20">
                  <Link href="/compete">Start Simulation</Link>
                </Button>
                <Button asChild variant="outline" size="lg" className="h-14 rounded-full border-border/50 px-10 text-xs font-bold tracking-[0.2em] uppercase hover:bg-secondary/50">
                  <Link href="/discover">View Scenarios</Link>
                </Button>
              </>
            ) : (
              <>
                <Button asChild size="lg" className="h-14 rounded-full px-10 text-xs font-bold tracking-[0.2em] uppercase shadow-2xl shadow-primary/20">
                  <Link href="/signup">Get Started</Link>
                </Button>
                <Button asChild variant="outline" size="lg" className="h-14 rounded-full border-border/50 px-10 text-xs font-bold tracking-[0.2em] uppercase hover:bg-secondary/50">
                  <Link href="/login">Login</Link>
                </Button>
              </>
            )}
          </div>

          {/* {session ? (
            <div className="mt-6 inline-flex items-center gap-3 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-1.5">
              <p className="text-xs text-muted-foreground">
                Signed in as {session.user?.name ?? session.user?.email ?? "Trader"}
              </p>
              <form>
                <button
                  className="text-xs text-rose-300 underline-offset-4 transition hover:text-rose-200 hover:underline"
                  formAction={async () => {
                    "use server";
                    await auth.api.signOut({ headers: await headers() });
                    redirect("/");
                  }}
                >
                  Sign Out
                </button>
              </form>
            </div>
          ) : null} */}
        </div>


        <div className="absolute right-0 bottom-12 left-0 flex justify-center opacity-20">
          <div className="flex gap-8 text-[10px] font-bold tracking-[0.2em] uppercase text-muted-foreground sm:gap-12">
            <span>High Fidelity</span>
            <span>AI Powered</span>
            <span>Risk Free</span>
          </div>
        </div>
      </section>
    </main>
  );
}

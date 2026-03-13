import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ModeToggle } from "~/components/mode-toggle";
import { Button } from "~/components/ui/button";

import { auth } from "~/server/better-auth";
import { getSession } from "~/server/better-auth/server";

export default async function Home() {
  const session = await getSession();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background">
      <div className="absolute top-4 right-4">
        <ModeToggle />
      </div>

      <div className="container flex flex-col items-center justify-center gap-12 px-4 py-16">
        <div className="text-center space-y-4">
          <h1 className="text-5xl font-bold tracking-tight">Welcome to BullIQ</h1>
          <p className="text-xl text-muted-foreground">
            {session
              ? `Logged in as ${session.user?.name}`
              : "Please sign in to continue"}
          </p>
        </div>

        <div className="flex flex-col items-center justify-center gap-4">
          {!session ? (
            <div className="flex gap-4">
              <Link href="/login">
                <Button size="lg" className="px-8">
                  Sign In
                </Button>
              </Link>
              <Link href="/signup">
                <Button size="lg" variant="outline" className="px-8">
                  Create Account
                </Button>
              </Link>
            </div>
          ) : (
            <form>
              <button
                className="rounded-full bg-red-600/80 px-10 py-3 font-semibold no-underline transition hover:bg-red-700"
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
          )}
        </div>
      </div>
    </main>
  );
}

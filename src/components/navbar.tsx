"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ModeToggle } from "~/components/mode-toggle";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { authClient } from "~/server/better-auth/client";

function getInitials(
  name: string | undefined,
  email: string | undefined,
): string {
  const source = name?.trim() || email?.trim() || "U";
  const parts = source.split(/\s+/).filter(Boolean);

  if (parts.length === 0) return "U";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();

  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}

export function Navbar() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();

  const onLogout = async () => {
    await authClient.signOut();
    router.push("/");
    router.refresh();
  };

  return (
    <nav className="border-border bg-background/95 supports-[backdrop-filter]:bg-background/60 sticky top-0 z-40 border-b backdrop-blur">
      <div className="flex h-16 items-center justify-between px-4 md:px-6">
        {/* Logo */}
        <Link href="/" className="flex items-center space-x-2">
          <div className="text-xl font-bold">NivionAI</div>
        </Link>

        {/* Navigation Items */}
        <div className="hidden items-center space-x-1 md:flex">
          <Link href="/discover">
            <Button variant="ghost" className="text-base">
              Discover
            </Button>
          </Link>
          <Link href="/compete">
            <Button variant="ghost" className="text-base">
              Compete
            </Button>
          </Link>
          <Link href="/leaderboard">
            <Button variant="ghost" className="text-base">
              Leaderboard
            </Button>
          </Link>
          <Link href="/knowledge">
            <Button variant="ghost" className="text-base">
              Learning
            </Button>
          </Link>
        </div>

        {/* Right Side - Auth & Theme Toggle */}
        <div className="flex items-center space-x-2">
          <ModeToggle />

          {isPending ? null : session?.user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="focus-visible:ring-ring rounded-full transition hover:opacity-90 focus-visible:ring-2 focus-visible:outline-none"
                  aria-label="Open user menu"
                >
                  <Avatar size="sm">
                    <AvatarImage
                      src={session.user.image ?? undefined}
                      alt={session.user.name ?? "User"}
                    />
                    <AvatarFallback>
                      {getInitials(
                        session.user.name ?? undefined,
                        session.user.email ?? undefined,
                      )}
                    </AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 bg-background">
                <DropdownMenuLabel>
                  <div className="space-y-0.5">
                    <p className="text-foreground">
                      {session.user.name ?? "User"}
                    </p>
                    <p className="text-muted-foreground">
                      {session.user.email}
                    </p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onLogout}>Logout</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <>
              <Link href="/login">
                <Button variant="outline" className="text-base">
                  Login
                </Button>
              </Link>
              <Link href="/signup">
                <Button className="text-base">Sign Up</Button>
              </Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}

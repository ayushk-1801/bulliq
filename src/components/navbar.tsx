"use client"

import React from "react"
import Link from "next/link"
import { ModeToggle } from "~/components/mode-toggle"
import { Button } from "~/components/ui/button"

export function Navbar() {
  return (
    <nav className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-16 items-center justify-between px-4 md:px-6">
        {/* Logo */}
        <Link href="/" className="flex items-center space-x-2">
          <div className="text-xl font-bold">bullIQ</div>
        </Link>

        {/* Navigation Items */}
        <div className="hidden md:flex items-center space-x-1">
          <Link href="/compete">
            <Button variant="ghost" className="text-base">
              Compete
            </Button>
          </Link>
          <Link href="/learning">
            <Button variant="ghost" className="text-base">
              Learning
            </Button>
          </Link>
        </div>

        {/* Right Side - Auth & Theme Toggle */}
        <div className="flex items-center space-x-2">
          <ModeToggle />
          <Link href="/login">
            <Button variant="outline" className="text-base">
              Login
            </Button>
          </Link>
          <Link href="/signup">
            <Button className="text-base">
              Sign Up
            </Button>
          </Link>
        </div>
      </div>
    </nav>
  )
}

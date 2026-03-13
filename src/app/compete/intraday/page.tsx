import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "~/components/ui/empty";

export const metadata: Metadata = {
  title: "Intra Day | BullIQ",
  description: "Intra day competition mode status.",
};

export default function IntradayPage() {
  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
        <Card className="border border-border/70 bg-card">
          <CardHeader>
            <CardTitle className="text-2xl font-semibold">Intra Day Competitions</CardTitle>
            <CardDescription>
              This mode is being prepared and will be available soon.
            </CardDescription>
          </CardHeader>

          <CardContent>
            <Empty className="border border-border/70 bg-muted/20 py-10">
              <EmptyHeader>
                <EmptyTitle className="text-base">No intra day challenges yet</EmptyTitle>
                <EmptyDescription>
                  Long-term competitions are live right now. You can start there and come back for
                  intra day when released.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent />
            </Empty>
          </CardContent>

          <CardFooter className="justify-end gap-2">
            <Button variant="outline" asChild>
              <Link href="/compete">Back</Link>
            </Button>
            <Button asChild>
              <Link href="/compete/long-term">Go To Long Term</Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
    </main>
  );
}

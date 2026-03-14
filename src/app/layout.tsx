import "~/styles/globals.css";

import { type Metadata } from "next";
import { Geist } from "next/font/google";
import { cn } from "~/lib/utils";
import { TooltipProvider } from "~/components/ui/tooltip";
import { ThemeProvider } from "~/components/theme-provider";
import { Navbar } from "~/components/navbar";
import { KnowledgeChatbot } from "~/components/knowledge-chatbot";

export const metadata: Metadata = {
  title: "BullIQ",
  description: "",
  icons: [{ rel: "icon", url: "/images.ico" }],
};

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={cn(geist.variable, "font-sans")}
      suppressHydrationWarning
    >
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <TooltipProvider>
            <Navbar />
            {children}
            <KnowledgeChatbot />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

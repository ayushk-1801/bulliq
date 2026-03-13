import { redirect } from "next/navigation";

type PageProps = {
  params: Promise<{
    source: string;
  }>;
};

export default async function LegacyCompeteSourcePage({ params }: PageProps) {
  const { source } = await params;

  if (source === "long-term") {
    redirect("/compete/long-term");
  }

  if (source === "intraday") {
    redirect("/compete/intraday");
  }

  redirect("/compete");
}

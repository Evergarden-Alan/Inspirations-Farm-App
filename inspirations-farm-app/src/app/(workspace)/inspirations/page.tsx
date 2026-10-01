import { InspirationFeed } from "@/features/inspirations/inspiration-feed";
import { getInspirations } from "@/lib/data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function InspirationsPage() {
  const items = await getInspirations();

  return <InspirationFeed initialItems={items} />;
}

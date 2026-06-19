import { InspirationFeed } from "./inspiration-feed";
import { DailyDashboard } from "./daily-dashboard";

export default function Home() {
  return (
    <div className="min-h-screen bg-slate-50/50 font-sans antialiased">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-white/80 backdrop-blur border-b border-slate-200/60">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <h1 className="text-xl font-semibold tracking-tight text-slate-800">
            Inspirations Farm
          </h1>
        </div>
      </header>

      {/* Two-column responsive grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 max-w-7xl mx-auto p-4">
        {/* Left — Daily Dashboard */}
        <aside className="order-1 lg:order-1">
          <DailyDashboard />
        </aside>

        {/* Right — Inspirations Pool */}
        <main className="order-2 lg:order-2">
          <InspirationFeed />
        </main>
      </div>
    </div>
  );
}

import Link from "next/link";
import { ArrowLeft, FlaskConical, Sprout } from "lucide-react";

import { ThemeToggle } from "@/app/theme-toggle";
import { FocusPlaylistLab } from "./focus-playlist-lab";

export const dynamic = "force-dynamic";

export default function FocusPlaylistLabPage() {
  return (
    <div className="farm-app min-h-screen font-sans antialiased">
      <header className="farm-header sticky top-0 z-20">
        <div className="mx-auto flex min-h-[68px] max-w-[1120px] items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <div className="farm-brand-mark" aria-hidden="true">
              <Sprout className="size-5" strokeWidth={1.8} />
            </div>
            <div className="min-w-0">
              <p className="farm-kicker hidden sm:block">FOCUS AUDIO · STAGE 0B</p>
              <h1 className="farm-display truncate text-xl font-semibold text-[var(--farm-ink)] sm:text-2xl">
                专注播放实验室
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[var(--farm-line)] bg-[var(--farm-paper)] px-3 text-sm font-medium text-[var(--farm-text)] transition-colors hover:border-[var(--farm-green)] hover:text-[var(--farm-green)]"
            >
              <ArrowLeft className="size-4" />
              <span className="hidden sm:inline">返回农场</span>
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1120px] px-4 pb-16 pt-8 sm:px-6 sm:pt-11 lg:px-8">
        <section className="mb-7 max-w-3xl">
          <div className="mb-3 flex items-center gap-2 text-[var(--farm-clay)]">
            <FlaskConical className="size-4" strokeWidth={1.8} />
            <p className="farm-kicker">PRIVATE RELAY PROBE</p>
          </div>
          <h2 className="farm-display text-[clamp(2rem,5vw,4rem)] font-medium leading-[1.05] tracking-[-0.035em] text-[var(--farm-ink)]">
            先证明声音能稳定穿过，
            <span className="block text-[var(--farm-green)]">再把它带进专注。</span>
          </h2>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-[var(--farm-muted)] sm:text-[15px]">
            此页面只验证固定示例音轨、中继鉴权、AAC 兼容性、连续播放和 Range seek；不会写入 GitHub 配置。
          </p>
        </section>

        <FocusPlaylistLab />
      </main>
    </div>
  );
}

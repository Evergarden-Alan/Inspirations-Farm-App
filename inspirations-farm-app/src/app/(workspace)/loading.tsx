export default function WorkspaceLoading() {
  return (
    <section
      aria-busy="true"
      aria-live="polite"
      className="space-y-4 rounded-3xl border border-[var(--farm-line)] bg-[var(--farm-paper)]/60 p-5"
    >
      <div className="flex items-center gap-3">
        <div className="size-10 animate-pulse rounded-2xl bg-[var(--farm-paper-deep)]" />
        <div className="space-y-2">
          <div className="h-4 w-32 animate-pulse rounded-full bg-[var(--farm-paper-deep)]" />
          <div className="h-3 w-20 animate-pulse rounded-full bg-[var(--farm-paper-deep)]" />
        </div>
      </div>
      <div className="space-y-3">
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className="h-16 animate-pulse rounded-2xl bg-[var(--farm-paper-deep)]"
          />
        ))}
      </div>
    </section>
  );
}

import Link from "next/link";

export function AppFrame({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-[#0d0f0e] text-stone-100">
      <div className="mx-auto min-h-screen w-full max-w-[1500px] px-3 py-5 sm:px-5 xl:px-8">
        {children}
      </div>
    </main>
  );
}

export function TopBar({ title, backHref, backLabel }: { title: string; backHref?: string; backLabel?: string }) {
  return (
    <header className="mb-6 border-b border-stone-800 pb-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          {backHref ? (
            <Link href={backHref} className="text-sm text-stone-500 hover:text-stone-200">
              ← {backLabel ?? "Back"}
            </Link>
          ) : (
            <Link href="/" className="text-sm font-semibold text-stone-500 hover:text-stone-200">
              ThreadWise
            </Link>
          )}
          <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-stone-50 sm:text-4xl">{title}</h1>
        </div>
      </div>
    </header>
  );
}

export function StatusBadge({ value }: { value: string }) {
  return <span className="rounded-full bg-stone-800 px-2.5 py-1 text-xs text-stone-300">{value}</span>;
}

export function PriorityBadge({ value }: { value: string }) {
  return <span className="rounded-full bg-stone-900 px-2.5 py-1 text-xs text-stone-400">{value}</span>;
}

export function formatDate(value: Date | string | null) {
  if (!value) return "No activity";

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

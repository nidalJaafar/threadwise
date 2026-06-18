import Link from "next/link";

import { AppFrame, PriorityBadge, StatusBadge, TopBar, formatDate } from "~/app/_components/threadwise-ui";
import { api } from "~/trpc/server";

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const query = q?.trim() ?? "";
  const results = query ? await api.threadwise.search({ query }) : [];

  return (
    <AppFrame>
      <TopBar title="Search" backHref="/" backLabel="Clients" />

      <form className="mb-4 flex gap-2" action="/search">
        <input
          name="q"
          defaultValue={query}
          placeholder="Search threads, clients, senders, or message text"
          className="min-w-0 flex-1 rounded-2xl border border-stone-800 bg-stone-950 px-4 py-3 text-stone-100 outline-none focus:border-[#c7ab6b]"
        />
        <button className="rounded-2xl bg-[#c7ab6b] px-5 py-3 text-sm font-semibold text-stone-950" type="submit">
          Search
        </button>
      </form>

      {query ? (
        <p className="mb-4 text-sm text-stone-500">{results.length} local results for &ldquo;{query}&rdquo;</p>
      ) : (
        <p className="mb-4 text-sm text-stone-500">Search uses only locally imported, non-ignored threads.</p>
      )}

      <div className="space-y-2">
        {results.map((thread) => (
          <Link
            key={thread.id}
            href={`/threads/${thread.id}`}
            className="block rounded-2xl border border-stone-800 bg-stone-950 px-4 py-4 transition hover:border-stone-600 hover:bg-stone-900"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-lg font-semibold text-stone-50">{thread.topic}</h2>
                <p className="mt-1 text-sm text-stone-500">{thread.clientName ?? "No client"} · {thread.subject}</p>
                <p className="mt-2 line-clamp-2 text-sm leading-6 text-stone-500">{thread.snippet}</p>
              </div>
              <span className="shrink-0 text-sm text-stone-600">{formatDate(thread.lastMessageAt)}</span>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <StatusBadge value={thread.status} />
              <PriorityBadge value={thread.priority} />
              <span className="text-stone-600">From {thread.latestSenderName}</span>
              {thread.latestSenderEmail && <span className="text-stone-700">{thread.latestSenderEmail}</span>}
            </div>
          </Link>
        ))}
      </div>
    </AppFrame>
  );
}

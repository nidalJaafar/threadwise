import Link from "next/link";

import { GmailSyncControl } from "~/app/_components/gmail-sync-control";
import { AppFrame, PriorityBadge, StatusBadge, TopBar, formatDate } from "~/app/_components/threadwise-ui";
import { HydrateClient, api } from "~/trpc/server";

export default async function Home({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const query = q?.trim() ?? "";
  const [dashboard, gmailStatus, searchResults] = await Promise.all([
    api.threadwise.dashboard(),
    api.gmail.connectionStatus(),
    query ? api.threadwise.search({ query }) : Promise.resolve([]),
  ]);

  return (
    <HydrateClient>
      <AppFrame>
        <TopBar title="Clients" />

        <GmailSyncControl status={gmailStatus} />

        <form className="mb-4 flex gap-2" action="/">
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

        <div className="mb-4 flex justify-end gap-4">
          {query && (
            <Link href="/" className="text-sm text-stone-500 hover:text-stone-200">
              Clear search
            </Link>
          )}
          <Link href="/date" className="text-sm text-stone-500 hover:text-stone-200">
            Today&apos;s threads →
          </Link>
          <Link href="/ignored" className="text-sm text-stone-500 hover:text-stone-200">
            View ignored emails →
          </Link>
        </div>

        {query && (
          <section className="mb-6">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-[0.25em] text-stone-500">Search Results</h2>
              <span className="text-sm text-stone-600">{searchResults.length} for &ldquo;{query}&rdquo;</span>
            </div>

            {searchResults.length ? (
              <div className="space-y-2">
                {searchResults.map((thread) => (
                  <Link
                    key={thread.id}
                    href={`/threads/${thread.id}`}
                    className="block rounded-2xl border border-stone-800 bg-stone-950 px-4 py-4 transition hover:border-stone-600 hover:bg-stone-900"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-lg font-semibold text-stone-50">{thread.topic}</h3>
                        <p className="mt-1 text-sm text-stone-500">{thread.clientName ?? "No client"} · {thread.subject}</p>
                        <p className="mt-2 line-clamp-2 text-sm leading-6 text-stone-500">{thread.snippet}</p>
                      </div>
                      <span className="shrink-0 text-sm text-stone-600">{formatDate(thread.lastMessageAt)}</span>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                      <StatusBadge value={thread.status} />
                      <PriorityBadge value={thread.priority} />
                      <span className="text-stone-600">From {thread.latestSenderName}</span>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-stone-800 bg-stone-950 p-6 text-center text-sm text-stone-500">
                No local threads matched this search.
              </div>
            )}
          </section>
        )}

        <div className="space-y-2">
          {dashboard.clients.map((client) => (
            <Link
              key={client.id}
              href={`/clients/${client.id}`}
              className="flex items-center justify-between gap-4 rounded-2xl border border-stone-800 bg-stone-950 px-4 py-4 transition hover:border-stone-600 hover:bg-stone-900"
            >
              <div className="min-w-0">
                <h2 className="truncate text-lg font-semibold text-stone-50">{client.name}</h2>
                <p className="mt-1 text-sm text-stone-500">
                  {client.totalCount} threads · {client.waitingOnMeCount} waiting on me · last {formatDate(client.lastActivityAt)}
                </p>
              </div>
              <span className="text-stone-600">→</span>
            </Link>
          ))}
        </div>
      </AppFrame>
    </HydrateClient>
  );
}

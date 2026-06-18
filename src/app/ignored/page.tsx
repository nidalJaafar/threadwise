import Link from "next/link";

import { IgnoreRuleManager, IgnoredThreadActions } from "~/app/ignored/ignored-actions";
import { AppFrame, TopBar, formatDate } from "~/app/_components/threadwise-ui";
import { api } from "~/trpc/server";

export default async function IgnoredPage() {
  const [threads, rules] = await Promise.all([
    api.threadwise.ignoredThreads(),
    api.threadwise.ignoreRules(),
  ]);

  return (
    <AppFrame>
      <TopBar title="Ignored Emails" backHref="/" backLabel="Clients" />

      <div className="mb-4 rounded-2xl border border-stone-800 bg-stone-950 p-4 text-sm text-stone-500">
        These threads are hidden from normal client views and sync notifications. They are kept locally so you can audit ignore rules.
      </div>

      <IgnoreRuleManager rules={rules} />

      {threads.length ? (
        <div className="space-y-2">
          {threads.map((thread) => (
            <div
              key={thread.id}
              className="rounded-2xl border border-stone-800 bg-stone-950 px-4 py-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <Link href={`/threads/${thread.id}`} className="block truncate text-lg font-semibold text-stone-50 hover:text-[#c7ab6b]">
                    {thread.topic}
                  </Link>
                  <p className="mt-1 text-sm text-stone-500">{thread.subject}</p>
                  <p className="mt-2 line-clamp-2 text-sm leading-6 text-stone-500">{thread.snippet}</p>
                </div>
                <span className="shrink-0 text-sm text-stone-600">{formatDate(thread.lastMessageAt)}</span>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full bg-stone-900 px-2.5 py-1 text-stone-400">{thread.ignoredReason}</span>
                <span className="text-stone-600">From {thread.latestSenderName}</span>
                {thread.latestSenderEmail && <span className="text-stone-700">{thread.latestSenderEmail}</span>}
                <IgnoredThreadActions threadId={thread.id} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-stone-800 bg-stone-950 p-8 text-center">
          <h2 className="text-lg font-semibold text-stone-200">No ignored emails yet</h2>
          <p className="mt-2 text-sm text-stone-500">Ignored GitLab, Jira, calendar, meeting, and notification emails will appear here.</p>
        </div>
      )}
    </AppFrame>
  );
}

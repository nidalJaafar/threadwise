import { AppFrame, PriorityBadge, StatusBadge, TopBar } from "~/app/_components/threadwise-ui";
import { MetadataForm } from "~/app/threads/[id]/metadata-form";
import { ThreadIgnoreActions } from "~/app/threads/[id]/thread-ignore-actions";
import { ThreadMainView } from "~/app/threads/[id]/thread-main-view";
import { api } from "~/trpc/server";

export default async function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [thread, clients] = await Promise.all([
    api.threadwise.threadById({ id }),
    api.threadwise.clients(),
  ]);
  const backHref = thread.clientId ? `/clients/${thread.clientId}` : "/";

  return (
    <AppFrame>
      <TopBar title={thread.topic} backHref={backHref} backLabel={thread.client?.name ?? "Clients"} />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge value={thread.status} />
          <PriorityBadge value={thread.priority} />
          <span className="text-sm text-stone-500">Waiting on {thread.waitingOn}</span>
        </div>
        <a
          href={thread.gmailUrl ?? "https://mail.google.com"}
          target="_blank"
          rel="noreferrer"
          className="rounded-full border border-stone-700 px-3 py-1.5 text-sm text-stone-300 hover:border-stone-500 hover:text-stone-50"
        >
          Open in Gmail
        </a>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_26rem] xl:items-start">
        <ThreadMainView thread={thread} />

        <aside className="order-first xl:sticky xl:top-4 xl:order-none xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto xl:overscroll-contain xl:pr-2">
          <MetadataForm thread={thread} clients={clients} />
          <ThreadIgnoreActions threadId={thread.id} domains={thread.participants.domains} />
        </aside>
      </div>

      <section className="mt-4">
        <details className="rounded-2xl border border-stone-800 bg-stone-950 p-4">
          <summary className="cursor-pointer text-sm font-semibold text-stone-300">Details, participants, attachments, and raw source</summary>

          <div className="mt-4 space-y-5 border-t border-stone-800 pt-4">
            <div>
              <h2 className="text-sm font-semibold text-stone-200">Participants</h2>
              <div className="mt-2 grid gap-3 md:grid-cols-2">
                {thread.intelligence.participantGroups.map((group) => (
                  <div key={group.domain} className="rounded-xl bg-stone-900 p-3">
                    <h3 className="text-sm font-semibold text-stone-300">{group.domain}</h3>
                    <div className="mt-2 space-y-1">
                      {group.contacts.map((contact) => (
                        <p key={contact.email} className="truncate text-xs text-stone-500">
                          {contact.name ? `${contact.name} · ` : ""}{contact.email}
                        </p>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h2 className="text-sm font-semibold text-stone-200">Attachments</h2>
              {thread.attachments.length ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {thread.attachments.map((attachment) => (
                    <span key={attachment.id} className="rounded-full bg-stone-900 px-3 py-1.5 text-xs text-stone-400">
                      {attachment.filename} · {(attachment.size / 1024).toFixed(1)} KB
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-sm text-stone-600">No attachments.</p>
              )}
            </div>

            <details>
              <summary className="cursor-pointer text-sm font-semibold text-stone-300">Raw email bodies</summary>
              <div className="mt-3 space-y-3">
                {thread.messages.map((message) => (
                  <pre key={message.id} className="overflow-x-auto rounded-xl bg-black p-3 text-xs leading-5 text-stone-500">
                    {message.rawBody}
                  </pre>
                ))}
              </div>
            </details>
          </div>
        </details>
      </section>
    </AppFrame>
  );
}

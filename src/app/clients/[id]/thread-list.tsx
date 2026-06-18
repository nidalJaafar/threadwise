"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { PriorityBadge, StatusBadge, formatDate } from "~/app/_components/threadwise-ui";
import { DomainOwnershipBadge, DomainRepairActions } from "~/app/clients/[id]/domain-repair-actions";
import { api, type RouterOutputs } from "~/trpc/react";

type ClientPageData = Extract<RouterOutputs["threadwise"]["clientById"], { deleted: false }>;
type ClientOption = RouterOutputs["threadwise"]["clients"][number];
type DomainRule = RouterOutputs["threadwise"]["domainRules"][number];
type Thread = ClientPageData["threads"][number];

export function ThreadList({
  currentClientName,
  threads,
  clients,
  domainRules,
}: {
  currentClientName: string;
  threads: Thread[];
  clients: ClientOption[];
  domainRules: DomainRule[];
}) {
  return (
    <div className="space-y-2">
      {threads.map((thread) => (
        <ThreadRow key={thread.id} currentClientName={currentClientName} thread={thread} clients={clients} domainRules={domainRules} />
      ))}
    </div>
  );
}

function ThreadRow({
  currentClientName,
  thread,
  clients,
  domainRules,
}: {
  currentClientName: string;
  thread: Thread;
  clients: ClientOption[];
  domainRules: DomainRule[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [clientId, setClientId] = useState("");
  const [rememberDomains, setRememberDomains] = useState(true);

  const quickAssign = api.threadwise.quickAssignThread.useMutation({
    onSuccess: () => {
      startTransition(() => router.refresh());
    },
  });
  const ignoreThread = api.threadwise.ignoreThread.useMutation({
    onSuccess: () => {
      startTransition(() => router.refresh());
    },
  });

  const showQuickAssign = currentClientName === "Unknown / Unsorted" || thread.status === "Unknown";
  const participantDomains = thread.participants.domains.slice(0, 6);

  return (
    <article className="rounded-2xl border border-stone-800 bg-stone-950 px-4 py-4 transition hover:border-stone-600 hover:bg-stone-900">
      <Link href={`/threads/${thread.id}`} className="block">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold text-stone-50">{thread.topic}</h2>
            <p className="mt-1 line-clamp-2 text-sm leading-6 text-stone-500">{thread.snippet}</p>
          </div>
          <span className="shrink-0 text-sm text-stone-600">{formatDate(thread.lastMessageAt)}</span>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <StatusBadge value={thread.status} />
          <PriorityBadge value={thread.priority} />
          <span className="text-xs text-stone-600">Waiting on {thread.waitingOn}</span>
        </div>
      </Link>

      <div className="mt-3 flex justify-end border-t border-stone-900 pt-3">
        <button
          type="button"
          disabled={ignoreThread.isPending || isPending}
          onClick={() => ignoreThread.mutate({ threadId: thread.id })}
          className="rounded-full border border-red-950/80 px-3 py-1.5 text-xs font-semibold text-red-300 hover:border-red-800 disabled:cursor-wait disabled:opacity-50"
        >
          {ignoreThread.isPending || isPending ? "Ignoring..." : "Ignore thread"}
        </button>
      </div>

      {participantDomains.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-stone-900 pt-3">
          {showQuickAssign
            ? participantDomains.map((domain) => <DomainRepairActions key={domain} domain={domain} clients={clients} domainRules={domainRules} />)
            : participantDomains.map((domain) => (
                <DomainOwnershipBadge key={domain} domain={domain} domainRules={domainRules} />
              ))}
        </div>
      )}

      {showQuickAssign && (
        <form
          className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-stone-800 bg-black/20 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!clientId) return;
            quickAssign.mutate({
              threadId: thread.id,
              clientId,
              domains: rememberDomains ? thread.participants.domains : [],
              contacts: [],
            });
          }}
        >
          <select
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
            className="min-w-48 rounded-xl border border-stone-800 bg-stone-950 px-3 py-2 text-sm text-stone-100 outline-none focus:border-[#c7ab6b]"
          >
            <option value="">Assign to client...</option>
            {clients
              .filter((client) => client.name !== "Unknown / Unsorted")
              .map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
          </select>
          <label className="flex items-center gap-2 text-sm text-stone-500">
            <input
              type="checkbox"
              checked={rememberDomains}
              onChange={(event) => setRememberDomains(event.target.checked)}
              className="accent-[#c7ab6b]"
            />
            remember domains
          </label>
          <button
            type="submit"
            disabled={!clientId || quickAssign.isPending || isPending}
            className="rounded-xl bg-[#d7bd79] px-3 py-2 text-sm font-semibold text-stone-950 disabled:cursor-wait disabled:opacity-50"
          >
            {quickAssign.isPending || isPending ? "Assigning..." : "Assign"}
          </button>
        </form>
      )}
    </article>
  );
}

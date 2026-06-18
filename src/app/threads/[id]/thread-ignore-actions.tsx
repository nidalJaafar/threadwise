"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { api } from "~/trpc/react";

export function ThreadIgnoreActions({ threadId, domains }: { threadId: string; domains: string[] }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const ignoreThread = api.threadwise.ignoreThread.useMutation({
    onSuccess: () => {
      setMessage("Thread ignored. It is hidden from normal client views and remains available in Ignored Emails.");
      startTransition(() => router.refresh());
    },
  });
  const ignoreDomain = api.threadwise.ignoreThreadDomain.useMutation({
    onSuccess: (result) => {
      if (result.currentThreadIgnored) {
        setMessage("Domain saved as noise. This thread is now hidden from normal client views.");
        startTransition(() => router.refresh());
        return;
      }

      setMessage(`Saved as noise. Ignored ${result.ignored}, kept ${result.kept}, reclassified ${result.reclassified}.`);
      startTransition(() => router.refresh());
    },
  });

  const usableDomains = domains.filter(Boolean);

  return (
    <div className="mt-4 rounded-[2rem] border border-stone-800 bg-stone-950/70 p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.25em] text-stone-500">Noise control</p>
      <h2 className="mt-1 text-xl font-semibold tracking-[-0.04em]">Ignore email noise</h2>
      <p className="mt-2 text-sm text-stone-500">Hide only this thread, or mark a domain as noise. Mixed client threads stay visible and are reclassified.</p>

      <button
        type="button"
        disabled={ignoreThread.isPending}
        onClick={() => ignoreThread.mutate({ threadId })}
        className="mt-4 w-full rounded-2xl border border-red-950/80 px-4 py-3 text-sm font-semibold text-red-200 transition hover:border-red-800 hover:text-red-100 disabled:cursor-wait disabled:opacity-50"
      >
        {ignoreThread.isPending ? "Ignoring..." : "Ignore this thread"}
      </button>

      {usableDomains.length > 0 && (
        <div className="mt-4 border-t border-stone-800 pt-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-stone-600">Ignore domain-only noise</p>
          <div className="flex flex-wrap gap-2">
            {usableDomains.map((domain) => (
              <button
                key={domain}
                type="button"
                disabled={ignoreDomain.isPending || isPending}
                onClick={() => ignoreDomain.mutate({ threadId, domain })}
                className="rounded-full border border-stone-700 px-3 py-1.5 text-xs font-semibold text-stone-300 hover:border-stone-500 hover:text-stone-50 disabled:cursor-wait disabled:opacity-50"
              >
                Ignore {domain} noise
              </button>
            ))}
          </div>
        </div>
      )}

      {ignoreThread.error && <p className="mt-3 text-sm text-red-300">{ignoreThread.error.message}</p>}
      {ignoreDomain.error && <p className="mt-3 text-sm text-red-300">{ignoreDomain.error.message}</p>}
      {message && <p className="mt-3 text-sm text-stone-400">{message}</p>}
    </div>
  );
}

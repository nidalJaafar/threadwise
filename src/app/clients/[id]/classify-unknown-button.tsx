"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { api, type RouterOutputs } from "~/trpc/react";

type Result = RouterOutputs["threadwise"]["classifyUnknownClientThreads"];

export function ClassifyUnknownButton({ clientId, threadCount }: { clientId: string; threadCount: number }) {
  const router = useRouter();
  const [result, setResult] = useState<Result | null>(null);
  const [isPending, startTransition] = useTransition();
  const classify = api.threadwise.classifyUnknownClientThreads.useMutation({
    onSuccess: (nextResult) => {
      setResult(nextResult);
      startTransition(() => router.refresh());
    },
  });

  return (
    <section className="mb-4 rounded-2xl border border-[#c7ab6b]/30 bg-[#c7ab6b]/10 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.25em] text-[#d7bd79]">AI Client Classification</h2>
          <p className="mt-2 text-sm text-stone-400">
            Classify unknown threads using only participant domains and subject. No message bodies or individual email addresses are sent.
          </p>
        </div>
        <button
          type="button"
          disabled={threadCount === 0 || classify.isPending || isPending}
          onClick={() => classify.mutate({ clientId, maxThreads: 100 })}
          className="rounded-2xl bg-[#d7bd79] px-4 py-3 text-sm font-semibold text-stone-950 transition hover:bg-[#e2ca8c] disabled:cursor-wait disabled:opacity-50"
        >
          {classify.isPending || isPending ? "Classifying..." : "AI classify unknown threads"}
        </button>
      </div>

      {result && (
        <p className="mt-3 text-sm text-stone-400">
          Checked {result.checked}. Classified {result.classified}. Left unknown {result.leftUnknown}. Failed {result.failed}.
        </p>
      )}

      {classify.error && <p className="mt-3 text-sm text-red-300">{classify.error.message}</p>}
    </section>
  );
}

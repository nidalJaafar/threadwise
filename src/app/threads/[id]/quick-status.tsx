"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { api } from "~/trpc/react";

const statuses = ["Waiting on Me", "Waiting on Client", "In Progress", "Resolved"] as const;

export function QuickStatus({ threadId, currentStatus }: { threadId: string; currentStatus: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const updateStatus = api.threadwise.updateThreadStatus.useMutation({
    onSuccess: () => startTransition(() => router.refresh()),
  });

  return (
    <div className="flex flex-wrap gap-2">
      {statuses.map((status) => (
        <button
          key={status}
          type="button"
          disabled={status === currentStatus || updateStatus.isPending || isPending}
          onClick={() => updateStatus.mutate({ threadId, status })}
          className="rounded-full border border-stone-800 px-3 py-1.5 text-xs font-semibold text-stone-400 transition hover:border-stone-600 hover:text-stone-100 disabled:cursor-default disabled:border-[#d7bd79]/30 disabled:bg-[#d7bd79]/10 disabled:text-[#e8d08a]"
        >
          {status}
        </button>
      ))}
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";

import { api } from "~/trpc/react";

export function DeleteEmptyClientButton({ clientId }: { clientId: string }) {
  const router = useRouter();
  const deleteClient = api.threadwise.deleteEmptyClient.useMutation({
    onSuccess: () => router.push("/"),
  });

  return (
    <section className="mb-4 rounded-2xl border border-red-950/80 bg-red-950/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.25em] text-red-300">Empty client</h2>
          <p className="mt-2 text-sm text-stone-400">This client has no threads. You can safely delete it.</p>
        </div>
        <button
          type="button"
          disabled={deleteClient.isPending}
          onClick={() => deleteClient.mutate({ clientId })}
          className="rounded-2xl border border-red-800 px-4 py-2 text-sm font-semibold text-red-200 hover:border-red-600 disabled:cursor-wait disabled:opacity-50"
        >
          {deleteClient.isPending ? "Deleting..." : "Delete client"}
        </button>
      </div>
      {deleteClient.error && <p className="mt-3 text-sm text-red-300">{deleteClient.error.message}</p>}
    </section>
  );
}

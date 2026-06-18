"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { api, type RouterOutputs } from "~/trpc/react";

type Rules = RouterOutputs["threadwise"]["ignoreRules"];
type RuleType = "sender_email_contains" | "sender_domain_contains" | "subject_contains" | "subject_starts_with";

export function IgnoredThreadActions({ threadId }: { threadId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const unignore = api.threadwise.unignoreThread.useMutation({
    onSuccess: () => startTransition(() => router.refresh()),
  });

  return (
    <button
      type="button"
      disabled={unignore.isPending || isPending}
      onClick={(event) => {
        event.preventDefault();
        unignore.mutate({ threadId });
      }}
      className="rounded-full border border-stone-700 px-3 py-1 text-xs font-semibold text-stone-300 hover:border-stone-500 hover:text-stone-50 disabled:cursor-wait disabled:opacity-50"
    >
      {unignore.isPending || isPending ? "Restoring..." : "Unignore"}
    </button>
  );
}

export function IgnoreRuleManager({ rules }: { rules: Rules }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState({
    type: "sender_domain_contains" as RuleType,
    value: "",
    reason: "",
  });
  const createRule = api.threadwise.createIgnoreRule.useMutation({
    onSuccess: () => {
      setForm((current) => ({ ...current, value: "", reason: "" }));
      startTransition(() => router.refresh());
    },
  });
  const disableRule = api.threadwise.disableIgnoreRule.useMutation({
    onSuccess: () => startTransition(() => router.refresh()),
  });
  const deleteRule = api.threadwise.deleteIgnoreRule.useMutation({
    onSuccess: () => startTransition(() => router.refresh()),
  });

  return (
    <details className="mb-4 rounded-2xl border border-stone-800 bg-stone-950 p-4">
      <summary className="cursor-pointer text-sm font-semibold text-stone-300">Ignore rules</summary>

      <form
        className="mt-4 grid gap-2 border-t border-stone-800 pt-4 md:grid-cols-[14rem_minmax(0,1fr)_minmax(0,1fr)_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          createRule.mutate(form);
        }}
      >
        <select
          value={form.type}
          onChange={(event) => setForm((current) => ({ ...current, type: event.target.value as RuleType }))}
          className="rounded-xl border border-stone-800 bg-black/30 px-3 py-2 text-sm text-stone-100 outline-none focus:border-[#c7ab6b]"
        >
          <option value="sender_domain_contains">Sender domain contains</option>
          <option value="sender_email_contains">Sender email contains</option>
          <option value="subject_contains">Subject contains</option>
          <option value="subject_starts_with">Subject starts with</option>
        </select>
        <input
          value={form.value}
          onChange={(event) => setForm((current) => ({ ...current, value: event.target.value }))}
          placeholder="example.com"
          className="rounded-xl border border-stone-800 bg-black/30 px-3 py-2 text-sm text-stone-100 outline-none focus:border-[#c7ab6b]"
        />
        <input
          value={form.reason}
          onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))}
          placeholder="Optional reason"
          className="rounded-xl border border-stone-800 bg-black/30 px-3 py-2 text-sm text-stone-100 outline-none focus:border-[#c7ab6b]"
        />
        <button
          type="submit"
          disabled={!form.value.trim() || createRule.isPending || isPending}
          className="rounded-xl bg-stone-100 px-4 py-2 text-sm font-semibold text-stone-950 disabled:cursor-wait disabled:opacity-50"
        >
          Add rule
        </button>
      </form>

      <div className="mt-4 space-y-2">
        {rules.map((rule) => (
          <div key={rule.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-stone-900 px-3 py-2 text-sm">
            <div className="min-w-0">
              <p className="text-stone-200">{rule.type}: <span className="text-stone-400">{rule.value}</span></p>
              <p className="text-xs text-stone-600">{rule.enabled ? "Enabled" : "Disabled"} · {rule.source} · {rule.reason}</p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={!rule.enabled || disableRule.isPending || isPending}
                onClick={() => disableRule.mutate({ ruleId: rule.id })}
                className="rounded-full border border-stone-700 px-3 py-1 text-xs text-stone-300 disabled:opacity-40"
              >
                Disable
              </button>
              <button
                type="button"
                disabled={deleteRule.isPending || isPending}
                onClick={() => deleteRule.mutate({ ruleId: rule.id })}
                className="rounded-full border border-red-950/80 px-3 py-1 text-xs text-red-300 disabled:opacity-40"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      <p className="mt-4 text-xs text-stone-600">All ignore rules are stored in the local database. Built-in defaults are inserted as database rows and can be disabled here.</p>
    </details>
  );
}

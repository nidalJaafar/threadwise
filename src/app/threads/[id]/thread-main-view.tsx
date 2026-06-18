"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { ChatView } from "~/app/threads/[id]/chat-view";
import { api, type RouterOutputs } from "~/trpc/react";

type Thread = RouterOutputs["threadwise"]["threadById"];

export function ThreadMainView({ thread }: { thread: Thread }) {
  const [view, setView] = useState<"chat" | "summary">("chat");

  return (
    <section className="rounded-2xl border border-stone-800 bg-stone-950 p-4 sm:p-5">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-stone-800 pb-4">
        <p className="min-w-0 flex-1 truncate text-sm text-stone-500">{thread.subject}</p>
        <div className="flex rounded-full border border-stone-800 bg-black/20 p-1">
          <ToggleButton active={view === "chat"} onClick={() => setView("chat")}>Chat</ToggleButton>
          <ToggleButton active={view === "summary"} onClick={() => setView("summary")}>AI Summary</ToggleButton>
        </div>
      </div>

      {view === "chat" ? <ChatView messages={thread.messages} /> : <AnalysisView thread={thread} onAnalyzed={() => setView("summary")} />}
    </section>
  );
}

function ToggleButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-sm font-semibold transition ${active ? "bg-[#d7bd79] text-stone-950" : "text-stone-500 hover:text-stone-200"}`}
    >
      {children}
    </button>
  );
}

function AnalysisView({ thread, onAnalyzed }: { thread: Thread; onAnalyzed: () => void }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const analyze = api.threadwise.analyzeThread.useMutation({
    onSuccess: () => {
      setMessage("Analysis saved locally.");
      onAnalyzed();
      startTransition(() => router.refresh());
    },
    onError: (error) => setMessage(error.message),
  });

  return (
    <div className="min-h-[28rem]">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-[-0.04em] text-stone-100">AI Summary</h2>
          <p className="mt-1 text-sm text-stone-500">Opt-in analysis. Sends cleaned message text from this thread to OpenAI.</p>
        </div>
        <button
          type="button"
          disabled={analyze.isPending || isPending}
          onClick={() => analyze.mutate({ threadId: thread.id })}
          className="rounded-full bg-[#d7bd79] px-4 py-2 text-sm font-semibold text-stone-950 disabled:cursor-wait disabled:opacity-60"
        >
          {analyze.isPending || isPending ? "Analyzing..." : thread.analysis ? "Re-analyze" : "Analyze thread"}
        </button>
      </div>

      {message && <p className="mb-4 rounded-xl border border-stone-800 bg-black/20 p-3 text-sm text-stone-500">{message}</p>}

      {thread.analysis ? (
        <div className="space-y-5">
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-[0.25em] text-stone-600">Summary</h3>
            <p className="mt-2 max-w-4xl text-base leading-7 text-stone-200">{thread.analysis.summary}</p>
          </section>

          <div className="grid gap-3 md:grid-cols-2">
            <Info label="Current status" value={thread.analysis.currentStatus} />
            <Info label="Suggested status" value={thread.analysis.suggestedStatus} />
          </div>

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-[0.25em] text-stone-600">Actions</h3>
            {thread.actions.length ? (
              <div className="mt-2 space-y-2">
                {thread.actions.map((action) => (
                  <div key={action.id} className="rounded-xl bg-stone-900 p-3 text-sm text-stone-300">
                    <p>{action.description} <span className="text-stone-600">({action.owner})</span></p>
                    {action.sourceQuote && <p className="mt-2 border-l border-stone-700 pl-3 text-xs italic text-stone-500">{action.sourceQuote}</p>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-sm text-stone-600">No actions extracted.</p>
            )}
          </section>

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-[0.25em] text-stone-600">Decisions</h3>
            {thread.decisions.length ? (
              <div className="mt-2 space-y-2">
                {thread.decisions.map((decision) => (
                  <div key={decision.id} className="rounded-xl bg-stone-900 p-3 text-sm text-stone-300">
                    <p>{decision.decision}</p>
                    {decision.sourceQuote && <p className="mt-2 border-l border-stone-700 pl-3 text-xs italic text-stone-500">{decision.sourceQuote}</p>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-sm text-stone-600">No decisions extracted.</p>
            )}
          </section>

          {thread.analysis.risks.length > 0 && <List title="Risks / blockers" items={thread.analysis.risks} />}

          {thread.analysis.entities.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-[0.25em] text-stone-600">Entities</h3>
              <div className="mt-2 flex flex-wrap gap-2">
                {thread.analysis.entities.map((entity) => (
                  <span key={entity} className="rounded-full bg-stone-900 px-3 py-1 text-xs text-stone-400">{entity}</span>
                ))}
              </div>
            </section>
          )}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-stone-800 bg-black/20 p-8 text-center">
          <h3 className="text-lg font-semibold text-stone-200">No analysis yet</h3>
          <p className="mt-2 text-sm text-stone-500">Analyze this thread to generate a summary, actions, decisions, risks, and entities.</p>
        </div>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-stone-900 p-3">
      <div className="text-xs text-stone-600">{label}</div>
      <div className="mt-1 text-sm font-semibold text-stone-300">{value}</div>
    </div>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-[0.25em] text-stone-600">{title}</h3>
      <div className="mt-2 space-y-2">
        {items.map((item) => (
          <p key={item} className="rounded-xl bg-stone-900 p-3 text-sm text-stone-400">{item}</p>
        ))}
      </div>
    </section>
  );
}

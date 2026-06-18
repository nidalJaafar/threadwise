"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { api, type RouterOutputs } from "~/trpc/react";

type Thread = RouterOutputs["threadwise"]["threadById"];
type Client = RouterOutputs["threadwise"]["clients"][number];

const statuses = [
  "Waiting on Me",
  "Waiting on Client",
  "Waiting on Internal Team",
  "In Progress",
  "Blocked",
  "Resolved",
  "Unknown",
];

const priorities = ["High", "Medium", "Low"];

export function MetadataForm({ thread, clients }: { thread: Thread; clients: Client[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState({
    clientId: thread.clientId,
    topic: thread.topic,
    status: thread.status,
    priority: thread.priority,
    waitingOn: thread.waitingOn,
    owner: thread.owner,
  });
  const [newClientName, setNewClientName] = useState("");
  const [selectedDomains, setSelectedDomains] = useState<string[]>([]);
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);

  const update = api.threadwise.updateThreadMetadata.useMutation({
    onSuccess: () => {
      startTransition(() => router.refresh());
    },
  });

  const createClient = api.threadwise.createClient.useMutation({
    onSuccess: (client) => {
      setForm((current) => ({ ...current, clientId: client.id }));
      setNewClientName("");
      startTransition(() => router.refresh());
    },
  });

  const learnParticipants = api.threadwise.learnThreadParticipants.useMutation({
    onSuccess: () => {
      setSelectedDomains([]);
      setSelectedContacts([]);
      startTransition(() => router.refresh());
    },
  });

  return (
    <form
      className="rounded-[2rem] border border-stone-800 bg-stone-950/70 p-5"
      onSubmit={(event) => {
        event.preventDefault();
        update.mutate({ threadId: thread.id, ...form });
      }}
    >
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-stone-500">Manual correction</p>
      <h2 className="mt-1 text-xl font-semibold tracking-[-0.04em]">Fix AI metadata</h2>

      <div className="mt-5 space-y-4">
        <label className="block text-sm text-stone-400">
          <span>Client</span>
          <select
            value={form.clientId ?? ""}
            onChange={(event) => setForm((current) => ({ ...current, clientId: event.target.value || null }))}
            className="mt-2 w-full rounded-2xl border border-stone-800 bg-black/30 px-3 py-2 text-stone-100 outline-none focus:border-[#c7ab6b]"
          >
            <option value="">No client</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
        </label>

        <div className="rounded-2xl border border-stone-800 bg-black/20 p-3">
          <label className="block text-sm text-stone-400">
            <span>Create client</span>
            <div className="mt-2 flex gap-2">
              <input
                value={newClientName}
                onChange={(event) => setNewClientName(event.target.value)}
                placeholder="Warba Google Pay"
                className="min-w-0 flex-1 rounded-xl border border-stone-800 bg-black/30 px-3 py-2 text-stone-100 outline-none focus:border-[#c7ab6b]"
              />
              <button
                type="button"
                disabled={!newClientName.trim() || createClient.isPending}
                onClick={() => createClient.mutate({ name: newClientName, threadId: thread.id })}
                className="rounded-xl bg-stone-100 px-3 py-2 text-xs font-semibold text-stone-950 disabled:opacity-50"
              >
                Create
              </button>
            </div>
          </label>
        </div>

        <label className="block text-sm text-stone-400">
          <span>Topic</span>
          <input
            value={form.topic}
            onChange={(event) => setForm((current) => ({ ...current, topic: event.target.value }))}
            className="mt-2 w-full rounded-2xl border border-stone-800 bg-black/30 px-3 py-2 text-stone-100 outline-none focus:border-[#c7ab6b]"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm text-stone-400">
            <span>Status</span>
            <select
              value={form.status}
              onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}
              className="mt-2 w-full rounded-2xl border border-stone-800 bg-black/30 px-3 py-2 text-stone-100 outline-none focus:border-[#c7ab6b]"
            >
              {statuses.map((status) => (
                <option key={status}>{status}</option>
              ))}
            </select>
          </label>

          <label className="block text-sm text-stone-400">
            <span>Priority</span>
            <select
              value={form.priority}
              onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value }))}
              className="mt-2 w-full rounded-2xl border border-stone-800 bg-black/30 px-3 py-2 text-stone-100 outline-none focus:border-[#c7ab6b]"
            >
              {priorities.map((priority) => (
                <option key={priority}>{priority}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm text-stone-400">
            <span>Waiting on</span>
            <input
              value={form.waitingOn}
              onChange={(event) => setForm((current) => ({ ...current, waitingOn: event.target.value }))}
              className="mt-2 w-full rounded-2xl border border-stone-800 bg-black/30 px-3 py-2 text-stone-100 outline-none focus:border-[#c7ab6b]"
            />
          </label>

          <label className="block text-sm text-stone-400">
            <span>Owner</span>
            <input
              value={form.owner}
              onChange={(event) => setForm((current) => ({ ...current, owner: event.target.value }))}
              className="mt-2 w-full rounded-2xl border border-stone-800 bg-black/30 px-3 py-2 text-stone-100 outline-none focus:border-[#c7ab6b]"
            />
          </label>
        </div>
      </div>

      <button
        type="submit"
        disabled={update.isPending || isPending}
        className="mt-5 w-full rounded-2xl bg-[#c7ab6b] px-4 py-3 text-sm font-semibold text-stone-950 transition hover:bg-[#d8bd7d] disabled:cursor-wait disabled:opacity-60"
      >
        {update.isPending || isPending ? "Saving..." : "Save correction"}
      </button>

      <div className="mt-5 border-t border-stone-800 pt-5">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-stone-500">Remember participants</p>
        <p className="mt-2 text-sm text-stone-500">
          Save selected domains or contacts to this client so future multi-party threads classify better.
        </p>

        <div className="mt-4 space-y-4">
          <ParticipantGroup
            title="Domains"
            values={thread.participants.domains}
            selected={selectedDomains}
            onToggle={(value) => toggleValue(value, selectedDomains, setSelectedDomains)}
          />
          <ParticipantGroup
            title="Contacts"
            values={thread.participants.contacts.map((contact) => contact.email)}
            selected={selectedContacts}
            onToggle={(value) => toggleValue(value, selectedContacts, setSelectedContacts)}
          />
        </div>

        <button
          type="button"
          disabled={!form.clientId || learnParticipants.isPending || (selectedDomains.length === 0 && selectedContacts.length === 0)}
          onClick={() => {
            if (!form.clientId) return;
            learnParticipants.mutate({
              threadId: thread.id,
              clientId: form.clientId,
              domains: selectedDomains,
              contacts: selectedContacts,
            });
          }}
          className="mt-4 w-full rounded-2xl border border-stone-700 px-4 py-3 text-sm font-semibold text-stone-300 transition hover:border-stone-500 hover:text-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {learnParticipants.isPending ? "Remembering..." : "Remember selected for client"}
        </button>
      </div>
    </form>
  );
}

function ParticipantGroup({
  title,
  values,
  selected,
  onToggle,
}: {
  title: string;
  values: string[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  if (values.length === 0) {
    return null;
  }

  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-[0.25em] text-stone-600">{title}</h3>
      <div className="mt-2 max-h-40 space-y-2 overflow-y-auto rounded-2xl border border-stone-800 bg-black/20 p-3">
        {values.map((value) => (
          <label key={value} className="flex cursor-pointer items-center gap-2 text-sm text-stone-400">
            <input
              type="checkbox"
              checked={selected.includes(value)}
              onChange={() => onToggle(value)}
              className="accent-[#c7ab6b]"
            />
            <span className="min-w-0 truncate">{value}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function toggleValue(value: string, selected: string[], setSelected: (value: string[]) => void) {
  setSelected(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]);
}

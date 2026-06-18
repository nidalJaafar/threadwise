"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { api, type RouterOutputs } from "~/trpc/react";

type ClientOption = RouterOutputs["threadwise"]["clients"][number];
type DomainRule = RouterOutputs["threadwise"]["domainRules"][number];

const contextRoles = new Set(["non_client", "internal", "vendor", "network", "tooling"]);

export function DomainRepairActions({ domain, clients, domainRules }: { domain: string; clients: ClientOption[]; domainRules: DomainRule[] }) {
  const router = useRouter();
  const [clientId, setClientId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const rule = findDomainRule(domain, domainRules);
  const clientRule = rule?.role === "client" ? rule : null;
  const isNonClient = Boolean(rule && contextRoles.has(rule.role));
  const markNonClient = api.threadwise.markDomainAsNonClient.useMutation({
    onSuccess: (result) => {
      setMessage(`Ignored ${result.ignored}, reclassified ${result.reclassified}, left unknown ${result.leftUnknown}.`);
      startTransition(() => router.refresh());
    },
  });
  const markClient = api.threadwise.markDomainAsClient.useMutation({
    onSuccess: (result) => {
      setMessage(`Updated ${result.updated} matching threads.`);
      setClientId("");
      startTransition(() => router.refresh());
    },
  });
  const unmarkNonClient = api.threadwise.unmarkDomainAsNonClient.useMutation({
    onSuccess: (result) => {
      setMessage(result.updated ? "Removed non-client rule." : "No active non-client rule found.");
      startTransition(() => router.refresh());
    },
  });
  const isRepairing = markNonClient.isPending || isPending;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-stone-800 bg-black/20 p-2">
      <span className="rounded-full bg-black/25 px-2.5 py-1 text-xs text-stone-400">{domain}</span>
      {clientRule?.client ? (
        <span className="rounded-full border border-emerald-900/80 bg-emerald-950/40 px-2.5 py-1 text-xs font-semibold text-emerald-200">
          Belongs to {clientRule.client.name}
        </span>
      ) : isNonClient ? (
        <>
          <span className="rounded-full bg-amber-950/60 px-2.5 py-1 text-xs font-semibold text-amber-200">Non-client</span>
          <button
            type="button"
            disabled={unmarkNonClient.isPending || isPending}
            onClick={() => unmarkNonClient.mutate({ domain })}
            className="rounded-full border border-amber-800 px-2.5 py-1 text-xs text-amber-200 hover:border-amber-600 disabled:cursor-wait disabled:opacity-50"
          >
            {unmarkNonClient.isPending ? "Undoing..." : "Undo"}
          </button>
        </>
      ) : (
        <button
          type="button"
          disabled={isRepairing}
          onClick={() => markNonClient.mutate({ domain })}
          className="rounded-full border border-red-950/80 px-2.5 py-1 text-xs text-red-300 hover:border-red-800 disabled:cursor-wait disabled:opacity-50"
        >
          {isRepairing ? "Scanning..." : "Not client"}
        </button>
      )}
      <select
        value={clientId}
        onChange={(event) => setClientId(event.target.value)}
        className="min-w-40 rounded-full border border-stone-800 bg-stone-950 px-2.5 py-1 text-xs text-stone-200 outline-none focus:border-[#c7ab6b]"
      >
        <option value="">{clientRule?.client ? "Change client..." : "Domain belongs to..."}</option>
        {clients
          .filter((client) => client.name !== "Unknown / Unsorted")
          .map((client) => (
            <option key={client.id} value={client.id}>{client.name}</option>
          ))}
      </select>
      <button
        type="button"
        disabled={!clientId || markClient.isPending || isPending}
        onClick={() => markClient.mutate({ domain, clientId })}
        className="rounded-full border border-stone-700 px-2.5 py-1 text-xs text-stone-300 hover:border-stone-500 disabled:cursor-wait disabled:opacity-50"
      >
        Save
      </button>
      {message && <span className="text-xs text-stone-500">{message}</span>}
      {isRepairing && <span className="text-xs text-amber-300">Scanning matching threads. This can take a minute; keep this tab open.</span>}
      {rule?.reason && <span className="text-xs text-stone-600">{rule.reason}</span>}
    </div>
  );
}

export function DomainOwnershipBadge({ domain, domainRules }: { domain: string; domainRules: DomainRule[] }) {
  const rule = findDomainRule(domain, domainRules);

  if (rule?.role === "client" && rule.client) {
    return (
      <span className="rounded-full border border-emerald-900/80 bg-emerald-950/40 px-2.5 py-1 text-xs font-semibold text-emerald-200">
        {domain} belongs to {rule.client.name}
      </span>
    );
  }

  if (rule && contextRoles.has(rule.role)) {
    return (
      <span className="rounded-full border border-amber-900/80 bg-amber-950/40 px-2.5 py-1 text-xs font-semibold text-amber-200">
        {domain} is non-client
      </span>
    );
  }

  return (
    <span className="rounded-full bg-black/25 px-2.5 py-1 text-xs text-stone-500">
      {domain}
    </span>
  );
}

export function AiClientRepairPanel({ clientId, domains, domainRules }: { clientId: string; domains: string[]; domainRules: DomainRule[] }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const markNonClient = api.threadwise.markDomainAsNonClient.useMutation({
    onSuccess: (result) => {
      setMessage(`Ignored ${result.ignored}, reclassified ${result.reclassified}, left unknown ${result.leftUnknown}, failed ${result.failed}.`);
      startTransition(() => router.refresh());
    },
  });
  const moveToUnknown = api.threadwise.moveAiClientThreadsToUnknown.useMutation({
    onSuccess: (result) => {
      setMessage(`Moved ${result.updated} AI-classified threads to Unknown.`);
      startTransition(() => router.refresh());
    },
  });
  const unmarkNonClient = api.threadwise.unmarkDomainAsNonClient.useMutation({
    onSuccess: (result) => {
      setMessage(result.updated ? "Removed non-client rule." : "No active non-client rule found.");
      startTransition(() => router.refresh());
    },
  });
  const isRepairing = markNonClient.isPending || isPending;

  return (
    <section className="mb-4 rounded-2xl border border-orange-900/50 bg-orange-950/20 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.25em] text-orange-300">AI-created client repair</h2>
          <p className="mt-2 text-sm text-stone-400">
            If this client is actually a network/vendor/context domain, mark that domain as non-client and ThreadWise will reclassify affected AI threads.
          </p>
        </div>
        <button
          type="button"
          disabled={moveToUnknown.isPending || isPending}
          onClick={() => moveToUnknown.mutate({ clientId })}
          className="rounded-2xl border border-stone-700 px-4 py-2 text-sm font-semibold text-stone-300 hover:border-stone-500 disabled:cursor-wait disabled:opacity-50"
        >
          Move AI threads to Unknown
        </button>
      </div>

      {domains.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {domains.map((domain) => (
            <DomainRepairChip
              key={domain}
              domain={domain}
              domainRules={domainRules}
              isRepairing={isRepairing}
              isUndoing={unmarkNonClient.isPending || isPending}
              onMark={() => markNonClient.mutate({ domain })}
              onUndo={() => unmarkNonClient.mutate({ domain })}
            />
          ))}
        </div>
      )}

      {message && <p className="mt-3 text-sm text-stone-400">{message}</p>}
      {isRepairing && <p className="mt-3 text-sm text-amber-300">Scanning matching threads and repairing classifications. This can take a minute; keep this tab open.</p>}
      {(markNonClient.error ?? moveToUnknown.error) && <p className="mt-3 text-sm text-red-300">{(markNonClient.error ?? moveToUnknown.error)?.message}</p>}
    </section>
  );
}

function DomainRepairChip({
  domain,
  domainRules,
  isRepairing,
  isUndoing,
  onMark,
  onUndo,
}: {
  domain: string;
  domainRules: DomainRule[];
  isRepairing: boolean;
  isUndoing: boolean;
  onMark: () => void;
  onUndo: () => void;
}) {
  const rule = findDomainRule(domain, domainRules);
  const isNonClient = Boolean(rule && contextRoles.has(rule.role));

  if (isNonClient) {
    return (
      <div className="flex items-center gap-2 rounded-full border border-amber-900/80 px-3 py-1.5 text-xs text-amber-200">
        <span>{domain} is non-client</span>
        <button type="button" disabled={isUndoing} onClick={onUndo} className="font-semibold hover:text-amber-100 disabled:opacity-50">
          {isUndoing ? "Undoing..." : "Undo"}
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={isRepairing}
      onClick={onMark}
      className="rounded-full border border-red-950/80 px-3 py-1.5 text-xs text-red-300 hover:border-red-800 disabled:cursor-wait disabled:opacity-50"
    >
      {isRepairing ? `Repairing ${domain}...` : `Mark ${domain} as non-client`}
    </button>
  );
}

function findDomainRule(domain: string, rules: DomainRule[]) {
  const normalized = domain.trim().toLowerCase();

  return [...rules].sort((a, b) => ruleScore(normalized, b) - ruleScore(normalized, a)).find((rule) => {
    const ruleDomain = rule.domain.trim().toLowerCase();

    if (!ruleDomain) return false;
    if (normalized === ruleDomain || normalized.endsWith(`.${ruleDomain}`)) return true;
    if (!ruleDomain.includes(".")) {
      return normalized.split(".").some((label) => label === ruleDomain || label.includes(ruleDomain));
    }

    return false;
  });
}

function ruleScore(domain: string, rule: DomainRule) {
  const ruleDomain = rule.domain.trim().toLowerCase();
  const exact = domain === ruleDomain;
  const roleScore = rule.role === "client" ? 100 : contextRoles.has(rule.role) ? 50 : 0;

  return roleScore + (exact ? 10 : 0) + ruleDomain.length / 1000;
}

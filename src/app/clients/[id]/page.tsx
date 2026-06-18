import { redirect } from "next/navigation";

import { AppFrame, TopBar } from "~/app/_components/threadwise-ui";
import { ClassifyUnknownButton } from "~/app/clients/[id]/classify-unknown-button";
import { DeleteEmptyClientButton } from "~/app/clients/[id]/delete-empty-client-button";
import { AiClientRepairPanel } from "~/app/clients/[id]/domain-repair-actions";
import { ThreadList } from "~/app/clients/[id]/thread-list";
import { api } from "~/trpc/server";

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [client, clients, domainRules] = await Promise.all([
    api.threadwise.clientById({ id }),
    api.threadwise.clients(),
    api.threadwise.domainRules(),
  ]);

  if (client.deleted) {
    redirect("/");
  }

  return (
    <AppFrame>
      <TopBar title={client.name} backHref="/" backLabel="Clients" />

      <details className="mb-4 rounded-2xl border border-stone-800 bg-stone-950 p-4 text-sm text-stone-500">
        <summary className="cursor-pointer font-semibold text-stone-300">
          {client.threads.length} threads · {client.domains.length} remembered domains · {client.contacts.length} remembered contacts
        </summary>
        <div className="mt-4 grid gap-4 border-t border-stone-800 pt-4 md:grid-cols-2">
          <MemoryGroup title="Domains" values={client.domains} />
          <MemoryGroup title="Contacts" values={client.contacts.map((contact) => contact.email)} />
        </div>
      </details>

      {client.name === "Unknown / Unsorted" && <ClassifyUnknownButton clientId={client.id} threadCount={client.threads.length} />}
      {client.source === "ai" && <AiClientRepairPanel clientId={client.id} domains={client.domains} domainRules={domainRules} />}
      {client.name !== "Unknown / Unsorted" && client.threads.length === 0 && <DeleteEmptyClientButton clientId={client.id} />}

      <ThreadList currentClientName={client.name} threads={client.threads} clients={clients} domainRules={domainRules} />
    </AppFrame>
  );
}

function MemoryGroup({ title, values }: { title: string; values: string[] }) {
  return (
    <div>
      <h2 className="text-xs font-semibold uppercase tracking-[0.25em] text-stone-600">{title}</h2>
      {values.length ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {values.map((value) => (
            <span key={value} className="rounded-full bg-black/25 px-2.5 py-1 text-xs text-stone-400">
              {value}
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-stone-600">Nothing remembered yet.</p>
      )}
    </div>
  );
}

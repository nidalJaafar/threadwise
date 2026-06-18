import { type PrismaClient } from "../../../generated/prisma";
import { classifyClientFromDomains } from "~/server/ai/client-classification";
import { classifyDomainsByRules } from "~/server/threadwise/domain-rules";

export async function classifyThreadClientFromDomains(
  db: PrismaClient,
  input: {
    entityType: string;
    entityId: string;
    subject: string;
    domains: string[];
  },
) {
  const domains = normalizeDomains(input.domains);

  if (domains.length === 0) {
    return null;
  }

  const inputHash = `${input.entityId}:${domains.join(",")}:${input.subject}`;
  const domainGroups = await classifyDomainsByRules(db, domains);
  const deterministicClientIds = [...new Set(domainGroups.clientDomains.map((domain) => domain.clientId))];

  if (deterministicClientIds.length === 1) {
    const classifiedDomain = domainGroups.clientDomains.find((domain) => domain.clientId === deterministicClientIds[0])?.domain ?? null;

    return {
      clientId: deterministicClientIds[0]!,
      classifiedDomain,
      classificationReason: classifiedDomain ? `Matched saved client domain ${classifiedDomain}` : "Matched saved client domain",
      confidence: 1,
      source: "domain_rule" as const,
    };
  }

  if (domainGroups.candidateDomains.length === 0) {
    return null;
  }

  if (domainGroups.candidateDomains.length === 1) {
    const domain = domainGroups.candidateDomains[0]!;
    const client = await getOrCreateAiClient(db, clientNameFromDomain(domain), [domain], 1);

    return {
      clientId: client.id,
      clientName: client.name,
      classifiedDomain: domain,
      classificationReason: `Only remaining candidate client domain after filtering context domains: ${domain}`,
      confidence: 1,
      source: "single_candidate" as const,
    };
  }

  let jobId: string | null = null;

  try {
    const job = await db.aiJob.create({
      data: {
        jobType: "client_classification",
        entityType: input.entityType,
        entityId: input.entityId,
        status: "running",
        inputHash,
        startedAt: new Date(),
      },
    });
    jobId = job.id;

    const classification = await classifyClientFromDomains(db, {
      subject: input.subject,
      candidateDomains: domainGroups.candidateDomains,
      contextDomains: domainGroups.contextDomains,
    });

    if (!classification?.shouldAssign) {
      await db.aiJob.update({
        where: { id: jobId },
        data: {
          status: "completed",
          model: classification?.model,
          promptVersion: classification?.promptVersion,
          completedAt: new Date(),
        },
      });

      return null;
    }

    const client = await getOrCreateAiClient(
      db,
      classification.clientName,
      classification.domainsToRemember,
      classification.confidence,
    );

    await db.aiJob.update({
      where: { id: jobId },
      data: {
        status: "completed",
        model: classification.model,
        promptVersion: classification.promptVersion,
        completedAt: new Date(),
      },
    });

    return {
      clientId: client.id,
      clientName: client.name,
      classifiedDomain: classification.selectedClientDomain,
      classificationReason: classification.reason,
      confidence: classification.confidence,
      source: "ai" as const,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown AI client classification error";

    if (jobId) {
      await db.aiJob.update({
        where: { id: jobId },
        data: {
          status: "failed",
          error: message,
          completedAt: new Date(),
        },
      });
    } else {
      await db.aiJob.create({
        data: {
          jobType: "client_classification",
          entityType: input.entityType,
          entityId: input.entityId,
          status: "failed",
          inputHash,
          error: message,
          completedAt: new Date(),
        },
      });
    }

    return { failed: true as const };
  }
}

export function externalDomainsFromEmails(emails: string[], userEmail: string | null | undefined) {
  const userDomain = userEmail ? domainFromEmail(userEmail) : "";

  return normalizeDomains(
    emails
      .map(domainFromEmail)
      .filter((domain) => domain && domain !== userDomain),
  );
}

async function getOrCreateAiClient(db: PrismaClient, name: string, domains: string[], confidence: number) {
  const trimmedName = name.trim();
  const existing = await db.client.findFirst({ where: { name: { equals: trimmedName } } });
  const client = existing ?? await db.client.create({
    data: {
      name: trimmedName,
      aliasesJson: "[]",
      domainsJson: "[]",
      source: "ai",
      notes: "Created by domain-only AI client classification.",
    },
  });

  for (const domain of domains) {
    await db.clientDomain.upsert({
      where: { clientId_domain: { clientId: client.id, domain } },
      create: {
        clientId: client.id,
        domain,
        source: "ai",
        confidence,
      },
      update: {
        source: "ai",
        confidence,
      },
    });
  }

  return client;
}

function normalizeDomains(domains: string[]) {
  return [...new Set(domains.map((domain) => domain.trim().toLowerCase()).filter(Boolean))].sort();
}

function domainFromEmail(email: string) {
  return email.trim().toLowerCase().split("@")[1] ?? "";
}

function clientNameFromDomain(domain: string) {
  const labels = domain.split(".").filter(Boolean);
  const base = labels[0] ?? domain;

  if (base.length <= 5) {
    return base.toUpperCase();
  }

  return base
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

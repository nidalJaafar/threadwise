import { type PrismaClient } from "../../../generated/prisma";

export type ThreadDomainSource = "sender" | "recipient" | "cc";

export type ThreadDomainInput = {
  domain: string;
  source: ThreadDomainSource;
};

export function domainFromEmailAddress(email: string) {
  return email.trim().toLowerCase().split("@")[1] ?? "";
}

export function collectThreadDomains(
  messages: Array<{
    senderEmail: string;
    recipients: string[];
    cc: string[];
  }>,
  userEmail?: string | null,
) {
  const userDomain = userEmail ? domainFromEmailAddress(userEmail) : "";
  const domains = new Map<string, Set<ThreadDomainSource>>();

  for (const message of messages) {
    addDomain(domains, message.senderEmail, "sender", userDomain);

    for (const email of message.recipients) {
      addDomain(domains, email, "recipient", userDomain);
    }

    for (const email of message.cc) {
      addDomain(domains, email, "cc", userDomain);
    }
  }

  return [...domains.entries()].flatMap(([domain, sources]) =>
    [...sources].map((source) => ({ domain, source })),
  );
}

export async function replaceThreadDomains(db: PrismaClient, threadId: string, domains: ThreadDomainInput[]) {
  await db.threadDomain.deleteMany({ where: { threadId } });

  if (domains.length === 0) {
    return;
  }

  await db.threadDomain.createMany({
    data: domains.map((domain) => ({
      threadId,
      domain: domain.domain,
      source: domain.source,
    })),
  });
}

export function parseJsonStringArray(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function addDomain(domains: Map<string, Set<ThreadDomainSource>>, email: string, source: ThreadDomainSource, userDomain: string) {
  const domain = domainFromEmailAddress(email);

  if (!domain || domain === userDomain) {
    return;
  }

  const sources = domains.get(domain) ?? new Set<ThreadDomainSource>();
  sources.add(source);
  domains.set(domain, sources);
}

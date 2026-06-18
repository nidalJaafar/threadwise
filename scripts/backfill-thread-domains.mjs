import { PrismaClient } from "../generated/prisma/index.js";

const db = new PrismaClient();
const batchSize = 500;

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function domainFromEmail(email) {
  return email.trim().toLowerCase().split("@")[1] ?? "";
}

function addDomain(domains, email, source, userDomain) {
  const domain = domainFromEmail(email);

  if (!domain || domain === userDomain) {
    return;
  }

  domains.set(`${domain}:${source}`, { domain, source });
}

try {
  await db.threadDomain.deleteMany();

  const syncStates = await db.gmailSyncState.findMany({ select: { userId: true, email: true } });
  const userEmailById = new Map(syncStates.map((state) => [state.userId, state.email ?? ""]));
  let cursor;
  let totalMessages = 0;
  let totalDomains = 0;

  for (;;) {
    const messages = await db.emailMessage.findMany({
      take: batchSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: {
        id: true,
        threadId: true,
        senderEmail: true,
        recipientJson: true,
        ccJson: true,
        thread: { select: { providerAccountId: true } },
      },
    });

    if (messages.length === 0) {
      break;
    }

    const domainsByThread = new Map();

    for (const message of messages) {
      const userEmail = message.thread.providerAccountId ? userEmailById.get(message.thread.providerAccountId) : "";
      const userDomain = userEmail ? domainFromEmail(userEmail) : "";
      const domains = domainsByThread.get(message.threadId) ?? new Map();

      addDomain(domains, message.senderEmail, "sender", userDomain);

      for (const email of parseJsonArray(message.recipientJson)) {
        addDomain(domains, email, "recipient", userDomain);
      }

      for (const email of parseJsonArray(message.ccJson)) {
        addDomain(domains, email, "cc", userDomain);
      }

      domainsByThread.set(message.threadId, domains);
    }

    for (const [threadId, domains] of domainsByThread) {
      for (const domain of domains.values()) {
        await db.threadDomain.upsert({
          where: { threadId_domain_source: { threadId, domain: domain.domain, source: domain.source } },
          create: { threadId, domain: domain.domain, source: domain.source },
          update: {},
        });
      }
      totalDomains += domains.size;
    }

    totalMessages += messages.length;
    cursor = messages.at(-1)?.id;
  }

  console.log(`Backfilled thread domains from ${totalMessages} messages (${totalDomains} domain-source rows considered).`);
} finally {
  await db.$disconnect();
}

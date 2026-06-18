import { type PrismaClient } from "../../../generated/prisma";
import { gmailFetch, getGmailAccessToken } from "~/server/gmail/client";
import { ensureDefaultIgnoreRules, getIgnoreMatch, type IgnoreRuleInput } from "~/server/gmail/ignore-rules";
import { domainFromEmail, normalizeTopic, parseGmailMessage, type GmailPayload } from "~/server/gmail/parser";
import { classifyThreadClientFromDomains, externalDomainsFromEmails } from "~/server/threadwise/client-auto-classification";
import { classifyDomainsByRules } from "~/server/threadwise/domain-rules";
import { collectThreadDomains, replaceThreadDomains } from "~/server/threadwise/thread-domains";

type GmailProfile = {
  emailAddress: string;
  historyId?: string;
};

type GmailThreadList = {
  threads?: Array<{ id: string; snippet?: string }>;
  nextPageToken?: string;
};

type GmailHistoryList = {
  history?: Array<{
    messages?: Array<{ id: string; threadId: string }>;
    messagesAdded?: Array<{ message?: { id: string; threadId: string } }>;
  }>;
  historyId?: string;
  nextPageToken?: string;
};

type GmailThread = {
  id: string;
  historyId?: string;
  messages?: Array<{
    id: string;
    threadId: string;
    labelIds?: string[];
    snippet?: string;
    internalDate?: string;
    payload?: GmailPayload;
  }>;
};

type ClientMatch = {
  clientId: string | null;
  source: "score" | "unknown";
};

export async function syncRecentGmailThreads(db: PrismaClient, userId: string, maxResults = 25) {
  const accessToken = await getGmailAccessToken(db, userId);
  const profile = await gmailFetch<GmailProfile>(accessToken, "profile");
  const syncState = await db.gmailSyncState.upsert({
    where: { userId },
    create: { userId, email: profile.emailAddress },
    update: { email: profile.emailAddress, lastError: null },
  });

  try {
    let threadIds: string[];
    let nextHistoryId = profile.historyId;
    let syncMode: "history" | "recent" = "recent";

    if (syncState.historyId) {
      try {
        const history = await listChangedThreadIds(accessToken, syncState.historyId);
        threadIds = history.threadIds;
        nextHistoryId = history.historyId ?? profile.historyId;
        syncMode = "history";
      } catch (error) {
        if (!isExpiredHistoryError(error)) {
          throw error;
        }

        threadIds = await listRecentThreadIds(accessToken, maxResults);
        syncMode = "recent";
      }
    } else {
      threadIds = await listRecentThreadIds(accessToken, maxResults);
    }

    const totals = await syncThreadIds(db, accessToken, threadIds, profile.emailAddress, userId);

    await db.gmailSyncState.update({
      where: { userId },
      data: {
        historyId: nextHistoryId,
        lastSyncedAt: new Date(),
        lastError: null,
      },
    });

    return { ...totals, syncMode };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Gmail sync error";

    await db.gmailSyncState.update({
      where: { userId },
      data: { lastError: message },
    });

    throw error;
  }
}

export async function backfillGmailThreadsByDays(db: PrismaClient, userId: string, days: number) {
  const accessToken = await getGmailAccessToken(db, userId);
  const profile = await gmailFetch<GmailProfile>(accessToken, "profile");
  const syncState = await db.gmailSyncState.upsert({
    where: { userId },
    create: { userId, email: profile.emailAddress },
    update: { email: profile.emailAddress, lastError: null },
  });

  try {
    const threadIds = await listThreadIdsByQuery(accessToken, `newer_than:${days}d -in:chats`);
    const totals = await syncThreadIds(db, accessToken, threadIds, profile.emailAddress, userId);

    await db.gmailSyncState.update({
      where: { userId },
      data: {
        historyId: syncState.historyId ?? profile.historyId,
        lastSyncedAt: new Date(),
        lastError: null,
      },
    });

    return { ...totals, syncMode: "backfill" as const, days };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Gmail backfill error";

    await db.gmailSyncState.update({
      where: { userId },
      data: { lastError: message },
    });

    throw error;
  }
}

async function listRecentThreadIds(accessToken: string, maxResults: number) {
  const list = await gmailFetch<GmailThreadList>(
    accessToken,
    `threads?${new URLSearchParams({ maxResults: String(maxResults), q: "-in:chats" }).toString()}`,
  );

  return (list.threads ?? []).map((thread) => thread.id);
}

async function listThreadIdsByQuery(accessToken: string, query: string) {
  const threadIds: string[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      maxResults: "100",
      q: query,
    });

    if (pageToken) {
      params.set("pageToken", pageToken);
    }

    const page = await gmailFetch<GmailThreadList>(accessToken, `threads?${params.toString()}`);

    threadIds.push(...(page.threads ?? []).map((thread) => thread.id));
    pageToken = page.nextPageToken;
  } while (pageToken);

  return threadIds;
}

async function listChangedThreadIds(accessToken: string, startHistoryId: string) {
  const threadIds = new Set<string>();
  let pageToken: string | undefined;
  let latestHistoryId: string | undefined;

  do {
    const params = new URLSearchParams({
      startHistoryId,
      historyTypes: "messageAdded",
    });

    if (pageToken) {
      params.set("pageToken", pageToken);
    }

    const page = await gmailFetch<GmailHistoryList>(accessToken, `history?${params.toString()}`);

    latestHistoryId = page.historyId ?? latestHistoryId;
    pageToken = page.nextPageToken;

    for (const history of page.history ?? []) {
      for (const added of history.messagesAdded ?? []) {
        if (added.message?.threadId) {
          threadIds.add(added.message.threadId);
        }
      }
    }
  } while (pageToken);

  return { threadIds: [...threadIds], historyId: latestHistoryId };
}

async function syncThreadIds(db: PrismaClient, accessToken: string, threadIds: string[], userEmail: string, userId: string) {
  let importedThreads = 0;
  let importedMessages = 0;
  let newThreads = 0;
  let newMessages = 0;
  const changedThreads: Array<{ id: string; topic: string; clientName: string | null; lastMessageAt: Date }> = [];
  const changedMessages: Array<{
    id: string;
    threadId: string;
    topic: string;
    clientName: string | null;
    isIgnored: boolean;
    senderName: string;
    snippet: string;
    sentAt: Date;
  }> = [];
  const ignoreRules = await getActiveIgnoreRules(db);

  for (const threadId of threadIds) {
    let result: Awaited<ReturnType<typeof upsertGmailThread>>;

    try {
      const gmailThread = await gmailFetch<GmailThread>(accessToken, `threads/${threadId}?format=full`);
      result = await upsertGmailThread(db, gmailThread, userEmail, userId, ignoreRules);
    } catch (error) {
      if (isGmailNotFoundError(error)) {
        continue;
      }

      throw error;
    }

    importedThreads += result.threadImported ? 1 : 0;
    importedMessages += result.messagesImported;
    newThreads += result.newThread ? 1 : 0;
    newMessages += result.newMessages;

    if (result.newMessages > 0) {
      changedMessages.push(...result.changedMessages);
    }

    if ((result.newThread || result.newMessages > 0) && result.thread && !result.isIgnored) {
      changedThreads.push(result.thread);
    }
  }

  return {
    importedThreads,
    importedMessages,
    newThreads,
    newMessages,
    changedThreads: changedThreads.sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime()),
    changedMessages: changedMessages.sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime()),
  };
}

function isExpiredHistoryError(error: unknown) {
  return isGmailNotFoundError(error);
}

function isGmailNotFoundError(error: unknown) {
  return error instanceof Error && error.message.includes("Gmail API failed: 404");
}

async function upsertGmailThread(db: PrismaClient, gmailThread: GmailThread, userEmail: string, userId: string, ignoreRules: IgnoreRuleInput[]) {
  const parsedMessages = (gmailThread.messages ?? [])
    .map((message) => ({ source: message, parsed: parseGmailMessage(message) }))
    .sort((a, b) => a.parsed.sentAt.getTime() - b.parsed.sentAt.getTime());

  if (parsedMessages.length === 0) {
    return { threadImported: false, messagesImported: 0, newThread: false, newMessages: 0, isIgnored: false, thread: null, changedMessages: [] };
  }

  const first = parsedMessages[0]?.parsed;
  const latest = parsedMessages.at(-1)?.parsed;
  const subject = first?.subject ?? "(no subject)";
  const topic = normalizeTopic(subject);
  const participantEmails = parsedMessages.flatMap((message) => [
    message.parsed.senderEmail,
    ...message.parsed.recipients,
    ...message.parsed.cc,
  ]);
  const matchedClient = await matchClientId(db, participantEmails, userEmail);
  const latestBody = latest?.cleanBody ?? latest?.snippet ?? "Imported Gmail thread.";
  const providerThreadId = gmailThread.id;
  const existingThread = await db.emailThread.findUnique({ where: { providerThreadId } });
  const subjectIgnoredReason = getIgnoreMatch({
    subject,
    senderEmails: parsedMessages.map((message) => message.parsed.senderEmail),
  }, ignoreRules.filter((rule) => rule.type === "subject_contains" || rule.type === "subject_starts_with" || rule.type === "sender_email_contains"));
  const domainIgnore = await getDomainNoiseIgnore(db, participantEmails, userEmail);
  const preserveManualIgnore = existingThread?.isIgnored === true && (
    existingThread.ignoreSource === "manual_thread" || existingThread.ignoredReason === "Manually ignored thread"
  );
  const ignoredReason = preserveManualIgnore
    ? (existingThread.ignoredReason ?? "Manually ignored thread")
    : subjectIgnoredReason ?? domainIgnore.reason;
  const ignoreSource = preserveManualIgnore
    ? "manual_thread"
    : subjectIgnoredReason
      ? "rule"
      : domainIgnore.shouldIgnore
        ? "domain_noise"
        : null;
  const isIgnored = preserveManualIgnore || subjectIgnoredReason !== null || domainIgnore.shouldIgnore;
  const existingMessageIds = existingThread
    ? new Set(
        (
          await db.emailMessage.findMany({
            where: { threadId: existingThread.id },
            select: { providerMessageId: true },
          })
        ).map((message) => message.providerMessageId),
      )
    : new Set<string>();
  const preserveManual = existingThread?.userOverridden === true;
  const aiClient = !preserveManual && !isIgnored && matchedClient.source === "unknown"
    ? await classifyThreadClientFromDomains(db, {
        entityType: "gmail_thread",
        entityId: providerThreadId,
        subject,
        domains: externalDomainsFromEmails(participantEmails, userEmail),
      })
    : null;
  const clientId = preserveManual ? existingThread.clientId : (aiClient && "clientId" in aiClient ? aiClient.clientId : matchedClient.clientId);
  const classificationSource = preserveManual
    ? existingThread.classificationSource
    : aiClient && "clientId" in aiClient
      ? aiClient.source === "ai" ? "ai" : "score"
      : matchedClient.source;

  const thread = await db.emailThread.upsert({
    where: { providerThreadId },
    create: {
      provider: "gmail",
      providerAccountId: userId,
      providerThreadId,
      gmailHistoryId: gmailThread.historyId,
      subject,
      clientId,
      topic,
      category: "Email",
      status: "Unknown",
      priority: "Medium",
      waitingOn: "Unknown",
      owner: "Unknown",
      summary: latestBody.slice(0, 500),
      classificationSource,
      classifiedDomain: aiClient && "clientId" in aiClient ? aiClient.classifiedDomain : null,
      classificationReason: aiClient && "clientId" in aiClient ? aiClient.classificationReason : null,
      isIgnored,
      ignoredReason,
      ignoreSource,
      gmailUrl: `https://mail.google.com/mail/u/0/#inbox/${providerThreadId}`,
      lastMessageAt: latest?.sentAt ?? new Date(),
      lastSyncedAt: new Date(),
    },
    update: {
      gmailHistoryId: gmailThread.historyId,
      subject,
      clientId,
      topic: preserveManual ? existingThread.topic : topic,
      category: preserveManual ? existingThread.category : "Email",
      status: preserveManual ? existingThread.status : "Unknown",
      priority: preserveManual ? existingThread.priority : "Medium",
      waitingOn: preserveManual ? existingThread.waitingOn : "Unknown",
      owner: preserveManual ? existingThread.owner : "Unknown",
      summary: latestBody.slice(0, 500),
      isIgnored,
      ignoredReason,
      ignoreSource,
      lastMessageAt: latest?.sentAt ?? new Date(),
      lastSyncedAt: new Date(),
      classificationSource,
      classifiedDomain: preserveManual ? existingThread.classifiedDomain : aiClient && "clientId" in aiClient ? aiClient.classifiedDomain : null,
      classificationReason: preserveManual ? existingThread.classificationReason : aiClient && "clientId" in aiClient ? aiClient.classificationReason : null,
    },
  });

  await db.attachment.deleteMany({ where: { threadId: thread.id } });
  await db.emailMessage.deleteMany({ where: { threadId: thread.id } });

  let messagesImported = 0;
  let newMessages = 0;

  for (const { source, parsed } of parsedMessages) {
    const message = await db.emailMessage.create({
      data: {
        threadId: thread.id,
        providerMessageId: source.id,
        messageHash: `${source.id}:${source.internalDate ?? ""}`,
        bodyHash: `${source.id}:${parsed.rawBody.length}`,
        senderName: parsed.senderName,
        senderEmail: parsed.senderEmail,
        recipientJson: JSON.stringify(parsed.recipients),
        ccJson: JSON.stringify(parsed.cc),
        sentAt: parsed.sentAt,
        gmailInternalDate: source.internalDate ? new Date(Number(source.internalDate)) : parsed.sentAt,
        rawBody: parsed.rawBody,
        cleanBody: parsed.cleanBody ? parsed.cleanBody : parsed.snippet,
        snippet: parsed.snippet,
        hasAttachments: parsed.attachments.length > 0,
        isFromUser: parsed.senderEmail.toLowerCase() === userEmail.toLowerCase(),
        cleanedAt: new Date(),
      },
    });

    messagesImported += 1;
    if (!existingMessageIds.has(source.id)) {
      newMessages += 1;
    }

    for (const attachment of parsed.attachments) {
      await db.attachment.create({
        data: {
          threadId: thread.id,
          messageId: message.id,
          filename: attachment.filename,
          mimeType: attachment.mimeType,
          size: attachment.size,
          providerAttachmentId: attachment.providerAttachmentId,
        },
      });
    }
  }

  await replaceThreadDomains(
    db,
    thread.id,
    collectThreadDomains(
      parsedMessages.map((message) => ({
        senderEmail: message.parsed.senderEmail,
        recipients: message.parsed.recipients,
        cc: message.parsed.cc,
      })),
      userEmail,
    ),
  );

  const threadWithClient = await db.emailThread.findUnique({
    where: { id: thread.id },
    include: { client: true },
  });

  return {
    threadImported: true,
    messagesImported,
    newThread: !existingThread,
    newMessages,
    isIgnored,
    changedMessages: threadWithClient
      ? parsedMessages
        .filter(({ source }) => !existingMessageIds.has(source.id))
        .map(({ source, parsed }) => ({
          id: source.id,
          threadId: threadWithClient.id,
          topic: threadWithClient.topic,
          clientName: threadWithClient.client?.name ?? null,
          isIgnored,
          senderName: parsed.senderName ? parsed.senderName : parsed.senderEmail,
          snippet: parsed.snippet ? parsed.snippet : parsed.cleanBody.slice(0, 160),
          sentAt: parsed.sentAt,
        }))
      : [],
    thread: threadWithClient
      ? {
          id: threadWithClient.id,
          topic: threadWithClient.topic,
          clientName: threadWithClient.client?.name ?? null,
          lastMessageAt: threadWithClient.lastMessageAt,
        }
      : null,
  };
}

async function getActiveIgnoreRules(db: PrismaClient): Promise<IgnoreRuleInput[]> {
  await ensureDefaultIgnoreRules(db);

  const dbRules = await db.ignoreRule.findMany({
    where: { enabled: true },
    orderBy: { createdAt: "asc" },
  });

  return dbRules.flatMap((rule) => {
    if (!isIgnoreRuleType(rule.type)) {
      return [];
    }

    return [{
      type: rule.type,
      value: rule.value,
      reason: rule.reason ?? `Ignored by ${rule.value}`,
    }];
  });
}

function isIgnoreRuleType(value: string): value is IgnoreRuleInput["type"] {
  return ["sender_email_contains", "sender_domain_contains", "subject_contains", "subject_starts_with"].includes(value);
}

async function getDomainNoiseIgnore(db: PrismaClient, participantEmails: string[], userEmail: string) {
  const domains = externalDomainsFromEmails(participantEmails, userEmail);

  if (domains.length === 0) {
    return { shouldIgnore: false, reason: null as string | null };
  }

  const domainGroups = await classifyDomainsByRules(db, domains);

  if (domainGroups.candidateDomains.length > 0 || domainGroups.clientDomains.length > 0) {
    return { shouldIgnore: false, reason: null as string | null };
  }

  return {
    shouldIgnore: true,
    reason: `Ignored domain-only noise: ${domainGroups.contextDomains.join(", ")}`,
  };
}

async function matchClientId(db: PrismaClient, participantEmails: string[], userEmail: string): Promise<ClientMatch> {
  const userDomain = domainFromEmail(userEmail);
  const rawEmails = participantEmails
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.includes("@") && domainFromEmail(email) !== userDomain);
  const rawDomains = [...new Set(rawEmails.map(domainFromEmail).filter((domain) => domain && domain !== userDomain))];
  const domainGroups = await classifyDomainsByRules(db, rawDomains);
  const deterministicClientIds = [...new Set(domainGroups.clientDomains.map((domain) => domain.clientId))];

  if (deterministicClientIds.length === 1) {
    return { clientId: deterministicClientIds[0]!, source: "score" };
  }

  const candidateDomainSet = new Set(domainGroups.candidateDomains);
  const emails = new Set(
    rawEmails.filter((email) => candidateDomainSet.has(domainFromEmail(email))),
  );
  const domains = new Set(
    participantEmails
      .map(domainFromEmail)
      .filter((domain) => candidateDomainSet.has(domain)),
  );

  if (domains.size === 0) {
    const unknown = await db.client.findFirst({ where: { name: "Unknown / Unsorted" } });
    return { clientId: unknown?.id ?? null, source: "unknown" };
  }

  const clients = await db.client.findMany({
    include: {
      domains: true,
      contacts: true,
    },
  });

  const scores = clients.map((client) => {
    let score = 0;

    for (const contact of client.contacts) {
      if (emails.has(contact.email.toLowerCase())) {
        score += 4 * contact.confidence;
      }
    }

    for (const domain of client.domains) {
      if (domains.has(domain.domain.toLowerCase())) {
        score += 3 * domain.confidence;
      }
    }

    for (const domain of parseStringArray(client.domainsJson)) {
      if (domains.has(domain.toLowerCase())) {
        score += 2;
      }
    }

    return { clientId: client.id, score, isUnknown: client.name === "Unknown / Unsorted" };
  });

  const best = scores
    .filter((score) => !score.isUnknown)
    .sort((a, b) => b.score - a.score)[0];

  if (best && best.score >= 3) {
    return { clientId: best.clientId, source: "score" };
  }

  const unknown = await db.client.findFirst({ where: { name: "Unknown / Unsorted" } });
  return { clientId: unknown?.id ?? null, source: "unknown" };
}

function parseStringArray(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

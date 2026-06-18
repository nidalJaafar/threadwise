import { z } from "zod";

import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { analyzeThread } from "~/server/ai/thread-analysis";
import { ensureDefaultIgnoreRules, upsertIgnoreRule } from "~/server/gmail/ignore-rules";
import { classifyThreadClientFromDomains } from "~/server/threadwise/client-auto-classification";
import { classifyDomainsByRules, markDomainRule } from "~/server/threadwise/domain-rules";
import { extractParticipants, groupParticipantsByDomain, parseJsonArray } from "~/server/threadwise/participants";
import { ensureUnknownClient } from "~/server/threadwise/system";

const metadataInput = z.object({
  threadId: z.string(),
  topic: z.string().min(1),
  status: z.string().min(1),
  priority: z.string().min(1),
  waitingOn: z.string().min(1),
  owner: z.string().min(1),
  clientId: z.string().nullable(),
});

const learnParticipantsInput = z.object({
  threadId: z.string(),
  clientId: z.string(),
  domains: z.array(z.string()).default([]),
  contacts: z.array(z.string()).default([]),
});

const statusInput = z.object({
  threadId: z.string(),
  status: z.enum([
    "Waiting on Me",
    "Waiting on Client",
    "Waiting on Internal Team",
    "In Progress",
    "Blocked",
    "Resolved",
    "Unknown",
  ]),
});

const ignoreRuleTypeInput = z.enum([
  "sender_email_contains",
  "sender_domain_contains",
  "subject_contains",
  "subject_starts_with",
]);

export const threadwiseRouter = createTRPCRouter({
  dashboard: publicProcedure.query(async ({ ctx }) => {
    const unknown = await ensureUnknownClient(ctx.db);
    await ignoreDomainNoiseThreads(ctx.db, { clientId: unknown.id });
    await deleteAllEmptyClients(ctx.db);

    const clients = await ctx.db.client.findMany({
      select: {
        id: true,
        name: true,
        notes: true,
        domainsJson: true,
        aliasesJson: true,
        confidence: true,
        emailThreads: {
          where: { isIgnored: false },
          select: {
            id: true,
            topic: true,
            status: true,
            priority: true,
            waitingOn: true,
            summary: true,
            lastMessageAt: true,
            messages: {
              orderBy: { sentAt: "desc" },
              take: 1,
              select: { snippet: true },
            },
          },
          orderBy: { lastMessageAt: "desc" },
        },
      },
      orderBy: { name: "asc" },
    });

    const decorated = clients.map((client) => {
      const activeThreads = client.emailThreads.filter(
        (thread) => !["Resolved", "Unknown"].includes(thread.status),
      );

      return {
        id: client.id,
        name: client.name,
        notes: client.notes,
        domains: parseJsonArray(client.domainsJson),
        aliases: parseJsonArray(client.aliasesJson),
        confidence: client.confidence,
        activeCount: activeThreads.length,
        totalCount: client.emailThreads.length,
        waitingOnMeCount: client.emailThreads.filter(
          (thread) =>
            thread.status === "Waiting on Me" || thread.waitingOn === "User",
        ).length,
        waitingOnOthersCount: client.emailThreads.filter(
          (thread) =>
            thread.status === "Waiting on Client" ||
            thread.status === "Waiting on Internal Team" ||
            (thread.waitingOn !== "User" && thread.waitingOn !== "Unknown"),
        ).length,
        unknownCount: client.emailThreads.filter(
          (thread) => thread.status === "Unknown",
        ).length,
        lastActivityAt: client.emailThreads[0]?.lastMessageAt ?? null,
        topThreads: client.emailThreads.slice(0, 3).map((thread) => ({
          id: thread.id,
          topic: thread.topic,
          status: thread.status,
          priority: thread.priority,
          lastMessageAt: thread.lastMessageAt,
          snippet: thread.messages[0]?.snippet ?? thread.summary,
        })),
      };
    });

    const allThreads = clients.flatMap((client) =>
      client.emailThreads.map((thread) => ({
        ...thread,
        clientName: client.name,
      })),
    );

    return {
      clients: decorated,
      stats: {
        clients: clients.length,
        threads: allThreads.length,
        waitingOnMe: allThreads.filter(
          (thread) =>
            thread.status === "Waiting on Me" || thread.waitingOn === "User",
        ).length,
        waitingOnOthers: allThreads.filter(
          (thread) =>
            thread.status === "Waiting on Client" ||
            thread.status === "Waiting on Internal Team" ||
            (thread.waitingOn !== "User" && thread.waitingOn !== "Unknown"),
        ).length,
        unknown: allThreads.filter((thread) => thread.status === "Unknown")
          .length,
        highPriority: allThreads.filter((thread) => thread.priority === "High")
          .length,
      },
    };
  }),

  clients: publicProcedure.query(async ({ ctx }) => {
    await ensureUnknownClient(ctx.db);
    await deleteAllEmptyClients(ctx.db);

    return ctx.db.client.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
  }),

  ignoredThreads: publicProcedure.query(async ({ ctx }) => {
    const threads = await ctx.db.emailThread.findMany({
      where: { isIgnored: true },
      select: {
        id: true,
        topic: true,
        subject: true,
        ignoredReason: true,
        lastMessageAt: true,
        summary: true,
        client: { select: { name: true } },
        messages: {
          orderBy: { sentAt: "desc" },
          take: 1,
          select: { senderName: true, senderEmail: true, snippet: true },
        },
      },
      orderBy: { lastMessageAt: "desc" },
      take: 200,
    });

    return threads.map(toThreadListRow).map((thread, index) => ({
      ...thread,
      ignoredReason: threads[index]?.ignoredReason ?? "Ignored by rule",
    }));
  }),

  ignoreRules: publicProcedure.query(async ({ ctx }) => {
    await ensureDefaultIgnoreRules(ctx.db);

    const rules = await ctx.db.ignoreRule.findMany({
      orderBy: [{ enabled: "desc" }, { createdAt: "desc" }],
    });

    return rules.map((rule) => ({
      id: rule.id,
      type: rule.type,
      value: rule.value,
      reason: rule.reason ?? "Manual ignore rule",
      enabled: rule.enabled,
      source: rule.source,
    }));
  }),

  domainRules: publicProcedure.query(async ({ ctx }) => {
    const rules = await ctx.db.domainRule.findMany({
      where: { enabled: true },
      include: { client: { select: { id: true, name: true } } },
      orderBy: [{ role: "asc" }, { domain: "asc" }],
    });

    return rules.map((rule) => ({
      id: rule.id,
      domain: rule.domain,
      role: rule.role,
      reason: rule.reason,
      source: rule.source,
      client: rule.client,
    }));
  }),

  search: publicProcedure
    .input(z.object({ query: z.string().trim().min(1) }))
    .query(async ({ ctx, input }) => {
      const query = input.query;
      const threads = await ctx.db.emailThread.findMany({
        where: {
          isIgnored: false,
          OR: [
            { topic: { contains: query } },
            { subject: { contains: query } },
            { summary: { contains: query } },
            { client: { name: { contains: query } } },
            {
              messages: {
                some: {
                  OR: [
                    { senderEmail: { contains: query } },
                    { senderName: { contains: query } },
                    { cleanBody: { contains: query } },
                    { snippet: { contains: query } },
                  ],
                },
              },
            },
          ],
        },
        select: {
          id: true,
          topic: true,
          subject: true,
          status: true,
          priority: true,
          lastMessageAt: true,
          summary: true,
          client: { select: { name: true } },
          messages: {
            orderBy: { sentAt: "desc" },
            take: 1,
            select: { senderName: true, senderEmail: true, snippet: true },
          },
        },
        orderBy: { lastMessageAt: "desc" },
        take: 50,
      });

      return threads.map(toThreadListRow);
    }),

  threadsByDate: publicProcedure
    .input(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
    .query(async ({ ctx, input }) => {
      const start = new Date(`${input.date}T00:00:00`);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);

      const threads = await ctx.db.emailThread.findMany({
        where: {
          isIgnored: false,
          lastMessageAt: {
            gte: start,
            lt: end,
          },
        },
        select: {
          id: true,
          topic: true,
          subject: true,
          status: true,
          priority: true,
          lastMessageAt: true,
          summary: true,
          client: { select: { name: true } },
          messages: {
            orderBy: { sentAt: "desc" },
            take: 1,
            select: { senderName: true, senderEmail: true, snippet: true },
          },
        },
        orderBy: { lastMessageAt: "desc" },
        take: 200,
      });

      return threads.map(toThreadListRow);
    }),

  createClient: publicProcedure
    .input(z.object({ name: z.string().min(1), threadId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.client.findFirst({
        where: { name: { equals: input.name } },
      });

      const client =
        existing ??
        (await ctx.db.client.create({
          data: {
            name: input.name.trim(),
            aliasesJson: "[]",
            domainsJson: "[]",
            source: "manual",
            notes: "Created from manual thread classification.",
          },
        }));

      if (input.threadId) {
        const current = await ctx.db.emailThread.findUnique({
          where: { id: input.threadId },
          select: { clientId: true },
        });

        await ctx.db.emailThread.update({
          where: { id: input.threadId },
          data: {
            clientId: client.id,
            classificationSource: "manual",
            userOverridden: true,
          },
        });

        await deleteEmptyClients(ctx.db, [current?.clientId]);
      }

      return client;
    }),

  deleteEmptyClient: publicProcedure
    .input(z.object({ clientId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const client = await ctx.db.client.findUniqueOrThrow({
        where: { id: input.clientId },
        select: {
          id: true,
          name: true,
        },
      });

      if (client.name === "Unknown / Unsorted") {
        throw new Error("Unknown / Unsorted cannot be deleted.");
      }

      const visibleThreadCount = await ctx.db.emailThread.count({
        where: {
          clientId: client.id,
          isIgnored: false,
        },
      });

      if (visibleThreadCount > 0) {
        throw new Error("Only clients with zero visible threads can be deleted.");
      }

      await ctx.db.client.delete({ where: { id: client.id } });

      return { ok: true };
    }),

  clientById: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      await ensureUnknownClient(ctx.db);

      const requestedClient = await ctx.db.client.findUnique({
        where: { id: input.id },
        select: { name: true },
      });

      if (requestedClient?.name === "Unknown / Unsorted") {
        await ignoreDomainNoiseThreads(ctx.db, { clientId: input.id });
      }

      const client = await ctx.db.client.findUnique({
        where: { id: input.id },
        select: {
          id: true,
          name: true,
          source: true,
          notes: true,
          aliasesJson: true,
          domainsJson: true,
          domains: { orderBy: { domain: "asc" } },
          contacts: { orderBy: { email: "asc" } },
          emailThreads: {
            where: { isIgnored: false },
            select: {
              id: true,
              subject: true,
              topic: true,
              category: true,
              status: true,
              priority: true,
              waitingOn: true,
              owner: true,
              summary: true,
              lastMessageAt: true,
              actions: {
                where: { status: "open" },
                select: { id: true },
              },
              messages: {
                orderBy: { sentAt: "asc" },
                select: {
                  senderName: true,
                  senderEmail: true,
                  recipientJson: true,
                  ccJson: true,
                  snippet: true,
                },
              },
            },
            orderBy: { lastMessageAt: "desc" },
          },
        },
      });

      if (!client) {
        return { deleted: true as const };
      }

      if (client.name !== "Unknown / Unsorted" && client.emailThreads.length === 0) {
        await ctx.db.client.delete({ where: { id: client.id } });
        return { deleted: true as const };
      }

      return {
        deleted: false as const,
        id: client.id,
        name: client.name,
        source: client.source,
        notes: client.notes,
        aliases: parseJsonArray(client.aliasesJson),
        domains: [...new Set([...parseJsonArray(client.domainsJson), ...client.domains.map((domain) => domain.domain)])],
        contacts: client.contacts.map((contact) => ({
          id: contact.id,
          name: contact.name,
          email: contact.email,
          domain: contact.domain,
        })),
        threads: client.emailThreads.map((thread) => ({
          id: thread.id,
          subject: thread.subject,
          topic: thread.topic,
          category: thread.category,
          status: thread.status,
          priority: thread.priority,
          waitingOn: thread.waitingOn,
          owner: thread.owner,
          summary: thread.summary,
          lastMessageAt: thread.lastMessageAt,
          openActionCount: thread.actions.length,
          snippet: thread.messages.at(-1)?.snippet ?? thread.summary,
          participants: extractParticipants(thread.messages),
        })),
      };
    }),

  threadById: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      await ensureUnknownClient(ctx.db);

      const thread = await ctx.db.emailThread.findUniqueOrThrow({
        where: { id: input.id },
        include: {
          client: true,
          messages: { orderBy: { sentAt: "asc" } },
          actions: { orderBy: { createdAt: "asc" } },
          decisions: { orderBy: { createdAt: "asc" } },
          attachments: { orderBy: { createdAt: "asc" } },
          analysis: true,
        },
      });

      const participants = extractParticipants(thread.messages);
      const latestMessage = thread.messages.at(-1) ?? null;

      return {
        ...thread,
        timeline: parseJsonArray(thread.timelineJson),
        importantEntities: parseJsonArray(thread.importantEntitiesJson),
        participants,
        intelligence: {
          latestMessage: latestMessage
            ? {
                senderName: latestMessage.isFromUser ? "You" : latestMessage.senderName,
                senderEmail: latestMessage.senderEmail,
                sentAt: latestMessage.sentAt,
                isFromUser: latestMessage.isFromUser,
              }
            : null,
          messageCount: thread.messages.length,
          participantCount: participants.contacts.length,
          attachmentCount: thread.attachments.length,
          possibleAction: getPossibleAction(latestMessage),
          participantGroups: groupParticipantsByDomain(participants.contacts),
        },
        analysis: thread.analysis
          ? {
              ...thread.analysis,
              risks: parseJsonArray(thread.analysis.risksJson),
              entities: parseJsonArray(thread.analysis.entitiesJson),
            }
          : null,
      };
    }),

  analyzeThread: publicProcedure
    .input(z.object({ threadId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return analyzeThread(ctx.db, input.threadId);
    }),

  classifyUnknownClientThreads: publicProcedure
    .input(z.object({ clientId: z.string(), maxThreads: z.number().int().min(1).max(200).default(100) }))
    .mutation(async ({ ctx, input }) => {
      const client = await ctx.db.client.findUniqueOrThrow({
        where: { id: input.clientId },
        select: { id: true, name: true },
      });

      if (client.name !== "Unknown / Unsorted") {
        throw new Error("AI classification can only be run from Unknown / Unsorted.");
      }

      const threads = await ctx.db.emailThread.findMany({
        where: {
          clientId: client.id,
          isIgnored: false,
          userOverridden: false,
        },
        select: {
          id: true,
          subject: true,
          domains: { select: { domain: true } },
        },
        orderBy: { lastMessageAt: "desc" },
        take: input.maxThreads,
      });

      let classified = 0;
      let failed = 0;

      for (const thread of threads) {
        const result = await classifyThreadClientFromDomains(ctx.db, {
          entityType: "email_thread",
          entityId: thread.id,
          subject: thread.subject,
          domains: thread.domains.map((domain) => domain.domain),
        });

        if (result && "failed" in result) {
          failed += 1;
          continue;
        }

        if (result?.clientId) {
          await ctx.db.emailThread.update({
            where: { id: thread.id },
            data: {
              clientId: result.clientId,
              classificationSource: result.source === "ai" ? "ai" : "score",
              classifiedDomain: result.classifiedDomain,
              classificationReason: result.classificationReason,
            },
          });
          classified += 1;
        }
      }

      return {
        checked: threads.length,
        classified,
        leftUnknown: threads.length - classified - failed,
        failed,
      };
    }),

  markDomainAsNonClient: publicProcedure
    .input(z.object({ domain: z.string().trim().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const domain = input.domain.trim().toLowerCase();
      const unknown = await ensureUnknownClient(ctx.db);
      await markDomainRule(ctx.db, {
        domain,
        role: "non_client",
        reason: "Marked as non-client from classification repair UI.",
      });

      const affectedThreads = await ctx.db.emailThread.findMany({
        where: {
          isIgnored: false,
          domains: {
            some: {
              OR: domainFilter(domain),
            },
          },
        },
        select: {
          id: true,
          subject: true,
          clientId: true,
          userOverridden: true,
          domains: { select: { domain: true } },
        },
        take: 500,
      });

      let reclassified = 0;
      let ignored = 0;
      let leftUnknown = 0;
      let failed = 0;
      const previousClientIds = new Set<string>();

      for (const thread of affectedThreads) {
        if (thread.clientId) {
          previousClientIds.add(thread.clientId);
        }

        const domains = thread.domains.map((domain) => domain.domain);
        const domainGroups = await classifyDomainsByRules(ctx.db, domains);

        if (domainGroups.candidateDomains.length === 0 && domainGroups.clientDomains.length === 0) {
          await ctx.db.emailThread.update({
            where: { id: thread.id },
            data: {
              clientId: unknown.id,
              isIgnored: true,
              ignoredReason: `Ignored domain-only noise: ${domainGroups.contextDomains.join(", ")}`,
              ignoreSource: "domain_noise",
              classificationSource: "unknown",
              classifiedDomain: null,
              classificationReason: `All external domains are ignored/context after marking ${domain} as non-client.`,
            },
          });
          ignored += 1;
          continue;
        }

        if (thread.userOverridden) {
          leftUnknown += 1;
          continue;
        }

        const result = await classifyThreadClientFromDomains(ctx.db, {
          entityType: "email_thread",
          entityId: thread.id,
          subject: thread.subject,
          domains,
        });

        if (result && "failed" in result) {
          failed += 1;
          continue;
        }

        if (result?.clientId) {
          await ctx.db.emailThread.update({
            where: { id: thread.id },
            data: {
              clientId: result.clientId,
              isIgnored: false,
              ignoredReason: null,
              ignoreSource: null,
              classificationSource: result.source === "ai" ? "ai" : "score",
              classifiedDomain: result.classifiedDomain,
              classificationReason: result.classificationReason,
            },
          });
          reclassified += 1;
          continue;
        }

        await ctx.db.emailThread.update({
          where: { id: thread.id },
          data: {
            clientId: unknown.id,
            isIgnored: false,
            ignoredReason: null,
            ignoreSource: null,
            classificationSource: "unknown",
            classifiedDomain: null,
            classificationReason: `Domain ${domain} marked as non-client.`,
          },
        });
        leftUnknown += 1;
      }

      await deleteEmptyClients(ctx.db, [...previousClientIds]);

      return { affected: affectedThreads.length, ignored, reclassified, leftUnknown, failed };
    }),

  unmarkDomainAsNonClient: publicProcedure
    .input(z.object({ domain: z.string().trim().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const domain = input.domain.trim().toLowerCase();

      const updated = await ctx.db.domainRule.updateMany({
        where: {
          domain,
          role: { in: ["non_client", "vendor", "network", "tooling", "internal"] },
          enabled: true,
        },
        data: { enabled: false },
      });

      await ctx.db.ignoreRule.updateMany({
        where: {
          type: "sender_domain_contains",
          value: domain,
          enabled: true,
        },
        data: { enabled: false },
      });

      return { updated: updated.count };
    }),

  markDomainAsClient: publicProcedure
    .input(z.object({ domain: z.string().trim().min(1), clientId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const domain = normalizeDomainInput(input.domain);
      const client = await ctx.db.client.findUniqueOrThrow({ where: { id: input.clientId } });

      await markDomainRule(ctx.db, {
        domain,
        role: "client",
        clientId: client.id,
        reason: `Marked as client domain for ${client.name}.`,
      });
      await ctx.db.clientDomain.upsert({
        where: { clientId_domain: { clientId: client.id, domain } },
        create: { clientId: client.id, domain, source: "manual", confidence: 1 },
        update: { source: "manual", confidence: 1 },
      });

      const affectedThreads = await ctx.db.emailThread.findMany({
        where: {
          isIgnored: false,
          userOverridden: false,
          domains: {
            some: {
              OR: domainFilter(domain),
            },
          },
        },
        select: { clientId: true },
      });

      const updated = await ctx.db.emailThread.updateMany({
        where: {
          isIgnored: false,
          userOverridden: false,
          domains: {
            some: {
              OR: domainFilter(domain),
            },
          },
        },
        data: {
          clientId: client.id,
          classificationSource: "score",
          classifiedDomain: domain,
          classificationReason: `Matched manually saved client domain ${domain}.`,
        },
      });

      await deleteEmptyClients(ctx.db, affectedThreads.map((thread) => thread.clientId));

      return { updated: updated.count };
    }),

  moveAiClientThreadsToUnknown: publicProcedure
    .input(z.object({ clientId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const unknown = await ensureUnknownClient(ctx.db);
      const updated = await ctx.db.emailThread.updateMany({
        where: {
          clientId: input.clientId,
          classificationSource: "ai",
          userOverridden: false,
        },
        data: {
          clientId: unknown.id,
          classificationSource: "unknown",
          classifiedDomain: null,
          classificationReason: "Moved from AI-created client back to Unknown.",
        },
      });

      await deleteEmptyClients(ctx.db, [input.clientId]);

      return { updated: updated.count };
    }),

  unignoreThread: publicProcedure
    .input(z.object({ threadId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.emailThread.update({
        where: { id: input.threadId },
        data: {
          isIgnored: false,
          ignoredReason: null,
          ignoreSource: null,
        },
      });

      return { ok: true };
    }),

  ignoreThread: publicProcedure
    .input(z.object({ threadId: z.string(), reason: z.string().trim().optional() }))
    .mutation(async ({ ctx, input }) => {
      const thread = await ctx.db.emailThread.findUnique({
        where: { id: input.threadId },
        select: { clientId: true },
      });

      await ctx.db.emailThread.update({
        where: { id: input.threadId },
        data: {
          isIgnored: true,
          ignoredReason: input.reason?.trim() ?? "Manually ignored thread",
          ignoreSource: "manual_thread",
        },
      });

      await deleteEmptyClients(ctx.db, [thread?.clientId]);

      return { ok: true };
    }),

  ignoreThreadDomain: publicProcedure
    .input(z.object({ threadId: z.string(), domain: z.string().trim().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const domain = input.domain.trim().toLowerCase();
      const reason = `Ignored domain-only noise: ${domain}`;
      const unknown = await ensureUnknownClient(ctx.db);

      await upsertIgnoreRule(ctx.db, "sender_domain_contains", domain, reason);
      await markDomainRule(ctx.db, {
        domain,
        role: "non_client",
        reason: "Ignored as noise/domain-only email source.",
      });

      const affectedThreads = await ctx.db.emailThread.findMany({
        where: {
          isIgnored: false,
          domains: {
            some: {
              OR: domainFilter(domain),
            },
          },
        },
        select: {
          id: true,
          subject: true,
          clientId: true,
          userOverridden: true,
          domains: { select: { domain: true } },
        },
        take: 500,
      });

      let ignored = 0;
      let kept = 0;
      let reclassified = 0;
      let failed = 0;
      let currentThreadIgnored = false;
      const previousClientIds = new Set<string>();

      for (const thread of affectedThreads) {
        if (thread.clientId) {
          previousClientIds.add(thread.clientId);
        }

        const domains = thread.domains.map((domain) => domain.domain);
        const domainGroups = await classifyDomainsByRules(ctx.db, domains);

        if (domainGroups.candidateDomains.length === 0 && domainGroups.clientDomains.length === 0) {
          await ctx.db.emailThread.update({
            where: { id: thread.id },
            data: {
              clientId: unknown.id,
              isIgnored: true,
              ignoredReason: `Ignored domain-only noise: ${domainGroups.contextDomains.join(", ")}`,
              ignoreSource: "domain_noise",
              classificationSource: "unknown",
              classifiedDomain: null,
              classificationReason: `All external domains are ignored/context after marking ${domain} as noise.`,
            },
          });
          ignored += 1;
          currentThreadIgnored ||= thread.id === input.threadId;
          continue;
        }

        if (thread.userOverridden) {
          kept += 1;
          continue;
        }

        const result = await classifyThreadClientFromDomains(ctx.db, {
          entityType: "email_thread",
          entityId: thread.id,
          subject: thread.subject,
          domains,
        });

        if (result && "failed" in result) {
          failed += 1;
          kept += 1;
          continue;
        }

        if (result?.clientId) {
          await ctx.db.emailThread.update({
            where: { id: thread.id },
            data: {
              clientId: result.clientId,
              isIgnored: false,
              ignoredReason: null,
              ignoreSource: null,
              classificationSource: result.source === "ai" ? "ai" : "score",
              classifiedDomain: result.classifiedDomain,
              classificationReason: result.classificationReason,
            },
          });
          reclassified += 1;
          kept += 1;
          continue;
        }

        kept += 1;
      }

      await deleteEmptyClients(ctx.db, [...previousClientIds]);

      return { ignored, kept, reclassified, failed, currentThreadIgnored };
    }),

  createIgnoreRule: publicProcedure
    .input(z.object({
      type: ignoreRuleTypeInput,
      value: z.string().trim().min(1),
      reason: z.string().trim().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const value = input.value.trim().toLowerCase();
      const reason = input.reason?.trim() ?? `Manual ignore rule: ${value}`;
      const unknown = await ensureUnknownClient(ctx.db);

      await upsertIgnoreRule(ctx.db, input.type, value, reason);

      let ignored = 0;

      if (input.type === "sender_domain_contains") {
        await markDomainRule(ctx.db, {
          domain: value,
          role: "non_client",
          reason,
        });

        const affectedThreads = await ctx.db.emailThread.findMany({
          where: {
            isIgnored: false,
            domains: {
              some: {
                OR: domainFilter(value),
              },
            },
          },
          select: {
            id: true,
            clientId: true,
            domains: { select: { domain: true } },
          },
          take: 500,
        });
        const previousClientIds = new Set<string>();

        for (const thread of affectedThreads) {
          if (thread.clientId) {
            previousClientIds.add(thread.clientId);
          }

          const domainGroups = await classifyDomainsByRules(ctx.db, thread.domains.map((domain) => domain.domain));

          if (domainGroups.candidateDomains.length > 0 || domainGroups.clientDomains.length > 0) {
            continue;
          }

          await ctx.db.emailThread.update({
            where: { id: thread.id },
            data: {
              clientId: unknown.id,
              isIgnored: true,
              ignoredReason: `Ignored domain-only noise: ${domainGroups.contextDomains.join(", ")}`,
              ignoreSource: "domain_noise",
              classificationSource: "unknown",
              classifiedDomain: null,
              classificationReason: `All external domains are ignored/context after adding ignore rule ${value}.`,
            },
          });
          ignored += 1;
        }

        await deleteEmptyClients(ctx.db, [...previousClientIds]);
      }

      return { ok: true, ignored };
    }),

  disableIgnoreRule: publicProcedure
    .input(z.object({ ruleId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.ignoreRule.update({
        where: { id: input.ruleId },
        data: { enabled: false },
      });

      return { ok: true };
    }),

  deleteIgnoreRule: publicProcedure
    .input(z.object({ ruleId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.ignoreRule.delete({ where: { id: input.ruleId } });

      return { ok: true };
    }),

  workQueues: publicProcedure.query(async ({ ctx }) => {
    await ensureUnknownClient(ctx.db);

    const threads = await ctx.db.emailThread.findMany({
      where: { isIgnored: false },
      include: { client: true, actions: true },
      orderBy: { lastMessageAt: "desc" },
    });

    return {
      waitingOnMe: threads.filter(
        (thread) =>
          thread.status === "Waiting on Me" || thread.waitingOn === "User",
      ),
      waitingOnOthers: threads.filter(
        (thread) =>
          thread.status === "Waiting on Client" ||
          thread.status === "Waiting on Internal Team" ||
          (thread.waitingOn !== "User" && thread.waitingOn !== "Unknown"),
      ),
      unknown: threads.filter((thread) => thread.status === "Unknown"),
      active: threads.filter(
        (thread) => !["Resolved", "Unknown"].includes(thread.status),
      ),
    };
  }),

  updateThreadMetadata: publicProcedure
    .input(metadataInput)
    .mutation(async ({ ctx, input }) => {
      await ensureUnknownClient(ctx.db);

      const current = await ctx.db.emailThread.findUniqueOrThrow({
        where: { id: input.threadId },
      });

      const changes = [
        ["topic", current.topic, input.topic],
        ["status", current.status, input.status],
        ["priority", current.priority, input.priority],
        ["waitingOn", current.waitingOn, input.waitingOn],
        ["owner", current.owner, input.owner],
        ["clientId", current.clientId, input.clientId],
      ] as const;

      await ctx.db.$transaction([
        ...changes
          .filter(([, oldValue, newValue]) => oldValue !== newValue)
          .map(([fieldName, oldValue, newValue]) =>
            ctx.db.userCorrection.create({
              data: {
                entityType: "email_thread",
                entityId: input.threadId,
                fieldName,
                oldValue,
                newValue: newValue ?? "",
              },
            }),
          ),
        ctx.db.emailThread.update({
          where: { id: input.threadId },
          data: {
            clientId: input.clientId,
            topic: input.topic,
            status: input.status,
            priority: input.priority,
            waitingOn: input.waitingOn,
            owner: input.owner,
            classificationSource: "manual",
            userOverridden: true,
          },
        }),
      ]);

      await deleteEmptyClients(ctx.db, [current.clientId]);

      return { ok: true };
    }),

  updateThreadStatus: publicProcedure
    .input(statusInput)
    .mutation(async ({ ctx, input }) => {
      const current = await ctx.db.emailThread.findUniqueOrThrow({
        where: { id: input.threadId },
      });

      await ctx.db.$transaction([
        ctx.db.userCorrection.create({
          data: {
            entityType: "email_thread",
            entityId: input.threadId,
            fieldName: "status",
            oldValue: current.status,
            newValue: input.status,
          },
        }),
        ctx.db.emailThread.update({
          where: { id: input.threadId },
          data: {
            status: input.status,
            userOverridden: true,
            classificationSource: "manual",
          },
        }),
      ]);

      return { ok: true };
    }),

  learnThreadParticipants: publicProcedure
    .input(learnParticipantsInput)
    .mutation(async ({ ctx, input }) => {
      const thread = await ctx.db.emailThread.findUniqueOrThrow({
        where: { id: input.threadId },
        select: {
          clientId: true,
          messages: {
            select: {
              senderName: true,
              senderEmail: true,
              recipientJson: true,
              ccJson: true,
            },
          },
        },
      });
      const participants = extractParticipants(thread.messages);
      const participantByEmail = new Map(participants.contacts.map((contact) => [contact.email, contact]));

      await ctx.db.$transaction([
        ctx.db.emailThread.update({
          where: { id: input.threadId },
          data: {
            clientId: input.clientId,
            classificationSource: "manual",
            userOverridden: true,
          },
        }),
        ...input.domains.map((domain) =>
          ctx.db.clientDomain.upsert({
            where: { clientId_domain: { clientId: input.clientId, domain } },
            create: {
              clientId: input.clientId,
              domain,
              source: "manual",
              confidence: 1,
            },
            update: { confidence: 1, source: "manual" },
          }),
        ),
        ...input.contacts.map((email) => {
          const contact = participantByEmail.get(email);
          const domain = email.split("@")[1]?.toLowerCase() ?? "";

          return ctx.db.clientContact.upsert({
            where: { clientId_email: { clientId: input.clientId, email } },
            create: {
              clientId: input.clientId,
              email,
              name: contact?.name,
              domain,
              source: "manual",
              confidence: 1,
            },
            update: {
              name: contact?.name,
              domain,
              source: "manual",
              confidence: 1,
            },
          });
        }),
      ]);

      await deleteEmptyClients(ctx.db, [thread.clientId]);

      return { ok: true };
    }),

  quickAssignThread: publicProcedure
    .input(learnParticipantsInput)
    .mutation(async ({ ctx, input }) => {
      const thread = await ctx.db.emailThread.findUniqueOrThrow({
        where: { id: input.threadId },
        select: {
          clientId: true,
          messages: {
            select: {
              senderName: true,
              senderEmail: true,
              recipientJson: true,
              ccJson: true,
            },
          },
        },
      });
      const participants = extractParticipants(thread.messages);
      const participantByEmail = new Map(participants.contacts.map((contact) => [contact.email, contact]));

      await ctx.db.$transaction([
        ctx.db.userCorrection.create({
          data: {
            entityType: "email_thread",
            entityId: input.threadId,
            fieldName: "clientId",
            oldValue: thread.clientId,
            newValue: input.clientId,
          },
        }),
        ctx.db.emailThread.update({
          where: { id: input.threadId },
          data: {
            clientId: input.clientId,
            classificationSource: "manual",
            userOverridden: true,
          },
        }),
        ...input.domains.map((domain) =>
          ctx.db.clientDomain.upsert({
            where: { clientId_domain: { clientId: input.clientId, domain } },
            create: {
              clientId: input.clientId,
              domain,
              source: "manual",
              confidence: 1,
            },
            update: { confidence: 1, source: "manual" },
          }),
        ),
        ...input.contacts.map((email) => {
          const contact = participantByEmail.get(email);
          const domain = email.split("@")[1]?.toLowerCase() ?? "";

          return ctx.db.clientContact.upsert({
            where: { clientId_email: { clientId: input.clientId, email } },
            create: {
              clientId: input.clientId,
              email,
              name: contact?.name,
              domain,
              source: "manual",
              confidence: 1,
            },
            update: {
              name: contact?.name,
              domain,
              source: "manual",
              confidence: 1,
            },
          });
        }),
      ]);

      await deleteEmptyClients(ctx.db, [thread.clientId]);

      return { ok: true };
  }),
});

async function deleteEmptyClients(db: Parameters<typeof ensureUnknownClient>[0], clientIds: Array<string | null | undefined>) {
  const ids = [...new Set(clientIds.filter((id): id is string => Boolean(id)))];

  if (ids.length === 0) {
    return;
  }

  const clients = await db.client.findMany({
    where: {
      id: { in: ids },
      name: { not: "Unknown / Unsorted" },
    },
    select: {
      id: true,
      emailThreads: {
        where: { isIgnored: false },
        select: { id: true },
        take: 1,
      },
    },
  });

  const emptyClientIds = clients
    .filter((client) => client.emailThreads.length === 0)
    .map((client) => client.id);

  if (emptyClientIds.length === 0) {
    return;
  }

  await db.client.deleteMany({
    where: {
      id: { in: emptyClientIds },
      name: { not: "Unknown / Unsorted" },
      emailThreads: { none: { isIgnored: false } },
    },
  });
}

async function deleteAllEmptyClients(db: Parameters<typeof ensureUnknownClient>[0]) {
  await db.client.deleteMany({
    where: {
      name: { not: "Unknown / Unsorted" },
      emailThreads: { none: { isIgnored: false } },
    },
  });
}

async function ignoreDomainNoiseThreads(
  db: Parameters<typeof ensureUnknownClient>[0],
  input: { clientId?: string; limit?: number } = {},
) {
  const unknown = await ensureUnknownClient(db);
  const threads = await db.emailThread.findMany({
    where: {
      clientId: input.clientId,
      isIgnored: false,
      domains: { some: {} },
    },
    select: {
      id: true,
      clientId: true,
      domains: { select: { domain: true } },
    },
    orderBy: { lastMessageAt: "desc" },
    take: input.limit ?? 1000,
  });
  const previousClientIds = new Set<string>();
  let ignored = 0;

  for (const thread of threads) {
    const domains = thread.domains.map((domain) => domain.domain);
    const domainGroups = await classifyDomainsByRules(db, domains);

    if (domainGroups.candidateDomains.length > 0 || domainGroups.clientDomains.length > 0) {
      continue;
    }

    if (thread.clientId) {
      previousClientIds.add(thread.clientId);
    }

    await db.emailThread.update({
      where: { id: thread.id },
      data: {
        clientId: unknown.id,
        isIgnored: true,
        ignoredReason: `Ignored domain-only noise: ${domainGroups.contextDomains.join(", ")}`,
        ignoreSource: "domain_noise",
        classificationSource: "unknown",
        classifiedDomain: null,
        classificationReason: "All external domains are ignored/context.",
      },
    });
    ignored += 1;
  }

  await deleteEmptyClients(db, [...previousClientIds]);

  return { ignored };
}

function toThreadListRow(thread: {
  id: string;
  topic: string;
  subject: string;
  status?: string;
  priority?: string;
  lastMessageAt: Date;
  summary: string;
  client?: { name: string } | null;
  messages: Array<{ senderName: string; senderEmail: string; snippet: string }>;
}) {
  return {
    id: thread.id,
    topic: thread.topic,
    subject: thread.subject,
    clientName: thread.client?.name ?? null,
    status: thread.status ?? "Unknown",
    priority: thread.priority ?? "Medium",
    lastMessageAt: thread.lastMessageAt,
    latestSenderName: thread.messages[0]?.senderName ?? "Unknown",
    latestSenderEmail: thread.messages[0]?.senderEmail ?? "",
    snippet: thread.messages[0]?.snippet ?? thread.summary,
  };
}

function domainFilter(domain: string) {
  const normalized = normalizeDomainInput(domain);

  if (!normalized.includes(".")) {
    return [
      { domain: normalized },
      { domain: { contains: normalized } },
    ];
  }

  return [
    { domain: normalized },
    { domain: { endsWith: `.${normalized}` } },
  ];
}

function normalizeDomainInput(value: string) {
  const normalized = value.trim().toLowerCase();

  if (!normalized) {
    return "";
  }

  try {
    const parsed = new URL(normalized.includes("://") ? normalized : `https://${normalized}`);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return normalized
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split("/")[0]!
      .split(":")[0]!
      .trim();
  }
}

function getPossibleAction(
  latestMessage: { cleanBody: string; isFromUser: boolean } | null,
) {
  if (!latestMessage) {
    return {
      label: "No messages",
      tone: "neutral" as const,
      reason: "This thread does not have imported messages yet.",
    };
  }

  if (latestMessage.isFromUser) {
    return {
      label: "Likely waiting on others",
      tone: "waiting" as const,
      reason: "The latest message is from you.",
    };
  }

  const body = latestMessage.cleanBody.toLowerCase();
  const actionPattern = /\b(please confirm|can you|could you|please advise|waiting for|let us know|share|send|provide|confirm|advise)\b/i;

  if (actionPattern.test(body)) {
    return {
      label: "Possible action needed",
      tone: "action" as const,
      reason: "The latest message asks for confirmation, information, or a response.",
    };
  }

  return {
    label: "Review latest message",
    tone: "neutral" as const,
    reason: "The latest message is from someone else.",
  };
}

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { env } from "~/env";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "~/server/api/trpc";
import { getGoogleAccountForUser } from "~/server/gmail/client";
import { backfillGmailThreadsByDays, syncRecentGmailThreads } from "~/server/gmail/sync";
import { ensureUnknownClient } from "~/server/threadwise/system";

export const gmailRouter = createTRPCRouter({
  connectionStatus: publicProcedure.query(async ({ ctx }) => {
    const configured = Boolean(env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET);

    if (!ctx.session?.user) {
      return {
        configured,
        signedIn: false,
        connected: false,
        email: null,
        lastSyncedAt: null,
        lastError: null,
      };
    }

    const [account, syncState] = await Promise.all([
      getGoogleAccountForUser(ctx.db, ctx.session.user.id),
      ctx.db.gmailSyncState.findUnique({ where: { userId: ctx.session.user.id } }),
    ]);

    const hasGmailScope = Boolean(account?.scope?.includes("https://www.googleapis.com/auth/gmail.readonly"));

    return {
      configured,
      signedIn: true,
      connected: Boolean(hasGmailScope && (account?.refresh_token ?? account?.access_token)),
      email: syncState?.email ?? ctx.session.user.email ?? null,
      lastSyncedAt: syncState?.lastSyncedAt ?? null,
      lastError: syncState?.lastError ?? null,
    };
  }),

  syncRecent: protectedProcedure
    .input(z.object({ maxResults: z.number().int().min(1).max(100).default(25) }))
    .mutation(async ({ ctx, input }) => {
      if (!env.AUTH_GOOGLE_ID || !env.AUTH_GOOGLE_SECRET) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Google OAuth is not configured." });
      }

      await ensureUnknownClient(ctx.db);

      return syncRecentGmailThreads(ctx.db, ctx.session.user.id, input.maxResults);
    }),

  backfillDays: protectedProcedure
    .input(z.object({ days: z.number().int().min(1).max(365).default(30) }))
    .mutation(async ({ ctx, input }) => {
      if (!env.AUTH_GOOGLE_ID || !env.AUTH_GOOGLE_SECRET) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Google OAuth is not configured." });
      }

      await ensureUnknownClient(ctx.db);

      return backfillGmailThreadsByDays(ctx.db, ctx.session.user.id, input.days);
    }),

  clearLocalData: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.db.$transaction([
      ctx.db.emailThread.deleteMany({
        where: {
          OR: [
            { provider: "gmail", providerAccountId: ctx.session.user.id },
            { provider: "seed" },
          ],
        },
      }),
      ctx.db.gmailSyncState.deleteMany({ where: { userId: ctx.session.user.id } }),
      ctx.db.client.deleteMany({
        where: {
          source: "seed",
        },
      }),
    ]);

    await ensureUnknownClient(ctx.db);

    return { ok: true };
  }),

  resetImportedEmail: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.db.$transaction([
      ctx.db.aiJob.deleteMany({
        where: {
          OR: [
            { entityType: "email_thread" },
            { entityType: "gmail_thread" },
          ],
        },
      }),
      ctx.db.userCorrection.deleteMany({ where: { entityType: "email_thread" } }),
      ctx.db.emailThread.deleteMany({
        where: {
          OR: [
            { provider: "gmail", providerAccountId: ctx.session.user.id },
            { provider: "seed" },
          ],
        },
      }),
      ctx.db.gmailSyncState.deleteMany({ where: { userId: ctx.session.user.id } }),
    ]);

    await ensureUnknownClient(ctx.db);

    return { ok: true };
  }),

  resetGoogleConnection: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.db.$transaction([
      ctx.db.account.deleteMany({
        where: {
          userId: ctx.session.user.id,
          provider: "google",
        },
      }),
      ctx.db.gmailSyncState.updateMany({
        where: { userId: ctx.session.user.id },
        data: { lastError: null },
      }),
    ]);

    return { ok: true };
  }),
});

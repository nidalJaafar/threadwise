import { TRPCError } from "@trpc/server";

import { env } from "~/env";
import { type PrismaClient } from "../../../generated/prisma";

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};

export async function getGoogleAccountForUser(db: PrismaClient, userId: string) {
  return db.account.findFirst({
    where: { userId, provider: "google" },
  });
}

export async function getGmailAccessToken(db: PrismaClient, userId: string) {
  const account = await getGoogleAccountForUser(db, userId);

  if (!account) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Connect Google before syncing Gmail." });
  }

  if (!account.scope?.includes("https://www.googleapis.com/auth/gmail.readonly")) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Google account is missing Gmail read-only scope." });
  }

  const expiresAt = account.expires_at ? account.expires_at * 1000 : 0;

  if (account.access_token && expiresAt > Date.now() + 60_000) {
    return account.access_token;
  }

  if (!account.refresh_token) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Google token expired. Sign in again to refresh access." });
  }

  if (!env.AUTH_GOOGLE_ID || !env.AUTH_GOOGLE_SECRET) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Google OAuth credentials are not configured." });
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.AUTH_GOOGLE_ID,
      client_secret: env.AUTH_GOOGLE_SECRET,
      refresh_token: account.refresh_token,
      grant_type: "refresh_token",
    }),
  });

  const payload = (await response.json()) as GoogleTokenResponse;

  if (!response.ok || !payload.access_token) {
    const message = payload.error_description ?? payload.error ?? "Failed to refresh Google access token.";
    const isRevoked = isRevokedGoogleToken(message);

    if (isRevoked) {
      await db.account.update({
        where: { id: account.id },
        data: {
          access_token: null,
          refresh_token: null,
          expires_at: null,
        },
      });
    }

    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: isRevoked
        ? "Google connection expired or was revoked. Reconnect Google to continue syncing Gmail."
        : message,
    });
  }

  await db.account.update({
    where: { id: account.id },
    data: {
      access_token: payload.access_token,
      expires_at: payload.expires_in ? Math.floor(Date.now() / 1000) + payload.expires_in : account.expires_at,
      token_type: payload.token_type ?? account.token_type,
      scope: payload.scope ?? account.scope,
    },
  });

  return payload.access_token;
}

function isRevokedGoogleToken(message: string) {
  const normalized = message.toLowerCase();

  return normalized.includes("expired") || normalized.includes("revoked") || normalized.includes("invalid_grant");
}

export async function gmailFetch<T>(accessToken: string, path: string) {
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Gmail API failed: ${response.status} ${body}`);
  }

  return (await response.json()) as T;
}

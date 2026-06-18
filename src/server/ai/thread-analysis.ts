import crypto from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { env } from "~/env";
import { type PrismaClient } from "../../../generated/prisma";

const promptVersion = "thread-analysis-v1";

const analysisSchema = z.object({
  summary: z.string(),
  current_status: z.string(),
  suggested_status: z.enum([
    "Waiting on Me",
    "Waiting on Client",
    "Waiting on Internal Team",
    "In Progress",
    "Blocked",
    "Resolved",
    "Unknown",
  ]),
  actions: z.array(
    z.object({
      description: z.string(),
      owner: z.string(),
      source_quote: z.string().optional().default(""),
    }),
  ),
  decisions: z.array(
    z.object({
      decision: z.string(),
      source_quote: z.string().optional().default(""),
    }),
  ),
  risks_or_blockers: z.array(z.unknown()).transform((items) => items.map(normalizeListItem).filter(Boolean)),
  entities: z.array(z.unknown()).transform((items) => items.map(normalizeListItem).filter(Boolean)),
});

type OpenAIResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
};

export async function analyzeThread(db: PrismaClient, threadId: string) {
  if (!env.OPENAI_API_KEY) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "OPENAI_API_KEY is not configured.",
    });
  }

  const thread = await db.emailThread.findUniqueOrThrow({
    where: { id: threadId },
    include: { messages: { orderBy: { sentAt: "asc" } } },
  });

  const input = buildThreadInput(thread.messages);
  const inputHash = crypto.createHash("sha256").update(input).digest("hex");
  const existing = await db.threadAnalysis.findUnique({ where: { threadId } });

  if (existing?.inputHash === inputHash) {
    return existing;
  }

  const parsed = await callOpenAI(input);

  await db.$transaction([
    db.threadAction.deleteMany({ where: { threadId } }),
    db.threadDecision.deleteMany({ where: { threadId } }),
  ]);

  const analysis = await db.threadAnalysis.upsert({
    where: { threadId },
    create: {
      threadId,
      summary: parsed.summary,
      currentStatus: parsed.current_status,
      suggestedStatus: parsed.suggested_status,
      risksJson: JSON.stringify(parsed.risks_or_blockers),
      entitiesJson: JSON.stringify(parsed.entities),
      model: env.OPENAI_MODEL,
      promptVersion,
      inputHash,
    },
    update: {
      summary: parsed.summary,
      currentStatus: parsed.current_status,
      suggestedStatus: parsed.suggested_status,
      risksJson: JSON.stringify(parsed.risks_or_blockers),
      entitiesJson: JSON.stringify(parsed.entities),
      model: env.OPENAI_MODEL,
      promptVersion,
      inputHash,
    },
  });

  await db.$transaction([
    ...parsed.actions.map((action) =>
      db.threadAction.create({
        data: {
          threadId,
          description: action.description,
          owner: action.owner,
          status: "open",
          sourceQuote: action.source_quote,
        },
      }),
    ),
    ...parsed.decisions.map((decision) =>
      db.threadDecision.create({
        data: {
          threadId,
          decision: decision.decision,
          sourceQuote: decision.source_quote,
        },
      }),
    ),
    db.emailThread.update({
      where: { id: threadId },
      data: {
        summary: parsed.summary,
        aiProcessedAt: new Date(),
        aiVersion: promptVersion,
      },
    }),
  ]);

  return analysis;
}

function buildThreadInput(
  messages: Array<{
    senderName: string;
    senderEmail: string;
    sentAt: Date;
    cleanBody: string;
  }>,
) {
  const maxChars = 28_000;
  const rendered = messages
    .map(
      (message, index) => `Message ${index + 1}
From: ${message.senderName} <${message.senderEmail}>
Sent: ${message.sentAt.toISOString()}
Body:
${message.cleanBody}`,
    )
    .join("\n\n---\n\n");

  if (rendered.length <= maxChars) {
    return rendered;
  }

  return rendered.slice(rendered.length - maxChars);
}

async function callOpenAI(threadInput: string) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You analyze read-only Gmail threads. Return only valid JSON. Do not invent facts. If unclear, say unclear. Focus on latest state. Extract only explicit decisions. Extract actions that are requested or implied by the latest thread state. Include short source quotes from provided messages. risks_or_blockers and entities must be arrays of strings only, not objects.",
        },
        {
          role: "user",
          content: `Analyze this thread and return JSON with exactly these fields: summary, current_status, suggested_status, actions, decisions, risks_or_blockers, entities.

suggested_status must be one of: Waiting on Me, Waiting on Client, Waiting on Internal Team, In Progress, Blocked, Resolved, Unknown.

actions must be an array of { description, owner, source_quote }.
decisions must be an array of { decision, source_quote }.
risks_or_blockers must be an array of strings.
entities must be an array of strings like company names, systems, products, IDs, environments, or technical terms.

Thread messages:
${threadInput}`,
        },
      ],
    }),
  });

  const payload = (await response.json()) as OpenAIResponse;

  if (!response.ok) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: payload.error?.message ?? "OpenAI analysis failed.",
    });
  }

  const content = payload.choices?.[0]?.message?.content;

  if (!content) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "OpenAI returned an empty analysis." });
  }

  const json = JSON.parse(content) as unknown;
  return analysisSchema.parse(json);
}

function normalizeListItem(item: unknown) {
  if (typeof item === "string") {
    return item.trim();
  }

  if (!item || typeof item !== "object") {
    return "";
  }

  const record = item as Record<string, unknown>;
  const preferred = record.name ?? record.entity ?? record.value ?? record.label ?? record.title ?? record.description;

  if (typeof preferred === "string") {
    return preferred.trim();
  }

  return Object.entries(record)
    .filter(([, value]) => typeof value === "string" || typeof value === "number")
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(", ")
    .trim();
}

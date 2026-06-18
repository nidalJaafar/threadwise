import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { env } from "~/env";
import { type PrismaClient } from "../../../generated/prisma";

const promptVersion = "client-domain-classification-v1";
const minimumConfidence = 0.75;

const classificationSchema = z.object({
  client_name: z.string().trim().min(1),
  selected_client_domain: z.string().trim().default(""),
  confidence: z.number().min(0).max(1),
  domains_to_remember: z.array(z.string()).default([]),
  reason: z.string().default(""),
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

export type ClientClassificationInput = {
  subject: string;
  candidateDomains: string[];
  contextDomains: string[];
};

export async function classifyClientFromDomains(db: PrismaClient, input: ClientClassificationInput) {
  const candidateDomains = normalizeDomains(input.candidateDomains);
  const contextDomains = normalizeDomains(input.contextDomains);

  if (!env.OPENAI_API_KEY || candidateDomains.length === 0) {
    return null;
  }

  const knownClients = await db.client.findMany({
    where: { name: { not: "Unknown / Unsorted" } },
    select: {
      name: true,
      domainsJson: true,
      domains: { select: { domain: true } },
    },
    orderBy: { name: "asc" },
  });

  const parsed = await callOpenAI({
    subject: input.subject,
    candidateDomains,
    contextDomains,
    knownClients: knownClients.map((client) => ({
      name: client.name,
      domains: normalizeDomains([
        ...parseStringArray(client.domainsJson),
        ...client.domains.map((domain) => domain.domain),
      ]),
    })),
  });

  const clientName = parsed.client_name.trim();
  const selectedClientDomain = normalizeDomains([parsed.selected_client_domain])[0] ?? "";
  const rememberedDomains = normalizeDomains(parsed.domains_to_remember)
    .filter((domain) => candidateDomains.includes(domain));

  return {
    clientName,
    selectedClientDomain,
    confidence: parsed.confidence,
    shouldAssign: parsed.confidence >= minimumConfidence && !isUnknownClientName(clientName) && candidateDomains.includes(selectedClientDomain),
    domainsToRemember: rememberedDomains.length ? rememberedDomains : selectedClientDomain ? [selectedClientDomain] : [],
    reason: parsed.reason,
    promptVersion,
    model: env.OPENAI_MODEL,
  };
}

async function callOpenAI(input: {
  subject: string;
  candidateDomains: string[];
  contextDomains: string[];
  knownClients: Array<{ name: string; domains: string[] }>;
}) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You classify Gmail threads into client organizations using only candidate domains, context domains, and subject. Do not infer people. Context domains are vendors, networks, tools, or infrastructure and must not be selected as the client. Prefer an existing client when candidate domains match. Return only valid JSON. If candidate domains are unclear, return client_name Unknown with low confidence.",
        },
        {
          role: "user",
          content: `Classify this thread's client organization.

Use only these domains and subject. Do not use or ask for email bodies, names, or individual email addresses.

Return JSON with exactly: client_name, selected_client_domain, confidence, domains_to_remember, reason.

Rules:
- client_name should be the organization/client name, not a person.
- selected_client_domain must be one of the candidate client domains, or empty if unknown.
- confidence is 0 to 1.
- domains_to_remember must only include candidate client domains.
- Never select context/non-client domains as the client.
- Prefer known client names when appropriate.
- Return client_name "Unknown" with confidence below 0.75 if unsure.

Candidate client domains:
${input.candidateDomains.join("\n")}

Context/non-client domains:
${input.contextDomains.join("\n") || "none"}

Subject:
${input.subject}

Known clients:
${input.knownClients.map((client) => `${client.name}: ${client.domains.join(", ") || "no domains"}`).join("\n")}`,
        },
      ],
    }),
  });

  const payload = (await response.json()) as OpenAIResponse;

  if (!response.ok) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: payload.error?.message ?? "OpenAI client classification failed.",
    });
  }

  const content = payload.choices?.[0]?.message?.content;

  if (!content) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "OpenAI returned an empty client classification." });
  }

  return classificationSchema.parse(JSON.parse(content));
}

function normalizeDomains(domains: string[]) {
  return [...new Set(domains.map((domain) => domain.trim().toLowerCase()).filter(Boolean))].sort();
}

function isUnknownClientName(name: string) {
  const normalized = name.trim().toLowerCase();
  return normalized === "unknown" || normalized === "unknown / unsorted" || normalized === "unsorted";
}

function parseStringArray(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

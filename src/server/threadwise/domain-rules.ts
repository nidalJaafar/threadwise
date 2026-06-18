import { type PrismaClient } from "../../../generated/prisma";

export type DomainRole = "client" | "non_client" | "internal" | "vendor" | "network" | "tooling";

export const contextRoles = new Set<DomainRole>(["non_client", "internal", "vendor", "network", "tooling"]);

const defaultDomainRules: Array<{ domain: string; role: DomainRole; reason: string }> = [
  { domain: "visa.com", role: "network", reason: "Payment network, usually context rather than the client" },
  { domain: "visa", role: "network", reason: "Payment network, usually context rather than the client" },
  { domain: "mastercard.com", role: "network", reason: "Payment network, usually context rather than the client" },
  { domain: "mastercard", role: "network", reason: "Payment network, usually context rather than the client" },
  { domain: "ni.com", role: "vendor", reason: "Vendor/context domain, not usually the client" },
  { domain: "apple.com", role: "network", reason: "Wallet/platform domain, usually context rather than the client" },
  { domain: "google.com", role: "tooling", reason: "Google/tooling domain, usually context rather than the client" },
  { domain: "googlemail.com", role: "tooling", reason: "Google/tooling domain, usually context rather than the client" },
  { domain: "microsoft.com", role: "tooling", reason: "Microsoft/tooling domain, usually context rather than the client" },
  { domain: "atlassian.net", role: "tooling", reason: "Atlassian notification/tooling domain" },
  { domain: "gitlab.com", role: "tooling", reason: "GitLab notification/tooling domain" },
];

export async function ensureDefaultDomainRules(db: PrismaClient) {
  for (const rule of defaultDomainRules) {
    await db.domainRule.upsert({
      where: { domain_role: { domain: rule.domain, role: rule.role } },
      create: {
        domain: rule.domain,
        role: rule.role,
        reason: rule.reason,
        source: "builtin",
        enabled: true,
      },
      update: {
        reason: rule.reason,
        source: "builtin",
      },
    });
  }
}

export async function classifyDomainsByRules(db: PrismaClient, domains: string[]) {
  await ensureDefaultDomainRules(db);

  const normalizedDomains = normalizeDomains(domains);
  const rules = await db.domainRule.findMany({
    where: { enabled: true },
    select: { domain: true, role: true, clientId: true },
  });
  const clientDomains: Array<{ domain: string; clientId: string }> = [];
  const contextDomains: string[] = [];
  const candidateDomains: string[] = [];

  for (const domain of normalizedDomains) {
    const matchingRules = rules.filter((rule) => domainMatchesRule(domain, rule.domain));
    const clientRule = matchingRules.find((rule) => rule.role === "client" && rule.clientId);
    const contextRule = matchingRules.find((rule) => contextRoles.has(rule.role as DomainRole));

    if (clientRule?.clientId) {
      clientDomains.push({ domain, clientId: clientRule.clientId });
      continue;
    }

    if (contextRule) {
      contextDomains.push(domain);
      continue;
    }

    candidateDomains.push(domain);
  }

  return { clientDomains, candidateDomains, contextDomains };
}

export async function markDomainRule(
  db: PrismaClient,
  input: { domain: string; role: DomainRole; clientId?: string | null; reason: string; source?: string },
) {
  const domain = normalizeDomain(input.domain);

  await db.domainRule.updateMany({
    where: {
      domain,
      role: { not: input.role },
    },
    data: { enabled: false },
  });

  return db.domainRule.upsert({
    where: { domain_role: { domain, role: input.role } },
    create: {
      domain,
      role: input.role,
      clientId: input.clientId ?? null,
      reason: input.reason,
      source: input.source ?? "manual",
      enabled: true,
    },
    update: {
      clientId: input.clientId ?? null,
      reason: input.reason,
      source: input.source ?? "manual",
      enabled: true,
    },
  });
}

export function normalizeDomains(domains: string[]) {
  return [...new Set(domains.map(normalizeDomain).filter(Boolean))].sort();
}

function normalizeDomain(domain: string) {
  const value = domain.trim().toLowerCase();

  if (!value) {
    return "";
  }

  try {
    const parsed = new URL(value.includes("://") ? value : `https://${value}`);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return value
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split("/")[0]!
      .split(":")[0]!
      .trim();
  }
}

export function domainMatchesRule(domain: string, ruleDomain: string) {
  const normalizedRule = normalizeDomain(ruleDomain);

  if (!normalizedRule) {
    return false;
  }

  if (domain === normalizedRule || domain.endsWith(`.${normalizedRule}`)) {
    return true;
  }

  if (!normalizedRule.includes(".")) {
    return domain.split(".").some((label) => label === normalizedRule || label.includes(normalizedRule));
  }

  return false;
}

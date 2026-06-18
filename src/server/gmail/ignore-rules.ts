import { type PrismaClient } from "../../../generated/prisma";

export type IgnoreRuleInput = {
  type: "sender_email_contains" | "sender_domain_contains" | "subject_contains" | "subject_starts_with";
  value: string;
  reason: string;
};

export type IgnoreRuleType = IgnoreRuleInput["type"];

export type IgnoreCheckInput = {
  subject: string;
  senderEmails: string[];
};

const defaultIgnoreRules: IgnoreRuleInput[] = [
  {
    type: "sender_email_contains",
    value: "calendar-notification@google.com",
    reason: "Google Calendar notification",
  },
  {
    type: "sender_email_contains",
    value: "calendar-notification@googlemail.com",
    reason: "Google Calendar notification",
  },
  { type: "subject_starts_with", value: "Invitation:", reason: "Calendar invitation" },
  { type: "subject_starts_with", value: "Updated invitation:", reason: "Calendar invitation update" },
  { type: "subject_starts_with", value: "Canceled event:", reason: "Calendar cancellation" },
  { type: "subject_starts_with", value: "Cancelled event:", reason: "Calendar cancellation" },
  { type: "subject_starts_with", value: "Accepted:", reason: "Calendar RSVP notification" },
  { type: "subject_starts_with", value: "Declined:", reason: "Calendar RSVP notification" },
  { type: "subject_starts_with", value: "Tentative:", reason: "Calendar RSVP notification" },
  { type: "subject_contains", value: "team meeting", reason: "Team meeting notification" },
  { type: "subject_contains", value: "weekly meeting", reason: "Team meeting notification" },
  { type: "subject_contains", value: "daily standup", reason: "Team meeting notification" },
  { type: "subject_contains", value: "standup", reason: "Team meeting notification" },
  { type: "subject_contains", value: "sprint planning", reason: "Team meeting notification" },
  { type: "subject_contains", value: "retrospective", reason: "Team meeting notification" },
  { type: "subject_contains", value: "Microsoft Teams meeting Join", reason: "Microsoft Teams meeting notification" },
  { type: "sender_domain_contains", value: "atlassian.net", reason: "Atlassian/Jira notification" },
  { type: "sender_email_contains", value: "jira", reason: "Jira notification" },
  { type: "subject_contains", value: "jira", reason: "Jira notification" },
  { type: "sender_email_contains", value: "gitlab", reason: "GitLab notification" },
  { type: "subject_contains", value: "[gitlab]", reason: "GitLab notification" },
  { type: "subject_contains", value: "merge request", reason: "GitLab notification" },
  { type: "subject_contains", value: "pipeline failed", reason: "GitLab notification" },
  { type: "sender_domain_contains", value: "harvestapp.com", reason: "Harvest notification" },
];

export async function ensureDefaultIgnoreRules(db: PrismaClient) {
  for (const rule of defaultIgnoreRules) {
    const value = rule.value.toLowerCase();
    await upsertIgnoreRule(db, rule.type, value, rule.reason, "builtin");
  }
}

export async function upsertIgnoreRule(
  db: PrismaClient,
  type: IgnoreRuleType,
  value: string,
  reason: string,
  source = "manual",
) {
  const existing = await db.ignoreRule.findFirst({ where: { type, value } });

  if (existing) {
    return db.ignoreRule.update({
      where: { id: existing.id },
      data: { reason, enabled: true, source },
    });
  }

  return db.ignoreRule.create({
    data: {
      type,
      value,
      reason,
      enabled: true,
      source,
    },
  });
}

export function getIgnoreMatch(input: IgnoreCheckInput, rules: IgnoreRuleInput[]) {
  const subject = input.subject.toLowerCase();
  const senderEmails = input.senderEmails.map((email) => email.toLowerCase());
  const senderDomains = senderEmails.map((email) => email.split("@")[1] ?? "");

  for (const rule of rules) {
    const value = rule.value.toLowerCase();

    if (rule.type === "subject_contains" && subject.includes(value)) {
      return rule.reason;
    }

    if (rule.type === "subject_starts_with" && subject.startsWith(value)) {
      return rule.reason;
    }

    if (rule.type === "sender_email_contains" && senderEmails.some((email) => email.includes(value))) {
      return rule.reason;
    }

    if (rule.type === "sender_domain_contains" && senderDomains.some((domain) => domain.includes(value))) {
      return rule.reason;
    }
  }

  return null;
}

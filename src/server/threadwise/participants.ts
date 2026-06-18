export type ParticipantMessage = {
  senderName: string;
  senderEmail: string;
  recipientJson: string;
  ccJson: string;
};

export type ParticipantContact = {
  name: string;
  email: string;
  domain: string;
};

export function parseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;

    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === "string");
    }
  } catch {
    return [];
  }

  return [];
}

export function extractParticipants(messages: ParticipantMessage[]) {
  const contacts = new Map<string, ParticipantContact>();

  for (const message of messages) {
    addContact(contacts, message.senderName, message.senderEmail);

    for (const email of [...parseJsonArray(message.recipientJson), ...parseJsonArray(message.ccJson)]) {
      addContact(contacts, "", email);
    }
  }

  const sortedContacts = [...contacts.values()].sort((a, b) => a.email.localeCompare(b.email));
  const domains = [...new Set(sortedContacts.map((contact) => contact.domain).filter(Boolean))].sort();

  return { domains, contacts: sortedContacts };
}

export function groupParticipantsByDomain(contacts: ParticipantContact[]) {
  const groups = new Map<string, Array<{ name: string; email: string }>>();

  for (const contact of contacts) {
    const current = groups.get(contact.domain) ?? [];
    current.push({ name: contact.name, email: contact.email });
    groups.set(contact.domain, current);
  }

  return [...groups.entries()]
    .map(([domain, groupedContacts]) => ({
      domain,
      contacts: groupedContacts.sort((a, b) => a.email.localeCompare(b.email)),
    }))
    .sort((a, b) => a.domain.localeCompare(b.domain));
}

function addContact(contacts: Map<string, ParticipantContact>, name: string, email: string) {
  const normalizedEmail = email.trim().toLowerCase();

  if (!normalizedEmail?.includes("@")) {
    return;
  }

  const domain = normalizedEmail.split("@")[1] ?? "";
  const existing = contacts.get(normalizedEmail);

  contacts.set(normalizedEmail, {
    name: existing?.name ?? name.trim(),
    email: normalizedEmail,
    domain,
  });
}

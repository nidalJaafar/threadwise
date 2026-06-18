import { type PrismaClient } from "../../../generated/prisma";

export async function ensureUnknownClient(db: PrismaClient) {
  const existing = await db.client.findFirst({ where: { name: "Unknown / Unsorted" } });

  if (existing) {
    return existing;
  }

  return db.client.create({
    data: {
      name: "Unknown / Unsorted",
      aliasesJson: "[]",
      domainsJson: "[]",
      confidence: 0,
      source: "system",
      notes: "Threads that need manual classification.",
    },
  });
}

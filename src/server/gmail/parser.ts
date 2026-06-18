type GmailHeader = {
  name?: string;
  value?: string;
};

export type GmailPayload = {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: {
    data?: string;
    size?: number;
    attachmentId?: string;
  };
  parts?: GmailPayload[];
};

export type ParsedGmailMessage = {
  subject: string;
  senderName: string;
  senderEmail: string;
  recipients: string[];
  cc: string[];
  sentAt: Date;
  rawBody: string;
  cleanBody: string;
  snippet: string;
  attachments: Array<{
    filename: string;
    mimeType: string;
    size: number;
    providerAttachmentId: string;
  }>;
};

export function parseGmailMessage(message: {
  id: string;
  internalDate?: string;
  snippet?: string;
  payload?: GmailPayload;
}): ParsedGmailMessage {
  const headers = message.payload?.headers ?? [];
  const headerSubject = getHeader(headers, "subject");
  const subject = headerSubject ? headerSubject : "(no subject)";
  const from = parseAddress(getHeader(headers, "from"));
  const date = getHeader(headers, "date");
  const extractedBody = extractBody(message.payload);
  const rawBody = extractedBody ? extractedBody : (message.snippet ?? "");
  const cleanBody = cleanEmailBody(rawBody);
  const cleanSnippet = cleanBody.slice(0, 180);

  return {
    subject,
    senderName: from.name ? from.name : from.email ? from.email : "Unknown",
    senderEmail: from.email ? from.email : "unknown@example.com",
    recipients: parseAddressList(getHeader(headers, "to")),
    cc: parseAddressList(getHeader(headers, "cc")),
    sentAt: parseDate(date, message.internalDate),
    rawBody,
    cleanBody,
    snippet: cleanSnippet ? cleanSnippet : (message.snippet ?? ""),
    attachments: extractAttachments(message.id, message.payload),
  };
}

export function normalizeTopic(subject: string) {
  const normalized = subject
    .replace(/^\s*((re|fw|fwd):\s*)+/i, "")
    .replace(/\s+/g, " ")
    .trim();

  return normalized ? normalized : "Untitled thread";
}

export function domainFromEmail(email: string) {
  return email.split("@")[1]?.toLowerCase() ?? "";
}

function getHeader(headers: GmailHeader[], name: string) {
  return headers.find((header) => header.name?.toLowerCase() === name)?.value ?? "";
}

function parseAddress(value: string) {
  const match = /^(.*?)\s*<([^>]+)>$/.exec(value);

  if (match) {
    return {
      name: match[1]?.replaceAll('"', "").trim() ?? "",
      email: match[2]?.trim().toLowerCase() ?? "",
    };
  }

  return { name: "", email: value.trim().toLowerCase() };
}

function parseAddressList(value: string) {
  if (!value) return [];

  return value
    .split(",")
    .map((item) => parseAddress(item).email)
    .filter(Boolean);
}

function parseDate(dateHeader: string, internalDate?: string) {
  const fromHeader = dateHeader ? new Date(dateHeader) : null;

  if (fromHeader && !Number.isNaN(fromHeader.getTime())) {
    return fromHeader;
  }

  const fromInternal = internalDate ? new Date(Number(internalDate)) : null;

  if (fromInternal && !Number.isNaN(fromInternal.getTime())) {
    return fromInternal;
  }

  return new Date();
}

function extractBody(payload?: GmailPayload): string {
  if (!payload) return "";

  const html = findPart(payload, "text/html");
  const plain = findPart(payload, "text/plain");
  const body = html?.body?.data ?? plain?.body?.data ?? payload.body?.data;

  if (!body) return "";

  const decoded = decodeBase64Url(body);
  return html ? htmlToText(stripQuotedHtml(decoded)) : decoded;
}

function findPart(payload: GmailPayload, mimeType: string): GmailPayload | undefined {
  if (payload.mimeType === mimeType && payload.body?.data) {
    return payload;
  }

  for (const part of payload.parts ?? []) {
    const found = findPart(part, mimeType);

    if (found) return found;
  }

  return undefined;
}

function extractAttachments(messageId: string, payload?: GmailPayload) {
  const attachments: ParsedGmailMessage["attachments"] = [];

  function walk(part?: GmailPayload) {
    if (!part) return;

    if (part.filename && part.body?.attachmentId) {
      attachments.push({
        filename: part.filename,
        mimeType: part.mimeType ?? "application/octet-stream",
        size: part.body.size ?? 0,
        providerAttachmentId: `${messageId}:${part.body.attachmentId}`,
      });
    }

    for (const child of part.parts ?? []) {
      walk(child);
    }
  }

  walk(payload);
  return attachments;
}

function decodeBase64Url(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}

function htmlToText(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ");
}

function stripQuotedHtml(html: string) {
  let result = html;

  const quotePatterns = [
    /<div[^>]+class=["'][^"']*gmail_quote[^"']*["'][\s\S]*$/i,
    /<div[^>]+class=["'][^"']*gmail_attr[^"']*["'][\s\S]*$/i,
    /<blockquote[\s\S]*?<\/blockquote>/gi,
    /<div[^>]+id=["']divRplyFwdMsg["'][\s\S]*$/i,
    /<div[^>]+id=["']appendonsend["'][\s\S]*$/i,
    /<div[^>]+class=["'][^"']*moz-cite-prefix[^"']*["'][\s\S]*$/i,
    /<div[^>]+class=["'][^"']*yahoo_quoted[^"']*["'][\s\S]*$/i,
    /<hr[^>]*>[\s\S]*$/i,
    /<p[^>]*>\s*On[\s\S]{0,500}?wrote:\s*<\/p>[\s\S]*$/i,
  ];

  for (const pattern of quotePatterns) {
    result = result.replace(pattern, "");
  }

  return result;
}

export function cleanEmailBody(body: string) {
  const normalized = body
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/<mailto:([^>]+)>/gi, "")
    .replace(/\[cid:[^\]]+\]/gi, "")
    .replace(/\[image:[^\]]+\]/gi, "")
    .replace(/\s*<www\.[^>]+>/gi, "");

  const lines = normalized.split("\n");
  const quoteStart = lines.findIndex((line, index) => isQuoteBoundary(line, index));
  const unquotedLines = (quoteStart >= 0 ? lines.slice(0, quoteStart) : lines)
    .filter((line) => !/^\s*>/.test(line))
    .filter((line) => !isNoiseLine(line));

  const signatureStart = findTrailingSignatureStart(unquotedLines);
  const contentLines = signatureStart >= 0 ? unquotedLines.slice(0, signatureStart) : unquotedLines;

  return contentLines
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isQuoteBoundary(line: string, index: number) {
  const value = line.trim();

  if (!value) return false;

  return (
    /^-{2,}\s*Original Message\s*-{2,}$/i.test(value) ||
    /^_{5,}$/.test(value) ||
    /^Begin forwarded message:/i.test(value) ||
    /^Forwarded message/i.test(value) ||
    /^On .+ wrote:$/i.test(value) ||
    /^From:\s.+/i.test(value) ||
    (index > 0 && /^Sent:\s.+/i.test(value)) ||
    (index > 0 && /^To:\s.+/i.test(value)) ||
    (index > 0 && /^Subject:\s*(re|fw|fwd)?:/i.test(value))
  );
}

function isNoiseLine(line: string) {
  const value = line.trim();

  return (
    /^\[?cid:/i.test(value) ||
    /^image\d+\.(png|jpg|jpeg|gif)/i.test(value) ||
    /^www\.[a-z0-9.-]+\.[a-z]{2,}/i.test(value) ||
    /^tel\s*\+?\d/i.test(value) ||
    /^mobile\s*\+?\d/i.test(value) ||
    /^phone\s*\+?\d/i.test(value)
  );
}

function findTrailingSignatureStart(lines: string[]) {
  const nonEmptyBefore = (index: number) => lines.slice(0, index).filter((line) => line.trim()).length;

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const value = lines[index]?.trim() ?? "";

    if (/^(best|regards|best regards|kind regards|thanks|thank you),?$/i.test(value) && nonEmptyBefore(index) >= 2) {
      return index;
    }
  }

  return -1;
}

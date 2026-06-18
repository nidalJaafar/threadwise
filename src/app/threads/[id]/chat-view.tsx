"use client";

import { useRef } from "react";

import { formatDate } from "~/app/_components/threadwise-ui";

type ChatMessage = {
  id: string;
  senderName: string;
  sentAt: Date;
  cleanBody: string;
  hasAttachments: boolean;
  isFromUser: boolean;
};

export function ChatView({ messages }: { messages: ChatMessage[] }) {
  const firstMessageRef = useRef<HTMLDivElement | null>(null);
  const lastMessageRef = useRef<HTMLDivElement | null>(null);

  return (
    <div className="relative">
      <div className="sticky top-3 z-10 mb-4 ml-auto flex w-fit gap-2 rounded-full border border-stone-800 bg-stone-950/90 p-1 shadow-lg shadow-black/20 backdrop-blur">
        <button
          type="button"
          onClick={() => firstMessageRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
          className="rounded-full px-3 py-1.5 text-sm font-semibold text-stone-300 transition hover:bg-stone-900 hover:text-stone-50"
        >
          Top ↑
        </button>
        <button
          type="button"
          onClick={() => lastMessageRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })}
          className="rounded-full px-3 py-1.5 text-sm font-semibold text-stone-300 transition hover:bg-stone-900 hover:text-stone-50"
        >
          Latest ↓
        </button>
      </div>

      <div className="space-y-4">
        {messages.map((message, index) => (
          <div
            key={message.id}
            ref={getMessageRef(index, messages.length, firstMessageRef, lastMessageRef)}
            className={`flex ${message.isFromUser ? "justify-end" : "justify-start"}`}
          >
            <div className={`max-w-[min(78%,52rem)] rounded-2xl px-4 py-3 ${message.isFromUser ? "bg-[#d7bd79] text-stone-950" : "bg-stone-900 text-stone-100"}`}>
              <div className={`mb-2 flex flex-wrap items-center gap-2 text-xs ${message.isFromUser ? "text-stone-700" : "text-stone-500"}`}>
                <span className="font-semibold">{message.isFromUser ? "You" : message.senderName}</span>
                <span>{formatDate(message.sentAt)}</span>
              </div>
              <p className="whitespace-pre-line text-sm leading-6">{message.cleanBody}</p>
              {message.hasAttachments && <p className="mt-2 text-xs font-semibold">Attachment included</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function getMessageRef(
  index: number,
  messageCount: number,
  firstMessageRef: React.RefObject<HTMLDivElement | null>,
  lastMessageRef: React.RefObject<HTMLDivElement | null>,
) {
  if (index === 0) {
    return firstMessageRef;
  }

  if (index === messageCount - 1) {
    return lastMessageRef;
  }

  return undefined;
}

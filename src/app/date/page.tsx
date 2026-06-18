import Link from "next/link";

import { AppFrame, PriorityBadge, StatusBadge, TopBar, formatDate } from "~/app/_components/threadwise-ui";
import { api } from "~/trpc/server";

export default async function DateThreadsPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { date: rawDate } = await searchParams;
  const today = formatDateInput(new Date());
  const selectedDate = isDateInput(rawDate) ? rawDate : today;
  const selectedDateObject = parseDateInput(selectedDate);
  const calendarDays = getCalendarDays(selectedDateObject);
  const previousMonthDate = addMonths(selectedDateObject, -1);
  const nextMonthDate = addMonths(selectedDateObject, 1);
  const threads = await api.threadwise.threadsByDate({ date: selectedDate });

  return (
    <AppFrame>
      <TopBar title="Threads By Date" backHref="/" backLabel="Clients" />

      <section className="mb-5 rounded-2xl border border-stone-800 bg-stone-950 p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-stone-100">{formatMonthHeading(selectedDateObject)}</h2>
            <p className="mt-1 text-sm text-stone-500">Pick a day to view threads active on that date.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={`/date?date=${formatDateInput(previousMonthDate)}`} className="rounded-full border border-stone-700 px-3 py-1.5 text-sm font-semibold text-stone-300 hover:border-stone-500 hover:text-stone-50">
              ← Previous
            </Link>
            {selectedDate !== today && (
              <Link href={`/date?date=${today}`} className="rounded-full bg-[#c7ab6b] px-3 py-1.5 text-sm font-semibold text-stone-950 hover:bg-[#d8bd7d]">
                Today
              </Link>
            )}
            <Link href={`/date?date=${formatDateInput(nextMonthDate)}`} className="rounded-full border border-stone-700 px-3 py-1.5 text-sm font-semibold text-stone-300 hover:border-stone-500 hover:text-stone-50">
              Next →
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold uppercase tracking-[0.2em] text-stone-600">
          {weekdays.map((day) => (
            <div key={day} className="py-2">{day}</div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {calendarDays.map((day, index) =>
            day ? (
              <Link
                key={day.date}
                href={`/date?date=${day.date}`}
                className={`rounded-xl border px-2 py-3 text-center text-sm font-semibold transition ${day.date === selectedDate
                  ? "border-[#c7ab6b] bg-[#c7ab6b] text-stone-950"
                  : day.date === today
                    ? "border-[#c7ab6b]/60 bg-[#c7ab6b]/10 text-[#e8d08a] hover:bg-[#c7ab6b]/20"
                    : "border-stone-800 bg-black/20 text-stone-300 hover:border-stone-600 hover:bg-stone-900"
                }`}
              >
                {day.dayOfMonth}
              </Link>
            ) : (
              <div key={`blank-${index}`} className="rounded-xl border border-transparent px-2 py-3" />
            ),
          )}
        </div>
      </section>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-stone-500">
          {threads.length} non-ignored threads active on {formatReadableDate(selectedDate)}.
        </p>
        <Link href="/ignored" className="text-sm text-stone-500 hover:text-stone-200">
          View ignored emails →
        </Link>
      </div>

      {threads.length ? (
        <div className="space-y-2">
          {threads.map((thread) => (
            <Link
              key={thread.id}
              href={`/threads/${thread.id}`}
              className="block rounded-2xl border border-stone-800 bg-stone-950 px-4 py-4 transition hover:border-stone-600 hover:bg-stone-900"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-lg font-semibold text-stone-50">{thread.topic}</h2>
                  <p className="mt-1 text-sm text-stone-500">{thread.clientName ?? "No client"} · {thread.subject}</p>
                  <p className="mt-2 line-clamp-2 text-sm leading-6 text-stone-500">{thread.snippet}</p>
                </div>
                <span className="shrink-0 text-sm text-stone-600">{formatDate(thread.lastMessageAt)}</span>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <StatusBadge value={thread.status} />
                <PriorityBadge value={thread.priority} />
                <span className="text-stone-600">From {thread.latestSenderName}</span>
                {thread.latestSenderEmail && <span className="text-stone-700">{thread.latestSenderEmail}</span>}
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-stone-800 bg-stone-950 p-8 text-center">
          <h2 className="text-lg font-semibold text-stone-200">No threads for this date</h2>
          <p className="mt-2 text-sm text-stone-500">Try another date or import more Gmail history.</p>
        </div>
      )}
    </AppFrame>
  );
}

function isDateInput(value: string | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function parseDateInput(value: string) {
  return new Date(`${value}T00:00:00`);
}

function formatDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatReadableDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function formatMonthHeading(date: Date) {
  return new Intl.DateTimeFormat("en", {
    month: "long",
    year: "numeric",
  }).format(date);
}

function addMonths(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function getCalendarDays(date: Date) {
  const firstDay = new Date(date.getFullYear(), date.getMonth(), 1);
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  const days: Array<{ date: string; dayOfMonth: number } | null> = [];

  for (let index = 0; index < firstDay.getDay(); index += 1) {
    days.push(null);
  }

  for (let day = 1; day <= lastDay.getDate(); day += 1) {
    const current = new Date(date.getFullYear(), date.getMonth(), day);
    days.push({ date: formatDateInput(current), dayOfMonth: day });
  }

  return days;
}

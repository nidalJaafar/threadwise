"use client";

import { useRouter } from "next/navigation";
import { signIn, signOut } from "next-auth/react";
import { useEffect, useRef, useState, useTransition } from "react";

import { api, type RouterOutputs } from "~/trpc/react";

type Status = RouterOutputs["gmail"]["connectionStatus"];
const defaultAutoSyncIntervalSeconds = 2 * 60;
const autoSyncIntervalOptions = [30, 60, 2 * 60, 5 * 60];
type NewMailNotice = {
  label: string;
  latestThreadId?: string;
  latestThreadLabel?: string;
};
type SyncResult = RouterOutputs["gmail"]["syncRecent"];

export function GmailSyncControl({ status }: { status: Status }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [newMailNotice, setNewMailNotice] = useState<NewMailNotice | null>(null);
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(false);
  const [autoSyncIntervalSeconds, setAutoSyncIntervalSeconds] = useState(defaultAutoSyncIntervalSeconds);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unsupported">("unsupported");
  const [backfillDays, setBackfillDays] = useState(30);
  const [lastAutoSyncAt, setLastAutoSyncAt] = useState<Date | null>(null);
  const [isPending, startTransition] = useTransition();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const sync = api.gmail.syncRecent.useMutation({
    onSuccess: (result) => {
      if (result.newThreads > 0 || result.newMessages > 0) {
        handleNewMailResult(result, (href) => router.push(href));
      } else {
        setNewMailNotice(null);
      }
      setMessage(`${result.syncMode === "history" ? "Incremental sync" : "Recent sync"}: imported ${result.importedThreads} threads and ${result.importedMessages} messages.`);
      startTransition(() => router.refresh());
    },
    onError: (error) => setMessage(error.message),
  });

  useEffect(() => {
    setAutoSyncEnabled(window.localStorage.getItem("threadwise:auto-sync") === "true");
    const savedInterval = Number(window.localStorage.getItem("threadwise:auto-sync-interval-seconds"));
    if (autoSyncIntervalOptions.includes(savedInterval)) {
      setAutoSyncIntervalSeconds(savedInterval);
    }

    setNotificationPermission("Notification" in window ? Notification.permission : "unsupported");
  }, []);

  useEffect(() => {
    if (!status.signedIn || !status.connected || !autoSyncEnabled) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    const runAutoSync = () => {
      if (sync.isPending) {
        return;
      }

      sync.mutate(
        { maxResults: 25 },
        {
          onSuccess: (result) => {
            const syncedAt = new Date();
            setLastAutoSyncAt(syncedAt);
            if (result.newThreads > 0 || result.newMessages > 0) {
              handleNewMailResult(result, (href) => router.push(href));
              setMessage(`${result.syncMode === "history" ? "Incremental sync" : "Recent sync"}: new email synced at ${syncedAt.toLocaleTimeString()}.`);
            } else {
              setMessage(`${result.syncMode === "history" ? "Incremental sync" : "Recent sync"}: checked at ${syncedAt.toLocaleTimeString()}. No new email.`);
            }
            startTransition(() => router.refresh());
          },
          onError: (error) => setMessage(error.message),
        },
      );
    };

    intervalRef.current = setInterval(runAutoSync, autoSyncIntervalSeconds * 1000);

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        runAutoSync();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [autoSyncEnabled, autoSyncIntervalSeconds, router, startTransition, status.connected, status.signedIn, sync]);

  const toggleAutoSync = () => {
    setAutoSyncEnabled((current) => {
      const next = !current;
      window.localStorage.setItem("threadwise:auto-sync", String(next));
      setMessage(next ? `Auto-sync enabled. Checks every ${formatInterval(autoSyncIntervalSeconds)} while this browser tab is open.` : "Auto-sync disabled.");
      return next;
    });
  };

  const requestNotificationAccess = async () => {
    if (!("Notification" in window)) {
      setNotificationPermission("unsupported");
      setMessage("This browser does not support desktop notifications.");
      return;
    }

    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
    setMessage(permission === "granted" ? "Notifications enabled for new email." : "Notifications were not enabled.");
  };

  const updateAutoSyncInterval = (seconds: number) => {
    setAutoSyncIntervalSeconds(seconds);
    window.localStorage.setItem("threadwise:auto-sync-interval-seconds", String(seconds));
    setMessage(`Auto-sync interval set to ${formatInterval(seconds)}.`);
  };

  const currentError = message ?? status.lastError;
  const shouldReconnectGoogle = Boolean(currentError && isGoogleReconnectError(currentError));

  const handleNewMailResult = (result: SyncResult, navigate: (href: string) => void) => {
    const latestMessage = result.changedMessages[0];
    const latestThread = result.changedThreads[0];
    const latestThreadId = latestMessage?.threadId ?? latestThread?.id;
    const latestThreadLabel = latestMessage
      ? `${latestMessage.clientName ? `${latestMessage.clientName}: ` : ""}${latestMessage.topic}`
      : latestThread
        ? `${latestThread.clientName ? `${latestThread.clientName}: ` : ""}${latestThread.topic}`
        : undefined;

    setNewMailNotice({
      label: `${result.newThreads} new threads · ${result.newMessages} new messages`,
      latestThreadId,
      latestThreadLabel,
    });

    for (const message of result.changedMessages) {
      const label = `${message.clientName ? `${message.clientName}: ` : ""}${message.topic}`;
      void showNewMailNotification({
        tag: message.id,
        title: `${message.isIgnored ? "Ignored email" : "New email"} from ${message.senderName}`,
        body: `${label}\n${message.snippet}`,
        url: `/threads/${message.threadId}`,
        onOpen: () => navigate(`/threads/${message.threadId}`),
      });
    }
  };

  const clearLocalData = api.gmail.clearLocalData.useMutation({
    onSuccess: () => {
      void signOut({ callbackUrl: "/" });
    },
    onError: (error) => setMessage(error.message),
  });

  const resetGoogleConnection = api.gmail.resetGoogleConnection.useMutation({
    onSuccess: () => {
      void signIn("google", { callbackUrl: "/" }, googleAuthParams);
    },
    onError: (error) => setMessage(error.message),
  });

  const resetImportedEmail = api.gmail.resetImportedEmail.useMutation({
    onSuccess: () => {
      setNewMailNotice(null);
      setMessage("Imported email reset. Choose a history window and click Import history to resync.");
      startTransition(() => router.refresh());
    },
    onError: (error) => setMessage(error.message),
  });

  const backfill = api.gmail.backfillDays.useMutation({
    onSuccess: (result) => {
      const latestThread = result.changedThreads[0];
      if (result.newThreads > 0 || result.newMessages > 0) {
        setNewMailNotice({
          label: `${result.newThreads} imported threads · ${result.newMessages} imported messages`,
          latestThreadId: latestThread?.id,
          latestThreadLabel: latestThread ? `${latestThread.clientName ? `${latestThread.clientName}: ` : ""}${latestThread.topic}` : undefined,
        });
      }
      setMessage(`Imported last ${result.days} days: ${result.importedThreads} threads and ${result.importedMessages} messages.`);
      startTransition(() => router.refresh());
    },
    onError: (error) => setMessage(error.message),
  });

  if (!status.configured) {
    return (
      <div className="mb-5 rounded-2xl border border-stone-800 bg-stone-950 p-4 text-sm text-stone-400">
        Add <code className="text-stone-200">AUTH_GOOGLE_ID</code> and <code className="text-stone-200">AUTH_GOOGLE_SECRET</code> to enable Gmail sync.
      </div>
    );
  }

  if (!status.signedIn || !status.connected) {
    return (
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-stone-800 bg-stone-950 p-4">
        <div>
          <p className="text-sm font-semibold text-stone-200">Gmail is not connected</p>
          <p className="mt-1 text-sm text-stone-500">Connect with read-only access to import recent threads.</p>
        </div>
        <button
          type="button"
          onClick={() => void signIn("google", { callbackUrl: "/" }, googleAuthParams)}
          className="rounded-full bg-stone-100 px-4 py-2 text-sm font-semibold text-stone-950 hover:bg-white"
        >
          Connect Gmail
        </button>
      </div>
    );
  }

  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-stone-800 bg-stone-950 p-4">
      <div>
        <p className="text-sm font-semibold text-stone-200">Gmail connected{status.email ? `: ${status.email}` : ""}</p>
        <p className="mt-1 text-sm text-stone-500">
          {status.lastSyncedAt ? `Last synced ${new Date(status.lastSyncedAt).toLocaleString()}` : "Not synced yet"}
        </p>
        <p className="mt-1 text-sm text-stone-600">
          Auto-sync {autoSyncEnabled ? "on" : "off"} · every {formatInterval(autoSyncIntervalSeconds)} · notifications {formatNotificationPermission(notificationPermission)}{lastAutoSyncAt ? ` · last auto ${lastAutoSyncAt.toLocaleTimeString()}` : ""}
        </p>
        {currentError && <p className="mt-2 text-sm text-stone-400">{currentError}</p>}
        {newMailNotice && (
          <div className="mt-3 rounded-2xl border border-emerald-400/40 bg-emerald-400/10 p-3 text-sm text-emerald-100">
            <p className="font-semibold">New email received: {newMailNotice.label}</p>
            {newMailNotice.latestThreadLabel && <p className="mt-1 text-emerald-200/80">Latest: {newMailNotice.latestThreadLabel}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              {newMailNotice.latestThreadId && (
                <button
                  type="button"
                  onClick={() => router.push(`/threads/${newMailNotice.latestThreadId}`)}
                  className="rounded-full bg-emerald-200 px-3 py-1.5 text-sm font-semibold text-emerald-950 hover:bg-emerald-100"
                >
                  Open latest
                </button>
              )}
              <button
                type="button"
                onClick={() => setNewMailNotice(null)}
                className="rounded-full border border-emerald-300/40 px-3 py-1.5 text-sm font-semibold text-emerald-100 hover:bg-emerald-300/10"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={notificationPermission === "granted" || notificationPermission === "unsupported"}
          onClick={() => void requestNotificationAccess()}
          className="rounded-full border border-stone-700 px-4 py-2 text-sm font-semibold text-stone-300 hover:border-stone-500 hover:text-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {notificationPermission === "granted" ? "Notifications: On" : notificationPermission === "denied" ? "Notifications denied" : notificationPermission === "unsupported" ? "Notifications unsupported" : "Enable notifications"}
        </button>
        {shouldReconnectGoogle && (
          <button
            type="button"
            disabled={resetGoogleConnection.isPending}
            onClick={() => resetGoogleConnection.mutate()}
            className="rounded-full bg-amber-200 px-4 py-2 text-sm font-semibold text-amber-950 hover:bg-amber-100"
          >
            {resetGoogleConnection.isPending ? "Resetting..." : "Reconnect Google"}
          </button>
        )}
        <button
          type="button"
          onClick={toggleAutoSync}
          className={`rounded-full border px-4 py-2 text-sm font-semibold ${autoSyncEnabled ? "border-[#d7bd79]/50 bg-[#d7bd79]/10 text-[#e8d08a]" : "border-stone-700 text-stone-300 hover:border-stone-500 hover:text-stone-50"}`}
        >
          Auto-sync: {autoSyncEnabled ? "On" : "Off"}
        </button>
        <button
          type="button"
          disabled={clearLocalData.isPending}
          onClick={() => {
            if (window.confirm("Delete locally synced Gmail data before switching accounts?")) {
              clearLocalData.mutate();
            }
          }}
          className="rounded-full border border-stone-700 px-4 py-2 text-sm font-semibold text-stone-300 hover:border-stone-500 hover:text-stone-50"
        >
          {clearLocalData.isPending ? "Clearing..." : "Switch account"}
        </button>
        <button
          type="button"
          disabled={sync.isPending || isPending}
          onClick={() => sync.mutate({ maxResults: 25 })}
          className="rounded-full bg-[#d7bd79] px-4 py-2 text-sm font-semibold text-stone-950 hover:bg-[#e6cc87] disabled:cursor-wait disabled:opacity-60"
        >
          {sync.isPending || isPending ? "Syncing..." : "Sync Gmail"}
        </button>
      </div>

      <details className="basis-full rounded-2xl border border-stone-800 bg-black/20 p-3">
        <summary className="cursor-pointer text-sm font-semibold text-stone-300">More sync options</summary>
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-stone-800 pt-3">
          <label className="text-sm text-stone-500">
            Auto-sync every
            <select
              value={autoSyncIntervalSeconds}
              onChange={(event) => updateAutoSyncInterval(Number(event.target.value))}
              className="mx-2 rounded-xl border border-stone-800 bg-stone-950 px-3 py-2 text-sm text-stone-100 outline-none focus:border-[#d7bd79]"
            >
              {autoSyncIntervalOptions.map((seconds) => (
                <option key={seconds} value={seconds}>{formatInterval(seconds)}</option>
              ))}
            </select>
          </label>
          <label className="text-sm text-stone-500">
            Import last
            <select
              value={backfillDays}
              disabled={backfill.isPending}
              onChange={(event) => setBackfillDays(Number(event.target.value))}
              className="mx-2 rounded-xl border border-stone-800 bg-stone-950 px-3 py-2 text-sm text-stone-100 outline-none focus:border-[#d7bd79] disabled:cursor-wait disabled:opacity-60"
            >
              <option value={7}>7 days</option>
              <option value={30}>30 days</option>
              <option value={60}>60 days</option>
              <option value={90}>90 days</option>
            </select>
          </label>
          <button
            type="button"
            disabled={backfill.isPending}
            onClick={() => backfill.mutate({ days: backfillDays })}
            className="rounded-full border border-stone-700 px-4 py-2 text-sm font-semibold text-stone-300 hover:border-stone-500 hover:text-stone-50 disabled:cursor-wait disabled:opacity-60"
          >
            {backfill.isPending ? "Importing..." : "Import history"}
          </button>
          <span className="text-xs text-stone-600">One-time backfill. Auto-sync remains lightweight.</span>
          {backfill.isPending && (
            <div className="basis-full rounded-2xl border border-[#d7bd79]/30 bg-[#d7bd79]/10 p-4 text-sm text-[#ead18d]">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-[#d7bd79]/30 border-t-[#d7bd79]" />
                <div>
                  <p className="font-semibold">Importing last {backfillDays} days...</p>
                  <p className="mt-1 text-[#ead18d]/70">This can take a few minutes. Keep this tab open.</p>
                </div>
              </div>
            </div>
          )}

          <details className="basis-full rounded-2xl border border-red-950/60 bg-red-950/10 p-3">
            <summary className="cursor-pointer text-sm font-semibold text-red-300">Danger zone</summary>
            <div className="mt-3 border-t border-red-950/60 pt-3">
              <p className="text-sm text-stone-400">
                Reset local imported Gmail data and sync state. Gmail is not modified. Clients, learned domains, domain rules, and ignore rules are kept.
              </p>
              <button
                type="button"
                disabled={resetImportedEmail.isPending || backfill.isPending || sync.isPending}
                onClick={() => {
                  if (window.confirm("Delete locally imported Gmail threads/messages and sync state? Gmail will not be modified. Clients and rules will be kept.")) {
                    resetImportedEmail.mutate();
                  }
                }}
                className="mt-3 rounded-full border border-red-800 px-4 py-2 text-sm font-semibold text-red-200 hover:border-red-600 disabled:cursor-wait disabled:opacity-60"
              >
                {resetImportedEmail.isPending ? "Resetting..." : "Reset imported email"}
              </button>
              {resetImportedEmail.isPending && <p className="mt-2 text-xs text-red-200/80">Deleting local import rows. Keep this tab open.</p>}
            </div>
          </details>
        </div>
      </details>
    </div>
  );
}

async function showNewMailNotification({
  tag,
  title,
  body,
  url,
  onOpen,
}: {
  tag: string;
  title: string;
  body: string;
  url: string;
  onOpen?: () => void;
}) {
  if (typeof window === "undefined" || !("Notification" in window) || Notification.permission !== "granted") {
    return;
  }

  if ("serviceWorker" in navigator) {
    try {
      const registration = await navigator.serviceWorker.ready;
      await registration.showNotification(title, {
        body,
        tag,
        data: { url },
        icon: "/threadwise-icon.svg",
        badge: "/threadwise-icon.svg",
      });
      return;
    } catch (error) {
      console.warn("ThreadWise service-worker notification failed", error);
    }
  }

  const notification = new Notification(title, { body, tag });

  if (onOpen) {
    notification.onclick = () => {
      window.focus();
      onOpen();
      notification.close();
    };
  }
}

function formatInterval(seconds: number) {
  if (seconds < 60) {
    return `${seconds} seconds`;
  }

  const minutes = seconds / 60;
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

function formatNotificationPermission(permission: NotificationPermission | "unsupported") {
  if (permission === "unsupported") {
    return "unsupported";
  }

  if (permission === "default") {
    return "not enabled";
  }

  return permission;
}

const googleAuthParams = {
  access_type: "offline",
  prompt: "consent",
  scope: "openid email profile https://www.googleapis.com/auth/gmail.readonly",
};

function isGoogleReconnectError(message: string) {
  const normalized = message.toLowerCase();

  return normalized.includes("expired") || normalized.includes("revoked") || normalized.includes("reconnect google") || normalized.includes("invalid_grant");
}

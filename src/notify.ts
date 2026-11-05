/**
 * Telegram ops notifier (ADR 0005). One bot, one private group with Topics, one topic per repo.
 *
 * Self-contained on purpose: no imports, only the global `fetch`, so a project can vendor this one
 * file (see docs/notify.md) and the kit's CLI can use it too.
 *
 * Two levels, chosen by the caller in code:
 * - `alert`: needs action today. Sent with sound.
 * - `digest`: the one quiet daily summary per repo. Sent with `disable_notification`.
 *
 * Privacy by shape: a notice is a fixed title plus structured facts (label and a number, boolean
 * or short single-line string) and https links. There is no free-text body. Callers pass counts,
 * statuses, names and links only, never user content or anything derived from it; detail stays in
 * the project's own database, admin pages and logs, and the message links there.
 *
 * Never fails the caller: `notify` returns a result and never throws. With no token or chat
 * configured it does nothing. It never prints or returns the bot token.
 */

export type NoticeLevel = "alert" | "digest";

/** One labelled value. Strings are for statuses and names: short, single line. */
export interface NoticeFact {
  label: string;
  value: number | boolean | string | null;
}

export interface NoticeLink {
  label: string;
  /** Must be https. */
  url: string;
}

export interface Notice {
  level: NoticeLevel;
  /** Fixed text from code, e.g. "Daily collection failed". Not built from user content. */
  title: string;
  /** Who is speaking, e.g. "wardintel · collect". Defaults to the config's `source`. */
  source?: string;
  facts?: NoticeFact[];
  links?: NoticeLink[];
}

export interface NotifyConfig {
  botToken?: string;
  chatId?: string;
  /** The repo's topic (message_thread_id). Unset sends to the group's General topic. */
  topicId?: string;
  /** Default source label for this process. */
  source?: string;
}

export type NotifyResult =
  | { sent: true }
  | { sent: false; reason: "not-configured" | "invalid" | "failed"; detail?: string };

type Fetch = (input: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface NotifyOptions {
  config?: NotifyConfig;
  fetch?: Fetch;
  /** Request timeout (default 5000 ms). */
  timeoutMs?: number;
}

/** Limits that keep a notice a summary, not a transcript. */
export const NOTICE_LIMITS = { title: 80, label: 40, value: 80, facts: 20, links: 5 } as const;

/** Read the notifier config from the environment (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, TELEGRAM_TOPIC_ID, NOTIFY_SOURCE). */
export function notifyConfigFromEnv(env: Record<string, string | undefined> = process.env): NotifyConfig {
  return {
    botToken: env.TELEGRAM_BOT_TOKEN?.trim() || undefined,
    chatId: env.TELEGRAM_CHAT_ID?.trim() || undefined,
    topicId: env.TELEGRAM_TOPIC_ID?.trim() || undefined,
    source: env.NOTIFY_SOURCE?.trim() || undefined,
  };
}

/** Problems that make a notice unsendable. Empty when it's fine. */
export function validateNotice(n: Notice): string[] {
  const problems: string[] = [];
  const line = (what: string, s: string, max: number) => {
    if (!s.trim()) problems.push(`${what} is empty`);
    if (s.length > max) problems.push(`${what} is longer than ${max} characters`);
    if (/[\r\n]/.test(s)) problems.push(`${what} has a line break`);
  };
  if (n.level !== "alert" && n.level !== "digest") problems.push("level must be alert or digest");
  line("title", n.title ?? "", NOTICE_LIMITS.title);
  if (n.source !== undefined) line("source", n.source, NOTICE_LIMITS.label);
  const facts = n.facts ?? [];
  const links = n.links ?? [];
  if (facts.length > NOTICE_LIMITS.facts) problems.push(`more than ${NOTICE_LIMITS.facts} facts`);
  if (links.length > NOTICE_LIMITS.links) problems.push(`more than ${NOTICE_LIMITS.links} links`);
  facts.forEach((f, i) => {
    line(`fact ${i + 1} label`, f.label ?? "", NOTICE_LIMITS.label);
    const v = f.value;
    if (typeof v === "string") line(`fact ${i + 1} value`, v, NOTICE_LIMITS.value);
    else if (typeof v === "number" && !Number.isFinite(v)) problems.push(`fact ${i + 1} value is not a finite number`);
    else if (v !== null && typeof v !== "number" && typeof v !== "boolean") problems.push(`fact ${i + 1} value must be a number, boolean, short string or null`);
  });
  links.forEach((l, i) => {
    line(`link ${i + 1} label`, l.label ?? "", NOTICE_LIMITS.label);
    if (!/^https:\/\/[^\s<>"]+$/.test(l.url ?? "")) problems.push(`link ${i + 1} must be an https URL`);
  });
  return problems;
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function formatValue(v: NoticeFact["value"]): string {
  if (v === null) return "–";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number") return v.toLocaleString("en-GB");
  return v;
}

/** The message text (Telegram HTML). Exported for tests and previews. */
export function formatNotice(n: Notice, defaultSource?: string): string {
  const icon = n.level === "alert" ? "🔴" : "🗒";
  const source = n.source ?? defaultSource;
  const head = `${icon} <b>${escapeHtml(n.title)}</b>${source ? `\n<i>${escapeHtml(source)}</i>` : ""}`;
  const facts = (n.facts ?? []).map((f) => `${escapeHtml(f.label)}: <b>${escapeHtml(formatValue(f.value))}</b>`);
  const links = (n.links ?? []).map((l) => `<a href="${escapeHtml(l.url)}">${escapeHtml(l.label)}</a>`);
  return [head, facts.join("\n"), links.join(" · ")].filter(Boolean).join("\n\n");
}

/**
 * Send a notice. Never throws: returns `{ sent: false, reason }` instead. `not-configured` means
 * the token or chat ID is unset, which is the normal state in development and previews.
 */
export async function notify(n: Notice, opts: NotifyOptions = {}): Promise<NotifyResult> {
  try {
    const config = opts.config ?? notifyConfigFromEnv();
    if (!config.botToken || !config.chatId) return { sent: false, reason: "not-configured" };
    const problems = validateNotice(n);
    if (problems.length) return { sent: false, reason: "invalid", detail: problems.join("; ") };
    const body: Record<string, unknown> = {
      chat_id: config.chatId,
      text: formatNotice(n, config.source),
      parse_mode: "HTML",
      disable_notification: n.level === "digest",
      link_preview_options: { is_disabled: true },
    };
    if (config.topicId) body.message_thread_id = Number(config.topicId);
    const f: Fetch = opts.fetch ?? (globalThis.fetch as unknown as Fetch);
    const res = await f(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 5000),
    });
    if (res.ok) return { sent: true };
    // Telegram's description (e.g. "Bad Request: message thread not found") never contains the token.
    const json = (await res.json().catch(() => null)) as { description?: unknown } | null;
    const description = typeof json?.description === "string" ? json.description.slice(0, 120) : "";
    return { sent: false, reason: "failed", detail: `HTTP ${res.status}${description ? `: ${description}` : ""}` };
  } catch (e) {
    // Only the error's name: a message could in principle echo the request URL, which holds the token.
    return { sent: false, reason: "failed", detail: (e as Error)?.name ?? "error" };
  }
}

/** One chat or topic the bot has seen, for finding TELEGRAM_CHAT_ID and TELEGRAM_TOPIC_ID. */
export interface SeenChat {
  chatId: string;
  chatTitle: string;
  topicId?: string;
  topicName?: string;
}

/**
 * List the chats and topics in the bot's recent updates (getUpdates), so the owner can find the
 * IDs without pasting the token anywhere. Only IDs and chat/topic names are returned, no message text.
 */
export async function discoverChats(botToken: string, opts: { fetch?: Fetch; timeoutMs?: number } = {}): Promise<SeenChat[]> {
  const f: Fetch = opts.fetch ?? (globalThis.fetch as unknown as Fetch);
  const res = await f(`https://api.telegram.org/bot${botToken}/getUpdates`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ allowed_updates: ["message", "my_chat_member"] }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
  });
  if (!res.ok) throw new Error(`Telegram getUpdates returned HTTP ${res.status}`);
  const json = (await res.json()) as { result?: Array<Record<string, any>> };
  const seen = new Map<string, SeenChat>();
  const topicNames = new Map<string, string>();
  for (const u of json.result ?? []) {
    const m = u.message ?? u.my_chat_member;
    const chat = m?.chat;
    if (!chat || chat.type === "private") continue;
    const chatId = String(chat.id);
    const base = { chatId, chatTitle: String(chat.title ?? "") };
    if (!seen.has(chatId)) seen.set(chatId, base);
    const thread = m.message_thread_id;
    if (m.is_topic_message && thread !== undefined) {
      const key = `${chatId}/${thread}`;
      const created = m.forum_topic_created?.name ?? m.reply_to_message?.forum_topic_created?.name;
      if (created) topicNames.set(key, String(created));
      if (!seen.has(key)) seen.set(key, { ...base, topicId: String(thread) });
    }
  }
  return [...seen.entries()].map(([key, c]) => (topicNames.has(key) ? { ...c, topicName: topicNames.get(key) } : c));
}

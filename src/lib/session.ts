import { gunzipSync, gzipSync } from "zlib";
import type { LLMInsights, NormalizedTransaction, PlanNarrative, Report, ReportStatus, UserProfile } from "@/lib/types";

export interface SessionRecord {
  profile: UserProfile;
  report: Report;
  status: ReportStatus;
  createdAt: number;
  /** Kept alongside the report so a recategorization correction can recompute the
   * deterministic numbers without re-running the LLM (which produced `insights`). */
  transactions: NormalizedTransaction[];
  insights: LLMInsights;
  /** The model's wording for the Money Plan, kept so the plan can be rebuilt from corrected
   * numbers without another model call. Null when the plan runs on its deterministic wording. */
  planNarrative: PlanNarrative | null;
}

const TTL_MS = 2 * 60 * 60 * 1000; // 2 hours — this is a one-time autopsy, not a saved account.
const TTL_SECONDS = TTL_MS / 1000;

/**
 * Where sessions live. They hold the real, unmasked report so the paywall can be enforced on
 * the server (see lib/report/shape.ts) rather than trusted to the client.
 *
 *  - With Upstash Redis configured (UPSTASH_REDIS_REST_URL/TOKEN, or the KV_REST_API_* names
 *    the Vercel Marketplace integration injects), sessions are shared by every server
 *    instance. This is required on Vercel: each request can land on a different serverless
 *    instance, so process memory alone loses reports and payments between requests.
 *  - Otherwise they sit in process memory. Fine for local development and a single server;
 *    the one place it must NOT be relied on is a multi-instance deployment.
 *
 * Either way they expire after two hours, in keeping with not hoarding financial data.
 */
type Backend = { url: string; token: string } | null;

function redisBackend(): Backend {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

// Kept on globalThis so dev-server hot reloads don't wipe in-memory sessions.
const globalStore = globalThis as unknown as { __moneyAutopsySessions?: Map<string, SessionRecord> };
const memory = (globalStore.__moneyAutopsySessions ??= new Map<string, SessionRecord>());

let warnedAboutMemory = false;
function warnIfEphemeral() {
  if (warnedAboutMemory || !process.env.VERCEL) return;
  warnedAboutMemory = true;
  console.error(
    "Session storage is in-memory on Vercel: reports and payments will be lost between requests. " +
      "Add an Upstash Redis integration (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN)."
  );
}

const keyFor = (id: string) => `money-autopsy:session:${id}`;

async function redis(backend: NonNullable<Backend>, command: (string | number)[]): Promise<unknown> {
  const res = await fetch(backend.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${backend.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => null)) as { result?: unknown; error?: string } | null;
  if (!res.ok || json?.error) throw new Error(`Session store error: ${json?.error ?? res.status}`);
  return json?.result;
}

// A full record (hundreds of transactions with their narrations) can approach Redis REST
// request limits as plain JSON; compressed it is a fraction of that.
const pack = (record: SessionRecord) => gzipSync(JSON.stringify(record)).toString("base64");
const unpack = (value: string) => JSON.parse(gunzipSync(Buffer.from(value, "base64")).toString("utf8")) as SessionRecord;

const isExpired = (record: SessionRecord) => Date.now() - record.createdAt > TTL_MS;

async function write(id: string, record: SessionRecord): Promise<void> {
  const backend = redisBackend();
  if (!backend) {
    warnIfEphemeral();
    memory.set(id, record);
    return;
  }
  // Never extend life past the original two hours, however often the record is rewritten.
  const remaining = Math.max(60, Math.ceil(TTL_SECONDS - (Date.now() - record.createdAt) / 1000));
  await redis(backend, ["SET", keyFor(id), pack(record), "EX", remaining]);
}

async function read(id: string): Promise<SessionRecord | undefined> {
  const backend = redisBackend();
  if (!backend) {
    warnIfEphemeral();
    for (const [key, record] of memory.entries()) if (isExpired(record)) memory.delete(key);
    return memory.get(id);
  }
  const value = await redis(backend, ["GET", keyFor(id)]);
  if (typeof value !== "string") return undefined;
  const record = unpack(value);
  return isExpired(record) ? undefined : record;
}

export async function createSession(
  report: Report,
  profile: UserProfile,
  transactions: NormalizedTransaction[],
  insights: LLMInsights,
  planNarrative: PlanNarrative | null = null
): Promise<void> {
  await write(report.id, { profile, report, status: "free", createdAt: Date.now(), transactions, insights, planNarrative });
}

export async function getSession(id: string): Promise<SessionRecord | undefined> {
  return read(id);
}

export async function unlockSession(id: string): Promise<SessionRecord | undefined> {
  const record = await read(id);
  if (!record) return undefined;
  record.status = "unlocked";
  record.report.status = "unlocked";
  await write(id, record);
  return record;
}

/** Replaces the session's transactions and report (e.g. after a user-corrected
 * category), keeping the same id and status (and the previous insights unless new ones are given). */
export async function updateSessionReport(
  id: string,
  transactions: NormalizedTransaction[],
  report: Report,
  insights?: LLMInsights,
  planNarrative?: PlanNarrative | null
): Promise<SessionRecord | undefined> {
  const record = await read(id);
  if (!record) return undefined;
  record.transactions = transactions;
  if (insights) record.insights = insights;
  if (planNarrative !== undefined) record.planNarrative = planNarrative;
  record.report = { ...report, status: record.status };
  await write(id, record);
  return record;
}

export async function deleteSession(id: string): Promise<void> {
  const backend = redisBackend();
  if (!backend) {
    memory.delete(id);
    return;
  }
  await redis(backend, ["DEL", keyFor(id)]);
}

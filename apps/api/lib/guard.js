// Protects the API (and the bill): the visitor's real IP, per-IP rate limits (shared through Upstash
// Redis when it's configured, in memory otherwise), how many searches may run at once, and a
// sitewide pause when a provider is out of credit.

import { BlockList, isIP } from "node:net";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const env = (name, fallback) => Number(process.env[name] ?? fallback);

// ---------- Client IP ----------
// Behind Cloudflare, the visitor's IP arrives in CF-Connecting-IP. That header is only trusted when
// the request really came from Cloudflare, since anyone can send it to the server directly; without
// Cloudflare in front it is simply ignored. Cloudflare's published ranges: https://www.cloudflare.com/ips/
const CLOUDFLARE = new BlockList();
for (const range of [
  "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22", "141.101.64.0/18", "108.162.192.0/18",
  "190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
  "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
]) CLOUDFLARE.addSubnet(...range.split("/").map((p, i) => (i ? Number(p) : p)), "ipv4");
for (const range of ["2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32", "2405:8100::/32", "2a06:98c0::/29", "2c0f:f248::/32"]) {
  CLOUDFLARE.addSubnet(...range.split("/").map((p, i) => (i ? Number(p) : p)), "ipv6");
}
const fromCloudflare = (ip) => {
  const v = isIP(ip);
  return v ? CLOUDFLARE.check(ip, v === 6 ? "ipv6" : "ipv4") : false;
};

// The address that connected to the hosting proxy: X-Real-IP, or the last X-Forwarded-For hop (the
// one the proxy added; earlier hops are whatever the client sent).
export function clientIp(c, fallback = "unknown") {
  const forwarded = (c.req.header("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const peer = c.req.header("x-real-ip")?.trim() || forwarded.at(-1) || fallback;
  const viaCloudflare = c.req.header("cf-connecting-ip")?.trim();
  return viaCloudflare && fromCloudflare(peer) && isIP(viaCloudflare) ? viaCloudflare : peer;
}

// The key limits are counted under: the IP itself, or for IPv6 its /64 block (one subscriber
// usually holds a whole /64, so per-address limits would be easy to dodge).
export function limitKey(ip) {
  if (isIP(ip) !== 6) return ip;
  const [head, tail = ""] = ip.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const full = [...left, ...Array(8 - left.length - right.length).fill("0"), ...right];
  return `${full.slice(0, 4).map((h) => h.toLowerCase().replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

// ---------- Rate limits ----------
const redis = process.env.UPSTASH_REDIS_REST_URL ? Redis.fromEnv() : null;
// Keeps environments apart in the shared Redis (local development uses its own prefix, so a test
// can't pause the live site).
const PREFIX = process.env.REDIS_PREFIX ?? "fh";
const WINDOW_MS = { "1 m": 60_000, "10 m": 600_000, "1 d": 86_400_000 };

// Used when Redis can't be reached: the same limits, kept per instance in memory.
function memoryLimiter(tokens, window) {
  const hits = new Map(); // ip → timestamps
  const ms = WINDOW_MS[window];
  setInterval(() => {
    const now = Date.now();
    for (const [ip, ts] of hits) if (now - ts.at(-1) > ms) hits.delete(ip);
  }, 60_000).unref();
  return {
    limit(ip) {
      const now = Date.now();
      const recent = (hits.get(ip) ?? []).filter((t) => now - t < ms);
      const success = recent.length < tokens;
      if (success) recent.push(now);
      hits.set(ip, recent);
      return { success, reset: (recent[0] ?? now) + ms };
    },
  };
}

const limiter = (tokens, window, prefix) => ({
  redis: redis ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(tokens, window), prefix: `${PREFIX}:rl:${prefix}`, timeout: 1500 }) : null,
  memory: memoryLimiter(tokens, window),
});

// Fresh searches cost about $0.05 each, so they get the tightest limits; replays of cached
// searches and the small endpoints are cheap.
const LIMITS = {
  fresh: [limiter(env("LIMIT_FRESH_10M", 12), "10 m", "fresh"), limiter(env("LIMIT_FRESH_DAY", 60), "1 d", "fresh-day")],
  search: [limiter(env("LIMIT_SEARCH_MIN", 60), "1 m", "search")],
  light: [limiter(env("LIMIT_LIGHT_MIN", 240), "1 m", "light")],
};

// { ok: true } or { ok: false, retryAfter: seconds }. Shared limits live in Redis; if it can't be
// reached, the same limits are enforced in memory on this instance.
let warned = false;
export async function rateLimit(kind, ip) {
  ip = limitKey(ip);
  let retryAfter = 0;
  for (const rl of LIMITS[kind]) {
    let r;
    try {
      if (!rl.redis) throw new Error("Redis isn't configured");
      r = await rl.redis.limit(ip);
    } catch (err) {
      if (!warned) console.error("rate limits falling back to memory:", err.message);
      warned = true;
      r = rl.memory.limit(ip);
    }
    if (!r.success) retryAfter = Math.max(retryAfter, Math.ceil((r.reset - Date.now()) / 1000));
  }
  return retryAfter ? { ok: false, retryAfter: Math.max(1, retryAfter) } : { ok: true };
}

// ---------- Searches in flight ----------
// One fresh search at a time per visitor, and a cap for the whole site.
const MAX_RUNNING = env("MAX_CONCURRENT_SEARCHES", 12);
const running = new Map(); // ip → count
let total = 0;
// Fresh searches running right now (their cost isn't recorded until they finish).
export const runningSearches = () => total;

export function startSearch(ip) {
  ip = limitKey(ip);
  if (running.get(ip)) return { ok: false, reason: "yours" };
  if (total >= MAX_RUNNING) return { ok: false, reason: "busy" };
  running.set(ip, 1);
  total++;
  let done = false;
  return {
    ok: true,
    end: () => {
      if (done) return;
      done = true;
      running.delete(ip);
      total--;
    },
  };
}

// ---------- Sitewide pause ----------
// Set when Jev or OpenAI says the account is out of credit (or the key was rejected). It expires on
// its own, so search retries after a while; topping up the account lifts it on the next attempt.
const OUTAGE_KEY = `${PREFIX}:outage`;
const OUTAGE_SECONDS = env("OUTAGE_PAUSE_MINUTES", 15) * 60;
let outageCache = { at: 0, value: null };

export async function markOutage(provider, kind) {
  const value = { provider, kind, at: new Date().toISOString() };
  outageCache = { at: Date.now(), value };
  console.error(`SEARCH PAUSED: ${provider} ${kind === "credits" ? "is out of credit" : "rejected the API key"}`);
  try {
    await redis?.set(OUTAGE_KEY, value, { ex: OUTAGE_SECONDS });
  } catch (err) {
    console.error("could not store the outage flag:", err.message);
  }
}

export async function currentOutage() {
  if (Date.now() - outageCache.at < 15_000) return outageCache.value;
  let value = null;
  try {
    value = (await redis?.get(OUTAGE_KEY)) ?? null;
  } catch {
    value = outageCache.value; // keep the last known state if Redis is unreachable
  }
  outageCache = { at: Date.now(), value };
  return value;
}

// Daily-history cache + resumable bulk ingestion from Dhan /charts/historical.
// Stored per instrument: { bars: [[t,o,h,l,c,v]...], fetchedAt, lastT }. Provenance: source "dhan", unit INR, EOD bars.
// Corporate-action adjustment of Dhan's daily series is NOT verified by this app (see docs/PROVIDER_INTEGRATIONS.md).
import { toCandles, dayStr, istSod, nowSec } from "./candles.js";

const DAY = 86400;
export const HIST_DAYS = 620; // ~430 trading bars: enough for 252d RS + 200DMA + slope lookbacks
const REFETCH_MS = 6 * 3600e3; // do not hit Dhan again for an instrument fetched within this window

/** Latest session whose daily bar is complete: today after 16:00 IST on a weekday, else the previous weekday. Holidays not modelled. */
export function expectedLastSession(tSec = nowSec()) {
  let d = Math.floor((tSec + 19800) / DAY);
  const wd = (x) => (x + 4) % 7; // 0=Sun (1970-01-01 was Thursday=4)
  if (!(wd(d) >= 1 && wd(d) <= 5 && istSod(tSec) >= 16 * 3600)) d -= 1;
  while (wd(d) === 0 || wd(d) === 6) d -= 1;
  return d;
}
const dayOf = (t) => Math.floor((t + 19800) / DAY);

/** Drop a bar for the current session while it can still be in progress, so EOD analytics never use a partial candle. */
export function completedBars(bars, tSec = nowSec()) {
  if (!bars.length) return bars;
  const last = bars[bars.length - 1];
  const todayIst = Math.floor((tSec + 19800) / DAY);
  return dayOf(last.t) === todayIst && istSod(tSec) < 16 * 3600 ? bars.slice(0, -1) : bars;
}

export const pack = (bars) => bars.map((k) => [k.t, k.o, k.h, k.l, k.c, k.v]);
export const unpack = (rows) => rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }));

export function memoryStore() {
  const m = new Map();
  return { get: async (k) => m.get(k) ?? null, set: async (k, v) => { m.set(k, v); }, keys: async () => [...m.keys()] };
}

/** IndexedDB-backed store (falls back to memory if unavailable, e.g. private mode). */
export function idbStore(name = "dhan-pulse-history") {
  let dbp = null;
  const open = () => (dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open(name, 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const tx = async (mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => { const t = db.transaction("kv", mode), q = fn(t.objectStore("kv")); t.oncomplete = () => res(q?.result ?? null); t.onerror = () => rej(t.error); });
  };
  if (typeof indexedDB === "undefined") return memoryStore();
  return { get: (k) => tx("readonly", (s) => s.get(k)).catch(() => null), set: (k, v) => tx("readwrite", (s) => s.put(v, k)).catch(() => {}), keys: () => tx("readonly", (s) => s.getAllKeys()).then((r) => r || []).catch(() => []) };
}

export const keyOf = (seg, id) => `${seg}:${id}`;

export function createHistory({ client, store, now = () => Date.now() }) {
  async function fetchDaily({ seg, id, instrument }) {
    const t = Math.floor(now() / 1000);
    const j = await client.historical({ securityId: String(id), exchangeSegment: seg, instrument, expiryCode: 0, oi: false, fromDate: dayStr(t - HIST_DAYS * DAY), toDate: dayStr(t) });
    return toCandles(j, false);
  }

  const isFresh = (rec) => rec && now() - rec.fetchedAt < REFETCH_MS && dayOf(rec.lastT) >= expectedLastSession(Math.floor(now() / 1000));

  /** Cached completed bars (or []) */
  async function bars(seg, id) {
    const rec = await store.get(keyOf(seg, id));
    return rec ? completedBars(unpack(rec.bars), Math.floor(now() / 1000)) : [];
  }

  /**
   * Ensure history for items [{seg,id,instrument,label}]. Sequential (Dhan's chart lane is rate-limited in the client).
   * Stops on an auth error; other per-instrument failures are collected. Returns { fetched, cached, failed:[{key,message}], aborted }.
   */
  async function ensure(items, { onProgress = () => {}, force = false, signal = null } = {}) {
    const out = { fetched: 0, cached: 0, failed: [], aborted: null };
    for (let i = 0; i < items.length; i++) {
      if (signal?.aborted) { out.aborted = "cancelled"; break; }
      const it = items[i], key = keyOf(it.seg, it.id);
      onProgress({ i, n: items.length, label: it.label || key });
      const rec = await store.get(key);
      if (!force && isFresh(rec)) { out.cached++; continue; }
      try {
        const b = await fetchDaily(it);
        if (!b.length) throw new Error("no bars returned");
        await store.set(key, { bars: pack(b), fetchedAt: now(), lastT: b[b.length - 1].t });
        out.fetched++;
      } catch (e) {
        if (rec) out.cached++; // keep serving the older cache, but record the failure
        out.failed.push({ key, label: it.label, message: String(e.message || e), code: e.code });
        if (e.code === "NO_TOKEN" || (e.status === 401)) { out.aborted = "auth"; break; }
        if (e instanceof TypeError) { out.aborted = "network"; break; }
      }
    }
    onProgress({ i: items.length, n: items.length, label: "" });
    return out;
  }

  async function status(items) {
    let have = 0, fresh = 0, oldest = null, newest = null;
    for (const it of items) {
      const rec = await store.get(keyOf(it.seg, it.id));
      if (!rec) continue;
      have++;
      if (isFresh(rec)) fresh++;
      oldest = oldest == null ? rec.lastT : Math.min(oldest, rec.lastT);
      newest = newest == null ? rec.lastT : Math.max(newest, rec.lastT);
    }
    return { total: items.length, have, fresh, oldestBar: oldest, newestBar: newest };
  }

  return { ensure, bars, status, fetchDaily };
}

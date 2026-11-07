// Multiple named watchlists on top of V1's single list. The default list keeps V1's storage key ("watch") so nothing migrates or is lost.
export const DEFAULT_LIST = "Watchlist";
export const MAX_ITEMS = 100;
export function createWatchlists(LS) {
  const lists = () => LS.get("wlists", {});
  const api = {
    names: () => [DEFAULT_LIST, ...Object.keys(lists())],
    active: () => { const a = LS.get("wlActive", DEFAULT_LIST); return api.names().includes(a) ? a : DEFAULT_LIST; },
    setActive: (n) => LS.set("wlActive", n),
    get: (n = api.active()) => (n === DEFAULT_LIST ? LS.get("watch", []) : lists()[n] || []),
    set: (n, items) => { if (n === DEFAULT_LIST) LS.set("watch", items); else LS.set("wlists", { ...lists(), [n]: items }); },
    create: (name) => { const n = String(name || "").trim().slice(0, 40); if (!n || api.names().includes(n)) return null; LS.set("wlists", { ...lists(), [n]: [] }); api.setActive(n); return n; },
    rename: (from, to) => { const n = String(to || "").trim().slice(0, 40); if (from === DEFAULT_LIST || !n || api.names().includes(n)) return null; const wasActive = api.active() === from, l = lists(), items = l[from] || []; delete l[from]; LS.set("wlists", { ...l, [n]: items }); if (wasActive) api.setActive(n); return n; },
    remove: (n) => { if (n === DEFAULT_LIST) return false; const l = lists(); delete l[n]; LS.set("wlists", l); if (LS.get("wlActive") === n) api.setActive(DEFAULT_LIST); return true; },
    duplicate: (from, to) => { const n = api.create(to); if (n) api.set(n, [...api.get(from)]); return n; },
    add: (item, n = api.active()) => { const items = api.get(n); if (items.some((x) => String(x.id) === String(item.id)) || items.length >= MAX_ITEMS) return false; api.set(n, [...items, item]); return true; },
    removeItem: (id, n = api.active()) => api.set(n, api.get(n).filter((x) => String(x.id) !== String(id))),
    /** every instrument id across all lists (used to keep quotes fresh for list-level views) */
    allIds: () => [...new Set(api.names().flatMap((n) => api.get(n).map((x) => Number(x.id))))],
  };
  return api;
}

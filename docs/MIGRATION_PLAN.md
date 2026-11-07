# Migration plan

This release is **additive**. No V1 storage key, API call or screen was changed.

- localStorage keys V1 uses: `dhan`, `renew`, `tab`, `watch`, `pf`, plus P&L log keys. Unchanged.
- New localStorage keys: `rsub`, `rfilters`, `rweights`, `rtemplate` (Research UI preferences only).
- New IndexedDB database `dhan-pulse-history` / store `kv`, key `SEG:id` → `{bars:[[t,o,h,l,c,v]], fetchedAt, lastT}`. Safe to delete; it is rebuilt on "Load history".
- Service worker cache bumped `dp-v6 → dp-v7` (new modules added to the shell list). Old cache is deleted on activate.
- Rollback: revert the commit; the extra IndexedDB data is inert.
- Future backend: saved screens/watchlists/journal move from localStorage via an export/import step; design the schema first (see DATA_DICTIONARY).

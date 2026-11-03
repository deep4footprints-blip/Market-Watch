#!/usr/bin/env python3
"""Build public/instruments.json from Dhan's compact scrip master.

Outputs:
  indices : curated broad + sectoral indices (IDX_I security ids)
  fno     : liquid F&O stock universe (NSE_EQ security ids) used for movers/breadth
  eq      : all NSE EQ-series stocks for watchlist search
  _unmatched / _allIndexNames : diagnostics so you can fix aliases if Dhan names differ
"""
import argparse
import csv
import io
import json
import re
import sys
import time
import urllib.request

URL = "https://images.dhan.co/api-data/api-scrip-master.csv"

# key, display name, group, accepted normalised aliases (exact match on trading/custom/symbol-name)
TARGETS = [
    ("nifty50", "Nifty 50", "broad", ["nifty50", "nifty"]),
    ("sensex", "Sensex", "broad", ["sensex", "bsesensex", "sensex30"]),
    ("banknifty", "Nifty Bank", "broad", ["niftybank", "banknifty"]),
    ("finnifty", "Nifty Fin Services", "broad", ["niftyfinancialservices", "finnifty", "niftyfinservice"]),
    ("midcpnifty", "Nifty Midcap Select", "broad", ["niftymidcapselect", "midcpnifty", "niftymidselect"]),
    ("next50", "Nifty Next 50", "broad", ["niftynext50", "niftyjr", "juniornifty"]),
    ("nifty100", "Nifty 100", "broad", ["nifty100"]),
    ("nifty500", "Nifty 500", "broad", ["nifty500"]),
    ("midcap150", "Nifty Midcap 150", "broad", ["niftymidcap150"]),
    ("smallcap250", "Nifty Smallcap 250", "broad", ["niftysmallcap250"]),
    ("vix", "India VIX", "volatility", ["indiavix"]),
    ("it", "Nifty IT", "sector", ["niftyit"]),
    ("auto", "Nifty Auto", "sector", ["niftyauto"]),
    ("pharma", "Nifty Pharma", "sector", ["niftypharma"]),
    ("fmcg", "Nifty FMCG", "sector", ["niftyfmcg"]),
    ("metal", "Nifty Metal", "sector", ["niftymetal"]),
    ("realty", "Nifty Realty", "sector", ["niftyrealty"]),
    ("psubank", "Nifty PSU Bank", "sector", ["niftypsubank"]),
    ("pvtbank", "Nifty Private Bank", "sector", ["nifty pvt bank".replace(" ", ""), "niftyprivatebank"]),
    ("energy", "Nifty Energy", "sector", ["niftyenergy"]),
    ("infra", "Nifty Infra", "sector", ["niftyinfrastructure", "niftyinfra"]),
    ("media", "Nifty Media", "sector", ["niftymedia"]),
    ("consumption", "Nifty Consumption", "sector", ["niftyindiaconsumption", "niftyconsumption"]),
    ("commodities", "Nifty Commodities", "sector", ["niftycommodities"]),
    ("oilgas", "Nifty Oil & Gas", "sector", ["niftyoilgas", "niftyoilandgas"]),
    ("healthcare", "Nifty Healthcare", "sector", ["niftyhealthcareindex", "niftyhealthcare"]),
    ("cpse", "Nifty CPSE", "sector", ["niftycpse"]),
    ("finserv", "Nifty Financial Services 25/50", "sector", ["niftyfinancialservices2550", "niftyfinservice2550"]),
]

COLS = {
    "id": ["SEM_SMST_SECURITY_ID", "SECURITY_ID"],
    "exch": ["SEM_EXM_EXCH_ID", "EXCH_ID"],
    "seg": ["SEM_SEGMENT", "SEGMENT"],
    "inst": ["SEM_INSTRUMENT_NAME", "INSTRUMENT"],
    "tsym": ["SEM_TRADING_SYMBOL", "SYMBOL_NAME"],
    "custom": ["SEM_CUSTOM_SYMBOL", "DISPLAY_NAME"],
    "name": ["SM_SYMBOL_NAME", "SYMBOL_NAME"],
    "series": ["SEM_SERIES", "SERIES"],
}


def norm(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def pick(header, options):
    for o in options:
        if o in header:
            return o
    return None


def fetch_csv(url, tries=3):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "dhan-pulse-builder"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 * (i + 1))
    raise SystemExit(f"could not download scrip master: {last}")


def build(text, min_indices, min_fno):
    rd = csv.DictReader(io.StringIO(text))
    header = rd.fieldnames or []
    c = {k: pick(header, v) for k, v in COLS.items()}
    missing = [k for k in ("id", "exch", "seg", "inst", "tsym") if not c[k]]
    if missing:
        raise SystemExit(f"scrip master columns not recognised: {missing}; header={header[:20]}")

    def g(row, key):
        return (row.get(c[key]) or "").strip() if c[key] else ""

    index_rows, fno_syms, equities = [], set(), {}
    for row in rd:
        exch, seg, inst = g(row, "exch"), g(row, "seg"), g(row, "inst")
        if seg == "I" or inst == "INDEX":
            index_rows.append(row)
        elif exch == "NSE" and seg == "D" and inst == "FUTSTK":
            fno_syms.add(g(row, "tsym").rsplit("-", 2)[0])
        elif exch == "NSE" and seg == "E" and inst == "EQUITY" and g(row, "series") in ("EQ", ""):
            sym = g(row, "tsym")
            if sym and sym not in equities:
                equities[sym] = (int(float(g(row, "id"))), sym, g(row, "name") or g(row, "custom") or sym)

    by_alias = {}
    for row in index_rows:
        for k in ("tsym", "custom", "name"):
            n = norm(g(row, k))
            if n:
                by_alias.setdefault(n, row)

    indices, unmatched = [], []
    for key, name, group, aliases in TARGETS:
        row = next((by_alias[a] for a in aliases if a in by_alias), None)
        if row is None:
            unmatched.append(name)
            continue
        indices.append({"key": key, "name": name, "group": group, "id": int(float(g(row, "id"))), "exch": g(row, "exch")})

    fno = sorted(
        [{"id": equities[s][0], "s": s, "n": equities[s][2]} for s in fno_syms if s in equities],
        key=lambda x: x["s"],
    )
    eq = sorted(([e[0], e[1], e[2]] for e in equities.values()), key=lambda x: x[1])

    if len(indices) < min_indices:
        raise SystemExit(f"only {len(indices)} indices matched (need {min_indices}); unmatched={unmatched}")
    if len(fno) < min_fno:
        raise SystemExit(f"only {len(fno)} F&O stocks resolved (need {min_fno})")

    return {
        "generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "indices": indices,
        "fno": fno,
        "eq": eq,
        "_unmatched": unmatched,
        "_allIndexNames": sorted({g(r, "custom") or g(r, "tsym") for r in index_rows})[:300],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", help="local csv instead of downloading")
    ap.add_argument("--out", default="public/instruments.json")
    ap.add_argument("--min-indices", type=int, default=8)
    ap.add_argument("--min-fno", type=int, default=50)
    a = ap.parse_args()
    text = open(a.csv, encoding="utf-8").read() if a.csv else fetch_csv(URL)
    out = build(text, a.min_indices, a.min_fno)
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"indices={len(out['indices'])} fno={len(out['fno'])} eq={len(out['eq'])} unmatched={out['_unmatched']}", file=sys.stderr)


if __name__ == "__main__":
    main()

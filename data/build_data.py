#!/usr/bin/env python3
"""Build data/dfa.json from the Federal Reserve Distributional Financial Accounts
(DFA) net-worth detail file and the FRED CPI-U series.

Inputs (checked into data/raw/):
  dfa-networth-levels-detail.csv  from https://www.federalreserve.gov/releases/z1/dataviz/download/zips/dfa.zip
  CPIAUCSL.csv                    from https://fred.stlouisfed.org/graph/fredgraph.csv?id=CPIAUCSL

Output: data/dfa.json (all money in millions of dollars, nominal).
"""
import csv, json, os, sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw")

GROUPS = ["Bottom50", "Next40", "Next9", "RemainingTop1", "TopPt1"]
GROUP_LABELS = ["Bottom 50%", "50th–90th pct", "90th–99th pct", "99th–99.9th pct", "Top 0.1%"]
GROUP_POP = [0.50, 0.40, 0.09, 0.009, 0.001]

# Liquidity tiers, most liquid first. Each maps to DFA columns (summed).
TIERS = [
    ("cash",     "Cash & deposits",            ["Deposits", "Money market fund shares"]),
    ("market",   "Stocks, funds & bonds",      ["Corporate equities and mutual fund shares", "Debt securities"]),
    ("retire",   "Retirement & insurance",     ["DC pension entitlements", "DB pension entitlements",
                                                "Life insurance reserves", "Annuities"]),
    ("business", "Private business & other",   ["Miscellaneous other equity", "Loans (Assets)", "Miscellaneous assets"]),
    ("home",     "Homes & durables",           ["Real estate", "Consumer durables"]),
]
LIAB = "Liabilities"
HH = "Household count"

def num(s):
    s = (s or "").strip()
    return float(s) if s else 0.0

def main():
    rows = defaultdict(dict)
    with open(os.path.join(RAW, "dfa-networth-levels-detail.csv"), newline="", encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            rows[r["Date"]][r["Category"]] = r
    quarters = sorted(rows.keys(), key=lambda d: (int(d[:4]), int(d[-1])))

    # sanity: components sum to reported assets
    worst = 0.0
    for q in quarters:
        for g in GROUPS:
            r = rows[q][g]
            s = sum(num(r[c]) for _, _, cols in TIERS for c in cols)
            worst = max(worst, abs(s - num(r["Assets"])) / max(num(r["Assets"]), 1))
    print(f"max relative gap between tier sum and reported Assets: {worst:.5f}", file=sys.stderr)

    # CPI: quarterly average, keyed like the DFA
    cpi_m = {}
    with open(os.path.join(RAW, "CPIAUCSL.csv"), newline="") as f:
        for r in csv.DictReader(f):
            if r["CPIAUCSL"] not in ("", "."):
                cpi_m[r["observation_date"][:7]] = float(r["CPIAUCSL"])
    def cpi_q(q):
        y, qn = int(q[:4]), int(q[-1])
        months = [f"{y}-{m:02d}" for m in range(3 * qn - 2, 3 * qn + 1)]
        vals = [cpi_m[m] for m in months if m in cpi_m]
        return sum(vals) / len(vals)
    cpi = [round(cpi_q(q), 3) for q in quarters]

    # per quarter: per group: [tier0..tier4, liabilities, households]
    series = []
    for q in quarters:
        qrow = []
        for g in GROUPS:
            r = rows[q][g]
            vals = [round(sum(num(r[c]) for c in cols)) for _, _, cols in TIERS]
            vals.append(round(num(r[LIAB])))
            vals.append(round(num(r[HH])))
            qrow.append(vals)
        series.append(qrow)

    out = {
        "source": "Federal Reserve Distributional Financial Accounts (Z.1), dfa-networth-levels-detail.csv; CPI-U from FRED (CPIAUCSL)",
        "units": "millions of nominal US dollars; households in units",
        "quarters": quarters,
        "cpi": cpi,
        "groups": GROUPS,
        "groupLabels": GROUP_LABELS,
        "groupPop": GROUP_POP,
        "tiers": [{"id": t[0], "label": t[1], "columns": t[2]} for t in TIERS],
        "fields": [t[0] for t in TIERS] + ["liabilities", "households"],
        "data": series,
    }
    with open(os.path.join(HERE, "dfa.json"), "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"wrote {len(quarters)} quarters, {quarters[0]}..{quarters[-1]}", file=sys.stderr)

if __name__ == "__main__":
    main()

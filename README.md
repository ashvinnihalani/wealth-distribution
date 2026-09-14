# Wealth Inequality in America — interactive

A static site that visualizes U.S. household wealth from the Federal Reserve's
Distributional Financial Accounts (DFA), 1989 Q3 to the latest quarter.

Three controls drive every chart:

1. **How many buckets** — 5, 10, 20, 100, 1,000, 10,000 or 100,000 equal slices of
   households. Coarse slices look almost unchanged since 1989; fine slices show the
   very top pulling away.
2. **What counts as wealth** — a liquidity slider from cash & deposits only, through
   stocks and bonds, retirement and insurance, private business, to homes and
   durables (all assets), with a checkbox to subtract debts.
3. **What year it is** — any quarter from 1989 Q3 onward, with a play button and an
   inflation toggle (CPI-U) to state everything in the latest quarter's dollars.

The page is plain HTML, CSS and JavaScript with no build step or dependencies.

## Running locally

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

(The page fetches `data/dfa.json`, so it needs to be served over HTTP rather than
opened as a file.)

## Publishing on GitHub Pages

The workflow in `.github/workflows/pages.yml` deploys the repository root on every
push to `main`. In the repository settings, under **Pages**, set the source to
**GitHub Actions**. Alternatively choose "Deploy from a branch" with the root folder;
the site works either way.

## Refreshing the data

```sh
curl -L -o /tmp/dfa.zip https://www.federalreserve.gov/releases/z1/dataviz/download/zips/dfa.zip
unzip -o -j /tmp/dfa.zip dfa-networth-levels-detail.csv -d data/raw/
curl -L -o data/raw/CPIAUCSL.csv "https://fred.stlouisfed.org/graph/fredgraph.csv?id=CPIAUCSL"
python3 data/build_data.py
```

## Method

- **Group totals** (assets by class, liabilities, household counts) are the Fed's
  published figures for five wealth groups: bottom 50%, 50–90th percentile,
  90–99th, 99–99.9th, and top 0.1%. Every dollar shown reconciles to them.
- **Within-group shape.** Slicing finer than the five groups needs an assumption
  about how wealth is spread inside each group. Below the 99th percentile the shape
  follows the Survey of Consumer Finances net-worth percentiles (2022 survey as
  tabulated by DQYDJ); inside the top 1% a Pareto curve is used; the split of the
  top 0.1% into the top 0.01% and 0.001% uses the World Inequality Database's
  reported shares, held constant across time. This follows the approach of the
  *Inequality in America* companion document (Politizane, 2026) that inspired the
  site.
- **Debts** within each group are spread so that assets minus debts reproduces the
  survey's net-worth shape (so the poorest households show negative net worth).
- **Inflation** uses the quarterly average of FRED series CPIAUCSL.

Sources: Federal Reserve Board Z.1 DFA release; FRED CPIAUCSL; Survey of Consumer
Finances via dqydj.com; World Inequality Database (wid.world).

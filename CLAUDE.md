# Working conventions

- Commit and push directly to `main`. Do not create feature branches or pull
  requests unless explicitly asked.
- The site is plain HTML/CSS/JS with no build step; `data/dfa.json` is generated
  by `python3 data/build_data.py` from the raw files in `data/raw/`.
- GitHub Pages deploys the repo root from `main` via `.github/workflows/pages.yml`.
- Commits are authored as `Claude <claude@simpleemails.net>`. Do not add a
  `Co-Authored-By` trailer; one author only.

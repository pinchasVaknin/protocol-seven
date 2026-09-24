## graphify

This project has a knowledge graph at `graphify-out/` — 7,126 nodes and 20,733 edges over
the 432 code files and the 17 live documents, split into 218 named communities.

The `graphify` launcher is not on PATH on this machine; every command below therefore runs
through `python -m graphify`, which resolves the same installed package.

Rules:
- For codebase questions, first run `python -m graphify query "<question>"` when
  `graphify-out/graph.json` exists. Use `python -m graphify path "<A>" "<B>"` for
  relationships and `python -m graphify explain "<concept>"` for focused concepts. These
  return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- `graphify-out/wiki/index.md` is the crawlable entry point — use it for broad navigation
  instead of raw source browsing.
- Read `graphify-out/GRAPH_REPORT.md` only for broad architecture review, or when
  query/path/explain do not surface enough context.
- After modifying code, run `python -m graphify update .` to keep the graph current
  (AST-only, no API cost). The post-commit hook already does this after every commit.
- Any rebuild re-clusters and renumbers the communities, which drops the curated names
  for hub filenames. Run `python scripts/graph-relabel.py` to put them back — it reads
  `graph-communities.json`, costs nothing, and is safe to run at any time.

Scope: `.graphifyignore` keeps `docs/archive/` and the image directories out of the corpus.
Re-running the full pipeline over the documents costs LLM tokens; `update` never does.

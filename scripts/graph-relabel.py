"""Re-attach the curated community names to the knowledge graph after a rebuild.

    python scripts/graph-relabel.py

graphify keys its community labels by community index, and every rebuild that
changes the node set renumbers them — so the post-commit hook's rebuild drops the
curated names and falls back to calling each community after its hub file
("Messages.ts" instead of "Wire Protocol and Snapshots"). Run this afterwards and
the names come back.

It works because graph-communities.json keys each name by something stable: the
id of the community's highest-degree node. A community whose hub survived the
re-cluster keeps its name; one that reorganised is matched on member overlap
instead; and one that matches neither keeps whatever graphify called it, because
a curated name on a community that no longer means the same thing is worse than
an honest generated one. Those are the ones worth looking at by hand — the script
lists them.

Nothing here calls an LLM and nothing costs tokens.
"""
import json
import subprocess
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "graphify-out"
MAP = ROOT / "graph-communities.json"
OVERLAP_FLOOR = 0.6

try:
    from graphify.paths import load_node_link_graph
    from graphify.detect import detect
    from graphify.cluster import score_all
    from graphify.analyze import god_nodes, surprising_connections, suggest_questions
    from graphify.report import generate
except ImportError:
    sys.exit("graphify is not importable by this interpreter — see CLAUDE.md.")


def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def main():
    if not (OUT / "graph.json").is_file():
        sys.exit(f"no graph at {OUT / 'graph.json'} — nothing to relabel.")
    spec = load(MAP)
    hubs, members = spec["hubs"], {k: set(v) for k, v in spec["members"].items()}

    raw = load(OUT / "graph.json")
    G = load_node_link_graph(raw)
    degree = dict(G.degree())

    communities = {}
    for node, attrs in G.nodes(data=True):
        communities.setdefault(attrs.get("community"), []).append(node)
    communities = {int(c): m for c, m in communities.items() if c is not None}
    current = {int(n["community"]): n.get("community_name")
               for n in raw["nodes"] if n.get("community") is not None}

    labels, by_hub, by_overlap, left = {}, 0, 0, []
    for cid, mem in communities.items():
        hub = max(mem, key=lambda n: (degree.get(n, 0), n))
        if hub in hubs:
            labels[cid] = hubs[hub]
            by_hub += 1
            continue
        seen = set(mem)
        best, score = None, 0.0
        for name, signature in members.items():
            # Containment, not Jaccard: a signature is the community's twelve
            # best-connected nodes, not its membership, so the question is how
            # many of those twelve are still here — not how much the two sets
            # overlap, which a 12-against-174 comparison could never satisfy.
            held = len(seen & signature) / max(1, len(signature))
            if held > score:
                best, score = name, held
        if best and score >= OVERLAP_FLOOR:
            labels[cid] = best
            by_overlap += 1
        else:
            labels[cid] = current.get(cid) or f"Community {cid}"
            left.append((cid, labels[cid], len(mem)))

    clashes = [n for n, c in Counter(labels.values()).items() if c > 1]
    if clashes:
        sys.exit(f"two communities would share a name, refusing to write: {clashes}")

    (OUT / ".graphify_labels.json").write_text(
        json.dumps({str(c): n for c, n in labels.items()}, ensure_ascii=False), encoding="utf-8")
    for node in raw["nodes"]:
        cid = node.get("community")
        if cid is not None:
            node["community_name"] = labels.get(int(cid), node.get("community_name"))
    (OUT / "graph.json").write_text(json.dumps(raw, ensure_ascii=False), encoding="utf-8")

    cost = load(OUT / "cost.json") if (OUT / "cost.json").is_file() else {}
    report = generate(
        G, communities, score_all(G, communities), labels, god_nodes(G),
        surprising_connections(G, communities), detect(ROOT),
        {"input": cost.get("total_input_tokens", 0), "output": cost.get("total_output_tokens", 0)},
        str(ROOT), suggested_questions=suggest_questions(G, communities, labels))
    (OUT / "GRAPH_REPORT.md").write_text(report, encoding="utf-8")
    for export in ("html", "wiki"):
        subprocess.run([sys.executable, "-m", "graphify", "export", export],
                       cwd=ROOT, check=False, stdout=subprocess.DEVNULL)

    print(f"{len(labels)} communities: {by_hub} named by hub, {by_overlap} by overlap, "
          f"{len(left)} still generated")
    for cid, name, size in sorted(left, key=lambda row: -row[2])[:10]:
        print(f"  #{cid:<4} {name:<34} ({size} nodes) — name it in {MAP.name} if it matters")


if __name__ == "__main__":
    main()

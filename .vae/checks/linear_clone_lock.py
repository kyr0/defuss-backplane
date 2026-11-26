"""Fails when examples/linear-clone/bun.lock records other backplane dependencies than the root package.json.

VERIFIED: the example installs the backplane from a file: tarball, and `bun install --frozen-lockfile` keeps the
dependencies its lock recorded for it: after the root moved to defuss-rpc 4.4.0, a frozen install still put
defuss-rpc 4.3.0 under node_modules/defuss-backplane without an error."""
import json, re, sys
from pathlib import Path

root = Path(__file__).resolve().parents[2]
want = json.loads((root / "package.json").read_text()).get("dependencies", {})
text = (root / "examples/linear-clone/bun.lock").read_text()
lock = json.loads(re.sub(r",(\s*[}\]])", r"\1", text))  # bun.lock is JSON with trailing commas
entry = lock["packages"]["defuss-backplane"]
have = next((e.get("dependencies", {}) for e in entry if isinstance(e, dict)), {})
if have != want:
    diff = sorted(f"{k}: lock {have.get(k)} != package.json {want.get(k)}" for k in set(have) | set(want) if have.get(k) != want.get(k))
    print("examples/linear-clone/bun.lock is stale for defuss-backplane: " + "; ".join(diff))
    print("fix: make -C examples/linear-clone setup && (cd examples/linear-clone && bun update defuss-backplane), then commit bun.lock")
    sys.exit(1)

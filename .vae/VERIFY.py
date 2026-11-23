"""Project-local verifier policy. Agents MAY extend it; every gate executes it fail-closed."""

CONFIG = {
    "coverage_min": 60,
    "lint_command": None,          # None → `make lint` (uv run ruff check . | bunx oxlint --deny-warnings).
    "test_command": None,          # None → `make test`. Commands run in the repo root.
    "coverage_command": None,      # None → `make coverage`; output needs `TOTAL <n>%` or an `All files |…|` table.
    "integration_commands": [],    # [] → `make integration` if present.
    "e2e_commands": [],            # [] → `make e2e`: build + consume the publishable artifact.
    "e2e_paths": [],               # globs e2e depends on, e.g. ["web/*"]: e2e reruns only when one (or a build file) changed; [] → any code file.
    "timeout_s": 180,
    # `init` on a GitHub remote writes .github/workflows/verify.yml (uv/bun via their official setup actions) unless a
    # workflow already runs `make verify`, these commands or every verify verb. None → make setup, make verify.
    "ci": None,                    # None | False (no CI workflow) | ["make setup", "make ci"] (one step each)
    "layout": True,                # Makefile verbs + gitignored secrets, runtime state, dist/, caches and package folders.
    "strict": True,               # docs.pages, gitignore and package block; False makes them warnings (a project created before 0.6.0 has False).
    "gitignore_exempt": [],        # required ignore lines this project may skip, e.g. ["dist/"] for a GitHub Action that commits its build.
    "toolchain": True,             # new (sub)projects start on bun (JS/TS) / uv (Python): newly added npm/yarn/pnpm/poetry/pipenv/pdm/pip lockfiles fail.
    # Static check of every changed doc page (*.md|*.mdx|*.markdown); False disables it.
    # allow: {glob: characters a page may use as house style}, e.g. {"docs/de/*.md": "\u201e\u201c"} for German quotes.
    # phrases: extra slop regexes (any language), case-insensitive, flagged as findings.
    # html: globs of HTML pages that are prose (a project site, e.g. ["docs/*.html"]), checked in their text and
    # reader-facing attributes; other HTML files (templates, reports) are code.
    # HYPOTHESIS: most projects need no allow entry; add one only for a page whose house style needs a flagged character.
    # README.md covers the root and each package with a changed CLI|API; ARCH.md each package with changed production code
    # or deployment|schema files. A page covers the folders below it up to the next package manifest; tests, examples,
    # docs, config and data need none.
    "readme": {"exclude": []},     # folder globs exempt from README.md coverage; False drops it (the root still needs one)
    "arch": {"exclude": []},       # folder globs exempt from ARCH.md coverage; False drops it
    # Changed package.json: packageManager, description, license, author; new packages also type, linter, library build.
    "package": {"manager": "bun", "type": "module", "lint": "oxlint", "library_build": "pkgroll"},  # False disables
    # Optional for edit runs (references/EDIT.md): "guidelines" (textsorte, zielgruppe, kommunikationsziel, hausstil,
    # geschuetzte_begriffe: terms a replacement must keep) and "edit" (max_part_chars, heading_depth, attempts, the
    # budgets, tool_scope, trace, max_tokens_total); unset keys keep pro-edit's defaults.
    # The pinned VAE scaffold uses its documented sequence operator in the managed agent block.
    "prose": {"allow": {"AGENTS.md": "→"}, "phrases": [], "html": []},
}

# Deterministic invariants only; no semantic guesses.
# kinds: command | file_exists | contains | regex | not_regex
# When none of these can express an invariant (it needs parsing, several files, a running program or project
# semantics), plan the check like a test: write .vae/checks/<id>.py (stdlib, exits non-zero and prints what to fix)
# and add {"id": "<id>", "kind": "command", "command": "python3 .vae/checks/<id>.py", "claim": "..."}.
# scope: "path" = one exact file; "glob" = every changed code file matching (fnmatch); "glob" + "docs": True = every
# changed doc page matching, e.g. {"id": "docs.arch.diagram", "kind": "contains", "path": "docs/ARCHITECTURE.md",
# "text": "```mermaid", "claim": "architecture page keeps its diagram"}.
RULES = [{
    "id": "tests.no-mocks",
    "kind": "not_regex",
    "glob": "*",
    # Every alternative contains an escape, so this file never matches its own pattern.
    "pattern": r"unittest\.mock|from\s+unittest\s+import\s+mock|MagicMock\(|mock\.patch|mocker\.|"
               r"jest\.(?:mock|fn|spyOn)\(|vi\.(?:mock|fn|spyOn)\(|sinon\.|gomock\.|mock\.Mock\b|Mockito\.|@Mock\s|mockk\(|"
               r"@Mock(?:ito)?Bean\b|new\s+Mock<|Mock\.Of<|Substitute\.For<|A\.Fake<|mockall:{2}|#\[automock\]",
    "claim": "tests exercise real subsystems, not mock frameworks",
}]

RULES += [
    {"id": "backplane.network", "kind": "contains", "path": "ARCH.md",
     "text": "127.0.0.1", "claim": "architecture specifies the loopback listener"},
    {"id": "backplane.install", "kind": "contains", "path": "README.md",
     "text": "defuss-backplane-0.3.0.tgz", "claim": "quick start installs the tested package"},
    {"id": "backplane.typescript", "kind": "command",
     "command": "test -z \"$(find src tests scripts -type f \\( -name '*.js' -o -name '*.mjs' -o -name '*.cjs' -o -name '*.jsx' \\) -print)\"",
     "claim": "sources, tests and scripts stay TypeScript; the lint step type-checks all three"},
    {"id": "backplane.registry-deps", "kind": "not_regex", "path": "package.json",
     "pattern": r"\"(?:file|link|portal):",
     "claim": "dependencies resolve from the registry, so a CI checkout without sibling repos installs them"},
    {"id": "backplane.version-sync", "kind": "command",
     "command": "v=$(node -p \"require('./package.json').version\") && grep -q \"version: \\\"$v\\\"\" src/tools.ts"
                " && grep -q \"version: \\\"$v\\\"\" scripts/e2e.ts && grep -qF \"defuss-backplane-$v.tgz\" scripts/e2e.ts",
     "claim": "the MCP server version and the packed-consumer tarball follow package.json"},
]

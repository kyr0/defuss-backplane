# The linear-clone app service: the defuss-vae verbs for humans, agents and the repository's gate.
# Bun loads .env for every bun command, so one parser reads it; an include here would read `$` and `#` by Make's rules.
NAME ?= linear-clone
RUN  ?= exec bun dist/server.js
N    ?= 50
FORMAT ?= json
export RUN
# Installer default dirs as a fallback: recipes find tools that setup just installed, while tools on PATH keep precedence.
export PATH := $(PATH):$(HOME)/.local/bin:$(HOME)/.bun/bin:$(HOME)/.local/share/mise/shims
# The backplane comes from this repository, because the release with scheduled RPC callbacks is not on npm yet.
ROOT        = ../..
BACKPLANE   = deps/defuss-backplane
BACKPLANE_TGZ = $(ROOT)/output/defuss-backplane-$(shell node -p "require('$(ROOT)/package.json').version").tgz

.PHONY: help setup build start stop restart status log metrics bench test coverage lint e2e verify logs mcp-config e2e-live health healthz
.DEFAULT_GOAL := help

help: ## list the verbs with their usage (default goal)
	@awk -F':.*## ' '/^[a-zA-Z0-9_ -]+:.*## /{printf "  %-12s %s\n", $$1, $$2}' $(firstword $(MAKEFILE_LIST))

# Why a directory extracted from the packed tarball: `file:../..` links the whole repository, var/ and node_modules
# included, and a tarball dependency kept serving its first content after a repack (VERIFIED by probe on Bun 1.4.5).
# `bun install` re-links a directory dependency's recreated files.
setup: ## install pinned tools, pack the backplane from the repository root, the locked dependencies and a missing .env
	@if command -v mise >/dev/null 2>&1; then mise install; fi
	$(MAKE) -C $(ROOT) pack
	rm -rf $(BACKPLANE) && mkdir -p $(BACKPLANE)
	tar xzf $(BACKPLANE_TGZ) -C $(BACKPLANE) --strip-components=1
	bun install --frozen-lockfile
	./node_modules/.bin/playwright-core install chromium firefox webkit
	@$(MAKE) -s .env

build: ## bundle the server and the frontend into dist/
	bun run build

# The lifecycle verbs print JSON (FORMAT=text: one line each) from $(ROOT)/scripts/service.ts.
SERVICE = node $(ROOT)/scripts/service.ts --name $(NAME) --lines $(N) --format $(FORMAT)
start: ## build quietly, then run RUN detached (pid in tmp/, logs appended to var/log/); prints its state as JSON
	@$(SERVICE) --run "$$RUN" --build "bun run build" start

# setup creates a missing .env from .env.example with the daemon's API_KEY from the repository root's .env, which the
# root creates first if it has none, so `make start` there and here pair up. A key with a character besides letters, digits
# and ._~+/=- is left for a human to write, because Bun's .env parser changes some ($, #, quotes, spaces).
.env:
	@$(MAKE) -s -C $(ROOT) .env
	@key=$$(sed -n 's/^API_KEY=//p' $(ROOT)/.env | tail -n 1); \
	printf '%s' "$$key" | grep -Eq '^[A-Za-z0-9._~+/=-]+$$' || { echo "UNKNOWN[.env] BC $(ROOT)/.env's API_KEY is empty or needs quoting: set BACKPLANE_API_KEY in .env by hand"; exit 6; }; \
	(umask 077; set -C; sed "s|^BACKPLANE_API_KEY=$$|BACKPLANE_API_KEY=$$key|" .env.example > $@) && echo "created .env with the backplane's API_KEY"

stop: ## SIGTERM the service group, SIGKILL after 5 s; prints JSON
	@$(SERVICE) stop

restart: stop start ## stop, then start

status: ## running | dead | stopped as JSON; exits 1 only when dead (a stale pid)
	@$(SERVICE) status

log: ## the last N=50 stdout and stderr entries merged by time, one JSON object per line
	@$(SERVICE) log

logs: log

# The MCP client entry (`.mcp.json` format) for the app, which has no auth yet; the root's file gets it too, so a
# session at the repository root sees the backplane and the app. scripts/e2e.ts writes its own for the built app.
MCP_ENV ?= .env
MCP_OUT ?= .mcp.json $(ROOT)/.mcp.json
mcp-config: ## write the app's MCP client entry into .mcp.json here and at the repository root, other servers kept
	@node $(ROOT)/scripts/mcp-config.ts --name $(NAME) --env $(MCP_ENV) --url 'http://127.0.0.1:$${PORT:-43180}/mcp' \
	  $(foreach f,$(MCP_OUT),--out $(f))

health: ## readiness of the running app (/readyz: it answers and the backplane is ready) as JSON; exits 1 unless it passes
	@$(SERVICE) --path /readyz probe

healthz: ## liveness of the running app (/livez) as JSON; exits 1 unless it answers
	@$(SERVICE) --path /livez probe

metrics: ## print the running backplane's metric lines for app="linear-clone" (reads .env like the app)
	bun scripts/metrics.ts

bench: ## time the Issues.list round trip over 1000 issues against a throwaway backplane; writes output/bench.json
	bun scripts/bench.ts

test: ## run the tests against real subsystems
	bun test ./tests

coverage: ## measure line and function coverage; below 60 % it fails (bunfig.toml)
	bun test --coverage ./tests

lint: ## run oxlint and the strict TypeScript checker
	bun run lint

e2e: build ## drive the built app with the real backplane in Chromium, Firefox and WebKit, then run the deep suite
	node scripts/e2e.ts

# A second instance of the built app runs the deep suite in the workspace _e2e_test_linear-clone, which it wipes
# before and after; the app make start runs and its workspace stay untouched.
e2e-live: build ## run the deep RPC and MCP suite against the running backplane named in .env
	node --env-file=.env scripts/deep-live.ts

verify: lint test coverage e2e ## run every verification verb, cheapest first

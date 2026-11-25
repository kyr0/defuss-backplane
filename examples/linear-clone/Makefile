# The linear-clone app service: the defuss-vae verbs for humans, agents and the repository's gate.
# Bun loads .env for every bun command, so one parser reads it; an include here would read `$` and `#` by Make's rules.
NAME ?= linear-clone
RUN  ?= exec bun dist/server.js
N    ?= 50
export RUN
# Installer default dirs as a fallback: recipes find tools that setup just installed, while tools on PATH keep precedence.
export PATH := $(PATH):$(HOME)/.local/bin:$(HOME)/.bun/bin:$(HOME)/.local/share/mise/shims
LOG   = var/log/$(NAME)
PID   = tmp/$(NAME).pid
ALIVE = [ -f $(PID) ] && kill -0 "$$(cat $(PID))" 2>/dev/null
# The backplane comes from this repository, because the release with scheduled RPC callbacks is not on npm yet.
ROOT        = ../..
BACKPLANE   = deps/defuss-backplane
BACKPLANE_TGZ = $(ROOT)/output/defuss-backplane-$(shell node -p "require('$(ROOT)/package.json').version").tgz

.PHONY: help setup build start stop restart status log metrics bench test coverage lint e2e verify
.DEFAULT_GOAL := help

help: ## list the verbs with their usage (default goal)
	@awk -F':.*## ' '/^[a-zA-Z0-9_ -]+:.*## /{printf "  %-12s %s\n", $$1, $$2}' $(firstword $(MAKEFILE_LIST))

# Why a directory extracted from the packed tarball: `file:../..` links the whole repository, var/ and node_modules
# included, and a tarball dependency kept serving its first content after a repack (VERIFIED by probe on Bun 1.4.5).
# `bun install` re-links a directory dependency's recreated files.
setup: ## install pinned tools, pack the backplane from the repository root, then exactly the locked dependencies
	@if command -v mise >/dev/null 2>&1; then mise install; fi
	$(MAKE) -C $(ROOT) pack
	rm -rf $(BACKPLANE) && mkdir -p $(BACKPLANE)
	tar xzf $(BACKPLANE_TGZ) -C $(BACKPLANE) --strip-components=1
	bun install --frozen-lockfile

build: ## bundle the server and the frontend into dist/
	bun run build

start: build ## run the built service detached: pid in tmp/, stdout|stderr appended to var/log/
	@mkdir -p var/log tmp
	@if $(ALIVE); then echo "running pid=$$(cat $(PID))"; exit 0; fi; \
	[ -n "$$RUN" ] || { echo "UNKNOWN[start] BC RUN unset"; exit 6; }; \
	if command -v setsid >/dev/null 2>&1; then nohup setsid sh -c "$$RUN" >$(LOG).stdout 2>$(LOG).stderr </dev/null & \
	else set -m; nohup sh -c "$$RUN" >$(LOG).stdout 2>$(LOG).stderr </dev/null & set +m; fi; \
	echo $$! >$(PID); sleep 1; \
	if $(ALIVE); then echo "running pid=$$(cat $(PID))"; else echo "dead; see: make log"; exit 1; fi

stop: ## SIGTERM the service group, SIGKILL after 5 s
	@if $(ALIVE); then p=$$(cat $(PID)); kill -s TERM -- -$$p 2>/dev/null || kill -s TERM $$p; \
	i=0; while kill -0 $$p 2>/dev/null && [ $$i -lt 50 ]; do sleep 0.1; i=$$((i+1)); done; \
	kill -s KILL -- -$$p 2>/dev/null || true; fi; rm -f $(PID); echo stopped

restart: stop start ## stop, then start

# LSB codes (make prints them as Error N): 0 running, 1 dead with stale pid, 3 stopped.
status: ## running | dead (stale pid) | stopped, as LSB exit codes
	@if $(ALIVE); then echo "running pid=$$(cat $(PID))"; \
	elif [ -f $(PID) ]; then echo "dead pid=$$(cat $(PID)); see: make log"; exit 1; \
	else echo stopped; exit 3; fi

log: ## tail stdout and stderr logs (N=50 lines)
	@for f in $(LOG).stdout $(LOG).stderr; do [ -f $$f ] && { echo "== $$f"; tail -n $(N) $$f; }; done; \
	ls $(LOG).* >/dev/null 2>&1 || echo "∅ no logs for $(NAME)"

metrics: ; @echo "UNKNOWN[metrics] BC undefined: the backplane's /metrics lines for app=linear-clone"; exit 2  ## print the app's backplane metrics
bench:   ; @echo "UNKNOWN[bench] BC undefined: the Issues.list round trip over 1000 issues"; exit 2  ## time the hot paths

test: ## run the tests against real subsystems
	bun test ./tests

coverage: ## measure line and function coverage; below 60 % it fails (bunfig.toml)
	bun test --coverage ./tests

lint: ## run oxlint and the strict TypeScript checker
	bun run lint

e2e: build ## drive the built app with the real backplane in Chromium, Firefox and WebKit
	node scripts/e2e.ts

verify: lint test coverage e2e ## run every verification verb, cheapest first

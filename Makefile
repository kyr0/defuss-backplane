# Daemon lifecycle and release verification. Both runtimes use the same build.
NAME ?= defuss-backplane
RUNTIME ?= node
RUN  ?= exec $(RUNTIME) dist/cli.js
N    ?= 50
FORMAT ?= json
export RUN
# The CLI loads .env itself under both runtimes, preserving literal key characters.

.PHONY: help setup start stop restart status log metrics bench test coverage lint e2e verify logs
.DEFAULT_GOAL := help

help: ## list the verbs with their usage (default goal)
	@awk -F':.*## ' '/^[a-zA-Z0-9_ -]+:.*## /{printf "  %-12s %s\n", $$1, $$2}' $(firstword $(MAKEFILE_LIST))

setup: ## install locked development dependencies (mise supplies pinned runtimes) and create a missing .env
	@if command -v mise >/dev/null 2>&1; then mise install; fi
	bun install --frozen-lockfile
	@$(MAKE) -s .env

build: ## build the ESM package, types and executable
	bun run build

# The lifecycle verbs print JSON (FORMAT=text: one line each) from scripts/service.ts.
SERVICE = node scripts/service.ts --name $(NAME) --lines $(N) --format $(FORMAT)
start: ## build quietly, then run RUN detached (pid in tmp/, logs appended to var/log/); prints its state as JSON
	@$(SERVICE) --run "$$RUN" --build "bun run build" start

# setup creates a missing .env from .env.example with a random bot key, readable by the owner only. Why random, not a
# fixed default key: every holder may access every tenant. An existing .env is never rewritten.
.env:
	@(umask 077; set -C; sed "s/^API_KEY=$$/API_KEY=$$(openssl rand -hex 32)/" .env.example > $@) && echo "created .env with a new API_KEY"

stop: ## SIGTERM the service group, SIGKILL after 5 s; prints JSON
	@$(SERVICE) stop

restart: stop start ## stop, then start

status: ## running | dead | stopped as JSON; exits 1 only when dead (a stale pid)
	@$(SERVICE) status

log: ## the last N=50 stdout and stderr entries merged by time, one JSON object per line
	@$(SERVICE) log

logs: log

metrics: ## show the last package verification results
	@cat output/e2e.json

bench: build ## time the isolated cross-runtime acceptance workload
	@time $(MAKE) e2e

# `./tests` is a path; a bare `tests` is a name filter that also matches examples/linear-clone/tests (VERIFIED).
test: ## run storage, protocol and resource tests
	bun test ./tests

coverage: ## measure source line and function coverage
	bun test --coverage ./tests

lint: ## run oxlint and the strict TypeScript checker
	bun run lint

pack: build ## pack an installable release into output/
	@mkdir -p output
	bun pm pack --destination output

e2e: pack ## install and exercise the tarball under Node.js and Bun
	node scripts/e2e.ts

verify: lint test coverage e2e ## run all verification checks

gate: ## run the pinned VAE verify, review and documentation gate
	@mkdir -p tmp/vae-runner
	@tar xzf vendor/defuss-vae-dc0f6b5.tar.gz -C tmp/vae-runner
	@python3 tmp/vae-runner/plugin/scripts/vae.py gate --repo . --session backplane

.PHONY: build pack gate

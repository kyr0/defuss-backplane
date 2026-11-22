# Daemon lifecycle and release verification. Both runtimes use the same build.
NAME ?= defuss-backplane
RUNTIME ?= node
RUN  ?= exec $(RUNTIME) dist/cli.js
N    ?= 50
export RUN
# The CLI loads .env itself under both runtimes, preserving literal key characters.
LOG   = var/log/$(NAME)
PID   = tmp/$(NAME).pid
ALIVE = [ -f $(PID) ] && kill -0 "$$(cat $(PID))" 2>/dev/null

.PHONY: help setup start stop restart status log metrics bench test coverage lint e2e verify
.DEFAULT_GOAL := help

help: ## list the verbs with their usage (default goal)
	@awk -F':.*## ' '/^[a-zA-Z0-9_ -]+:.*## /{printf "  %-12s %s\n", $$1, $$2}' $(firstword $(MAKEFILE_LIST))

setup: ## install locked development dependencies (mise supplies pinned runtimes)
	@if command -v mise >/dev/null 2>&1; then mise install; fi
	bun install --frozen-lockfile

build: ## build the ESM package, types and executable
	bun run build

start: build ## run RUN detached: pid in tmp/, stdout|stderr appended to var/log/
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

metrics: ## show the last package verification results
	@cat output/e2e.json

bench: build ## time the isolated cross-runtime acceptance workload
	@time $(MAKE) e2e

test: ## run storage, protocol and resource tests
	bun test tests

coverage: ## measure source line and function coverage
	bun test --coverage tests

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

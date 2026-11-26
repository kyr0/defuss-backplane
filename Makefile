# Daemon lifecycle and release verification. Both runtimes use the same build.
NAME ?= defuss-backplane
RUNTIME ?= node
RUN  ?= exec $(RUNTIME) dist/cli.js
N    ?= 50
FORMAT ?= json
export RUN
# The CLI loads .env itself under both runtimes, preserving literal key characters.

.PHONY: help setup start stop restart status log metrics bench test coverage lint e2e verify logs mcp-config fixtures e2e-live
.DEFAULT_GOAL := help

help: ## list the verbs with their usage (default goal)
	@awk -F':.*## ' '/^[a-zA-Z0-9_ -]+:.*## /{printf "  %-12s %s\n", $$1, $$2}' $(firstword $(MAKEFILE_LIST))

setup: ## install locked development dependencies (mise supplies pinned runtimes), Chromium and a missing .env
	@if command -v mise >/dev/null 2>&1; then mise install; fi
	bun install --frozen-lockfile
	./node_modules/.bin/playwright-core install chromium
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

# The MCP client entry (`.mcp.json` format) for this daemon, URL and bot key read from MCP_ENV; scripts/e2e.ts writes
# its own with MCP_ENV and MCP_OUT pointing at the throwaway daemon, so the e2e connects exactly as a client would.
MCP_ENV ?= .env
MCP_OUT ?= .mcp.json
mcp-config: ## write this daemon's MCP client entry (URL, bot key header) into .mcp.json, mode 600, other servers kept
	@node scripts/mcp-config.ts --name $(NAME) --env $(MCP_ENV) --url 'http://127.0.0.1:$${PORT:-43127}/mcp' \
	  --header 'Authorization: Bearer $${API_KEY}' $(foreach f,$(MCP_OUT),--out $(f))

# The deep suite's video, committed. Playwright's Chromium has no H.264, so it is VP9 with a keyframe every second.
# The noise holds the bitrate at 1.5 Mbit/s: a seek opens a new range only megabytes ahead of what has arrived.
fixtures: ## regenerate input/video.webm (20 s, 640x360, VP9, about 4 MB) with ffmpeg
	ffmpeg -hide_banner -loglevel error -y -f lavfi -i "testsrc2=duration=20:size=640x360:rate=25,noise=alls=30:allf=t+u" \
	  -c:v libvpx-vp9 -b:v 1500k -minrate 1500k -maxrate 1500k -g 25 -deadline realtime -cpu-used 8 -an input/video.webm

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

# The deep suite against the daemon `make start` runs, through the client config `make mcp-config` wrote. It writes
# only to the tenant _e2e_test_backplane of the app deep-e2e, in buckets named after the run.
e2e-live: ## run the deep RPC and MCP suite against the running daemon (needs make start and make mcp-config)
	@test -f .mcp.json || { echo '{"error":"no .mcp.json; run make mcp-config"}'; exit 1; }
	node --env-file=.env scripts/deep/run.ts --mcp .mcp.json $$(test -f tmp/$(NAME).pid && echo --pid $$(cat tmp/$(NAME).pid)) --report output/deep-live.json

verify: lint test coverage e2e ## run all verification checks

gate: ## run the pinned VAE verify, review and documentation gate
	@mkdir -p tmp/vae-runner
	@tar xzf vendor/defuss-vae-dc0f6b5.tar.gz -C tmp/vae-runner
	@python3 tmp/vae-runner/plugin/scripts/vae.py gate --repo . --session backplane

.PHONY: build pack gate

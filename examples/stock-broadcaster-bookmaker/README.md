# Stock example — Flow 01 read-only bootstrap

Status: read-only bootstrap only. This is NOT a working stock broadcaster. It proves an outside process can install the packed CLI and read the Observe role catalog/board. No frames, markets, vaults, funding, resolution, or claims happen here.

Boundary: imports ONLY `@livestreak/cli/agent-client` (`createAgentClient`) from the packed tarball in a clean consumer. No `cli/src`, app, Host, or workspace imports. No `file:` dependencies. Credentials are runtime inputs only.

## Prerequisites (operator)

- Node 22+.
- A reachable Host + gateway (this example does not boot one; `livestreak remote open` builds the session wallet from your configured wallet backend, so settings must be initialized and unlocked first).
- One THROWAWAY grant — the revoke/close path destroys it. Never reuse a live role session for this check.

## Run (throwaway grant)

```sh
# Operator (keeps the seed, shares ONLY code+pass):
livestreak remote open --scopes bridge:board:read --ttl 30m
# pairing code: <sessionId>   pairing pass: see LIVESTREAK_PAIR_PASSWORD below

# Clean consumer (fresh temp root, no workspace symlinks or parent node_modules):
E01ROOT=$(mktemp -d) && PACKDIR="$E01ROOT/pack" && CONSUMER="$E01ROOT/consumer" && mkdir -p "$PACKDIR" "$CONSUMER"
npm pack --workspace=@livestreak/cli --pack-destination="$PACKDIR"
cd "$CONSUMER" && npm init -y
npm install --no-save "$PACKDIR"/livestreak-cli-*.tgz
cp <repo>/examples/stock-broadcaster-bookmaker/package.json ./package.json
mkdir -p src && cp <repo>/examples/stock-broadcaster-bookmaker/src/read-boards.mjs ./src/
export LIVESTREAK_PAIR_PASSWORD # set to the pairing password via your secret manager, never pasted here
npm run read -- http://127.0.0.1:8787 <sessionId> --wait-ms 10000
# expect: READY { resolved: .../node_modules/@livestreak/cli/dist/agent-client.js } + JSON { functionCount, boardKeys, boardSummary }
cd / && rm -rf "$E01ROOT"
```

Or from the repo root (same clean-consumer steps, automated):

```sh
export LIVESTREAK_PAIR_PASSWORD # pairing password from your secret manager
HOST_URL=http://127.0.0.1:8787 SESSION_ID=<throwawaySessionId> \
  node examples/stock-broadcaster-bookmaker/scripts/verify-readonly-consumer.mjs
# expect: FLOW01-READ-OK <resolved-outside-workspace> boards=<keys> functions=<n>
```

What counts: a real Host + real gateway run against a throwaway grant, with the installed package AND resolved module proven under the clean consumer via URL + `realpath` (symlink escape rejected, advertised `npm run read` exercised) and an Observe board with revision, catalog version and system:config run state received within one total connect/read timeout budget. An empty action catalog under a board-only grant is legitimate and reported honestly. Fixture/offline runs are labeled `FIXTURE-NOT-FLOW01` and do not pass Flow 01. Credentials never appear in output or receipts; missing-credential errors name the env var only.

Next (not this batch): bot frames via the accepted A/B ingest boundary, second-viewer proof, then mandate/receipt/funding work under Master assignment.

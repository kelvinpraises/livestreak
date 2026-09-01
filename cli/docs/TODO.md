# CLI / Gateway — TODO

Target CLI: `cli/`. Architecture: **pending** — do not write `cli/docs/architecture.md` until host / contracts / options public edges are callable.

See [repo TODO](../../README.md). **This file is mostly blocked.** Good CLI design comes after packages can be called cleanly through stable public APIs.

---

## Status: blocked (read first)

Do not implement integration commands or deep CLI structure until:

- [ ] `@flowstream/contracts` generated ABI/types and execution plan are real enough to plan commands against
- [ ] `host/` dev server exposes descriptor + `POST /aa/bundler/:chain` (or documented dev equivalent)
- [ ] `@livestreak/options` runtime hardening and real read transport edge are clean enough for meaningful vault UX
- [ ] Observe market-registration edge is documented end-to-end (observe metadata → `registerMarket` write)

Until then: preferences sketch and ownership notes only — no command surface expansion.

---

## Ownership (design notes only — not implementation yet)

- [ ] CLI owns: auth UX, preferences, selected host, selected chain, account labels, process execution
- [ ] CLI calls package **public APIs only** — no worker / pipeline / contract internals
- [ ] Gateway (future): external authentication, session, caller identity
- [ ] Package Bridges: internal authorized call surfaces inside each package

---

## Preferences (deferred — spec when packages stabilize)

- [ ] Saved host URL and descriptor
- [ ] Chain id and contract address map
- [ ] Account / wallet label selection
- [ ] Output defaults (file, local, simulcast / host)
- [ ] Adapter paths (browser, ffmpeg, python cv)

---

## Integration commands (deferred)

- [ ] Observe: prepare/start run via public observe runtime/bridge
- [ ] Observe edge: trigger/coordinate `registerMarket` with manifest + `observeRunId`
- [ ] Options: panel read, funding, claims via public options API
- [ ] Bookmaker: agent loop edge (later)
- [ ] Steward: monitor / action edge (later)
- [ ] Host: health, descriptor, bundler URL from AA descriptor

---

## Engineering (when unblocked)

- [ ] `Effect.run*` allowed at CLI edge only
- [ ] Serialize errors via `@livestreak/core`
- [ ] No duplicate protocol types — import from canonical packages

---

## Hardening (every slice)

When CLI work starts, run after each slice. Full checklist: [repo TODO § Hardening loop](../../README.md#hardening-loop).

- [ ] check / build / test for `cli`
- [ ] Stale-term + forbidden-import + empty-file scans
- [ ] Negative-path test for every new command
- [ ] Update this `docs/TODO.md`

# @livestreak/schema — TODO

Architecture: **pending** — schema does not need a full architecture doc until first cross-package wire format is chosen.

See [repo TODO](../../../README.md).

**Conservative rule:** schema is for **shared JSON on the wire** only. It is **not** a dumping ground for every internal TypeScript type. When in doubt, keep the type in the owning package until a second consumer needs the same serialized shape.

---

## Default answer: not yet

Before adding anything to schema, ask:

1. Is this JSON crossing a package or process boundary (CLI output, host HTTP, chain-adjacent wire)?
2. Do two or more packages need the **exact same** serialized shape?
3. Can `@flowstream/contracts` generated ABI/types, tiny decode helpers, or package-local view types handle it instead?

If any answer is no → **do not add to schema.**

---

## Scope decision (write this before first schema addition)

- [ ] One-page `schema/docs/architecture.md` when first wire type lands — what belongs here vs packages
- [ ] List approved schema domains; reject drive-by type moves

---

## Candidates (only after wire format is stable — not a backlog to empty)

Add **one at a time** when a concrete integration needs it:

- [ ] Chain / protocol references (if not owned solely by contracts package exports)
- [ ] Endpoint manifest JSON (if host + observe + CLI all serialize the same envelope)
- [ ] Host descriptor / policy / session JSON (if duplicated outside `packages/host`)
- [ ] Evidence refs / cache receipt JSON (if shared beyond host types package)
- [ ] CLI JSON output envelopes (error + command result shells)

**Not candidates for schema**

- Options `VaultSnapshot` / `VaultView` internal models
- Bookmaker `VaultDraft` / `Detection` internals
- Steward `Finding` / `Decision` internals before a wire format exists
- Runtime config structs used in one package only
- Effect types, viem types, decode helpers

---

## Mapping notes

- [ ] Contract enum → product strings: prefer `@flowstream/contracts` generated ABI/types or tiny decode helpers first
- [ ] Schema enters only when multiple packages emit/consume the same JSON enum strings
- [ ] Reconcile legacy `packages-re/schema` drift only when contracts v0 enums lock

---

## Non-goals

- [ ] No Effect runtime, no viem, no business workflows
- [ ] No "move everything from packages-re/schema" migration without per-type justification
- [ ] No mirror of architecture doc types for documentation convenience

---

## Hardening (every slice)

Run when schema types change. Full checklist: [repo TODO § Hardening loop](../../../README.md#hardening-loop).

- [ ] check / build / test for `packages/schema`
- [ ] Boundary test: schema modules import no package runtime code
- [ ] Negative-path decode/encode test for every new public schema export
- [ ] Update this `docs/TODO.md`

// Renders the in-package function catalog as ONE package container (the "GLOBAL" pattern), uniform
// across all four packages. Three descriptor shapes converge here:
//   - a package that emits a single wrapping root group (bookmaker/steward/options) → the group IS
//     the container (unwrapped, so its label titles the pane).
//   - a package whose actions carry a `parentId` naming a logical section but that emits NO group node
//     for it (observe: `observe.capture.file`, `observe.sink.live`, `observe.market`,
//     `observe.system.run`, …) → a section group is SYNTHESIZED per distinct parentId so the actions
//     nest under a labelled header instead of collapsing into one flat blob.
//   - loose root actions with no parentId at all → they sit directly under the package container.
// Either way the console shows exactly one titled container per package, with grouped sections inside.
// GROUP nodes nest as indented sub-containers; ACTION nodes are leaf cards rendered by the slot.
// Nodes with `visible === false` are omitted.

import { useMemo, type ReactNode } from 'react'
import type { FunctionDescriptor } from '@livestreak/schema'
import { bridgeActionScope } from '@livestreak/schema'

interface Props {
  readonly functions: readonly FunctionDescriptor[]
  readonly packageLabel: string
  readonly renderAction: (fn: FunctionDescriptor) => ReactNode
}

interface TreeIndex {
  readonly roots: readonly FunctionDescriptor[]
  readonly childrenOf: ReadonlyMap<string, readonly FunctionDescriptor[]>
}

// Turn a dangling parentId into a readable section header, e.g.
//   observe.capture.file  → "Capture · File"
//   observe.sink.live     → "Sink · Live"
//   observe.system.run    → "Run"       (the "system" qualifier is noise for the operator)
//   observe.market        → "Market"
// The package prefix (first segment) is dropped — the container already names the package.
export function deriveSectionLabel(parentId: string): string {
  const parts = parentId.split('.').filter((p) => p.length > 0)
  const withoutPackage = parts.length > 1 ? parts.slice(1) : parts
  const meaningful = withoutPackage.filter((p) => p !== 'system')
  const segments = (meaningful.length > 0 ? meaningful : withoutPackage).map(titleCase)
  return segments.length > 0 ? segments.join(' · ') : titleCase(parentId)
}

const titleCase = (segment: string): string =>
  segment.length === 0 ? segment : segment.charAt(0).toUpperCase() + segment.slice(1)

// Build a synthetic GROUP descriptor for an orphaned parentId so FunctionTree can render a real section.
// `package` is inherited from a child (FunctionTree is already filtered per-package upstream, so this is
// only for completeness); the node is structural — never dispatched — so its scope is inert.
const syntheticGroup = (
  parentId: string,
  order: number,
  pkg: FunctionDescriptor['package']
): FunctionDescriptor => ({
  id: parentId,
  package: pkg,
  name: parentId,
  label: deriveSectionLabel(parentId),
  scope: bridgeActionScope,
  disabled: false,
  visible: true,
  nodeKind: 'group',
  order,
})

export function buildTree(functions: readonly FunctionDescriptor[]): TreeIndex {
  const visible = functions.filter((f) => f.visible !== false)
  const byId = new Map<string, FunctionDescriptor>(visible.map((f) => [f.id, f]))
  const childrenOf = new Map<string, FunctionDescriptor[]>()

  // Synthesize a group for every parentId that is referenced but has no node of its own, so its children
  // nest under a section header rather than falling through to the flat package root. The group inherits
  // its first child's order so observe's cell ordering (Run, Capture, Sink, Market, …) is preserved.
  const orphanGroupOrder = new Map<string, number>()
  const orphanGroupPackage = new Map<string, FunctionDescriptor['package']>()
  for (const fn of visible) {
    const pid = fn.parentId
    if (pid && !byId.has(pid)) {
      const existing = orphanGroupOrder.get(pid)
      const order = fn.order ?? 0
      if (existing === undefined || order < existing) {
        orphanGroupOrder.set(pid, order)
      }
      if (!orphanGroupPackage.has(pid)) {
        orphanGroupPackage.set(pid, fn.package)
      }
    }
  }
  for (const [pid, order] of orphanGroupOrder) {
    byId.set(pid, syntheticGroup(pid, order, orphanGroupPackage.get(pid) ?? 'observe'))
  }

  for (const fn of byId.values()) {
    const pid = fn.parentId
    if (pid && byId.has(pid)) {
      const list = childrenOf.get(pid) ?? []
      list.push(fn)
      childrenOf.set(pid, list)
    }
  }

  for (const kids of childrenOf.values()) {
    kids.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  }

  const roots = [...byId.values()]
    .filter((f) => !f.parentId || !byId.has(f.parentId))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

  return { roots, childrenOf }
}

function Node({
  fn,
  childrenOf,
  renderAction,
  depth,
}: {
  fn: FunctionDescriptor
  childrenOf: ReadonlyMap<string, readonly FunctionDescriptor[]>
  renderAction: (fn: FunctionDescriptor) => ReactNode
  depth: number
}) {
  const kids = childrenOf.get(fn.id) ?? []

  // A group is a nested sub-container (header + stacked children), never a form.
  if (fn.nodeKind === 'group') {
    return (
      <Container title={fn.label} nodes={kids} childrenOf={childrenOf} renderAction={renderAction} depth={depth + 1} />
    )
  }

  // An action is a leaf card. Permutation guard: an action should never have children, but if a
  // descriptor ever nests actions under one (the steward bug), render the FORM first, then the
  // children indented below — the form is never swallowed into a header.
  if (kids.length > 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
        {renderAction(fn)}
        <div style={{ paddingLeft: 12, borderLeft: '2px solid rgba(0,255,135,0.16)', display: 'flex', flexDirection: 'column', gap: 26 }}>
          {kids.map((child) => (
            <Node key={child.id} fn={child} childrenOf={childrenOf} renderAction={renderAction} depth={depth + 1} />
          ))}
        </div>
      </div>
    )
  }

  return <>{renderAction(fn)}</>
}

function Container({
  title,
  nodes,
  childrenOf,
  renderAction,
  depth,
}: {
  title: string
  nodes: readonly FunctionDescriptor[]
  childrenOf: ReadonlyMap<string, readonly FunctionDescriptor[]>
  renderAction: (fn: FunctionDescriptor) => ReactNode
  depth: number
}) {
  const isRoot = depth === 0
  return (
    <section
      data-testid={`fn-container-${title}`}
      style={
        isRoot
          ? {
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 12,
              background: 'rgba(255,255,255,0.015)',
              padding: 24,
            }
          : {
              borderLeft: '2px solid rgba(0,255,135,0.22)',
              paddingLeft: 18,
            }
      }
    >
      <h3
        style={{
          fontSize: isRoot ? 11 : 10,
          color: isRoot ? 'rgba(255,255,255,0.5)' : 'rgba(0,255,135,0.6)',
          fontFamily: 'var(--font-mono)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          margin: '0 0 22px',
        }}
      >
        {title}
      </h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
        {nodes.map((node) => (
          <Node key={node.id} fn={node} childrenOf={childrenOf} renderAction={renderAction} depth={depth} />
        ))}
      </div>
    </section>
  )
}

export function FunctionTree({ functions, packageLabel, renderAction }: Props) {
  const { roots, childrenOf } = useMemo(() => buildTree(functions), [functions])

  if (roots.length === 0) {
    return (
      <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)' }}>
        No functions in this package.
      </p>
    )
  }

  // Normalize both shapes to one titled container. If the package wraps everything in a single root
  // group, that group's label titles the pane; otherwise synthesize the pane from packageLabel.
  const single = roots.length === 1 && roots[0].nodeKind === 'group' ? roots[0] : undefined
  const title = single ? single.label : packageLabel
  const topNodes = single ? childrenOf.get(single.id) ?? [] : roots

  return (
    <Container title={title} nodes={topNodes} childrenOf={childrenOf} renderAction={renderAction} depth={0} />
  )
}

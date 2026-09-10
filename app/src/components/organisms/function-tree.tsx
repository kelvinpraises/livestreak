// Renders the in-package function catalog as an id/parentId tree. Nodes with
// `visible === false` are omitted; roots are nodes with no parentId or whose
// parent is not in the visible set. Group nodes (`nodeKind === 'group'`) nest
// their children; action nodes are rendered via the caller-supplied slot.

import { useMemo, type ReactNode } from 'react'
import type { FunctionDescriptor } from '@livestreak/schema'

interface Props {
  readonly functions: readonly FunctionDescriptor[]
  readonly renderAction: (fn: FunctionDescriptor) => ReactNode
}

interface TreeIndex {
  readonly roots: readonly FunctionDescriptor[]
  readonly childrenOf: ReadonlyMap<string, readonly FunctionDescriptor[]>
}

export function buildTree(functions: readonly FunctionDescriptor[]): TreeIndex {
  const visible = functions.filter((f) => f.visible !== false)
  const byId = new Map(visible.map((f) => [f.id, f]))
  const childrenOf = new Map<string, FunctionDescriptor[]>()

  for (const fn of visible) {
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

  const roots = visible
    .filter((f) => !f.parentId || !byId.has(f.parentId))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

  return { roots, childrenOf }
}

function TreeNode({
  fn,
  childrenOf,
  renderAction,
}: {
  fn: FunctionDescriptor
  childrenOf: ReadonlyMap<string, readonly FunctionDescriptor[]>
  renderAction: (fn: FunctionDescriptor) => ReactNode
}) {
  const kids = childrenOf.get(fn.id) ?? []
  const isGroup = fn.nodeKind === 'group' || kids.length > 0

  if (isGroup && kids.length > 0) {
    return (
      <section data-testid={`fn-group-${fn.id}`} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h3
          style={{
            fontSize: 12,
            color: 'rgba(255,255,255,0.55)',
            fontFamily: 'var(--font-mono)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            margin: 0,
          }}
        >
          {fn.label}
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingLeft: 8 }}>
          {kids.map((child) => (
            <TreeNode key={child.id} fn={child} childrenOf={childrenOf} renderAction={renderAction} />
          ))}
        </div>
      </section>
    )
  }

  return <>{renderAction(fn)}</>
}

export function FunctionTree({ functions, renderAction }: Props) {
  const { roots, childrenOf } = useMemo(() => buildTree(functions), [functions])

  if (roots.length === 0) {
    return (
      <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)' }}>
        No functions in this package.
      </p>
    )
  }

  return (
    <div
      data-testid="function-tree"
      style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}
    >
      {roots.map((fn) => (
        <TreeNode key={fn.id} fn={fn} childrenOf={childrenOf} renderAction={renderAction} />
      ))}
    </div>
  )
}

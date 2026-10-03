// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
vi.mock('../src/hooks/use-vault-views', () => ({useVaultView: () => ({userPosition: undefined})}))
import { useStreamDraft } from '../src/hooks/use-stream-draft'
afterEach(cleanup)
it('preserves a viewer draft when connecting a wallet remounts the board', () => {
  const first = renderHook(() => useStreamDraft('connect-proof'))
  act(() => { first.result.current.setSide('yes'); first.result.current.setRate(0.5) })
  first.unmount()
  const next = renderHook(() => useStreamDraft('connect-proof'))
  expect(next.result.current.side).toBe('yes'); expect(next.result.current.rate).toBe(0.5)
  act(() => next.result.current.clear())
  expect(next.result.current.editing).toBe(false)
})
it('shares the draft between compact and focused views without leaking to another question', () => {
  const a=renderHook(() => useStreamDraft('question-a')), focused=renderHook(() => useStreamDraft('question-a')), b=renderHook(() => useStreamDraft('question-b'))
  act(() => a.result.current.change('no', 1))
  expect(focused.result.current.side).toBe('no'); expect(focused.result.current.rate).toBe(1)
  expect(b.result.current.side).toBeNull()
  act(() => focused.result.current.clear())
  expect(a.result.current.side).toBeNull()
})

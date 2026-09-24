// @vitest-environment jsdom
// The verb-row's named form snapshot: what Run hands to the dispatcher. The rules under test:
// plain fields keyed by display name, the discriminant's hidden group input included, INACTIVE
// arm fields excluded (only the chosen arm ships), picker checked labels as an array, and the
// picker's search input never treated as form state.

import { describe, expect, it } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import { ConsoleVerbRow } from '../src/components/molecules/console-verb-row'
import type { ConsoleFormValues, ConsoleVerb } from '../src/types/console'

const runAndRead = (verb: ConsoleVerb, mutate?: (c: ReturnType<typeof render>) => void): ConsoleFormValues => {
  let got: ConsoleFormValues = {}
  const view = render(<ConsoleVerbRow verb={verb} onRun={(_, values) => (got = values)} />)
  mutate?.(view)
  fireEvent.click(view.getByTestId(`verb-run-${verb.name}`))
  return got
}

describe('ConsoleVerbRow readNamedValues', () => {
  it('reads text/number/select fields keyed by display name', () => {
    const values = runAndRead(
      {
        name: 'Create vault',
        state: 'ready',
        fields: [
          { name: 'question', value: 'Will there be a goal?' },
          { name: 'seed side', value: 'yes', kind: 'select', options: [{ label: 'yes' }, { label: 'no' }] },
          { name: 'stake', value: '5000000', kind: 'number' },
        ],
      },
      (view) => {
        fireEvent.change(view.getByTestId('verb-field-Create vault-stake'), { target: { value: '7000000' } })
      }
    )
    expect(values).toEqual({ question: 'Will there be a goal?', 'seed side': 'yes', stake: '7000000' })
  })

  it('ships the discriminant choice plus ONLY the active arm fields', () => {
    const values = runAndRead({
      name: 'Configure capture',
      state: 'ready',
      fields: [
        {
          name: 'source',
          value: 'file',
          kind: 'select',
          options: [{ label: 'file' }, { label: 'browser' }],
          arms: {
            file: [{ name: 'path', value: './friday-cup.mp4' }],
            browser: [
              { name: 'url', value: 'http://x' },
              { name: 'fps', value: '30', kind: 'number' },
            ],
          },
        },
      ],
    })
    expect(values).toEqual({ source: 'file', path: './friday-cup.mp4' })
    expect(values).not.toHaveProperty('url')
    expect(values).not.toHaveProperty('fps')
  })

  it('collapses a picker to its checked labels and ignores the search box', () => {
    const values = runAndRead(
      {
        name: 'Add market',
        state: 'ready',
        fields: [
          {
            name: 'markets',
            value: '',
            kind: 'picker',
            multi: true,
            options: [{ label: 'Board Clunk Demo' }, { label: 'Friday Night Cup' }, { label: 'Champions Replay' }],
          },
        ],
      },
      (view) => {
        fireEvent.change(view.getByTestId('picker-search-markets'), { target: { value: 'cup' } })
        fireEvent.click(view.getByLabelText('Friday Night Cup'))
      }
    )
    expect(values).toEqual({ markets: ['Friday Night Cup'] })
  })

  it('an unchecked picker still reports its field as an empty array', () => {
    const values = runAndRead({
      name: 'Add market',
      state: 'ready',
      fields: [
        { name: 'markets', value: '', kind: 'picker', options: [{ label: 'A' }, { label: 'B' }] },
      ],
    })
    expect(values).toEqual({ markets: [] })
  })
})

// Fixture ConsoleModels for the /remote-test bed — the walk-backwards contract. Each model is the
// shape the gateway will later produce from a package's board + functions[]; the fixtures mirror
// the real July-20 drive (Board Clunk Demo, its vaults, position #189178…) so the port is judged
// against known truth. Tree rule: Session roots the scope subtree (markets under it, vaults and
// positions under their market; observe adds Capture/Stream/Publish under it); State is its OWN
// root below the session subtree — the machine's status is not contained by the scope. Depth is
// derived from parentId only.
//
// Add market is the ONE session verb everywhere, in two shapes: the observer CREATES a market
// (title composite → produces marketId); every other party PICKS from what the host lists (picker
// field — fuzzy search, spent options struck but visible).

import type { ConsoleModel, VerbField } from '#/types/console'

const hostMarketPicker = (multi: boolean, added: readonly string[]): VerbField => ({
  name: 'markets',
  value: '',
  kind: 'picker',
  multi,
  // Sorted selectable-first: live → added → ended.
  options: [
    { label: 'Board Clunk Demo', note: added.includes('Board Clunk Demo') ? 'added' : 'live', disabled: added.includes('Board Clunk Demo') },
    { label: 'Friday Night Cup', note: added.includes('Friday Night Cup') ? 'added' : 'live', disabled: added.includes('Friday Night Cup') },
    { label: 'Champions Replay', note: 'live' },
    { label: 'Street Chess Cup', note: 'live' },
    { label: 'Night Market IRL', note: 'live' },
    { label: 'Marathon Watch', note: 'live' },
    { label: 'Keynote Rewatch', note: 'ended', disabled: true },
  ].sort((a, b) => Number(a.disabled ?? false) - Number(b.disabled ?? false)),
})

const observe: ConsoleModel = {
  role: 'observe',
  defaultFocusId: 'obs',
  things: [
    { id: 'session', kind: 'session', label: 'Session', note: '1 observation', tone: 'ok' },
    { id: 'obs', parentId: 'session', kind: 'observation', label: 'Friday cup stream', note: 'ready', tone: 'warn' },
    { id: 'state', kind: 'state', label: 'State', note: 'connected', tone: 'idle' },
  ],
  focus: {
    session: {
      title: 'Session',
      sub: 'open · 1 observation',
      verbs: [
        {
          // An observation is created ON a chain; options = chains the CLI holds a wallet on.
          name: 'Add observation',
          state: 'ready',
          fields: [
            { name: 'title', value: '' },
            {
              name: 'chain',
              value: 'eip155:31337',
              kind: 'select',
              options: [{ label: 'eip155:31337' }, { label: 'solana devnet' }, { label: 'sui testnet' }],
            },
          ],
        },
      ],
      history: ['14:01 added Friday cup stream'],
    },
    obs: {
      title: 'Friday cup stream',
      sub: 'ready · eip155:31337 · Friday Night Cup registered',
      verbs: [
        {
          name: 'Configure capture',
          state: 'ready',
          fields: [
            {
              // Discriminant: the source choice shapes the fields below it — a `path` under browser
              // would be a lie. All arms ship; the renderer swaps locally.
              name: 'source',
              value: 'file',
              kind: 'select',
              options: [{ label: 'file' }, { label: 'browser' }],
              arms: {
                file: [
                  { name: 'path', value: './friday-cup.mp4' },
                  { name: 'start at', value: '0:00' },
                ],
                browser: [
                  { name: 'url', value: '' },
                  { name: 'viewport', value: '1280x720' },
                  { name: 'fps', value: '30', kind: 'number' },
                ],
              },
            },
          ],
        },
        {
          name: 'Configure publish',
          state: 'ready',
          fields: [
            {
              // Discriminant with an EMPTY arm: live (host fan-out) needs nothing — its zone closes
              // and the elbow glyph dims; direct and file-export open their own fields.
              name: 'sink',
              value: 'live',
              kind: 'select',
              options: [{ label: 'live' }, { label: 'direct' }, { label: 'file-export' }],
              arms: {
                live: [],
                direct: [{ name: 'viewer cap', value: '20', kind: 'number' }],
                'file-export': [{ name: 'path', value: './friday-cup-export.mp4' }],
              },
            },
          ],
        },
        { name: 'Prepare', state: 'ready', hot: true },
        { name: 'Start', state: 'locked', hint: 'needs · prepared', path: 'prepare' },
        { name: 'Pause', state: 'locked', hint: 'needs · running', path: 'prepare → start' },
        { name: 'Go live', state: 'locked', hint: 'needs · running stream', path: 'prepare → start' },
        { name: 'Set ended', state: 'locked', hint: 'needs · live' },
        {
          name: 'Close out',
          state: 'guarded',
          consequence:
            'removes this observation from your session and stops capture and publish. Registered markets stay on-chain',
        },
      ],
      history: ['marketId · 0x8f21…'],
    },
    state: {
      title: 'State',
      sub: 'connected · revision 42',
      verbs: [],
      history: [
        'gateway · connected',
        'host · reachable · 8787',
        'chain · eip155:31337',
        'board · revision 42',
      ],
    },
  },
  attention: [
    { title: 'Prepare Friday cup stream', detail: 'then: start → go live', targetId: 'obs', tone: 'do' },
    { title: 'Waiting on bookmaker', detail: 'Friday Night Cup has no vaults yet', targetId: 'obs', tone: 'wait' },
  ],
}

const bookmaker: ConsoleModel = {
  role: 'bookmaker',
  defaultFocusId: 'm1',
  things: [
    { id: 'session', kind: 'session', label: 'Session', note: '2 markets', tone: 'ok' },
    { id: 'm1', parentId: 'session', kind: 'market', label: 'Board Clunk Demo', note: '2 vaults', tone: 'ok' },
    { id: 'v1', parentId: 'm1', kind: 'vault', label: 'Will there be a goal?', note: 'open', tone: 'ok' },
    { id: 'v2', parentId: 'm1', kind: 'vault', label: 'Will there be a red card?', note: 'open', tone: 'ok' },
    { id: 'm2', parentId: 'session', kind: 'market', label: 'Friday Night Cup', note: '0 vaults', tone: 'warn', fresh: true },
    { id: 'state', kind: 'state', label: 'State', note: '0 pending', tone: 'idle' },
  ],
  focus: {
    session: {
      title: 'Session',
      sub: 'configured · 2 markets',
      verbs: [
        {
          name: 'Add market',
          state: 'ready',
          fields: [hostMarketPicker(true, ['Board Clunk Demo', 'Friday Night Cup'])],
        },
      ],
      history: ['14:12 added Friday Night Cup'],
    },
    state: {
      title: 'State',
      sub: 'ready · 0 pending writes',
      verbs: [],
      history: ['runtime · ready', 'write intents · none pending', 'last write · created red card 14:06'],
    },
    m1: {
      title: 'Board Clunk Demo',
      sub: 'open · 0x2669… · 2 vaults',
      verbs: [
        {
          name: 'Create vault',
          state: 'ready',
          hot: true,
          fields: [
            { name: 'question', value: 'Will the keeper save one?' },
            {
              name: 'seed side',
              value: 'YES',
              kind: 'select',
              options: [{ label: 'YES' }, { label: 'NO' }],
            },
            { name: 'stake', value: '5', kind: 'number' },
          ],
        },
        {
          name: 'Close out',
          state: 'guarded',
          consequence:
            'removes this market from your session and stops your seeds on 2 vaults first. Streamed stake stays in play, unstreamed bonds return',
        },
      ],
      history: ['14:06 created: red card?'],
    },
    m2: {
      title: 'Friday Night Cup',
      sub: 'added 14:12 · 0 vaults',
      verbs: [
        {
          name: 'Create vault',
          state: 'ready',
          hot: true,
          fields: [
            { name: 'question', value: 'First goal before 20’?' },
            {
              name: 'seed side',
              value: 'NO',
              kind: 'select',
              options: [{ label: 'YES' }, { label: 'NO' }],
            },
            { name: 'stake', value: '5', kind: 'number' },
          ],
        },
        {
          name: 'Close out',
          state: 'guarded',
          consequence: 'removes this market from your session. Nothing on-chain changes, it has no seeds yet',
        },
      ],
      history: ['14:12 added to session'],
    },
    v1: {
      title: 'Will there be a goal?',
      sub: 'open · your seed streaming YES',
      verbs: [
        {
          name: 'Stop seed',
          state: 'guarded',
          consequence:
            'streamed stake stays in play on this side, only the unstreamed bond returns',
        },
      ],
      history: ['your seed · YES · 5 USDC @ 0.01/s'],
    },
    v2: {
      title: 'Will there be a red card?',
      sub: 'open · your seed streaming YES',
      verbs: [
        {
          name: 'Stop seed',
          state: 'guarded',
          consequence:
            'streamed stake stays in play on this side, only the unstreamed bond returns',
        },
      ],
      history: ['your seed · YES · 5 USDC @ 0.01/s'],
    },
  },
  attention: [
    { title: 'Seed Friday Night Cup', detail: '0 vaults, bettors have nothing to fund', targetId: 'm2', tone: 'do' },
    { title: 'Waiting on observer', detail: 'Friday Night Cup stream not live yet', targetId: 'm2', tone: 'wait' },
  ],
}

const options: ConsoleModel = {
  role: 'options',
  defaultFocusId: 'v1',
  things: [
    { id: 'session', kind: 'session', label: 'Session', note: '1 market · gasless', tone: 'ok' },
    { id: 'm1', parentId: 'session', kind: 'market', label: 'Board Clunk Demo', note: 'runway 12m', tone: 'warn' },
    { id: 'v1', parentId: 'm1', kind: 'vault', label: 'Will there be a red card?', note: 'open', tone: 'ok' },
    { id: 'lvst', kind: 'lvst', label: 'LVST', note: '0 staked', tone: 'ok' },
    { id: 'state', kind: 'state', label: 'State', note: 'polling 3s', tone: 'idle' },
  ],
  focus: {
    session: {
      title: 'Session',
      sub: 'connected · 3uhV…ny7t · gasless',
      verbs: [
        {
          name: 'Add market',
          state: 'ready',
          fields: [hostMarketPicker(false, ['Board Clunk Demo'])],
        },
      ],
      history: [],
    },
    state: {
      title: 'State',
      sub: 'polling 3s · solana devnet',
      verbs: [],
      history: ['chain · solana devnet', 'polling · 3s', 'writes · sponsored (token-free)'],
    },
    // The market card IS the position NFT: one NFT per market holds the shared balance every lane
    // streams from. Low runway → top up HERE, not on a vault.
    m1: {
      title: 'Board Clunk Demo',
      sub: 'entered · NFT #189178… · balance $27.78 · streaming $1.50/min · runway 12m',
      verbs: [
        {
          // Like Add market: pick options (multi) from what the market already has; Run creates a
          // desk entry per pick — funding happens on each option's own card afterwards.
          name: 'Add options',
          state: 'ready',
          fields: [
            {
              name: 'options',
              value: '',
              kind: 'picker',
              multi: true,
              options: [
                { label: 'Will there be a goal?', note: 'open' },
                { label: 'Will there be a corner?', note: 'open' },
                { label: 'Will the keeper save one?', note: 'open' },
                { label: 'Both teams to score?', note: 'open' },
                { label: 'Over 2.5 goals?', note: 'open' },
                { label: 'Penalty awarded?', note: 'open' },
                { label: 'Hat-trick tonight?', note: 'open' },
                { label: 'Will there be a red card?', note: 'added', disabled: true },
                { label: 'First goal before 20’?', note: 'resolved', disabled: true },
              ],
            },
          ],
        },
        {
          name: 'Add funds',
          state: 'ready',
          hot: true,
          fields: [{ name: 'deposit $', value: '50', kind: 'number' }],
        },
        { name: 'Sweep to wallet', state: 'ready' },
        {
          name: 'Close out',
          state: 'guarded',
          consequence:
            'removes this market from your session, stops all lanes and sweeps your balance to wallet. Resolved claims stay claimable',
        },
      ],
      history: [],
    },
    v1: {
      title: 'Will there be a red card?',
      sub: 'YES 64% · NO 36% · $140.37 pooled',
      verbs: [
        {
          // ONE entry verb — the side lives in the form, never in the verb name.
          name: 'Back a side',
          state: 'ready',
          hot: true,
          fields: [
            {
              name: 'side',
              value: 'YES',
              kind: 'select',
              options: [{ label: 'YES' }, { label: 'NO' }],
            },
            { name: 'rate $/min', value: '0.60', kind: 'number' },
            { name: 'deposit $', value: '30', kind: 'number' },
          ],
        },
        { name: 'Withdraw', state: 'locked', hint: 'needs · resolved, waiting on steward' },
      ],
      history: ['your side · YES · $0.60/min', 'streamed · $7.20 · 12.4 sh'],
    },
    // LVST is wallet-level: no session needed to stake or unstake. It carries its own chain choice.
    lvst: {
      title: 'LVST',
      sub: '845.49 on solana devnet · 0 staked · 0 dividends pending',
      verbs: [
        {
          name: 'Stake',
          state: 'ready',
          fields: [
            {
              name: 'chain',
              value: 'solana devnet',
              kind: 'select',
              options: [{ label: 'eip155:31337' }, { label: 'solana devnet' }, { label: 'sui testnet' }],
            },
            { name: 'amount', value: '500', kind: 'number' },
          ],
        },
        { name: 'Unstake', state: 'locked', hint: 'nothing staked' },
      ],
      history: [],
    },
  },
  attention: [
    { title: 'Position runway low', detail: '12 min left, top up?', targetId: 'm1', tone: 'do' },
    { title: 'Waiting on steward', detail: 'no vaults resolved, winnings locked until then', targetId: 'v1', tone: 'wait' },
  ],
}

const steward: ConsoleModel = {
  role: 'steward',
  defaultFocusId: 'v1',
  things: [
    { id: 'session', kind: 'session', label: 'Session', note: 'watching 1', tone: 'ok' },
    { id: 'm1', parentId: 'session', kind: 'market', label: 'Board Clunk Demo', note: 'quiet', tone: 'ok' },
    { id: 'v1', parentId: 'm1', kind: 'vault', label: 'Vault 0x39e9…', note: 'finding', tone: 'warn' },
    { id: 'state', kind: 'state', label: 'State', note: 'loop 5s', tone: 'idle' },
  ],
  focus: {
    session: {
      title: 'Session',
      sub: 'watching · 1 market',
      verbs: [
        {
          name: 'Add market',
          state: 'ready',
          fields: [hostMarketPicker(false, ['Board Clunk Demo'])],
        },
      ],
      history: ['watching · vaults + steward decisions'],
    },
    state: {
      title: 'State',
      sub: 'loop 5s · 1 finding',
      verbs: [],
      history: ['refresh · every 5s', 'last refresh · 14:07', 'facts · 12 · findings · 1'],
    },
    m1: {
      title: 'Board Clunk Demo',
      sub: 'quiet · 0 findings',
      verbs: [{ name: 'Open thread', state: 'ready' }],
      history: [],
    },
    v1: {
      title: 'Vault 0x39e9…',
      sub: 'finding market_hot · 14:07 · evidence pinned',
      verbs: [
        {
          name: 'Resolve',
          state: 'ready',
          hot: true,
          fields: [
            {
              name: 'outcome',
              value: 'YES',
              kind: 'select',
              options: [{ label: 'YES' }, { label: 'NO' }],
            },
            { name: 'evidence', value: 'walrus:0x8c…' },
          ],
        },
        {
          name: 'Annotate',
          state: 'ready',
          fields: [{ name: 'note', value: 'off-ball incident, reviewing replay' }],
        },
        { name: 'Trigger hot', state: 'ready' },
      ],
      history: ['evidence · walrus:0x8c…'],
    },
  },
  attention: [
    { title: 'Review market_hot finding', detail: 'vault 0x39e9… · 14:07', targetId: 'v1', tone: 'do' },
  ],
}

export const consoleFixtures: Readonly<Record<string, ConsoleModel>> = {
  observe,
  bookmaker,
  options,
  steward,
}

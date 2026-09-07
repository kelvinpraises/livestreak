/* One-shot additive enrichment of the demo fixture (agent-1 fix C/A):
 *  - give every demo stream its OWN watch URL (per-stream feed in demo mode)
 *  - give every demo market open/hot vaults + views (floating cards on every stream page)
 * Idempotent: re-running only fills gaps, never duplicates. */
const fs = require('fs')
const path = require('path')
const file = path.join(__dirname, '..', 'src', 'utils', 'fixture-demo.json')
const f = JSON.parse(fs.readFileSync(file, 'utf8'))

const SAMPLE = 'https://storage.googleapis.com/gtv-videos-bucket/sample'
const WATCH = {
  'tech-1': `${SAMPLE}/BigBuckBunny.mp4`,
  'esports-1': `${SAMPLE}/ForBiggerBlazes.mp4`,
  'politics-1': `${SAMPLE}/ElephantsDream.mp4`,
  'entertainment-1': `${SAMPLE}/ForBiggerFun.mp4`,
}

for (const [routeId, watchUrl] of Object.entries(WATCH)) {
  if (f.streams[routeId] && !f.streams[routeId].watchUrl) {
    f.streams[routeId].watchUrl = watchUrl
  }
}

const EXTRA = {
  'esports-1': [
    { vaultId: '0xe1a1', question: 'Blue team takes first objective', type: 'momentum', mult: 1.92, no: 140, yes: 120, hot: false },
    { vaultId: '0xe2b2', question: 'Match goes past 30 minutes', type: 'outcome', mult: 2.45, no: 90, yes: 210, hot: true },
    { vaultId: '0xe3c3', question: 'Red team wins this round', type: 'momentum', mult: 1.74, no: 160, yes: 150, hot: false },
  ],
  'politics-1': [
    { vaultId: '0xp1a1', question: 'Candidate mentions inflation next', type: 'momentum', mult: 2.10, no: 110, yes: 130, hot: false },
    { vaultId: '0xp2b2', question: 'Moderator cuts in within 5 min', type: 'outcome', mult: 1.66, no: 200, yes: 95, hot: true },
    { vaultId: '0xp3c3', question: 'Polls tighten after this segment', type: 'momentum', mult: 2.88, no: 70, yes: 240, hot: false },
  ],
  'entertainment-1': [
    { vaultId: '0xn1a1', question: 'Host brings out surprise guest', type: 'outcome', mult: 3.10, no: 60, yes: 250, hot: true },
    { vaultId: '0xn2b2', question: 'Live performance in next segment', type: 'momentum', mult: 1.85, no: 150, yes: 140, hot: false },
    { vaultId: '0xn3c3', question: 'Audience vote flips the result', type: 'outcome', mult: 2.30, no: 100, yes: 180, hot: false },
  ],
}

const existing = new Set(f.options.vaults.map(v => v.vaultId))
for (const [marketId, vaults] of Object.entries(EXTRA)) {
  let added = 0
  for (const v of vaults) {
    if (existing.has(v.vaultId)) continue
    f.options.vaults.push({
      vaultId: v.vaultId,
      marketId,
      question: v.question,
      type: v.type,
      creator: '0xsteward',
      status: v.hot ? 'hot' : 'open',
      outcome: 'pending',
      pools: { yes: v.yes, no: v.no },
      timing: { createdAtAgoMs: 300000, expiresAtFromNowMs: 240000 },
      steward: v.hot ? { hot: true, hotUntilFromNowMs: 90000 } : { hot: false },
    })
    f.options.vaultViews[v.vaultId] = { multiplier: v.mult, createdMinute: 12 + added * 7 }
    existing.add(v.vaultId)
    added++
  }
  const count = f.options.vaults.filter(x => x.marketId === marketId).length
  const cat = f.catalog.streams.find(s => s.marketId === marketId)
  if (cat) cat.activeVaults = count
  if (f.streams[marketId]) f.streams[marketId].activeVaults = count
}

fs.writeFileSync(file, JSON.stringify(f, null, 2) + '\n')
console.log('fixture enriched:', {
  streams: Object.keys(f.streams).map(k => ({ k, watchUrl: !!f.streams[k].watchUrl, activeVaults: f.streams[k].activeVaults })),
  vaultCount: f.options.vaults.length,
})

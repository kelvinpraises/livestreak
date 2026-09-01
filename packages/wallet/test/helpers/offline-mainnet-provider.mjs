import { readFileSync } from 'node:fs'
import path from 'node:path'

const fixtureDirectory = import.meta.dirname

const responses = new Map(
  JSON.parse(
    readFileSync(path.join(fixtureDirectory, '../fixtures/mainnet-rpc-responses.json'), 'utf8'),
  ),
)

/** @returns {{ request: (args: { method: string, params?: unknown[] }) => Promise<unknown> }} */
export function createOfflineMainnetProvider () {
  return {
    request: async ({ method, params }) => {
      const key = JSON.stringify({ method, params: params ?? [] })
      if (!responses.has(key)) {
        throw new Error(`offline mainnet provider: unhandled RPC ${key}`)
      }
      return responses.get(key)
    },
  }
}

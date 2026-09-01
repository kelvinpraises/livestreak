import { cpSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(new URL('..', import.meta.url)))
const vendorSrc = join(root, 'src', 'vendor')
const vendorDist = join(root, 'dist', 'vendor')

function copyTree(src, dest) {
  mkdirSync(dest, { recursive: true })
  for (const name of readdirSync(src)) {
    const from = join(src, name)
    const to = join(dest, name)
    if (statSync(from).isDirectory()) {
      copyTree(from, to)
    } else {
      mkdirSync(dirname(to), { recursive: true })
      cpSync(from, to)
    }
  }
}

copyTree(vendorSrc, vendorDist)

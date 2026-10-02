/**
 * Pure directory-scan logic for the local plugin source.
 *
 * Kept free of Cordis so the classification rules are unit-testable: which
 * folders under the source directory count as installable plugins, whether a
 * package declares a bundle, and how an installed bundle's state is reported.
 *
 * @module dsh-local-plugin-source/scan
 */

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Read one directory entry's `package.json`.
 * @param directory - candidate package directory.
 * @returns the parsed manifest, or undefined when it is not a readable package.
 */
export async function readManifest(directory) {
  let text
  try {
    text = await readFile(join(directory, 'package.json'), 'utf8')
  }
  catch {
    return undefined
  }
  try {
    const manifest = JSON.parse(text)
    if (manifest === null || typeof manifest !== 'object') return undefined
    if (typeof manifest.name !== 'string' || manifest.name.trim() === '') return undefined
    return manifest
  }
  catch {
    return undefined
  }
}

/**
 * Classify one manifest into the row the page renders.
 * @param manifest - a package manifest with a name.
 * @returns the classification fields, without installed state.
 */
export function classifyManifest(manifest) {
  const dsh = manifest.dsh !== undefined && manifest.dsh !== null && typeof manifest.dsh === 'object' ? manifest.dsh : {}
  const bundle = dsh.bundle !== undefined && dsh.bundle !== null && typeof dsh.bundle === 'object' ? dsh.bundle : undefined
  const client = dsh.client !== undefined && dsh.client !== null && typeof dsh.client === 'object' ? dsh.client : undefined
  return {
    name: manifest.name,
    version: typeof manifest.version === 'string' ? manifest.version : undefined,
    description: typeof manifest.description === 'string' ? manifest.description : undefined,
    bundle: bundle?.patch !== undefined,
    client: client?.platform !== undefined,
  }
}

/**
 * Scan one source directory for installable local plugins.
 * @param options.directory - absolute directory to scan; a missing directory yields no rows.
 * @param options.bundles - current `pluginManager.listBundles()` entries, if known.
 * @returns `{ directory, items }`, sorted by package name.
 */
export async function scanPlugins({ directory, bundles = [] }) {
  let entries = []
  try {
    entries = await readdir(directory, { withFileTypes: true })
  }
  catch {
    return { directory, items: [] }
  }
  const byName = new Map()
  for (const bundle of bundles) if (typeof bundle?.name === 'string') byName.set(bundle.name, bundle)

  const items = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const path = join(directory, entry.name)
    const manifest = await readManifest(path)
    if (manifest === undefined) continue
    const classified = classifyManifest(manifest)
    const known = byName.get(classified.name)
    items.push({
      ...classified,
      directory: path,
      spec: path,
      installed: known?.installed === true,
      enabled: known?.enabled === true,
      removable: known?.removable === true,
      managed: known !== undefined,
      managementProblem: typeof known?.readOnlyReason === 'string' ? known.readOnlyReason : undefined,
      activationError: typeof known?.error === 'string' ? known.error : undefined,
    })
  }
  items.sort((left, right) => left.name.localeCompare(right.name))
  return { directory, items }
}

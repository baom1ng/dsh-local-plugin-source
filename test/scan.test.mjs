/**
 * Pure scan-logic tests for the local plugin source.
 *
 * Run with:  node --test test/scan.test.mjs
 */

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { classifyManifest, readManifest, scanPlugins } from '../lib/scan.js'

/** Build a source directory with a few candidate packages. */
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'local-source-'))
  const write = async (name, manifest) => {
    await mkdir(join(root, name), { recursive: true })
    await writeFile(join(root, name, 'package.json'), JSON.stringify(manifest, null, 2))
  }
  await write('dsh-session-archive-manager', {
    name: 'dsh-session-archive-manager',
    version: '0.1.0',
    description: 'archive manager',
    dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web' } },
  })
  await write('plain-package', { name: 'plain-package', version: '2.0.0' })
  await write('broken-json', {})
  await writeFile(join(root, 'broken-json', 'package.json'), '{ not json')
  await mkdir(join(root, 'no-manifest'), { recursive: true })
  await mkdir(join(root, '.hidden'), { recursive: true })
  await writeFile(join(root, '.hidden', 'package.json'), JSON.stringify({ name: 'hidden', version: '1.0.0' }))
  await writeFile(join(root, 'notes.txt'), 'not a package')
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) }
}

test('classifyManifest reads the dsh declarations', () => {
  assert.deepEqual(classifyManifest({
    name: 'a',
    version: '1.2.3',
    description: 'd',
    dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web' } },
  }), { name: 'a', version: '1.2.3', description: 'd', bundle: true, client: true })

  assert.deepEqual(classifyManifest({ name: 'b' }), {
    name: 'b', version: undefined, description: undefined, bundle: false, client: false,
  })
  // A dsh block without a patch is not a bundle.
  assert.equal(classifyManifest({ name: 'c', dsh: { bundle: {} } }).bundle, false)
  assert.equal(classifyManifest({ name: 'd', dsh: { client: { platform: 'web' } } }).client, true)
})

test('readManifest refuses missing, malformed, and nameless manifests', async () => {
  const { root, cleanup } = await fixture()
  try {
    assert.equal((await readManifest(join(root, 'plain-package'))).name, 'plain-package')
    assert.equal(await readManifest(join(root, 'no-manifest')), undefined)
    assert.equal(await readManifest(join(root, 'broken-json')), undefined)
    assert.equal(await readManifest(join(root, 'nowhere')), undefined)
  }
  finally {
    await cleanup()
  }
})

test('scanPlugins lists package directories, skips the rest, and sorts by name', async () => {
  const { root, cleanup } = await fixture()
  try {
    const scanned = await scanPlugins({ directory: root })
    assert.equal(scanned.directory, root)
    assert.deepEqual(scanned.items.map((item) => item.name), ['dsh-session-archive-manager', 'plain-package'])
    const first = scanned.items[0]
    assert.equal(first.bundle, true)
    assert.equal(first.client, true)
    assert.equal(first.version, '0.1.0')
    assert.equal(first.spec, join(root, 'dsh-session-archive-manager'))
    assert.equal(first.installed, false)
    assert.equal(first.enabled, false)
  }
  finally {
    await cleanup()
  }
})

test('scanPlugins merges the profile manager state by package name', async () => {
  const { root, cleanup } = await fixture()
  try {
    const scanned = await scanPlugins({
      directory: root,
      bundles: [
        { name: 'dsh-session-archive-manager', installed: true, enabled: true, removable: true },
        { name: 'someone-else', installed: true, enabled: true, removable: true },
      ],
    })
    const row = scanned.items.find((item) => item.name === 'dsh-session-archive-manager')
    assert.equal(row.installed, true)
    assert.equal(row.enabled, true)
    assert.equal(row.removable, true)
    assert.equal(row.managed, true)
    const plain = scanned.items.find((item) => item.name === 'plain-package')
    assert.equal(plain.installed, false)
    assert.equal(plain.managed, false)
  }
  finally {
    await cleanup()
  }
})

test('scanPlugins reports a missing directory as an empty source', async () => {
  const missing = join(tmpdir(), 'local-source-absent-directory')
  const scanned = await scanPlugins({ directory: missing })
  assert.deepEqual(scanned, { directory: missing, items: [] })
})

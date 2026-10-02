/**
 * Host-half tests for the local plugin source: apply() wiring, the request
 * guards, and how each operation drives the profile's Plugin Manager.
 *
 * Run with:  node --test test/host.test.mjs
 */

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { FAILURE, apply, inject, name, resolveDirectory } from '../lib/manager.js'

/** A source directory plus a fake Cordis context around it. */
async function harness(options = {}) {
  const directory = options.directory ?? await mkdtemp(join(tmpdir(), 'local-source-host-'))
  const write = async (packageName, manifest) => {
    await mkdir(join(directory, packageName), { recursive: true })
    await writeFile(join(directory, packageName, 'package.json'), JSON.stringify(manifest, null, 2))
  }
  if (options.seed !== false) {
    await write('dsh-session-archive-manager', {
      name: 'dsh-session-archive-manager',
      version: '0.1.0',
      description: 'archive manager',
      dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web' } },
    })
    await write('plain-package', { name: 'plain-package', version: '2.0.0' })
  }

  const calls = []
  const routes = []
  const logs = []
  const bundles = options.bundles ?? [
    { name: 'dsh-session-archive-manager', installed: true, enabled: true, removable: true },
  ]
  const ctx = {
    logger: { info: (...args) => logs.push(['info', ...args]), warn: (...args) => logs.push(['warn', ...args]) },
    webServer: {
      register: (route) => {
        routes.push(route)
        return () => {}
      },
    },
    pluginManager: {
      // The service resolves to a plain array; the Agent tool pages it.
      listBundles: async () => (options.pagedBundles === true
        ? { entries: bundles, total: bundles.length, nextOffset: null }
        : bundles),
      installBundle: async (spec, installOptions) => {
        if (options.failManager === true) throw new Error('pnpm exploded')
        calls.push(['installBundle', spec, installOptions])
        return { stage: 'enable', target: 'dsh-session-archive-manager', enabled: true, changed: true, application: 'applied', warnings: [], packageResult: { exitCode: 0, output: 'pnpm output'.repeat(600) } }
      },
      removeBundle: async (target) => {
        calls.push(['removeBundle', target])
        return { stage: 'enable', target, changed: true, application: 'applied', warnings: [], packageResult: { exitCode: 0, output: 'removed' } }
      },
      setBundleEnabled: async (target, enabled) => {
        calls.push(['setBundleEnabled', target, enabled])
        return { stage: 'enable', target, enabled, changed: true, application: 'applied', warnings: [] }
      },
    },
    effect: (callback) => {
      callback()
      return () => {}
    },
  }

  // Cordis resolves the web surface through an optional injection; the fake
  // answers it immediately unless a test withholds the services.
  ctx.inject = (_services, callback) => {
    if (options.withholdInjection === true) return
    callback(ctx)
  }

  apply(ctx, { directory })
  const route = routes[0]

  const call = async (payload, init = {}) => {
    const body = typeof payload === 'string' ? payload : JSON.stringify(payload)
    const request = {
      method: init.method ?? 'POST',
      headers: { host: '127.0.0.1:19387', ...(init.headers ?? {}) },
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(body)
      },
    }
    const response = {
      writableEnded: false,
      status: undefined,
      body: undefined,
      writeHead(status) {
        this.status = status
      },
      end(chunk) {
        this.writableEnded = true
        this.body = chunk
      },
    }
    await route.handler(request, response)
    return { status: response.status, envelope: response.body === undefined ? undefined : JSON.parse(response.body) }
  }

  return { directory, calls, route, logs, call, cleanup: () => rm(directory, { recursive: true, force: true }) }
}

test('the row declares its services and registers one exact route', async () => {
  assert.equal(name, 'local-plugin-source')
  assert.deepEqual(inject, [], 'the web surface is optional so the row activates anywhere')
  const h = await harness()
  try {
    assert.equal(h.route.kind, 'exact')
    assert.equal(h.route.path, '/local-plugin-source/api')
  }
  finally {
    await h.cleanup()
  }
})

test('without a webserver the row activates and registers nothing', async () => {
  const h = await harness({ withholdInjection: true })
  try {
    assert.equal(h.route, undefined, 'no route without a webserver')
    assert.equal(h.logs.length, 0, 'no startup log for a surface that never resolved')
  }
  finally {
    await h.cleanup()
  }
})

test('resolveDirectory prefers the config, then the DSH home', () => {
  assert.equal(resolveDirectory({ directory: 'C:\\mine' }, {}), 'C:\\mine')
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = 'C:\\dsh-home'
  try {
    assert.equal(resolveDirectory({}, {}), join('C:\\dsh-home', 'local-plugins'))
  }
  finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  }
})

test('list reports every local package with its live profile state', async () => {
  const h = await harness()
  try {
    const { status, envelope } = await h.call({ op: 'list' })
    assert.equal(status, 200)
    assert.equal(envelope.ok, true)
    assert.equal(envelope.value.directory, h.directory)
    assert.deepEqual(envelope.value.items.map((item) => item.name), ['dsh-session-archive-manager', 'plain-package'])
    const archive = envelope.value.items[0]
    assert.equal(archive.bundle, true)
    assert.equal(archive.client, true)
    assert.equal(archive.installed, true)
    assert.equal(archive.enabled, true)
    assert.equal(archive.removable, true)
    const plain = envelope.value.items[1]
    assert.equal(plain.bundle, false)
    assert.equal(plain.installed, false)
  }
  finally {
    await h.cleanup()
  }
})

test('install drives the profile Plugin Manager with the scanned absolute path', async () => {
  const h = await harness()
  try {
    const { envelope } = await h.call({ op: 'install', name: 'dsh-session-archive-manager' })
    assert.equal(envelope.ok, true)
    assert.equal(envelope.value.name, 'dsh-session-archive-manager')
    assert.equal(envelope.value.application, 'applied')
    assert.equal(envelope.value.changed, true)
    assert.equal(envelope.value.exitCode, 0)
    assert.equal(envelope.value.output.length, 4000, 'the pnpm tail is bounded')
    const [kind, spec, options] = h.calls.find((entry) => entry[0] === 'installBundle')
    assert.equal(kind, 'installBundle')
    assert.equal(spec, join(h.directory, 'dsh-session-archive-manager'))
    assert.deepEqual(options, { enabled: true })
  }
  finally {
    await h.cleanup()
  }
})

test('remove and setEnabled forward to the profile Plugin Manager', async () => {
  const h = await harness()
  try {
    const removed = await h.call({ op: 'remove', name: 'dsh-session-archive-manager' })
    assert.equal(removed.envelope.ok, true)
    assert.deepEqual(h.calls.at(-1), ['removeBundle', 'dsh-session-archive-manager'])

    const disabled = await h.call({ op: 'setEnabled', name: 'dsh-session-archive-manager', enabled: false })
    assert.equal(disabled.envelope.ok, true)
    assert.deepEqual(h.calls.at(-1), ['setBundleEnabled', 'dsh-session-archive-manager', false])
    assert.equal(disabled.envelope.value.enabled, false)
  }
  finally {
    await h.cleanup()
  }
})

test('a name outside the scanned directory is never installed', async () => {
  const h = await harness()
  try {
    for (const bad of ['not-there', '..\\escape', '', 42]) {
      const { envelope } = await h.call({ op: 'install', name: bad })
      assert.equal(envelope.ok, false)
      assert.ok([FAILURE.unknownPlugin, FAILURE.badRequest].includes(envelope.error.code), `unexpected code ${envelope.error.code}`)
    }
    assert.equal(h.calls.some((entry) => entry[0] === 'installBundle'), false)
  }
  finally {
    await h.cleanup()
  }
})

test('request guards reject other methods, cross-origin callers, bad bodies, and unknown ops', async () => {
  const h = await harness()
  try {
    const wrongMethod = await h.call('', { method: 'GET' })
    assert.equal(wrongMethod.status, 400)
    assert.equal(wrongMethod.envelope.error.code, FAILURE.badRequest)

    const crossOrigin = await h.call({ op: 'list' }, { headers: { origin: 'https://evil.example' } })
    assert.equal(crossOrigin.status, 400)
    assert.equal(crossOrigin.envelope.error.code, FAILURE.badRequest)

    const sameOrigin = await h.call({ op: 'list' }, { headers: { origin: 'http://127.0.0.1:19387' } })
    assert.equal(sameOrigin.envelope.ok, true)

    const broken = await h.call('{not json')
    assert.equal(broken.envelope.error.code, FAILURE.badRequest)

    const unknown = await h.call({ op: 'nope' })
    assert.equal(unknown.envelope.error.code, FAILURE.unknownOp)
  }
  finally {
    await h.cleanup()
  }
})

test('a manager failure becomes one structured error, not a crash', async () => {
  const h = await harness({ failManager: true })
  try {
    const { status, envelope } = await h.call({ op: 'install', name: 'dsh-session-archive-manager' })
    assert.equal(status, 200)
    assert.equal(envelope.ok, false)
    assert.equal(envelope.error.code, FAILURE.management)
    assert.match(envelope.error.message, /pnpm exploded/)
    assert.equal(h.logs.some(([level]) => level === 'warn'), true, 'the failure is logged for the operator')
    // The route still answers the next request.
    const after = await h.call({ op: 'list' })
    assert.equal(after.envelope.ok, true)
  }
  finally {
    await h.cleanup()
  }
})

test('list reads the array shape the manager service resolves, and tolerates a paged wrapper', async () => {
  const direct = await harness()
  try {
    const { envelope } = await direct.call({ op: 'list' })
    const archive = envelope.value.items.find((item) => item.name === 'dsh-session-archive-manager')
    assert.equal(archive.installed, true, 'the plain-array answer carries the installed state')
    assert.equal(archive.enabled, true)
  }
  finally {
    await direct.cleanup()
  }

  const paged = await harness({ pagedBundles: true })
  try {
    const { envelope } = await paged.call({ op: 'list' })
    const archive = envelope.value.items.find((item) => item.name === 'dsh-session-archive-manager')
    assert.equal(archive.installed, true, 'the paged wrapper is read too')
  }
  finally {
    await paged.cleanup()
  }
})

test('status exposes the endpoint and the scanned directory', async () => {
  const h = await harness()
  try {
    const { envelope } = await h.call({ op: 'status' })
    assert.equal(envelope.value.route, '/local-plugin-source/api')
    assert.equal(envelope.value.directory, h.directory)
    assert.equal(envelope.value.pluginManager, true)
  }
  finally {
    await h.cleanup()
  }
})

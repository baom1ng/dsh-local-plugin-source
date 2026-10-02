/**
 * Browser-half tests: registration, the injected-hook contract, the model's
 * host calls, and what the page actually renders for each plugin state.
 *
 * Run with:  node --test test/client.test.mjs
 */

import assert from 'node:assert/strict'
import test from 'node:test'

function fakeStore(initial) {
  let state = initial
  const listeners = new Set()
  return {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    update: (mutate) => {
      mutate(state)
      for (const listener of listeners) listener()
    },
    set: (next) => {
      state = next
      for (const listener of listeners) listener()
    },
  }
}

function element(type, props, key) {
  const children = []
  const rest = { ...(props ?? {}) }
  delete rest.children
  if (props !== undefined && props !== null && props.children !== undefined) {
    children.push(...(Array.isArray(props.children) ? props.children : [props.children]))
  }
  return { type, props: rest, children: children.flat(Infinity), key }
}

function textOf(node) {
  if (node === null || node === undefined || node === false || node === true) return []
  if (typeof node === 'string' || typeof node === 'number') return [String(node)]
  if (Array.isArray(node)) return node.flatMap(textOf)
  const own = []
  for (const key of ['title', 'description']) {
    if (typeof node.props?.[key] === 'string') own.push(node.props[key])
  }
  return [...own, ...textOf(node.children)]
}

function collect(node, out = []) {
  if (node === null || node === undefined || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) collect(child, out)
    return out
  }
  if (node.type !== undefined) out.push(node)
  collect(node.children, out)
  for (const key of ['footer', 'icon']) collect(node.props?.[key], out)
  return out
}

/** The renderer's projection: `hooks: { source }` becomes a `useSource` prop. */
function flattenFace(face, t) {
  const { hooks, ...rest } = face
  const props = { ...rest }
  if (t !== undefined) props.t = t
  for (const [name, source] of Object.entries(hooks ?? {})) {
    const hookName = `use${String(name[0]).toUpperCase()}${String(name).slice(1)}`
    props[hookName] = (selector = (value) => value) => selector(source.getSnapshot())
  }
  return props
}

/** A primitive's rendered element keeps its stub name as the element type. */
function typeNameOf(node) {
  return typeof node.type === 'string' ? node.type : node.type?.name
}

/**
 * Evaluate nested function components the way React would, so assertions see
 * the real tree: the page renders one row component per item.
 */
function renderTree(node) {
  if (node === null || node === undefined || typeof node !== 'object') return node
  if (Array.isArray(node)) return node.map(renderTree)
  if (typeof node.type === 'function') {
    const props = { ...node.props }
    if (node.children.length > 0) props.children = node.children
    return renderTree(node.type(props))
  }
  return { ...node, children: node.children.map(renderTree) }
}

let generation = 0
async function loadBundle() {
  const registrations = new Map()
  let captured
  globalThis.window = { __ModuleLoader__: { load: (spec) => { captured = spec } } }
  globalThis.document = {
    querySelector: () => null,
    createElement: () => ({ dataset: {} }),
    head: { appendChild: () => {} },
  }
  generation += 1
  await import(`../lib/client.js?test=${String(generation)}`)

  const react = {
    useState: (value) => [value, () => {}],
    useEffect: (fn) => {
      fn()
    },
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
    createElement: (type, props, ...children) => element(type, { ...(props ?? {}), children }),
    Fragment: Symbol('Fragment'),
  }
  const primitives = new Proxy({}, {
    get: (target, key) => {
      const stubName = String(key)
      const component = (props) => element(stubName, props ?? {})
      Object.defineProperty(component, 'name', { value: stubName })
      return component
    },
  })
  const require = (specifier) => {
    switch (specifier) {
      case 'react': return react
      case 'react/jsx-runtime':
        return { jsx: (type, props, key) => element(type, props, key), jsxs: (type, props, key) => element(type, props, key) }
      case '@deepseek-ai/dsh-client-ui-primitives': return primitives
      case '@deepseek-ai/dsh-client-store': return { createSnapshotStore: fakeStore }
      default: throw new Error(`unexpected require: ${specifier}`)
    }
  }
  const plugin = captured.factory(require)

  const dictionaries = new Map()
  const translate = (namespace, locale) => (key, params) => {
    const dict = dictionaries.get(namespace)?.[locale] ?? dictionaries.get(namespace)?.zh ?? {}
    const template = dict[key] ?? key
    if (params === undefined) return template
    return template.replace(/\{(\w+)\}/gu, (_match, name) => (params[name] === undefined ? `{${name}}` : String(params[name])))
  }
  const ctx = {
    locale: {
      register: (namespace, dicts) => { dictionaries.set(namespace, dicts) },
      bind: (namespace) => translate(namespace, 'zh'),
    },
    slots: {
      inject: (_slot, callback) => { callback() },
      register: (options, component) => {
        registrations.set(`${options.name}:${options.id ?? options.key}`, { options, component })
        return () => {}
      },
    },
    effect: (callback) => {
      callback()
      return () => {}
    },
  }
  plugin.apply(ctx)
  return {
    registrations,
    t: translate('local-plugin-source', 'zh'),
    tEn: translate('local-plugin-source', 'en'),
    render(extra = {}) {
      const entry = registrations.get('settings.plugins.tab:local-source')
      assert.ok(entry !== undefined, 'the tab is registered')
      const face = entry.options.inject()
      return renderTree(entry.component({ ...flattenFace(face, translate('local-plugin-source', 'zh')), ...extra }))
    },
    face() {
      return registrations.get('settings.plugins.tab:local-source').options.inject()
    },
    /** The injected face exactly as the renderer would project it. */
    faceProps() {
      return flattenFace(this.face(), translate('local-plugin-source', 'zh'))
    },
  }
}

const settle = async () => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

/** Host stub: one list answer plus recorded mutations. */
function stubHost(items) {
  const calls = []
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body)
    calls.push(body)
    if (body.op === 'list') {
      return { ok: true, status: 200, json: async () => ({ ok: true, value: { directory: 'C:\\local-plugins', items } }) }
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, value: { name: body.name, changed: true, application: 'applied' } }) }
  }
  return calls
}

const ITEM_INSTALLED = {
  name: 'dsh-session-archive-manager', version: '0.1.0', description: 'archive manager',
  bundle: true, client: true, installed: true, enabled: true, removable: true, managed: true,
  directory: 'C:\\local-plugins\\dsh-session-archive-manager',
}
const ITEM_PLAIN = { name: 'plain-package', version: '2.0.0', bundle: false, client: false, installed: false, enabled: false, removable: false, managed: false }

test('the bundle registers one Plugins settings tab and injects only slots and locale', async () => {
  stubHost([])
  const bundle = await loadBundle()
  assert.deepEqual([...bundle.registrations.keys()], ['settings.plugins.tab:local-source'])
  const options = bundle.registrations.get('settings.plugins.tab:local-source').options
  assert.equal(options.order, 20)
  assert.equal(options.locale, 'local-plugin-source')
  assert.equal(typeof options.label, 'undefined')
})

test('the face projects useSource rather than a raw hooks object', async () => {
  stubHost([ITEM_INSTALLED])
  const bundle = await loadBundle()
  await settle()
  const props = flattenFace(bundle.face(), bundle.t)
  assert.equal(props.hooks, undefined)
  assert.equal(typeof props.useSource, 'function')
  assert.equal(props.useSource((value) => value).items.length, 1)
})

test('an installed, enabled bundle offers reinstall, disable and remove', async () => {
  stubHost([ITEM_INSTALLED, ITEM_PLAIN])
  const bundle = await loadBundle()
  await settle()
  const tree = bundle.render()
  const text = textOf(tree).join(' | ')
  assert.match(text, /本地插件目录中的插件/)
  assert.match(text, /dsh-session-archive-manager/)
  assert.match(text, /已安装/)
  assert.match(text, /已启用/)
  assert.match(text, /C:\\local-plugins/)

  const buttons = collect(tree)
    .filter((node) => typeNameOf(node) === 'Button')
    .map((node) => textOf(node.children).join(''))
  assert.deepEqual(buttons.sort(), ['停用', '卸载', '刷新', '重新安装'].sort())

  const plainCard = textOf(tree).join(' | ')
  assert.match(plainCard, /plain-package/)
  assert.match(plainCard, /无 bundle 补丁/)
})

test('a missing bundle offers install only, and a disabled one offers enable', async () => {
  stubHost([{ ...ITEM_INSTALLED, installed: false, enabled: false, removable: false }])
  const bundle = await loadBundle()
  await settle()
  let buttons = collect(bundle.render())
    .filter((node) => typeNameOf(node) === 'Button')
    .map((node) => textOf(node.children).join(''))
  assert.deepEqual(buttons.sort(), ['刷新', '安装'].sort())

  stubHost([{ ...ITEM_INSTALLED, installed: true, enabled: false, removable: true }])
  const second = await loadBundle()
  await settle()
  buttons = collect(second.render())
    .filter((node) => typeNameOf(node) === 'Button')
    .map((node) => textOf(node.children).join(''))
  assert.deepEqual(buttons.sort(), ['刷新', '启用', '卸载', '重新安装'].sort())
})

test('the empty source explains where packages come from', async () => {
  stubHost([])
  const bundle = await loadBundle()
  await settle()
  const text = textOf(bundle.render()).join(' | ')
  assert.match(text, /没有找到本地插件/)
  assert.match(text, /把带 package.json 的 DSH 插件包放进上面的目录，然后刷新。/)
})

test('the model posts install / remove / setEnabled and reloads after each', async () => {
  const calls = stubHost([ITEM_INSTALLED])
  const bundle = await loadBundle()
  await settle()
  const face = bundle.faceProps()

  await face.install('dsh-session-archive-manager')
  assert.deepEqual(calls.find((body) => body.op === 'install'), { op: 'install', name: 'dsh-session-archive-manager' })
  assert.equal(calls.filter((body) => body.op === 'list').length >= 2, true, 'the list is re-read after a mutation')
  assert.equal(face.useSource((value) => value).notice.text, 'installedNotice')

  await face.remove('dsh-session-archive-manager')
  assert.deepEqual(calls.find((body) => body.op === 'remove'), { op: 'remove', name: 'dsh-session-archive-manager' })

  await face.setEnabled('dsh-session-archive-manager', false)
  assert.deepEqual(calls.find((body) => body.op === 'setEnabled'), { op: 'setEnabled', name: 'dsh-session-archive-manager', enabled: false })
  assert.equal(face.useSource((value) => value).notice.text, 'disabledNotice')
})

test('an unreachable host half is reported and the page still renders', async () => {
  globalThis.fetch = async () => {
    throw new Error('socket closed')
  }
  const bundle = await loadBundle()
  await settle()
  const state = bundle.faceProps().useSource((value) => value)
  assert.equal(state.status, 'error')
  assert.match(state.error, /socket closed/)
  const text = textOf(bundle.render()).join(' | ')
  assert.match(text, /无法读取本地插件目录/)
})

test('a failed action reports the host message instead of a false success', async () => {
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body)
    if (body.op === 'list') {
      return { ok: true, status: 200, json: async () => ({ ok: true, value: { directory: 'C:\\local-plugins', items: [ITEM_INSTALLED] } }) }
    }
    return { ok: true, status: 200, json: async () => ({ ok: false, error: { code: 'local-plugin-source/management-failed', message: 'pnpm exploded', details: {} } }) }
  }
  const bundle = await loadBundle()
  await settle()
  const face = bundle.faceProps()
  await face.install('dsh-session-archive-manager')
  const state = face.useSource((value) => value)
  assert.equal(state.busy, null)
  assert.equal(state.notice.text, 'actionFailed')
  assert.match(state.notice.params.detail, /pnpm exploded/)
})

test('the English dictionary covers every key the page uses', async () => {
  const bundle = await loadBundle()
  for (const key of [
    'tab', 'title', 'subtitle', 'refresh', 'empty', 'emptyHint', 'installed', 'enabled', 'disabled',
    'notInstalled', 'bundle', 'plain', 'client', 'problem', 'activationError', 'install', 'reinstall',
    'enable', 'disable', 'remove', 'busy', 'loadFailed', 'actionFailed', 'installedNotice',
    'removedNotice', 'enabledNotice', 'disabledNotice', 'details',
  ]) {
    assert.notEqual(bundle.tEn(key), key, `the English dictionary is missing "${key}"`)
  }
})

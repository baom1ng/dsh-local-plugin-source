/**
 * Local plugin source — host half.
 *
 * Turns one local directory (`<DSH home>/local-plugins` by default) into a
 * source the app's own Plugin Manager can install from, and exposes it to the
 * browser half over one same-origin endpoint:
 *
 *   POST /local-plugin-source/api
 *   { op: 'list' | 'install' | 'remove' | 'setEnabled' | 'status', ... }
 *
 * Every mutation goes through `ctx.pluginManager`, so the profile manifest,
 * the bundle selection, pnpm and the Loader reconciliation all behave exactly
 * as they do for any other plugin installation — this package adds a source,
 * never a second installer.
 *
 * @module dsh-local-plugin-source
 */

import { join } from 'node:path'
import { homedir } from 'node:os'

import { scanPlugins } from './scan.js'

/** Cordis plugin name. */
export const name = 'local-plugin-source'

/**
 * The web surface this row extends. Declared as an optional injection rather
 * than a hard `inject` list so a profile without a webserver (headless/CLI)
 * still activates this row instead of leaving it pending forever.
 */
const WEB_SERVICES = ['webServer', 'pluginManager']

/** No hard service dependency: the web surface is awaited inside `apply`. */
export const inject = []

/** Exact route the browser half calls. */
const ROUTE_PATH = '/local-plugin-source/api'

/** Request-body cap; these payloads carry names only. */
const MAX_BODY_BYTES = 64 * 1024

/** Stable failure codes returned to the browser half. */
export const FAILURE = {
  badRequest: 'local-plugin-source/bad-request',
  unknownOp: 'local-plugin-source/unknown-op',
  unknownPlugin: 'local-plugin-source/unknown-plugin',
  bodyTooLarge: 'local-plugin-source/body-too-large',
  management: 'local-plugin-source/management-failed',
}

/** Structured failure carrying a browser-facing code. */
export class LocalSourceError extends Error {
  /**
   * @param code - stable failure code.
   * @param message - human-readable detail.
   * @param details - extra JSON detail for the caller.
   */
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'LocalSourceError'
    this.code = code
    this.details = details
  }
}

/** Register the endpoint for the lifetime of this row. */
export function apply(ctx, config = {}) {
  const directory = resolveDirectory(config)
  ctx.inject(WEB_SERVICES, (webCtx) => {
    webCtx.effect(
      () => webCtx.webServer.register({
        kind: 'exact',
        path: ROUTE_PATH,
        handler: (request, response) => handle(webCtx, directory, request, response),
      }),
      'local-plugin-source: http endpoint',
    )
    logOf(webCtx).info('local plugin source ready at %s (directory %s)', ROUTE_PATH, directory)
  })
}

/**
 * The scanned directory: configured, else `<DSH home>/local-plugins`.
 * Reads the environment only — a Cordis context throws for a service the row
 * did not inject, so `ctx.dshHome` must never be probed here.
 * @param config - this row's config.
 * @returns the absolute directory to scan.
 */
export function resolveDirectory(config) {
  if (typeof config?.directory === 'string' && config.directory !== '') return config.directory
  const env = process.env.DSH_HOME
  const home = typeof env === 'string' && env !== '' ? env : join(homedir(), '.dsh')
  return join(home, 'local-plugins')
}

function logOf(ctx) {
  const logger = ctx.logger
  if (logger !== undefined && logger !== null) return logger
  return console
}

/** Route every accepted request to one operation. */
async function handle(ctx, directory, request, response) {
  try {
    if (request.method === 'OPTIONS') {
      writeJson(response, 204, undefined)
      return
    }
    if (request.method !== 'POST') {
      throw new LocalSourceError(FAILURE.badRequest, `expected POST, received ${String(request.method)}`)
    }
    assertSameOrigin(request)
    const body = await readJsonBody(request)
    const value = await dispatch(ctx, directory, body)
    writeJson(response, 200, { ok: true, value })
  }
  catch (error) {
    const failure = error instanceof LocalSourceError
      ? error
      : new LocalSourceError(FAILURE.management, error instanceof Error ? error.message : String(error))
    if (!(error instanceof LocalSourceError)) logOf(ctx).warn(error)
    writeJson(response, failure.code === FAILURE.badRequest ? 400 : 200, {
      ok: false,
      error: { code: failure.code, message: failure.message, details: failure.details },
    })
  }
}

/** Reject a request whose browser Origin is not this very server. */
function assertSameOrigin(request) {
  const origin = request.headers.origin
  if (typeof origin !== 'string' || origin === '' || origin === 'null') return
  let host
  try {
    host = new URL(origin).host
  }
  catch {
    throw new LocalSourceError(FAILURE.badRequest, `invalid Origin header: ${origin}`)
  }
  if (host !== request.headers.host) {
    throw new LocalSourceError(FAILURE.badRequest, `cross-origin request refused: ${origin}`)
  }
}

/** Read and parse a bounded JSON body. */
async function readJsonBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new LocalSourceError(FAILURE.bodyTooLarge, 'request body too large')
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text === '') return {}
  try {
    return JSON.parse(text)
  }
  catch {
    throw new LocalSourceError(FAILURE.badRequest, 'request body is not valid JSON')
  }
}

function writeJson(response, status, payload) {
  if (response.writableEnded === true) return
  if (payload === undefined) {
    response.writeHead(status, { 'cache-control': 'no-store' })
    response.end()
    return
  }
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  })
  response.end(body)
}

/** One operation per request. */
async function dispatch(ctx, directory, body) {
  const op = body !== null && typeof body === 'object' ? body.op : undefined
  switch (op) {
    case 'list':
      return await listSource(ctx, directory)
    case 'status':
      return { route: ROUTE_PATH, directory, pluginManager: ctx.pluginManager !== undefined }
    case 'install':
      return await installOne(ctx, directory, body.name)
    case 'remove':
      return await removeOne(ctx, body.name)
    case 'setEnabled':
      return await setEnabled(ctx, body.name, body.enabled === true)
    default:
      throw new LocalSourceError(FAILURE.unknownOp, `unknown operation: ${JSON.stringify(op)}`)
  }
}

/** Read the source directory with each package's live profile state. */
async function listSource(ctx, directory) {
  const bundles = await safeListBundles(ctx)
  const scanned = await scanPlugins({ directory, bundles })
  return { ...scanned, generatedAt: Date.now() }
}

/**
 * Read the profile's bundle inventory.
 * `pluginManager.listBundles()` resolves to a plain array; a paged wrapper is
 * tolerated too, because the Agent-facing tool projects the same service
 * through `{ entries, total, nextOffset }`.
 * @param ctx - host context carrying the manager.
 * @returns the bundle entries, or an empty list when the read fails.
 */
async function safeListBundles(ctx) {
  try {
    const result = await ctx.pluginManager.listBundles()
    if (Array.isArray(result)) return result
    return Array.isArray(result?.entries) ? result.entries : []
  }
  catch (error) {
    logOf(ctx).warn(error)
    return []
  }
}

/** Resolve one row by package name; only scanned rows are ever installable. */
async function requireItem(ctx, directory, name) {
  if (typeof name !== 'string' || name === '') {
    throw new LocalSourceError(FAILURE.badRequest, 'a package name is required')
  }
  const scanned = await scanPlugins({ directory, bundles: await safeListBundles(ctx) })
  const item = scanned.items.find((candidate) => candidate.name === name)
  if (item === undefined) {
    throw new LocalSourceError(FAILURE.unknownPlugin, `no local plugin named ${name} in ${directory}`, { name, directory })
  }
  return item
}

/** Install or reinstall one local package through the profile's manager. */
async function installOne(ctx, directory, name) {
  const item = await requireItem(ctx, directory, name)
  const result = await ctx.pluginManager.installBundle(item.spec, { enabled: true })
  return {
    name: item.name,
    spec: item.spec,
    changed: result?.changed === true,
    enabled: result?.enabled === true,
    application: result?.application,
    stage: result?.stage,
    warnings: Array.isArray(result?.warnings) ? result.warnings : [],
    output: tailOutput(result?.packageResult?.output),
    exitCode: typeof result?.packageResult?.exitCode === 'number' ? result.packageResult.exitCode : undefined,
  }
}

/** Remove one profile-owned local package through the profile's manager. */
async function removeOne(ctx, name) {
  const result = await ctx.pluginManager.removeBundle(name)
  return {
    name,
    changed: result?.changed === true,
    application: result?.application,
    stage: result?.stage,
    warnings: Array.isArray(result?.warnings) ? result.warnings : [],
    output: tailOutput(result?.packageResult?.output),
    exitCode: typeof result?.packageResult?.exitCode === 'number' ? result.packageResult.exitCode : undefined,
  }
}

/** Select or deselect one installed local bundle. */
async function setEnabled(ctx, name, enabled) {
  const result = await ctx.pluginManager.setBundleEnabled(name, enabled)
  return {
    name,
    enabled,
    changed: result?.changed === true,
    application: result?.application,
    warnings: Array.isArray(result?.warnings) ? result.warnings : [],
  }
}

/** Keep the last few KiB of pnpm diagnostics; the full log stays in the profile. */
function tailOutput(output) {
  if (typeof output !== 'string') return undefined
  return output.length <= 4000 ? output : output.slice(output.length - 4000)
}

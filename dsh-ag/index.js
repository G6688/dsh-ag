/**
 * dsh-ag - mount ag中转站 as a dsh model provider.
 *
 * The plugin never touches the API key. It writes one provider route into the
 * `llm-pi-ai` settings section that names a credential reference, so the key
 * keeps living in the harness credential store, and removing the route leaves
 * the section exactly as it was.
 *
 * Mounting the plugin is what switches the provider on and unloading it is what
 * switches it off again, so the route is there exactly while the plugin is: the
 * plugin panel turns it on, disabling or uninstalling turns it off. A route
 * that was already there is put back the way it was when the plugin goes away.
 *
 * Two facts about this endpoint shape the code:
 *
 *   - ag中转站 admits only recognized coding-agent clients. The harness sends
 *     its own User-Agent and reserves the header, so the route carries an
 *     `originator` header instead, which the harness passes through untouched.
 *     A route without it is answered with 401, which the client reports as an
 *     invalid API key, so the route this plugin installs always carries it.
 *   - the endpoint is not directly reachable from every network, and Node
 *     ignores the operating system's proxy settings. When a `proxy` is
 *     configured, the plugin installs a dispatcher that sends that station's
 *     origins through it and leaves every other origin alone; unloading the
 *     plugin puts the previous dispatcher back.
 */

import { hostOf, installScopedProxy } from './proxy.js'

export const name = 'ag'
export const inject = ['settings', 'commands', 'credentials']

const SETTINGS_NS = 'llm-pi-ai'
const ROUTE = 'ag'
const IDENTITY_HEADER = 'originator'
const CREDENTIAL_REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u
const PROXY_SCHEME_PATTERN = /^https?:\/\//u

export const scheduler = {
  /**
   * Wait before asking the settings section again.
   * @param ms - milliseconds to wait.
   */
  wait: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
}

const DEFAULTS = {
  displayName: 'ag中转站',
  baseURL: 'https://agentrouter.org/v1',
  apiKeyEnv: 'AG_API_KEY',
  originator: 'codex_cli_rs',
  proxy: '',
  models: [
    'glm-5.3',
    'deepseek-v4-flash',
    'gpt-5.6-sol',
    'gpt-6-astra',
    'claude-opus-4-8',
    'claude-opus-5',
  ],
}

/**
 * Merge the shipped defaults with the config the profile supplies.
 * @param config - the plugin row config.
 * @returns the resolved config.
 */
function normalizeConfig(config) {
  const merged = { ...DEFAULTS, ...(config ?? {}) }
  if (!Array.isArray(merged.models) || merged.models.length === 0) {
    throw new Error('ag: "models" must be a non-empty list of model ids')
  }
  if (!CREDENTIAL_REF_PATTERN.test(String(merged.apiKeyEnv))) {
    throw new Error('ag: "apiKeyEnv" must be a credential name such as AG_API_KEY')
  }
  if (merged.proxy !== '' && !PROXY_SCHEME_PATTERN.test(String(merged.proxy))) {
    throw new Error('ag: "proxy" must be empty or an http(s) proxy URL such as http://127.0.0.1:7890')
  }
  if (hostOf(merged.baseURL) === undefined) {
    throw new Error('ag: "baseURL" must be an absolute URL')
  }
  return merged
}

/**
 * The provider route this plugin writes.
 * @param config - the resolved config.
 * @returns the route value for the settings section.
 */
function routeOf(config) {
  return {
    displayName: config.displayName,
    apiKeyEnv: config.apiKeyEnv,
    api: 'openai-completions',
    baseURL: config.baseURL,
    headers: { originator: config.originator },
    models: config.models.map(model => (typeof model === 'string' ? { id: model } : { ...model })),
  }
}

/**
 * The model ids the route declares.
 * @param config - the resolved config.
 * @returns the ids.
 */
function modelIds(config) {
  return config.models.map(model => (typeof model === 'string' ? model : model.id))
}

/**
 * The message of a thrown value.
 * @param error - the thrown value.
 * @returns a readable message.
 */
function detail(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * A non-empty string, or undefined for anything else.
 * @param value - the candidate.
 * @returns the value, or undefined.
 */
function nonEmpty(value) {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * A settings value that is a plain object, or undefined for anything else.
 * @param value - the candidate.
 * @returns the object, or undefined.
 */
function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined
}

/**
 * The client-identity header a route carries, or the empty string. ag中转站
 * refuses a request that arrives without one, so its absence is the difference
 * between a working provider and one the client reports as an invalid API key.
 * @param route - a provider route from the settings section.
 * @returns the header value in use, or the empty string.
 */
function identityHeader(route) {
  const entries = Object.entries(plainObject(route?.headers) ?? {})
  const entry = entries.find(([key]) => key.toLowerCase() === IDENTITY_HEADER)
  return nonEmpty(entry?.[1]) ?? ''
}

/**
 * A header map that carries the identity header once, whatever case it used.
 * @param headers - the route's current headers.
 * @param value - the identity header value.
 * @returns a new header map.
 */
function withIdentityHeader(headers, value) {
  const next = {}
  for (const [key, headerValue] of Object.entries(plainObject(headers) ?? {})) {
    if (key.toLowerCase() !== IDENTITY_HEADER) next[key] = headerValue
  }
  next[IDENTITY_HEADER] = value
  return next
}

/**
 * The model ids a route declares.
 * @param route - a provider route from the settings section.
 * @returns the ids.
 */
function idsOfRoute(route) {
  if (!Array.isArray(route?.models)) return []
  return route.models
    .map(model => (typeof model === 'string' ? model : model?.id))
    .filter(id => nonEmpty(id) !== undefined)
}

/**
 * What the report and the reachability probe should talk about: the route that
 * is actually in effect, with this plugin's config filling any gap it leaves.
 * @param route - the effective route, or undefined.
 * @param config - the resolved config.
 * @returns the target.
 */
function routeTarget(route, config) {
  const models = idsOfRoute(route)
  return {
    baseURL: nonEmpty(route?.baseURL) ?? config.baseURL,
    apiKeyEnv: nonEmpty(route?.apiKeyEnv) ?? config.apiKeyEnv,
    originator: identityHeader(route) || config.originator,
    models: models.length > 0 ? models : modelIds(config),
  }
}

/**
 * A stable spelling of a settings value, so two routes can be compared.
 * @param value - any JSON-shaped value.
 * @returns the canonical text.
 */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`
  }
  return JSON.stringify(value ?? null)
}

/**
 * Whether a route already is the route this plugin would write.
 * @param left - one route.
 * @param right - the other route.
 * @returns true when they say the same thing.
 */
export function sameRoute(left, right) {
  return canonical(left) === canonical(right)
}
/**
 * The `llm-pi-ai` settings descriptor, when this profile mounts that adapter.
 * @param ctx - the plugin context.
 * @returns the descriptor, or undefined.
 */
function settingsDescriptor(ctx) {
  try {
    return ctx.settings.describe().find(descriptor => descriptor.ns === SETTINGS_NS)
  } catch {
    return undefined
  }
}

/**
 * The route as the user's own settings layer declares it, if at all.
 * @param descriptor - the settings descriptor.
 * @returns the route value, or undefined.
 */
function userRoute(descriptor) {
  const providers = descriptor?.user?.['providers']
  if (providers === null || typeof providers !== 'object' || Array.isArray(providers)) return undefined
  return providers[ROUTE]
}

/**
 * The route as it resolves after every layer, if at all.
 * @param descriptor - the settings descriptor.
 * @returns the route value, or undefined.
 */
function resolvedRoute(descriptor) {
  const providers = descriptor?.value?.['providers']
  if (providers === null || typeof providers !== 'object' || Array.isArray(providers)) return undefined
  return providers[ROUTE]
}

/**
 * Describe a task to the caller.
 * @param lines - one line per fact.
 * @returns a success-shaped command result.
 */
function ok(lines) {
  const list = Array.isArray(lines) ? lines : [lines]
  return { kind: 'success', text: list.filter(Boolean).join('\n') }
}

/**
 * Describe a failure to the caller.
 * @param lines - one line per fact.
 * @returns an error-shaped command result.
 */
function fail(lines) {
  const list = Array.isArray(lines) ? lines : [lines]
  return { kind: 'error', text: list.filter(Boolean).join('\n') }
}

/**
 * Describe one credential reference without reading its value.
 * @param ctx - the plugin context.
 * @param ref - the credential reference name.
 * @returns a human-readable state.
 */
async function credentialState(ctx, ref) {
  try {
    const info = await ctx.credentials.describe(ref)
    if (info?.configured === true) return `set (source: ${info.source ?? 'unknown'})`
    return 'not set'
  } catch (error) {
    return `unknown (${error instanceof Error ? error.message : String(error)})`
  }
}

/**
 * Read one credential reference's value, for the reachability probe only.
 * @param ctx - the plugin context.
 * @param ref - the credential reference name.
 * @returns the value, or undefined.
 */
async function credentialValue(ctx, ref) {
  try {
    const hit = await ctx.credentials.resolve(ref)
    return hit?.value
  } catch {
    return undefined
  }
}

/**
 * Ask the endpoint which models it serves, using the headers the route sends.
 * @param ctx - the plugin context.
 * @param config - the resolved config.
 * @returns the offered ids, or the reason it could not be read.
 */
async function probeEndpoint(ctx, config) {
  const headers = { originator: config.originator }
  const key = await credentialValue(ctx, config.apiKeyEnv)
  if (typeof key === 'string' && key !== '') headers.authorization = `Bearer ${key}`
  const url = `${String(config.baseURL).replace(/\/+$/u, '')}/models`
  let response
  try {
    response = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) })
  } catch (error) {
    const detail = error?.cause?.code ?? error?.name ?? 'unknown'
    return { ok: false, detail: `unreachable (${detail})` }
  }
  const text = await response.text().catch(() => '')
  if (!response.ok) return { ok: false, detail: `HTTP ${response.status} ${text.slice(0, 160)}`.trim() }
  let ids = []
  try {
    const parsed = JSON.parse(text)
    if (Array.isArray(parsed?.data)) ids = parsed.data.map(entry => entry?.id).filter(Boolean)
    else if (parsed?.models !== null && typeof parsed.models === 'object') ids = Object.keys(parsed.models)
  } catch {
    return { ok: false, detail: `unreadable model listing: ${text.slice(0, 120)}` }
  }
  return { ok: true, ids }
}

/**
 * Mount the provider route, its `/ag` switch, and the transport it needs.
 * @param ctx - the plugin context.
 * @param config - the plugin row config.
 */
export async function apply(ctx, config) {
  const resolved = normalizeConfig(config)
  const hosts = [hostOf(resolved.baseURL)]

  const report = (message) => {
    try {
      ctx.logger?.info?.(`ag: ${message}`)
    } catch {
      // Diagnostics must never be the reason a mount fails.
    }
  }

  let installedUrl = ''
  let disposeProxy

  /**
   * Make the transport match `url`, installing or removing the dispatcher.
   * @param url - the proxy URL to route ag中转站 through, or the empty string.
   */
  async function useProxy(url) {
    if (url === installedUrl) return
    const previous = disposeProxy
    disposeProxy = undefined
    installedUrl = ''
    if (previous !== undefined) await previous()
    if (url === '') return
    disposeProxy = await installScopedProxy({ url, hosts, report })
    installedUrl = url
  }

  /**
   * Apply the transport, reporting rather than throwing.
   * @param url - the proxy URL to route ag中转站 through, or the empty string.
   * @returns a line naming a failure, or the empty string.
   */
  async function tryUseProxy(url) {
    try {
      await useProxy(url)
      return ''
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      report(detail)
      return `代理没有装上：${detail}`
    }
  }

  /**
   * The credential's state, in the words the settings page uses.
   * @param ref - the credential reference name.
   * @returns a readable state.
   */
  async function keyState(ref) {
    const state = await credentialState(ctx, ref)
    if (state.startsWith('not set')) return '未配置'
    if (state.startsWith('unknown')) return state
    return state.replace(/^set \(source: (.+)\)$/u, '已配置（来源 $1）')
  }

  /**
   * The facts a switched-on route reports.
   * @param target - the route in effect.
   * @returns one line per fact.
   */
  async function liveLines(target) {
    const probe = await probeEndpoint(ctx, target)
    return [
      `  地址     : ${target.baseURL}`,
      `  模型     : ${target.models.join(', ')}`,
      `  密钥     : ${target.apiKeyEnv} ${await keyState(target.apiKeyEnv)}`,
      probe.ok
        ? `  端点     : 可达，提供 ${probe.ids.length} 个模型`
        : `  端点     : ${probe.detail}`,
      probe.ok || resolved.proxy !== ''
        ? ''
        : '  提示     : 如果一直不可达，这台机器到该地址可能需要走代理：把插件配置里的 proxy 指向它。',
    ]
  }

  /**
   * The next step when the credential is still missing.
   * @param target - the route in effect.
   * @returns a line, or the empty string.
   */
  async function keyNextStep(target) {
    const state = await credentialState(ctx, target.apiKeyEnv)
    return state.startsWith('not set')
      ? `  下一步   : 打开「设置 → 模型 → ${resolved.displayName}」，把 API 密钥填进去。`
      : ''
  }

  let owned = false
  let previous

  /**
   * Put this plugin's route in place, remembering whatever was there before.
   * @returns whether the route is in place, whether a miss is worth retrying,
   *          and the lines to log.
   */
  async function attach() {
    const descriptor = settingsDescriptor(ctx)
    if (descriptor === undefined) {
      return { ok: false, retry: true, lines: ['"llm-pi-ai" 设置段还没挂载，稍后重试。'] }
    }
    const desired = routeOf(resolved)
    const existing = userRoute(descriptor)
    if (existing !== undefined && sameRoute(existing, desired)) {
      // An earlier run of this plugin left exactly this route behind.
      previous = undefined
    } else {
      previous = existing
      try {
        await ctx.settings.mutate(SETTINGS_NS, [
          { op: 'set', path: ['providers', ROUTE], value: desired },
        ], descriptor.revision)
      } catch (error) {
        previous = undefined
        return { ok: false, retry: false, lines: [`写入这条路由失败：${detail(error)}`] }
      }
    }
    owned = true
    const proxyNote = await tryUseProxy(resolved.proxy)
    return {
      ok: true,
      retry: false,
      lines: [
        `已接入 ${resolved.displayName}：${desired.baseURL}，${desired.models.length} 个模型。`,
        existing !== undefined && previous !== undefined ? '（原来那条 ag 路由会在卸载时放回去。）' : '',
        proxyNote,
      ],
    }
  }

  /**
   * Take the route and the transport back out. This is what disabling the
   * plugin - in the panel, or by uninstalling it - ends up doing.
   */
  async function detach() {
    await tryUseProxy('')
    if (!owned) return
    owned = false
    const value = previous
    previous = undefined
    const descriptor = settingsDescriptor(ctx)
    if (descriptor === undefined) return
    try {
      await ctx.settings.mutate(SETTINGS_NS, [
        value === undefined
          ? { op: 'unset', path: ['providers', ROUTE] }
          : { op: 'set', path: ['providers', ROUTE], value },
      ], descriptor.revision)
      report(value === undefined ? 'route removed' : 'the previous route is back')
    } catch (error) {
      report(`could not take the route back out: ${detail(error)}`)
    }
  }

  /**
   * The facts `/ag` prints.
   * @returns one line per fact.
   */
  async function statusLines() {
    const attached = await attach()
    const descriptor = settingsDescriptor(ctx)
    const route = descriptor === undefined ? undefined : userRoute(descriptor)
    const target = routeTarget(route, resolved)
    const lines = []
    if (!attached.ok) lines.push(...attached.lines.filter(Boolean))
    lines.push(route === undefined ? '状态     : 未接入' : '状态     : 已接入')
    if (route !== undefined) {
      lines.push(`  协议     : ${route.api ?? '(来自模型目录)'}`)
      lines.push(`  地址     : ${route.baseURL ?? '(来自模型目录)'}`)
      lines.push(`  请求头   : ${JSON.stringify(route.headers ?? {})}`)
      lines.push(`  模型     : ${target.models.join(', ')}`)
    }
    lines.push(`  密钥     : ${target.apiKeyEnv} ${await keyState(target.apiKeyEnv)}`)
    lines.push(installedUrl === ''
      ? `  代理     : 未安装（插件配置里是 ${resolved.proxy === '' ? '不走代理' : resolved.proxy}）`
      : `  代理     : ${installedUrl} → ${hosts.join(', ')}`)
    const probe = await probeEndpoint(ctx, target)
    lines.push(probe.ok
      ? `  端点     : 可达，提供 ${probe.ids.length} 个模型`
      : `  端点     : ${probe.detail}`)
    lines.push(await keyNextStep(target))
    return lines
  }

  let queue = Promise.resolve()

  /**
   * Run one command at a time, so two calls cannot interleave.
   * @param task - the work to run.
   * @returns the task's own result.
   */
  function serialize(task) {
    const run = queue.then(task, task)
    queue = run.then(() => undefined, () => undefined)
    return run
  }

  ctx.commands.register({
    name: 'ag',
    description: 'ag中转站的接入状态；接入和撤掉由插件自己完成，这里只是查看',
    handler: ({ rawInput }) => serialize(async () => {
      const argument = String(rawInput ?? '').trim().toLowerCase()
      if (argument !== '' && argument !== 'status') {
        return ok([
          `不需要 "${argument}"：插件挂载时自动接入，卸载时自动撤掉。`,
          ...(await statusLines()),
        ])
      }
      return ok(await statusLines())
    }),
  })

  ctx.effect(() => async () => {
    await detach()
  }, 'ag: take the route and the transport back out')

  // Mounting the plugin is what switches the provider on: no command, no
  // setting to flip. The settings section can still be a moment away from
  // being mounted when this runs, so a miss is retried a few times.
  let attached = await attach()
  for (let attempt = 0; !attached.ok && attached.retry && attempt < 5; attempt++) {
    await scheduler.wait(1000)
    attached = await attach()
  }
  report(attached.lines.filter(Boolean).join(' '))
}

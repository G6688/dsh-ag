import assert from 'node:assert/strict'
import { apply, sameRoute, scheduler } from '../index.js'
import { undiciLoader } from '../proxy.js'
import { readFileSync } from 'node:fs'

// --- the endpoint lives in the shipped config, so this suite never hard-codes it
const shippedBaseURL = /^\s*baseURL:\s*(\S+)\s*$/mu
  .exec(readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8'))[1]
const shippedOrigin = new URL(shippedBaseURL).origin
const shippedHost = new URL(shippedBaseURL).host

// --- the endpoint probe is stubbed, so the suite is offline and deterministic
const offered = [{ id: 'glm-5.3' }, { id: 'deepseek-v4-flash' }]
const shipped = ['glm-5.3', 'deepseek-v4-flash', 'gpt-5.6-sol', 'gpt-6-astra', 'claude-opus-4-8', 'claude-opus-5']
let fetchCalls = []
function stubFetch(url, init) {
  fetchCalls.push({ url: String(url), headers: init.headers })
  return Promise.resolve(new Response(JSON.stringify({ data: offered }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }))
}
globalThis.fetch = stubFetch

// --- a fake undici, so the transport half is exercised without a network either
function makeUndici() {
  const state = { current: undefined, previous: { label: 'previous', dispatch: () => { state.delegated += 1; return true } }, delegated: 0, proxied: [], agents: [], uris: [] }
  state.current = state.previous
  class FakeProxyAgent {
    constructor(options) { state.uris.push(options.uri); state.agents.push(this) }
    dispatch() { state.proxied.push('proxied'); return true }
    async close() { this.closed = true }
    async destroy() {}
  }
  return {
    state,
    undici: {
      ProxyAgent: FakeProxyAgent,
      getGlobalDispatcher: () => state.current,
      setGlobalDispatcher: (dispatcher) => { state.current = dispatcher },
    },
  }
}

const realLoad = undiciLoader.load
let fake = makeUndici()
undiciLoader.load = () => Promise.resolve(fake.undici)

// --- a settings service stub that applies the same path ops the real one does
function makeCtx({ user, composed = {}, keyState = 'not set', descriptorDelay = 0, failMutate = false } = {}) {
  const state = { user: user === undefined ? undefined : structuredClone(user), ops: [], revision: 7, describes: 0 }
  const settings = {
    describe() {
      state.describes += 1
      if (state.describes <= descriptorDelay) return []
      const providers = { ...composed, ...(state.user?.providers ?? {}) }
      return [{
        ns: 'llm-pi-ai',
        revision: state.revision,
        value: { providers: structuredClone(providers) },
        ...state.user === undefined ? {} : { user: structuredClone(state.user) },
      }]
    },
    async mutate(ns, ops, expectedRevision) {
      if (failMutate) throw new Error('llm-pi-ai: provider "ag" is unserviceable')
      assert.equal(ns, 'llm-pi-ai')
      assert.equal(expectedRevision, state.revision)
      state.ops.push(...ops)
      for (const op of ops) {
        const root = state.user ??= {}
        const providers = root.providers ??= {}
        if (op.op === 'set') providers.ag = structuredClone(op.value)
        else delete providers.ag
      }
    },
  }
  const commands = { registered: [], register(definition) { this.registered.push(definition); return () => {} } }
  const credentials = {
    async describe() { return { configured: keyState === 'set', writable: true, ...keyState === 'set' ? { source: 'environment' } : {} } },
    async resolve() { return keyState === 'set' ? { value: 'test-key' } : undefined },
  }
  const effects = []
  const logs = []
  const ctx = {
    settings,
    commands,
    credentials,
    effect: (factory, label) => { const disposer = factory(); effects.push({ label, disposer }); return disposer },
    logger: { info: (message) => { logs.push(message) }, warn: () => {} },
  }
  return { ctx, state, commands, effects, logs }
}

const start = async (options) => {
  fake = makeUndici()
  undiciLoader.load = options?.failUndici === true
    ? () => Promise.reject(new Error("Cannot find package 'undici'"))
    : () => Promise.resolve(fake.undici)
  scheduler.wait = async () => {}
  const made = makeCtx(options)
  await apply(made.ctx, options?.config ?? {})
  return { ...made, transport: fake.state }
}

const command = (made, rawInput = '') => made.commands.registered[0].handler({ rawInput, agent: undefined, commandId: 'c', attachments: [] })

// --- route comparison
{
  assert.equal(sameRoute({ a: 1, b: { c: 2 } }, { b: { c: 2 }, a: 1 }), true)
  assert.equal(sameRoute({ a: 1 }, { a: 2 }), false)
  assert.equal(sameRoute(undefined, undefined), true)
}

// --- config validation
{
  const { ctx } = makeCtx()
  await assert.rejects(() => apply(ctx, { models: [] }), /non-empty list/)
  await assert.rejects(() => apply(ctx, { models: ['m'], apiKeyEnv: 'not-a-ref' }), /credential name/)
  await assert.rejects(() => apply(ctx, { models: ['m'], proxy: 'socks5://127.0.0.1:1080' }), /http\(s\) proxy URL/)
  await assert.rejects(() => apply(ctx, { models: ['m'], baseURL: 'not-an-absolute-url' }), /absolute URL/)
}

// --- mounting the plugin is what switches the provider on
{
  const made = await start()
  assert.equal(made.commands.registered.length, 1)
  assert.equal(made.commands.registered[0].name, 'ag')
  assert.equal(made.state.ops.length, 1)
  const op = made.state.ops[0]
  assert.equal(op.op, 'set')
  assert.deepEqual(op.path, ['providers', 'ag'])
  assert.deepEqual(op.value.headers, { originator: 'codex_cli_rs' })
  assert.equal(op.value.api, 'openai-completions')
  assert.equal(op.value.baseURL, shippedBaseURL)
  assert.equal(op.value.apiKeyEnv, 'AG_API_KEY')
  assert.deepEqual(op.value.models.map(model => model.id), shipped)
  assert.ok(made.logs.some(message => message.includes('已接入')), 'the mount says what it did')
}

// --- a mount that finds the very route it wrote last time leaves it alone
{
  const first = await start()
  const route = first.state.user.providers.ag
  const again = await start({ user: { providers: { ag: route } } })
  assert.equal(again.state.ops.length, 0, 'nothing to rewrite')
}

// --- unmounting takes the route back out and puts the dispatcher back
{
  const made = await start({ config: { proxy: 'http://127.0.0.1:7890' } })
  assert.deepEqual(made.transport.uris, ['http://127.0.0.1:7890'])
  assert.notEqual(made.transport.current, made.transport.previous)
  await made.effects[0].disposer()
  assert.equal(made.state.ops.at(-1).op, 'unset')
  assert.deepEqual(made.state.ops.at(-1).path, ['providers', 'ag'])
  assert.equal(made.transport.current, made.transport.previous)
  assert.equal(made.transport.agents[0].closed, true)
}

// --- a route the user already had is replaced while mounted, restored on unmount
{
  const declared = { displayName: 'mine', api: 'openai-responses', baseURL: 'https://relay.example/v1', headers: { originator: 'another-client' }, models: [{ id: 'x' }] }
  const made = await start({ user: { providers: { ag: structuredClone(declared) } } })
  assert.equal(made.state.ops.length, 1)
  assert.equal(made.state.ops[0].value.baseURL, shippedBaseURL)
  await made.effects[0].disposer()
  const last = made.state.ops.at(-1)
  assert.equal(last.op, 'set', 'the user keeps their own route')
  assert.deepEqual(last.value, declared)
}

// --- a configured proxy covers that station's origin and nothing else
{
  const made = await start({ config: { proxy: 'http://127.0.0.1:7890' } })
  assert.deepEqual(made.transport.uris, ['http://127.0.0.1:7890'])
  assert.equal(made.transport.current.dispatch({ origin: shippedOrigin }), true)
  assert.equal(made.transport.proxied.length, 1)
  made.transport.current.dispatch({ origin: 'https://example.com' })
  assert.equal(made.transport.delegated, 1, 'a foreign origin keeps the dispatcher it had')
  made.transport.current.dispatch({ origin: new URL('http://127.0.0.1:3080/api') })
  assert.equal(made.transport.delegated, 2, 'loopback stays direct')
  assert.ok(made.logs.some(message => message.includes(`sending ${shippedHost} through http://127.0.0.1:7890`)))
}

// --- a proxy that cannot be installed still leaves the route usable
{
  const made = await start({ config: { proxy: 'http://127.0.0.1:7890' }, failUndici: true })
  assert.equal(made.state.ops.length, 1, 'the route is written either way')
  assert.ok(made.logs.some(message => message.includes('代理没有装上')), 'the miss is reported')
}

// --- the command only reports; it never switches anything by itself
{
  const made = await start({ keyState: 'set' })
  const shown = await command(made)
  assert.equal(shown.kind, 'success', shown.text)
  assert.match(shown.text, /状态     : 已接入/)
  assert.match(shown.text, /协议     : openai-completions/)
  assert.ok(shown.text.includes(`地址     : ${shippedBaseURL}`), shown.text)
  assert.match(shown.text, /请求头   : \{"originator":"codex_cli_rs"\}/)
  assert.match(shown.text, /模型     : glm-5\.3, deepseek-v4-flash, /)
  assert.match(shown.text, /密钥     : AG_API_KEY 已配置（来源 environment）/)
  assert.match(shown.text, /端点     : 可达，提供 2 个模型/)
  assert.ok(!/下一步/.test(shown.text))
  assert.equal(made.state.ops.length, 1, 'no second route appears')
}

// --- the old habit of typing on/off is answered rather than obeyed
{
  const made = await start()
  const answer = await command(made, 'off')
  assert.equal(answer.kind, 'success')
  assert.match(answer.text, /不需要 "off"/)
  assert.equal(made.state.ops.at(-1).op, 'set', 'the route stays')
}

// --- a missing key points at the settings page
{
  const made = await start()
  const shown = await command(made)
  assert.match(shown.text, /下一步   : 打开「设置 → 模型 → ag中转站」/)
}

// --- an unreachable endpoint is reported, not thrown
{
  const made = await start()
  globalThis.fetch = () => { const error = new Error('fetch failed'); error.cause = { code: 'ECONNRESET' }; return Promise.reject(error) }
  const shown = await command(made)
  assert.equal(shown.kind, 'success')
  assert.match(shown.text, /unreachable \(ECONNRESET\)/)
  globalThis.fetch = stubFetch
}

// --- a refused settings write is reported, not thrown
{
  const made = await start({ failMutate: true })
  assert.equal(made.state.ops.length, 0)
  assert.ok(made.logs.some(message => message.includes('写入这条路由失败')), 'the mount reports the refusal')
  const shown = await command(made)
  assert.equal(shown.kind, 'success')
  assert.match(shown.text, /写入这条路由失败/)
  assert.match(shown.text, /unserviceable/)
  assert.match(shown.text, /状态     : 未接入/)
}

// --- a settings section that is not mounted yet is retried, then used
{
  const made = await start({ descriptorDelay: 2 })
  assert.equal(made.state.ops.length, 1, 'the route lands once the section shows up')
  assert.ok(made.state.describes >= 3)
}

// --- the shipped defaults carry every model the endpoint offers
{
  const made = await start()
  const shown = await command(made)
  assert.ok(shown.text.includes(shipped.join(', ')))
}

undiciLoader.load = realLoad
console.log('all plugin tests passed')
/**
 * The transport half of dsh-ag.
 *
 * the endpoint is not directly reachable from every network, and Node does
 * not read the operating system's proxy settings, so a machine whose browser is
 * proxied still leaves the harness connecting directly. This module sends
 * that station's own origins through a local proxy while every other origin keeps
 * the dispatcher it already had, and hands back a disposer that puts the
 * previous dispatcher back.
 *
 * The proxy is installed at run time as undici's global dispatcher, which is
 * what `fetch` resolves. That is deliberate: Node samples NODE_USE_ENV_PROXY
 * before the program runs, so setting it from a plugin cannot work.
 */

/**
 * The undici module, behind a mutable seam so tests never touch the network.
 *
 * Resolved lazily and by name: the profile this plugin is installed into owns
 * the copy, and a plugin must not assume it was hoisted into the harness.
 */
export const undiciLoader = { load: () => import('undici') }

/**
 * The host a URL names, lowercased, or undefined when it is not a URL.
 * @param value - an absolute URL string.
 * @returns the hostname, or undefined.
 */
export function hostOf(value) {
  try {
    return new URL(String(value)).hostname.toLowerCase()
  } catch {
    return undefined
  }
}

/**
 * Read the origin undici hands a dispatcher.
 * @param options - the dispatch options.
 * @returns the parsed origin, or undefined when it carries none.
 */
function originOf(options) {
  const raw = options?.origin
  if (raw === undefined || raw === null) return undefined
  try {
    return raw instanceof URL ? raw : new URL(typeof raw === 'string' ? raw : String(raw))
  } catch {
    return undefined
  }
}

/**
 * Install a dispatcher that proxies the named hosts and delegates the rest.
 *
 * Only the named hosts take the proxy, so the harness's own browser traffic, its
 * loopback servers, and every other model provider keep the route they had.
 * Delegating to the dispatcher already installed, rather than rebuilding a
 * direct one, is what makes that true even when the launcher installed a policy
 * of its own at start-up.
 * @param options - the proxy URL, the hosts to send through it, and a diagnostics sink.
 * @returns a disposer restoring the previous dispatcher and closing the agent.
 */
export async function installScopedProxy({ url, hosts, report }) {
  let undici
  try {
    undici = await undiciLoader.load()
  } catch (cause) {
    throw new Error(
      'the "undici" package is not resolvable from this plugin, so the proxy cannot be installed: '
      + (cause instanceof Error ? cause.message : String(cause)),
    )
  }
  const { ProxyAgent, getGlobalDispatcher, setGlobalDispatcher } = undici
  const previous = getGlobalDispatcher()
  const agent = new ProxyAgent({ uri: url })
  const targets = new Set([...hosts].map(host => String(host).toLowerCase()))
  const dispatcher = {
    dispatch(options, handler) {
      const origin = originOf(options)
      if (origin !== undefined && targets.has(origin.hostname.toLowerCase())) {
        return agent.dispatch(options, handler)
      }
      return previous.dispatch(options, handler)
    },
    close: () => agent.close(),
    destroy: (error, callback) => agent.destroy(error, callback),
  }
  setGlobalDispatcher(dispatcher)
  report(`sending ${[...targets].join(', ')} through ${url}`)
  return async () => {
    setGlobalDispatcher(previous)
    await agent.close()
  }
}

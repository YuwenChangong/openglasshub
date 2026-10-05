const hopByHop = ['connection', 'proxy-connection', 'keep-alive', 'transfer-encoding',
  'upgrade', 'te', 'trailer', 'proxy-authorization', 'proxy-authenticate'];

export async function buildOutboundFetchInit(request, { signal = AbortSignal.timeout(10000) } = {}) {
  const headers = new Headers(request.headers);
  // Connection can nominate additional fields that are valid only on the source hop.
  const nominated = (headers.get('connection') ?? '').split(',').map(name => name.trim()).filter(Boolean);
  for (const name of [...nominated, ...hopByHop, 'host', 'content-length']) headers.delete(name);
  return {
    method: request.method, headers, redirect: 'error', signal,
    // Reconstruct once; Node owns destination framing, including content length.
    ...(['GET', 'HEAD'].includes(request.method) ? {} : { body: await request.arrayBuffer() }),
  };
}

import { summary } from '../../dist/server/server.js';

const config = new Map([
  ['hosts', 'sdk-host|127.0.0.1'],
  ['check_method', 'http'],
]);
const host = {
  config: { get: async (name) => config.get(name) },
  http: { request: async () => ({ status: 200, headers: {}, body: 'ok' }) },
  notifications: { emit: async () => undefined },
  storage: {
    get: async () => null,
    set: async () => undefined,
    delete: async () => undefined,
  },
  audit: { annotate: async () => undefined },
};

const result = await summary({ method: 'GET' }, host);
if (result.totalHosts !== 1 || result.onlineHosts !== 1 || result.statusTone !== 'ok') {
  throw new Error(`Deno SDK smoke test returned an unexpected result: ${JSON.stringify(result)}`);
}

import type {
  AppInvocationV2,
  ConnectionProfileSummary,
  ConnectionProfileValue,
  HostApiV2,
  HostDiagnosticV2,
  HostNotificationV2,
  ScopedHttpRequestV2,
} from '@nad/sdk';

export interface FakeHostV2Options {
  connection?: ConnectionProfileSummary | null;
  values?: Record<string, ConnectionProfileValue>;
  responses?: Record<string, { status: number; headers?: Record<string, string>; body?: unknown }>;
  appOperations?: Record<string, unknown | ((input: unknown, connectionProfileId: string) => unknown | Promise<unknown>)>;
  deniedAppOperations?: string[];
}

export interface FakeHostV2 extends HostApiV2 {
  connectionReads: string[];
  httpLog: ScopedHttpRequestV2[];
  notificationsLog: HostNotificationV2[];
  diagnosticsLog: HostDiagnosticV2[];
  auditLog: Array<Record<string, string | number | boolean | null>>;
  storageValues: Map<string, unknown>;
  storageLog: Array<{ action: 'set' | 'delete'; key: string; value?: unknown }>;
  appInvocationLog: AppInvocationV2[];
}

function clone<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value)) as T;
}

export function createFakeHostV2(options: FakeHostV2Options = {}): FakeHostV2 {
  const connectionReads: string[] = [];
  const httpLog: ScopedHttpRequestV2[] = [];
  const notificationsLog: HostNotificationV2[] = [];
  const diagnosticsLog: HostDiagnosticV2[] = [];
  const auditLog: Array<Record<string, string | number | boolean | null>> = [];
  const storageValues = new Map<string, unknown>();
  const storageLog: Array<{ action: 'set' | 'delete'; key: string; value?: unknown }> = [];
  const appInvocationLog: AppInvocationV2[] = [];
  const denied = new Set(options.deniedAppOperations ?? []);

  return {
    connectionReads,
    httpLog,
    notificationsLog,
    diagnosticsLog,
    auditLog,
    storageValues,
    storageLog,
    appInvocationLog,
    connections: {
      async current() {
        return clone(options.connection ?? null);
      },
      async get(name) {
        connectionReads.push(name);
        if (!options.connection) throw new Error('CONNECTION_REQUIRED');
        return clone(options.values?.[name]);
      },
    },
    http: {
      async request(request) {
        httpLog.push(clone(request));
        const fixture = options.responses?.[request.scope];
        return fixture
          ? { status: fixture.status, headers: { ...(fixture.headers ?? {}) }, body: clone(fixture.body) }
          : { status: 404, headers: {}, body: { error: 'No fake scoped response configured.' } };
      },
    },
    notifications: {
      async emit(event) {
        notificationsLog.push(clone(event));
      },
    },
    storage: {
      async get(key) {
        return clone(storageValues.get(key));
      },
      async set(key, value) {
        storageValues.set(key, clone(value));
        storageLog.push({ action: 'set', key, value: clone(value) });
      },
      async delete(key) {
        storageValues.delete(key);
        storageLog.push({ action: 'delete', key });
      },
    },
    diagnostics: {
      async emit(event) {
        diagnosticsLog.push(clone(event));
      },
    },
    audit: {
      async annotate(metadata) {
        auditLog.push(clone(metadata));
      },
    },
    apps: {
      async invoke(request) {
        const key = `${request.dependency}.${request.operation}`;
        appInvocationLog.push(clone(request));
        if (denied.has(key)) throw new Error('APP_OPERATION_ACCESS_DENIED');
        const fixture = options.appOperations?.[key];
        if (fixture === undefined) throw new Error('APP_OPERATION_UNAVAILABLE');
        return clone(typeof fixture === 'function'
          ? await fixture(request.input, request.connectionProfileId)
          : fixture);
      },
    },
  };
}

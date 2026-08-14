import type { HostApi, HostConfigValue, HostHttpRequest, HostHttpResponse, HostNotification } from '@nad/sdk';

export interface FakeHostResponseFixture extends HostHttpResponse {
  delayMs?: number;
}

export interface FakeHostOptions {
  config?: Record<string, HostConfigValue>;
  responses?: Record<string, FakeHostResponseFixture>;
}

export interface FakeHostHttpLogEntry {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface FakeHostStorageLogEntry {
  action: 'set' | 'delete';
  key: string;
  value?: unknown;
}

export interface FakeHostAuditLogEntry extends Record<string, string | number | boolean | null> {}

export interface FakeHost extends HostApi {
  notificationsLog: HostNotification[];
  auditLog: FakeHostAuditLogEntry[];
  storageValues: Map<string, unknown>;
  storageLog: FakeHostStorageLogEntry[];
  httpLog: FakeHostHttpLogEntry[];
  configLog: string[];
}

function cloneHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  return headers ? { ...headers } : {};
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function createFakeHost(options: FakeHostOptions = {}): FakeHost {
  const storageValues = new Map<string, unknown>();
  const notificationsLog: HostNotification[] = [];
  const auditLog: FakeHostAuditLogEntry[] = [];
  const storageLog: FakeHostStorageLogEntry[] = [];
  const httpLog: FakeHostHttpLogEntry[] = [];
  const configLog: string[] = [];

  return {
    notificationsLog,
    auditLog,
    storageValues,
    storageLog,
    httpLog,
    configLog,
    config: {
      async get(name) {
        configLog.push(name);
        return options.config?.[name];
      },
    },
    http: {
      async request(request: HostHttpRequest) {
        httpLog.push({
          url: request.url,
          method: request.method ?? 'GET',
          headers: cloneHeaders(request.headers),
          body: request.body,
        });
        const response = options.responses?.[request.url];
        if (!response) {
          return { status: 404, headers: {}, body: { error: 'No fake response configured.' } };
        }
        if (response.delayMs && response.delayMs > 0) {
          await delay(response.delayMs);
        }
        return {
          status: response.status,
          headers: cloneHeaders(response.headers),
          body: response.body,
        };
      },
    },
    notifications: {
      async emit(event) {
        notificationsLog.push(event);
      },
    },
    storage: {
      async get(key) {
        return storageValues.get(key);
      },
      async set(key, value) {
        storageValues.set(key, value);
        storageLog.push({ action: 'set', key, value });
      },
      async delete(key) {
        storageValues.delete(key);
        storageLog.push({ action: 'delete', key });
      },
    },
    audit: {
      async annotate(metadata) {
        auditLog.push(metadata);
      },
    },
  };
}

import type {
  NADHostAPIV2Call,
  NADHostAPIV2OperationInvocation,
} from './generated/v2/index.js';
import type { SecretReference } from './host-api.js';

type ParamsFor<TMethod extends NADHostAPIV2Call['method']> = Extract<NADHostAPIV2Call, { method: TMethod }>['params'];

export type ConnectionProfileValue = string | number | boolean | SecretReference | undefined;
export type ConnectionProfileSummary = {
  id: string;
  name: string;
};
export type ScopedHttpRequestV2 = ParamsFor<'http.request'>;
export type HostNotificationV2 = ParamsFor<'notifications.emit'>;
export type HostDiagnosticV2 = ParamsFor<'diagnostics.emit'>;
export type HostAuditMetadataV2 = ParamsFor<'audit.annotate'>;
export type AppInvocationV2<TInput = unknown> = Omit<ParamsFor<'apps.invoke'>, 'input'> & { input: TInput };

export interface HostApiV2 {
  connections: {
    current(): Promise<ConnectionProfileSummary | null>;
    get(name: string): Promise<ConnectionProfileValue>;
  };
  http: {
    request(request: ScopedHttpRequestV2): Promise<{
      status: number;
      headers: Record<string, string>;
      body: unknown;
    }>;
  };
  notifications: {
    emit(event: HostNotificationV2): Promise<void>;
  };
  storage: {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<void>;
  };
  diagnostics: {
    emit(event: HostDiagnosticV2): Promise<void>;
  };
  audit: {
    annotate(metadata: HostAuditMetadataV2): Promise<void>;
  };
  apps: {
    invoke<TInput = unknown, TOutput = unknown>(request: AppInvocationV2<TInput>): Promise<TOutput>;
  };
}

export type AppRequestV2<TBody = unknown> = Omit<NADHostAPIV2OperationInvocation, 'body'> & {
  body?: TBody;
};

export type AddonRequestV2<TBody = unknown> = AppRequestV2<TBody>;

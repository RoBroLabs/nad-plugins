import type {
  ModuleAuditMetadata,
  ModuleHostHttpRequest,
  ModuleHostHttpResponse,
  ModuleHostNotification,
  ModuleInvocationRequestDocument,
  ModuleSecretReference,
} from './generated/v1/index.js';

export type SecretReference = ModuleSecretReference;
export type HostConfigValue = string | SecretReference | undefined;
export type HostHttpRequest = ModuleHostHttpRequest;
export type HostHttpResponse = ModuleHostHttpResponse;
export type HostNotification = ModuleHostNotification;

export interface HostApi {
  config: {
    get(name: string): Promise<HostConfigValue>;
  };
  http: {
    request(request: HostHttpRequest): Promise<HostHttpResponse>;
  };
  notifications: {
    emit(event: HostNotification): Promise<void>;
  };
  storage: {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<void>;
  };
  audit: {
    annotate(metadata: ModuleAuditMetadata): Promise<void>;
  };
}

export type ModuleRequest<TBody = unknown> = Omit<ModuleInvocationRequestDocument, 'body'> & {
  body?: TBody;
};

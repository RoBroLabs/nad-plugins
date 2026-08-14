import type {
  CapabilityName,
  ChecksumsFile,
  ConfigFieldType,
  DeclarativePage,
  DeclarativeWidget,
  EntrypointDeclaration,
  ModuleManifest,
  PagesFile,
  ReleaseMetadata,
  ReleaseRecord,
  SignatureFile,
  UiElement,
  ValidationIssue,
  ValidationResult,
  WidgetsFile,
} from './types.js';
import { canonicalSchemaIssues, matchesCanonicalSchema } from './schema-validation.js';

const slugPattern = /^[a-z0-9][a-z0-9-]{0,63}$/;
const moduleIdPattern = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/;
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:[-+][0-9A-Za-z.-]+)?$/;
const actionPattern = /^[a-z][a-z0-9]*(?:[.:_-][a-z0-9]+)*$/;
const endpointPattern = /^[a-z0-9][a-z0-9/-]{0,127}$/;
const handlerPattern = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const allowedCategories = new Set(['servers', 'media', 'games', 'network', 'tools', 'automation', 'monitoring', 'custom']);
const allowedMethods = new Set(['GET', 'POST', 'PUT', 'DELETE']);
const packageControlledForbiddenHeaders = new Set([
  'authorization', 'connection', 'content-length', 'cookie', 'expect', 'forwarded',
  'host', 'proxy-authenticate', 'proxy-authorization', 'set-cookie', 'trailer',
  'transfer-encoding', 'upgrade', 'via', 'x-forwarded-for', 'x-forwarded-host',
  'x-forwarded-proto', 'x-real-ip',
]);
const injectedForbiddenHeaders = new Set([
  'connection', 'content-length', 'cookie', 'expect', 'forwarded', 'host',
  'proxy-authenticate', 'proxy-authorization', 'set-cookie', 'trailer',
  'transfer-encoding', 'upgrade', 'via', 'x-forwarded-for', 'x-forwarded-host',
  'x-forwarded-proto', 'x-real-ip',
]);
const allowedKinds = new Set(['query', 'mutation']);
const allowedTimeouts = new Set(['short', 'standard', 'action']);
const allowedRisks = new Set(['read', 'write', 'admin']);
const allowedFieldTypes = new Set(['text', 'url', 'secret', 'number', 'boolean', 'select']);
const allowedCapabilities = new Set<CapabilityName>([
  'config.get',
  'http.request',
  'notifications.emit',
  'storage.get',
  'storage.set',
  'storage.delete',
  'audit.annotate',
]);
const maxHttpAccessScopes = 32;
const maxHttpAccessPathLength = 2048;
const allowedHttpAccessSchemes = new Set(['http', 'https']);
const allowedHttpAccessFields = new Set([
  'scheme',
  'hostConfig',
  'port',
  'portConfig',
  'path',
  'methods',
  'effect',
  'requestBodyPolicy',
  'allowedHeaders',
  'queryParameters',
  'pathParameters',
  'credential',
  'tlsVerifyConfig',
]);
const pathParameterPattern = /\{([A-Za-z][A-Za-z0-9_]{0,31})\}/g;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function issue(issues: ValidationIssue[], path: string, message: string): void {
  issues.push({ path, message });
}

function stringField(
  issues: ValidationIssue[],
  value: Record<string, unknown>,
  path: string,
  key: string,
  maxLength: number,
): string {
  const field = value[key];
  if (typeof field !== 'string' || field.trim() === '') {
    issue(issues, `${path}.${key}`, 'must be a non-empty string');
    return '';
  }
  if (field.length > maxLength) issue(issues, `${path}.${key}`, `must be ${maxLength} characters or fewer`);
  return field;
}

function integerField(
  issues: ValidationIssue[],
  value: Record<string, unknown>,
  path: string,
  key: string,
  min: number,
  max: number,
): number {
  const field = value[key];
  if (typeof field !== 'number' || !Number.isInteger(field)) {
    issue(issues, `${path}.${key}`, 'must be an integer');
    return 0;
  }
  if (field < min || field > max) issue(issues, `${path}.${key}`, `must be between ${min} and ${max}`);
  return field;
}

function validateEndpointSchemaPath(issues: ValidationIssue[], path: string, value: string): void {
  if (!/^schemas\/endpoints\/[a-z0-9][a-z0-9-]*\.json$/.test(value)) {
    issue(issues, path, 'must reference schemas/endpoints/<name>.json');
  }
}

function validateConfigSchema(
  issues: ValidationIssue[],
  manifest: Record<string, unknown>,
): Map<string, ConfigFieldType> {
  const fieldTypes = new Map<string, ConfigFieldType>();
  if (!Array.isArray(manifest.configSchema)) {
    issue(issues, 'manifest.configSchema', 'must be an array');
    return fieldTypes;
  }

  const keys = new Set<string>();
  manifest.configSchema.forEach((field, index) => {
    const path = `manifest.configSchema[${index}]`;
    if (!isRecord(field)) {
      issue(issues, path, 'must be an object');
      return;
    }
    const key = stringField(issues, field, path, 'key', 64);
    if (key && !slugPattern.test(key.replaceAll('_', '-'))) issue(issues, `${path}.key`, 'must be snake_case/kebab-case compatible');
    if (keys.has(key)) issue(issues, `${path}.key`, 'must be unique');
    keys.add(key);
    stringField(issues, field, path, 'label', 80);
    if (typeof field.type !== 'string' || !allowedFieldTypes.has(field.type)) {
      issue(issues, `${path}.type`, 'has unsupported field type');
    } else if (key) {
      fieldTypes.set(key, field.type as ConfigFieldType);
    }
    if (typeof field.required !== 'boolean') issue(issues, `${path}.required`, 'must be a boolean');
    if (field.type === 'select') {
      if (!Array.isArray(field.options) || field.options.length === 0) {
        issue(issues, `${path}.options`, 'select fields require options');
      }
    }
  });
  return fieldTypes;
}

function validateHttpAccess(
  issues: ValidationIssue[],
  value: unknown,
  hasHttpRequestCapability: boolean,
  configFieldTypes: ReadonlyMap<string, ConfigFieldType>,
): void {
  if (!hasHttpRequestCapability) {
    if (value !== undefined) {
      issue(issues, 'manifest.httpAccess', 'must be omitted unless the http.request capability is declared');
    }
    return;
  }
  if (!Array.isArray(value)) {
    issue(issues, 'manifest.httpAccess', 'must be an array when the http.request capability is declared');
    return;
  }
  if (value.length === 0) {
    issue(issues, 'manifest.httpAccess', 'must declare at least one scope for the http.request capability');
  }
  if (value.length > maxHttpAccessScopes) {
    issue(issues, 'manifest.httpAccess', `must declare no more than ${maxHttpAccessScopes} scopes`);
  }

  const scopes = new Set<string>();
  value.forEach((scope, index) => {
    const path = `manifest.httpAccess[${index}]`;
    if (!isRecord(scope)) {
      issue(issues, path, 'must be an object');
      return;
    }
    for (const key of Object.keys(scope)) {
      if (!allowedHttpAccessFields.has(key)) issue(issues, `${path}.${key}`, 'is not allowed');
    }

    if (typeof scope.scheme !== 'string' || !allowedHttpAccessSchemes.has(scope.scheme)) {
      issue(issues, `${path}.scheme`, 'must be http or https');
    }
    const hostConfig = stringField(issues, scope, path, 'hostConfig', 64);
    if (hostConfig) {
      const hostConfigType = configFieldTypes.get(hostConfig);
      if (hostConfigType === undefined) {
        issue(issues, `${path}.hostConfig`, 'must reference a declared config field');
      } else if (hostConfigType !== 'text' && hostConfigType !== 'url') {
        issue(issues, `${path}.hostConfig`, 'must reference a non-secret text or URL config field');
      }
    }

    const hasPort = scope.port !== undefined;
    const hasPortConfig = scope.portConfig !== undefined;
    if (hasPort && hasPortConfig) {
      issue(issues, path, 'must not declare both port and portConfig');
    } else if (!hasPort && !hasPortConfig) {
      if (configFieldTypes.get(hostConfig) !== 'url') {
        issue(issues, path, 'may derive the port only when hostConfig references a URL field');
      }
    } else if (hasPort) {
      integerField(issues, scope, path, 'port', 1, 65_535);
    } else {
      const portConfig = stringField(issues, scope, path, 'portConfig', 64);
      if (portConfig) {
        const portConfigType = configFieldTypes.get(portConfig);
        if (portConfigType === undefined) {
          issue(issues, `${path}.portConfig`, 'must reference a declared config field');
        } else if (portConfigType !== 'number') {
          issue(issues, `${path}.portConfig`, 'must reference a number config field');
        }
      }
    }

    const exactPath = stringField(issues, scope, path, 'path', maxHttpAccessPathLength);
    if (exactPath && !exactPath.startsWith('/')) {
      issue(issues, `${path}.path`, 'must begin with /');
    }
    if (exactPath && /[?#]/.test(exactPath)) {
      issue(issues, `${path}.path`, 'must not contain a query string or fragment');
    }

    const declaredPathParameters = new Set<string>();
    if (scope.pathParameters !== undefined) {
      if (!isRecord(scope.pathParameters)) {
        issue(issues, `${path}.pathParameters`, 'must be an object');
      } else {
        for (const [name, kind] of Object.entries(scope.pathParameters)) {
          declaredPathParameters.add(name);
          if (kind !== 'segment' && kind !== 'integer') {
            issue(issues, `${path}.pathParameters.${name}`, 'must be segment or integer');
          }
        }
      }
    }
    const referencedPathParameters = new Set(
      [...exactPath.matchAll(pathParameterPattern)]
        .map((match) => match[1])
        .filter((name): name is string => name !== undefined),
    );
    for (const name of referencedPathParameters) {
      if (!declaredPathParameters.has(name)) issue(issues, `${path}.pathParameters`, `must declare {${name}}`);
    }
    for (const name of declaredPathParameters) {
      if (!referencedPathParameters.has(name)) issue(issues, `${path}.pathParameters.${name}`, 'is not used by path');
    }

    const validateStringList = (field: 'allowedHeaders' | 'queryParameters', maximum: number): void => {
      const entries = scope[field];
      if (entries === undefined) return;
      if (!Array.isArray(entries)) {
        issue(issues, `${path}.${field}`, 'must be an array');
        return;
      }
      if (entries.length > maximum) issue(issues, `${path}.${field}`, `must contain no more than ${maximum} entries`);
      const normalized = new Set<string>();
      entries.forEach((entry, entryIndex) => {
        if (typeof entry !== 'string' || !entry) {
          issue(issues, `${path}.${field}[${entryIndex}]`, 'must be a non-empty string');
          return;
        }
        const key = field === 'allowedHeaders' ? entry.toLowerCase() : entry;
        if (field === 'allowedHeaders' && packageControlledForbiddenHeaders.has(key)) {
          issue(issues, `${path}.${field}[${entryIndex}]`, 'is a broker-controlled or unsafe header');
        }
        if (normalized.has(key)) issue(issues, `${path}.${field}[${entryIndex}]`, 'must be unique');
        normalized.add(key);
      });
    };
    validateStringList('allowedHeaders', 8);
    validateStringList('queryParameters', 16);

    if (scope.tlsVerifyConfig !== undefined) {
      if (typeof scope.tlsVerifyConfig !== 'string' || configFieldTypes.get(scope.tlsVerifyConfig) !== 'boolean') {
        issue(issues, `${path}.tlsVerifyConfig`, 'must reference a boolean config field');
      }
      if (scope.scheme !== 'https') issue(issues, `${path}.tlsVerifyConfig`, 'is allowed only for HTTPS scopes');
    }

    if (scope.credential !== undefined) {
      if (!isRecord(scope.credential)) {
        issue(issues, `${path}.credential`, 'must be an object');
      } else {
        const credentialConfig = stringField(issues, scope.credential, `${path}.credential`, 'config', 64);
        if (credentialConfig && configFieldTypes.get(credentialConfig) !== 'secret') {
          issue(issues, `${path}.credential.config`, 'must reference a secret config field');
        }
        if (!['header', 'query', 'json-body'].includes(String(scope.credential.location))) {
          issue(issues, `${path}.credential.location`, 'must be header, query, or json-body');
        }
        stringField(issues, scope.credential, `${path}.credential`, 'name', 80);
        if (
          scope.credential.location === 'header'
          && typeof scope.credential.name === 'string'
          && injectedForbiddenHeaders.has(scope.credential.name.toLowerCase())
        ) {
          issue(issues, `${path}.credential.name`, 'is a broker-controlled or unsafe header');
        }
        if (scope.credential.publicConfig !== undefined) {
          if (
            typeof scope.credential.publicConfig !== 'string'
            || !['text', 'url', 'number'].includes(String(configFieldTypes.get(scope.credential.publicConfig)))
          ) {
            issue(issues, `${path}.credential.publicConfig`, 'must reference a non-secret text, URL, or number config field');
          }
        }
      }
    }

    const methods: string[] = [];
    if (!Array.isArray(scope.methods) || scope.methods.length === 0) {
      issue(issues, `${path}.methods`, 'must be a non-empty array');
    } else {
      if (scope.methods.length > allowedMethods.size) {
        issue(issues, `${path}.methods`, `must contain no more than ${allowedMethods.size} methods`);
      }
      const seenMethods = new Set<string>();
      scope.methods.forEach((method, methodIndex) => {
        const methodPath = `${path}.methods[${methodIndex}]`;
        if (typeof method !== 'string' || !allowedMethods.has(method)) {
          issue(issues, methodPath, 'has unsupported method');
          return;
        }
        if (seenMethods.has(method)) issue(issues, methodPath, 'must be unique within the scope');
        seenMethods.add(method);
        methods.push(method);
      });
    }
    if (scope.effect !== undefined && scope.effect !== 'read' && scope.effect !== 'write') {
      issue(issues, `${path}.effect`, 'must be read or write');
    }
    if (scope.effect === 'read' && methods.includes('PUT')) {
      issue(issues, `${path}.effect`, 'read scopes must not allow PUT');
    }
    if (
      scope.requestBodyPolicy !== undefined
      && !['graphql-query', 'credential-only', 'session-cleanup'].includes(String(scope.requestBodyPolicy))
    ) {
      issue(issues, `${path}.requestBodyPolicy`, 'has an unsupported request-body policy');
    }
    if (scope.effect === 'read' && methods.includes('POST') && !['graphql-query', 'credential-only'].includes(String(scope.requestBodyPolicy))) {
      issue(issues, `${path}.requestBodyPolicy`, 'read-effect POST scopes require graphql-query or credential-only');
    }
    if (scope.effect === 'read' && methods.includes('DELETE') && scope.requestBodyPolicy !== 'session-cleanup') {
      issue(issues, `${path}.requestBodyPolicy`, 'read-effect DELETE scopes require session-cleanup');
    }
    if (scope.requestBodyPolicy === 'graphql-query' && (!methods.includes('POST') || scope.effect !== 'read')) {
      issue(issues, `${path}.requestBodyPolicy`, 'graphql-query requires a read-effect POST scope');
    }
    if (
      scope.requestBodyPolicy === 'credential-only'
      && (
        !methods.includes('POST')
        || scope.effect !== 'read'
        || !isRecord(scope.credential)
        || scope.credential.location !== 'json-body'
      )
    ) {
      issue(issues, `${path}.requestBodyPolicy`, 'credential-only requires read-effect POST with JSON-body credential injection');
    }
    if (scope.requestBodyPolicy === 'session-cleanup' && (!methods.includes('DELETE') || scope.effect !== 'read')) {
      issue(issues, `${path}.requestBodyPolicy`, 'session-cleanup requires a read-effect DELETE scope');
    }

    if (
      typeof scope.scheme === 'string'
      && hostConfig
      && exactPath
      && methods.length > 0
    ) {
      const port = typeof scope.port === 'number'
        ? `port:${scope.port}`
        : typeof scope.portConfig === 'string'
          ? `portConfig:${scope.portConfig}`
          : 'url-port';
      const scopeKey = JSON.stringify([
        scope.scheme,
        hostConfig,
        port,
        exactPath,
        [...methods].sort(),
        scope.effect,
        scope.requestBodyPolicy,
        scope.pathParameters,
        scope.queryParameters,
        scope.allowedHeaders,
        scope.credential,
        scope.tlsVerifyConfig,
      ]);
      if (scopes.has(scopeKey)) issue(issues, path, 'must be unique');
      scopes.add(scopeKey);
    }
  });
}

function validateEntrypoint(
  issues: ValidationIssue[],
  key: string,
  value: unknown,
  permissions: Set<string>,
): void {
  const path = `manifest.entrypoints.${key}`;
  if (!endpointPattern.test(key)) issue(issues, path, 'has an invalid endpoint key');
  if (!isRecord(value)) {
    issue(issues, path, 'must be an object');
    return;
  }

  if (typeof value.method !== 'string' || !allowedMethods.has(value.method)) issue(issues, `${path}.method`, 'has unsupported method');
  if (typeof value.kind !== 'string' || !allowedKinds.has(value.kind)) issue(issues, `${path}.kind`, 'must be query or mutation');
  const permission = stringField(issues, value, path, 'permission', 80);
  if (permission && !permissions.has(permission)) issue(issues, `${path}.permission`, 'must reference a declared permission');
  const handler = stringField(issues, value, path, 'handler', 80);
  if (handler && !handlerPattern.test(handler)) issue(issues, `${path}.handler`, 'must be a JavaScript identifier');
  const requestSchema = stringField(issues, value, path, 'requestSchema', 160);
  const responseSchema = stringField(issues, value, path, 'responseSchema', 160);
  validateEndpointSchemaPath(issues, `${path}.requestSchema`, requestSchema);
  validateEndpointSchemaPath(issues, `${path}.responseSchema`, responseSchema);
  if (typeof value.timeoutClass !== 'string' || !allowedTimeouts.has(value.timeoutClass)) issue(issues, `${path}.timeoutClass`, 'has unsupported timeout class');
  integerField(issues, value, path, 'maxRequestBytes', 0, 64 * 1024);
  integerField(issues, value, path, 'maxResponseBytes', 1, 512 * 1024);
  if (value.kind === 'mutation' && typeof value.auditAction !== 'string') {
    issue(issues, `${path}.auditAction`, 'is required for mutations');
  }
  if (value.kind === 'mutation' && value.method === 'GET') {
    issue(issues, `${path}.method`, 'mutations must not use GET');
  }
  if (value.kind === 'query' && value.auditAction !== undefined) {
    issue(issues, `${path}.auditAction`, 'is only allowed for mutations');
  }
}

function configDefaultMatches(type: ConfigFieldType, value: unknown): boolean {
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'boolean') return typeof value === 'boolean';
  return typeof value === 'string';
}

function validateDataMigrations(
  issues: ValidationIssue[],
  value: unknown,
  manifestVersion: string,
  configFieldTypes: ReadonlyMap<string, ConfigFieldType>,
): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    issue(issues, 'manifest.dataMigrations', 'must be an array');
    return;
  }
  const routes = new Set<string>();
  value.forEach((candidate, migrationIndex) => {
    const path = `manifest.dataMigrations[${migrationIndex}]`;
    if (!isRecord(candidate)) return;
    if (candidate.toVersion !== manifestVersion) {
      issue(issues, `${path}.toVersion`, 'must equal manifest.version');
    }
    if (candidate.fromVersion === candidate.toVersion) {
      issue(issues, path, 'must migrate between different versions');
    }
    if (typeof candidate.fromVersion === 'string' && typeof candidate.toVersion === 'string') {
      const route = `${candidate.fromVersion}->${candidate.toVersion}`;
      if (routes.has(route)) issue(issues, path, 'must be unique');
      routes.add(route);
    }
    const validateOperations = (operations: unknown, scope: 'config' | 'storage'): void => {
      if (!Array.isArray(operations)) return;
      operations.forEach((operation, operationIndex) => {
        if (!isRecord(operation)) return;
        const operationPath = `${path}.${scope}[${operationIndex}]`;
        if (operation.op === 'rename') {
          if (operation.from === operation.to) issue(issues, operationPath, 'rename source and destination must differ');
          if (scope === 'config' && typeof operation.to === 'string' && !configFieldTypes.has(operation.to)) {
            issue(issues, `${operationPath}.to`, 'must reference a field in the new config schema');
          }
        }
        if (operation.op === 'setDefault') {
          if (scope === 'config' && typeof operation.key === 'string') {
            const fieldType = configFieldTypes.get(operation.key);
            if (!fieldType) issue(issues, `${operationPath}.key`, 'must reference a field in the new config schema');
            else if (fieldType === 'secret') issue(issues, operationPath, 'must not embed a secret default');
            else if (!configDefaultMatches(fieldType, operation.value)) issue(issues, `${operationPath}.value`, `must match ${fieldType} config type`);
          }
          try {
            const encoded = JSON.stringify(operation.value);
            if (encoded === undefined || Buffer.byteLength(encoded, 'utf8') > 64 * 1024) {
              issue(issues, `${operationPath}.value`, 'must be JSON serialisable and no larger than 64 KiB');
            }
          } catch {
            issue(issues, `${operationPath}.value`, 'must be JSON serialisable');
          }
        }
      });
    };
    validateOperations(candidate.config, 'config');
    validateOperations(candidate.storage, 'storage');
  });
}

export function validateManifest(value: unknown): ValidationResult {
  const issues: ValidationIssue[] = canonicalSchemaIssues('manifest', value);
  const warnings: string[] = [];

  if (!isRecord(value)) return { valid: false, issues: [{ path: 'manifest', message: 'must be an object' }], warnings };
  if (value.schemaVersion !== 1) issue(issues, 'manifest.schemaVersion', 'must be 1');
  const id = stringField(issues, value, 'manifest', 'id', 120);
  if (id && !moduleIdPattern.test(id)) issue(issues, 'manifest.id', 'must be an immutable reverse-DNS ID');
  const slug = stringField(issues, value, 'manifest', 'slug', 64);
  if (slug && !slugPattern.test(slug)) issue(issues, 'manifest.slug', 'must be kebab-case');
  stringField(issues, value, 'manifest', 'name', 80);
  stringField(issues, value, 'manifest', 'description', 300);
  stringField(issues, value, 'manifest', 'icon', 64);
  if (typeof value.category !== 'string' || !allowedCategories.has(value.category)) issue(issues, 'manifest.category', 'has unsupported category');
  const version = stringField(issues, value, 'manifest', 'version', 40);
  if (version && !semverPattern.test(version)) issue(issues, 'manifest.version', 'must be SemVer');
  stringField(issues, value, 'manifest', 'publisher', 80);

  if (!isRecord(value.compatibility)) {
    issue(issues, 'manifest.compatibility', 'must be an object');
  } else {
    stringField(issues, value.compatibility, 'manifest.compatibility', 'core', 80);
    stringField(issues, value.compatibility, 'manifest.compatibility', 'hostApi', 20);
    stringField(issues, value.compatibility, 'manifest.compatibility', 'uiApi', 20);
  }

  const capabilityNames = new Set<string>();
  if (!Array.isArray(value.capabilities) || value.capabilities.length === 0) {
    issue(issues, 'manifest.capabilities', 'must declare at least one capability');
  } else {
    value.capabilities.forEach((capability, index) => {
      const path = `manifest.capabilities[${index}]`;
      if (!isRecord(capability)) {
        issue(issues, path, 'must be an object');
        return;
      }
      const name = stringField(issues, capability, path, 'name', 80);
      if (name && !allowedCapabilities.has(name as CapabilityName)) issue(issues, `${path}.name`, 'has unsupported capability');
      if (capabilityNames.has(name)) issue(issues, `${path}.name`, 'must be unique');
      capabilityNames.add(name);
      stringField(issues, capability, path, 'reason', 200);
    });
  }

  const permissionActions = new Set<string>();
  if (!Array.isArray(value.permissions) || value.permissions.length === 0) {
    issue(issues, 'manifest.permissions', 'must declare at least one permission');
  } else {
    value.permissions.forEach((permission, index) => {
      const path = `manifest.permissions[${index}]`;
      if (!isRecord(permission)) {
        issue(issues, path, 'must be an object');
        return;
      }
      const action = stringField(issues, permission, path, 'action', 80);
      if (action && !actionPattern.test(action)) issue(issues, `${path}.action`, 'has invalid action syntax');
      if (permissionActions.has(action)) issue(issues, `${path}.action`, 'must be unique');
      permissionActions.add(action);
      stringField(issues, permission, path, 'label', 80);
      if (typeof permission.risk !== 'string' || !allowedRisks.has(permission.risk)) issue(issues, `${path}.risk`, 'has unsupported risk');
    });
  }
  if (!permissionActions.has('view')) warnings.push('manifest.permissions should include a view permission for Module visibility.');

  const configFieldTypes = validateConfigSchema(issues, value);
  validateHttpAccess(issues, value.httpAccess, capabilityNames.has('http.request'), configFieldTypes);
  validateDataMigrations(issues, value.dataMigrations, version, configFieldTypes);

  if (!isRecord(value.entrypoints) || Object.keys(value.entrypoints).length === 0) {
    issue(issues, 'manifest.entrypoints', 'must declare at least one endpoint');
  } else {
    for (const [key, entrypoint] of Object.entries(value.entrypoints)) {
      validateEntrypoint(issues, key, entrypoint, permissionActions);
    }
  }

  return { valid: issues.length === 0, issues, warnings };
}

function validateGridSize(issues: ValidationIssue[], path: string, value: unknown): void {
  if (!isRecord(value)) {
    issue(issues, path, 'must be an object');
    return;
  }
  integerField(issues, value, path, 'w', 1, 12);
  integerField(issues, value, path, 'h', 1, 24);
}

function validateSource(issues: ValidationIssue[], path: string, value: unknown, entrypoints: Set<string>): void {
  if (!isRecord(value)) {
    issue(issues, path, 'must be an object');
    return;
  }
  const endpoint = stringField(issues, value, path, 'endpoint', 128);
  if (endpoint && !entrypoints.has(endpoint)) issue(issues, `${path}.endpoint`, 'must reference a declared entrypoint');
  if (value.refreshIntervalMs !== undefined) integerField(issues, value, path, 'refreshIntervalMs', 1000, 3_600_000);
}

function validateUiElement(issues: ValidationIssue[], path: string, value: unknown): void {
  if (!isRecord(value)) {
    issue(issues, path, 'must be an object');
    return;
  }
  if (typeof value.type !== 'string') {
    issue(issues, `${path}.type`, 'must be a string');
    return;
  }
  if (value.type === 'section') {
    if (!Array.isArray(value.body)) issue(issues, `${path}.body`, 'must be an array');
    else value.body.forEach((child, index) => validateUiElement(issues, `${path}.body[${index}]`, child));
    return;
  }
  if (value.type === 'metric' || value.type === 'status') {
    stringField(issues, value, path, 'label', 80);
    stringField(issues, value, path, 'valuePath', 120);
    return;
  }
  if (value.type === 'text') {
    if (typeof value.value !== 'string' && typeof value.valuePath !== 'string') {
      issue(issues, path, 'text requires value or valuePath');
    }
    return;
  }
  if (value.type === 'keyValue') {
    if (!Array.isArray(value.items) || value.items.length === 0) issue(issues, `${path}.items`, 'must be a non-empty array');
    return;
  }
  if (value.type === 'table') {
    stringField(issues, value, path, 'rowsPath', 120);
    if (!Array.isArray(value.columns) || value.columns.length === 0) issue(issues, `${path}.columns`, 'must be a non-empty array');
    return;
  }
  issue(issues, `${path}.type`, 'has unsupported UI element type');
}

function validateWidget(issues: ValidationIssue[], widget: DeclarativeWidget | unknown, index: number, entrypoints: Set<string>): void {
  const path = `widgets.widgets[${index}]`;
  if (!isRecord(widget)) {
    issue(issues, path, 'must be an object');
    return;
  }
  const id = stringField(issues, widget, path, 'id', 64);
  if (id && !slugPattern.test(id)) issue(issues, `${path}.id`, 'must be kebab-case');
  stringField(issues, widget, path, 'name', 80);
  stringField(issues, widget, path, 'description', 200);
  validateGridSize(issues, `${path}.defaultSize`, widget.defaultSize);
  if (widget.minSize !== undefined) validateGridSize(issues, `${path}.minSize`, widget.minSize);
  if (widget.maxSize !== undefined) validateGridSize(issues, `${path}.maxSize`, widget.maxSize);
  validateSource(issues, `${path}.source`, widget.source, entrypoints);
  if (!Array.isArray(widget.body) || widget.body.length === 0) issue(issues, `${path}.body`, 'must be a non-empty array');
  else widget.body.forEach((element, elementIndex) => validateUiElement(issues, `${path}.body[${elementIndex}]`, element));
}

function validatePage(issues: ValidationIssue[], page: DeclarativePage | unknown, index: number, entrypoints: Set<string>): void {
  const path = `pages.pages[${index}]`;
  if (!isRecord(page)) {
    issue(issues, path, 'must be an object');
    return;
  }
  if (page.path !== '/') issue(issues, `${path}.path`, 'must be / in UI v1');
  stringField(issues, page, path, 'title', 80);
  if (page.source !== undefined) validateSource(issues, `${path}.source`, page.source, entrypoints);
  if (!Array.isArray(page.body) || page.body.length === 0) issue(issues, `${path}.body`, 'must be a non-empty array');
  else page.body.forEach((element, elementIndex) => validateUiElement(issues, `${path}.body[${elementIndex}]`, element));
}

export function validateUiFiles(
  widgets: unknown,
  pages: unknown,
  manifest: ModuleManifest,
): ValidationResult {
  const issues: ValidationIssue[] = [
    ...canonicalSchemaIssues('widgets', widgets),
    ...canonicalSchemaIssues('pages', pages),
  ];
  const entrypoints = new Set(Object.keys(manifest.entrypoints));
  if (!isRecord(widgets) || widgets.schemaVersion !== 1 || !Array.isArray(widgets.widgets)) {
    issue(issues, 'widgets', 'must be a schemaVersion 1 widgets file');
  } else {
    widgets.widgets.forEach((widget, index) => validateWidget(issues, widget, index, entrypoints));
  }
  if (!isRecord(pages) || pages.schemaVersion !== 1 || !Array.isArray(pages.pages)) {
    issue(issues, 'pages', 'must be a schemaVersion 1 pages file');
  } else {
    pages.pages.forEach((page, index) => validatePage(issues, page, index, entrypoints));
  }
  return { valid: issues.length === 0, issues, warnings: [] };
}

export function validateChecksums(value: unknown): value is ChecksumsFile {
  return matchesCanonicalSchema('checksums', value);
}

export function validateSignature(value: unknown): value is SignatureFile {
  return matchesCanonicalSchema('signature', value);
}

function endpointSchemaSemanticIssues(value: unknown, path: string, depth = 0): ValidationIssue[] {
  if (!isRecord(value)) return [];
  const issues: ValidationIssue[] = [];
  if (depth > 20) {
    issue(issues, path, 'must not be nested more than 20 levels');
    return issues;
  }
  if (typeof value.pattern === 'string') {
    try {
      new RegExp(value.pattern);
    } catch {
      issue(issues, `${path}.pattern`, 'must be a valid JavaScript regular expression');
    }
  }
  if (typeof value.minimum === 'number' && typeof value.maximum === 'number' && value.minimum > value.maximum) {
    issue(issues, path, 'minimum must not exceed maximum');
  }
  if (typeof value.minLength === 'number' && typeof value.maxLength === 'number' && value.minLength > value.maxLength) {
    issue(issues, path, 'minLength must not exceed maxLength');
  }
  if (typeof value.minItems === 'number' && typeof value.maxItems === 'number' && value.minItems > value.maxItems) {
    issue(issues, path, 'minItems must not exceed maxItems');
  }
  if (typeof value.minProperties === 'number' && typeof value.maxProperties === 'number' && value.minProperties > value.maxProperties) {
    issue(issues, path, 'minProperties must not exceed maxProperties');
  }
  if (isRecord(value.properties)) {
    for (const [name, child] of Object.entries(value.properties)) {
      issues.push(...endpointSchemaSemanticIssues(child, `${path}.properties.${name}`, depth + 1));
    }
  }
  if (isRecord(value.items)) {
    issues.push(...endpointSchemaSemanticIssues(value.items, `${path}.items`, depth + 1));
  }
  return issues;
}

export function validateEndpointSchema(value: unknown): ValidationResult {
  const issues = [
    ...canonicalSchemaIssues('endpointSchema', value),
    ...endpointSchemaSemanticIssues(value, 'endpointSchema'),
  ];
  return { valid: issues.length === 0, issues, warnings: [] };
}

export function validateReleaseMetadata(value: unknown): value is ReleaseMetadata {
  return matchesCanonicalSchema('releaseMetadata', value);
}

export function validateReleaseRecord(value: unknown): value is ReleaseRecord {
  return matchesCanonicalSchema('releaseRecord', value);
}

export function assertValidManifest(value: unknown): ModuleManifest {
  const result = validateManifest(value);
  if (!result.valid) {
    throw new Error(result.issues.map(({ path, message }) => `${path}: ${message}`).join('\n'));
  }
  return value as ModuleManifest;
}

export function assertValidUiFiles(widgets: unknown, pages: unknown, manifest: ModuleManifest): {
  widgets: WidgetsFile;
  pages: PagesFile;
} {
  const result = validateUiFiles(widgets, pages, manifest);
  if (!result.valid) {
    throw new Error(result.issues.map(({ path, message }) => `${path}: ${message}`).join('\n'));
  }
  return { widgets: widgets as WidgetsFile, pages: pages as PagesFile };
}

export function forbiddenServerImportIssues(serverSource: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const importPattern = /\bimport\s*(?:[^'"()]*?\sfrom\s*)?["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const match of serverSource.matchAll(importPattern)) {
    const specifier = match[1] ?? match[2] ?? '';
    if (
      specifier.startsWith('node:')
      || specifier.startsWith('npm:')
      || specifier.startsWith('jsr:')
      || specifier.startsWith('http:')
      || specifier.startsWith('https:')
      || specifier.startsWith('file:')
      || specifier.startsWith('.')
      || specifier.startsWith('/')
    ) {
      issue(issues, 'server/main.js', `runtime import is forbidden: ${specifier}`);
    }
  }
  return issues;
}

import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import { contractSchemas } from './generated/v1/index.js';
import type { ValidationIssue } from './types.js';

export type CanonicalDocument =
  | 'manifest'
  | 'pages'
  | 'widgets'
  | 'checksums'
  | 'signature'
  | 'endpointSchema'
  | 'hostCall'
  | 'hostHttpResponse'
  | 'secretReference'
  | 'releaseMetadata'
  | 'releaseRecord';

const schemaFile: Record<CanonicalDocument, keyof typeof contractSchemas> = {
  manifest: 'manifest.schema.json',
  pages: 'ui-pages.schema.json',
  widgets: 'ui-widgets.schema.json',
  checksums: 'checksums.schema.json',
  signature: 'signature.schema.json',
  endpointSchema: 'endpoint-schema.v1.schema.json',
  hostCall: 'host-call.schema.json',
  hostHttpResponse: 'host-http-response.schema.json',
  secretReference: 'secret-reference.schema.json',
  releaseMetadata: 'release-metadata.schema.json',
  releaseRecord: 'release-record.schema.json',
};

const ajv = new Ajv2020({
  allErrors: true,
  allowUnionTypes: true,
  strict: true,
  strictRequired: false,
});
for (const schema of Object.values(contractSchemas)) ajv.addSchema(schema);

const validators = Object.fromEntries(
  Object.entries(schemaFile).map(([document, file]) => {
    const schema = contractSchemas[file];
    const validator = ajv.getSchema(schema.$id);
    if (!validator) throw new Error(`Canonical schema validator is unavailable for ${file}.`);
    return [document, validator];
  }),
) as Record<CanonicalDocument, ValidateFunction>;

function pointerPath(root: CanonicalDocument, pointer: string): string {
  if (!pointer) return root;
  const parts = pointer.slice(1).split('/').map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'));
  return parts.reduce((path, part) => /^\d+$/.test(part) ? `${path}[${part}]` : `${path}.${part}`, root);
}

function issueFromError(root: CanonicalDocument, error: ErrorObject): ValidationIssue {
  let path = pointerPath(root, error.instancePath);
  if (error.keyword === 'required' && typeof error.params.missingProperty === 'string') {
    path = `${path}.${error.params.missingProperty}`;
  }
  const message = error.message ?? `failed ${error.keyword} validation`;
  return { path, message };
}

export function canonicalSchemaIssues(document: CanonicalDocument, value: unknown): ValidationIssue[] {
  const validator = validators[document];
  return validator(value) ? [] : (validator.errors ?? []).map((error) => issueFromError(document, error));
}

export function matchesCanonicalSchema(document: CanonicalDocument, value: unknown): boolean {
  return validators[document](value) as boolean;
}

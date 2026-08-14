import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import { contractV2Schemas } from './generated/v2/index.js';
import type { ValidationIssue } from './types.js';

export type CanonicalV2Document =
  | 'manifest'
  | 'operation'
  | 'connectionSchema'
  | 'httpAccess'
  | 'surfaces'
  | 'bridgeConnect'
  | 'bridgeMessage'
  | 'invocationRequest'
  | 'hostCall'
  | 'hostResponse'
  | 'releaseRecord'
  | 'reviewAttestation'
  | 'collection';

const schemaFile: Record<CanonicalV2Document, keyof typeof contractV2Schemas> = {
  manifest: 'manifest.v2.schema.json',
  operation: 'operation.v2.schema.json',
  connectionSchema: 'connection-schema.v2.schema.json',
  httpAccess: 'http-access.v2.schema.json',
  surfaces: 'ui-surfaces.v2.schema.json',
  bridgeConnect: 'ui-bridge-connect.v2.schema.json',
  bridgeMessage: 'ui-bridge-message.v2.schema.json',
  invocationRequest: 'invocation-request.v2.schema.json',
  hostCall: 'host-call.v2.schema.json',
  hostResponse: 'host-response.v2.schema.json',
  releaseRecord: 'release-record.v2.schema.json',
  reviewAttestation: 'review-attestation.v1.schema.json',
  collection: 'collection.v1.schema.json',
};

const ajv = new Ajv2020({
  allErrors: true,
  allowUnionTypes: true,
  strict: true,
  strictRequired: false,
});
for (const schema of Object.values(contractV2Schemas)) ajv.addSchema(schema);

const validators = Object.fromEntries(
  Object.entries(schemaFile).map(([document, file]) => {
    const schema = contractV2Schemas[file];
    const validator = ajv.getSchema(schema.$id);
    if (!validator) throw new Error(`Canonical v2 schema validator is unavailable for ${file}.`);
    return [document, validator];
  }),
) as Record<CanonicalV2Document, ValidateFunction>;

function pointerPath(root: CanonicalV2Document, pointer: string): string {
  if (!pointer) return root;
  const parts = pointer.slice(1).split('/').map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'));
  return parts.reduce((path, part) => /^\d+$/.test(part) ? `${path}[${part}]` : `${path}.${part}`, root);
}

function issueFromError(root: CanonicalV2Document, error: ErrorObject): ValidationIssue {
  let path = pointerPath(root, error.instancePath);
  if (error.keyword === 'required' && typeof error.params.missingProperty === 'string') {
    path = `${path}.${error.params.missingProperty}`;
  }
  return { path, message: error.message ?? `failed ${error.keyword} validation` };
}

export function canonicalV2SchemaIssues(document: CanonicalV2Document, value: unknown): ValidationIssue[] {
  const validator = validators[document];
  return validator(value) ? [] : (validator.errors ?? []).map((error) => issueFromError(document, error));
}

export function matchesCanonicalV2Schema(document: CanonicalV2Document, value: unknown): boolean {
  return validators[document](value) as boolean;
}

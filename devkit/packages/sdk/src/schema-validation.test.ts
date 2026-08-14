import { describe, expect, it } from 'vitest';
import { contractLock } from './generated/v1/index.js';
import { canonicalSchemaIssues, matchesCanonicalSchema } from './schema-validation.js';
import { validateEndpointSchema } from './validation.js';

describe('canonical contract bundle', () => {
  it('locks every public contract document and host capability', () => {
    expect(contractLock.contractVersion).toBe('1.0');
    expect(contractLock.hostApiVersion).toBe('1.0');
    expect(contractLock.uiApiVersion).toBe('1.0');
    expect(contractLock.capabilities).toEqual([
      'config.get',
      'http.request',
      'notifications.emit',
      'storage.get',
      'storage.set',
      'storage.delete',
      'audit.annotate',
    ]);
    expect(Object.keys(contractLock.files)).toEqual(expect.arrayContaining([
      'manifest.schema.json',
      'host-call.schema.json',
      'endpoint-schema.v1.schema.json',
      'release-record.schema.json',
    ]));
  });

  it('validates host calls from the generated host contract', () => {
    expect(matchesCanonicalSchema('hostCall', {
      method: 'notifications.emit',
      params: {
        key: 'example.changed',
        severity: 'info',
        title: 'Example changed',
        body: 'The example mutation completed.',
      },
    })).toBe(true);
    expect(canonicalSchemaIssues('hostCall', {
      method: 'http.request',
      params: { url: 'http://example.test', method: 'PATCH' },
    })).not.toHaveLength(0);
  });

  it('restricts endpoint schemas to the core-supported bounded dialect', () => {
    expect(validateEndpointSchema({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      additionalProperties: false,
      required: ['ok'],
      properties: { ok: { const: true } },
    }).valid).toBe(true);

    expect(validateEndpointSchema({
      type: 'object',
      oneOf: [{ type: 'string' }, { type: 'number' }],
    }).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'endpointSchema', message: expect.stringContaining('additional properties') }),
    ]));

    expect(validateEndpointSchema({ type: 'string', pattern: '[' }).issues).toEqual(expect.arrayContaining([
      { path: 'endpointSchema.pattern', message: 'must be a valid JavaScript regular expression' },
    ]));
  });
});

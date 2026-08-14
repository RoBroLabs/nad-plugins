import { describe, expect, it } from 'vitest';
import { assertCommunitySubmissionEnvelope } from './schema-validation-community.js';

function envelope() {
  return {
    schemaVersion: 1,
    namespace: 'test-lab',
    source: {
      mode: 'repository',
      archive: { fileName: 'source.zip', sha256: '1'.repeat(64), bytes: 100 },
      repositoryUrl: 'https://github.com/example/status',
      revision: '1234567',
      directory: 'apps/status',
    },
    candidate: {
      artifactFileName: 'status-1.0.0.nadmod',
      artifactSha256: '2'.repeat(64),
      artifactBytes: 200,
      releaseRecordSha256: '3'.repeat(64),
    },
    publisher: { keyId: 'test-lab-2026-01', publicKeySha256: '4'.repeat(64) },
    createdAt: '2026-08-13T12:00:00.000Z',
  };
}

describe('community submission contract', () => {
  it('accepts exact source and candidate digest bindings', () => {
    expect(assertCommunitySubmissionEnvelope(envelope()).namespace).toBe('test-lab');
  });

  it('rejects unknown workflow fields and malformed digests', () => {
    expect(() => assertCommunitySubmissionEnvelope({ ...envelope(), surprise: true })).toThrow('additional properties');
    expect(() => assertCommunitySubmissionEnvelope({
      ...envelope(),
      candidate: { ...envelope().candidate, artifactSha256: 'mutable' },
    })).toThrow('pattern');
  });
});

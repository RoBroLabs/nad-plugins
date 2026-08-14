import { describe, expect, it } from 'vitest';
import { runContractChecks } from './contract.js';

describe('runContractChecks', () => {
  it('reports a missing module directory clearly', async () => {
    const result = await runContractChecks('/path/that/does/not/exist');
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.message).toContain('no such file');
  });
});

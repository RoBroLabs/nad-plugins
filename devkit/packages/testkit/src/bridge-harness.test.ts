import { describe, expect, it } from 'vitest';
import { createBridgeHarness } from './bridge-harness.js';

const sessionId = 'fixture_session_0000000001';

function message(type: string, payload: unknown, index = 1): unknown {
  return {
    bridgeVersion: 2,
    sessionId,
    messageId: `message_${String(index).padStart(4, '0')}`,
    type,
    payload,
  };
}

describe('UI bridge v2 harness', () => {
  it('allows declared bindings and rejects undeclared operations', () => {
    const bridge = createBridgeHarness({ sessionId, bindings: ['guests'] });
    expect(bridge.receive(message('binding.invoke', { binding: 'guests', input: {} }))).toMatchObject({ type: 'binding.invoke' });
    expect(() => bridge.receive(message('binding.invoke', { binding: 'raw-secret', input: {} }, 2))).toThrow('UNDECLARED');
  });

  it('enforces privileges, access revocation and a message bound', () => {
    const bridge = createBridgeHarness({ sessionId, bindings: [], privileges: [], maxMessages: 1 });
    expect(() => bridge.receive(message('navigation.request', { path: '/settings' }))).toThrow('PRIVILEGE_DENIED');
    bridge.receive(message('surface.ready', {}));
    expect(() => bridge.receive(message('surface.ready', {}, 2))).toThrow('RATE_LIMITED');
    expect(bridge.revoke()).toMatchObject({ type: 'access.revoked' });
    expect(() => bridge.receive(message('surface.ready', {}, 3))).toThrow('ACCESS_REVOKED');
  });
});

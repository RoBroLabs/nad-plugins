import { describe, expect, it } from 'vitest';
import { parseUiBridgeConnect, parseUiBridgeMessage } from './ui-bridge-v2.js';

const sessionId = 'fixture_session_0000000001';

function message(type = 'binding.invoke', payload: unknown = { binding: 'summary', input: {} }): unknown {
  return {
    bridgeVersion: 2,
    sessionId,
    messageId: 'message_0001',
    type,
    payload,
  };
}

describe('UI bridge v2 validation', () => {
  it('accepts only the nad.ui.connect bootstrap with one transferred port', () => {
    const connect = { type: 'nad.ui.connect', bridgeVersion: 2, sessionId };
    expect(parseUiBridgeConnect(connect)).toEqual(connect);
    expect(() => parseUiBridgeConnect({ ...connect, type: 'message' })).toThrow('invalid');
    expect(() => parseUiBridgeConnect(connect, 0)).toThrow('exactly one MessagePort');
    expect(() => parseUiBridgeConnect(connect, 2)).toThrow('exactly one MessagePort');
  });

  it('accepts a declared binding request for the exact session', () => {
    expect(parseUiBridgeMessage(message(), sessionId)).toMatchObject({ type: 'binding.invoke', sessionId });
  });

  it('rejects forged sessions, invalid payloads and unexpected fields', () => {
    expect(() => parseUiBridgeMessage(message(), 'another_session_000000001')).toThrow('session does not match');
    expect(() => parseUiBridgeMessage(message('resize.request', { height: 99999 }), sessionId)).toThrow('v2 contract');
    expect(() => parseUiBridgeMessage({ ...(message() as object), cookie: 'forged' }, sessionId)).toThrow('v2 contract');
  });

  it('requires binding responses to identify the binding and return a result', () => {
    expect(parseUiBridgeMessage({
      ...(message('binding.result', { binding: 'summary', result: { ok: true } }) as object),
      replyTo: 'request_0001',
    }, sessionId)).toMatchObject({ type: 'binding.result', payload: { binding: 'summary', result: { ok: true } } });
    expect(() => parseUiBridgeMessage({
      ...(message('binding.result', { result: { ok: true } }) as object),
      replyTo: 'request_0001',
    }, sessionId)).toThrow('v2 contract');
  });

  it('bounds hostile message size', () => {
    expect(() => parseUiBridgeMessage(message('diagnostic.emit', {
      level: 'error',
      code: 'TOO_LARGE',
      message: 'x'.repeat(70 * 1024),
    }), sessionId)).toThrow('64 KiB');
  });
});

import { parseUiBridgeMessage, type UiBridgeEnvelope, type UiBridgeMessageType } from '@nad/sdk';

export interface BridgeHarnessOptions {
  sessionId?: string;
  bindings?: string[];
  privileges?: Array<'theme' | 'resize' | 'navigation' | 'connection-selection'>;
  maxMessages?: number;
}

export interface BridgeHarness {
  sessionId: string;
  messages: UiBridgeEnvelope[];
  revoked: boolean;
  receive(value: unknown): UiBridgeEnvelope;
  revoke(): UiBridgeEnvelope;
}

const childMessageTypes = new Set<UiBridgeMessageType>([
  'surface.ready',
  'binding.invoke',
  'resize.request',
  'navigation.request',
  'connection.select.request',
  'diagnostic.emit',
]);

function requirePrivilege(type: UiBridgeMessageType): 'resize' | 'navigation' | 'connection-selection' | undefined {
  if (type === 'resize.request') return 'resize';
  if (type === 'navigation.request') return 'navigation';
  if (type === 'connection.select.request') return 'connection-selection';
  return undefined;
}

export function createBridgeHarness(options: BridgeHarnessOptions = {}): BridgeHarness {
  const sessionId = options.sessionId ?? 'fixture_session_0000000001';
  const bindings = new Set(options.bindings ?? []);
  const privileges = new Set(options.privileges ?? []);
  const maximum = options.maxMessages ?? 128;
  const messages: UiBridgeEnvelope[] = [];
  let revoked = false;

  return {
    sessionId,
    messages,
    get revoked() {
      return revoked;
    },
    receive(value) {
      if (revoked) throw new Error('UI_BRIDGE_ACCESS_REVOKED');
      if (messages.length >= maximum) throw new Error('UI_BRIDGE_RATE_LIMITED');
      const message = parseUiBridgeMessage(value, sessionId);
      if (!childMessageTypes.has(message.type)) throw new Error('UI_BRIDGE_DIRECTION_INVALID');
      if (message.type === 'binding.invoke') {
        const payload = message.payload as { binding?: unknown };
        if (typeof payload.binding !== 'string' || !bindings.has(payload.binding)) throw new Error('UI_BRIDGE_BINDING_UNDECLARED');
      }
      const privilege = requirePrivilege(message.type);
      if (privilege && !privileges.has(privilege)) throw new Error('UI_BRIDGE_PRIVILEGE_DENIED');
      messages.push(message);
      return message;
    },
    revoke() {
      revoked = true;
      return {
        bridgeVersion: 2,
        sessionId,
        messageId: 'host_revoke_0001',
        type: 'access.revoked',
        payload: { reason: 'Access was removed.' },
      };
    },
  };
}

export function assertNoSecretMaterial(value: unknown, forbiddenValues: string[] = []): void {
  const encoded = JSON.stringify(value);
  const unsafeKey = /"(?:secret|password|token|apiKey|api_key)"\s*:/i.test(encoded);
  const unsafeValue = forbiddenValues.some((entry) => entry.length > 0 && encoded.includes(entry));
  if (unsafeKey || unsafeValue) throw new Error('Value contains secret material.');
}

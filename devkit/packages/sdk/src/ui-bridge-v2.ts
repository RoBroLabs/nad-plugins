import type {
  NADUIAPIV2MessageChannelEnvelope,
  NADUIAPIV2SurfaceConnectionBootstrap,
} from './generated/v2/index.js';
import { matchesCanonicalV2Schema } from './schema-validation-v2.js';

export const UI_BRIDGE_VERSION = 2 as const;
export const MAX_UI_BRIDGE_MESSAGE_BYTES = 64 * 1024;

export type UiBridgeMessageType = NADUIAPIV2MessageChannelEnvelope['type'];
export interface UiBridgeEnvelope<TPayload = unknown> {
  bridgeVersion: 2;
  sessionId: string;
  messageId: string;
  replyTo?: string;
  type: UiBridgeMessageType;
  payload: TPayload;
}

export interface UiBridgeBindingInvokePayload {
  binding: string;
  input: unknown;
}

export interface UiBridgeBindingResultPayload {
  binding: string;
  result: unknown;
}

export interface UiBridgeBindingErrorPayload {
  binding?: string;
  code: string;
  message: string;
}

export interface UiBridgeResizePayload {
  width?: number;
  height: number;
}

export interface UiBridgeNavigationPayload {
  path: string;
}

export interface UiBridgeConnectionSelectionPayload {
  slot: string;
}

export interface UiBridgeDiagnosticPayload {
  level: 'debug' | 'info' | 'warning' | 'error';
  code: string;
  message: string;
  metadata?: Record<string, string | number | boolean | null>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function byteLength(value: unknown): number {
  try {
    const encoded = JSON.stringify(value);
    return encoded === undefined ? Number.POSITIVE_INFINITY : new TextEncoder().encode(encoded).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

const messageTypes = new Set<UiBridgeMessageType>([
  'surface.ready',
  'surface.context',
  'binding.invoke',
  'binding.result',
  'binding.error',
  'resize.request',
  'navigation.request',
  'connection.select.request',
  'diagnostic.emit',
  'theme.changed',
  'connection.changed',
  'access.revoked',
]);

export function parseUiBridgeConnect(
  value: unknown,
  transferredPortCount = 1,
): NADUIAPIV2SurfaceConnectionBootstrap {
  if (byteLength(value) > 1024) throw new Error('UI bridge bootstrap message exceeds its limit.');
  if (!matchesCanonicalV2Schema('bridgeConnect', value)) throw new Error('UI bridge bootstrap message is invalid.');
  if (transferredPortCount !== 1) throw new Error('UI bridge bootstrap must transfer exactly one MessagePort.');
  return value as NADUIAPIV2SurfaceConnectionBootstrap;
}

export function parseUiBridgeMessage(value: unknown, expectedSessionId: string): UiBridgeEnvelope {
  if (byteLength(value) > MAX_UI_BRIDGE_MESSAGE_BYTES) throw new Error('UI bridge message exceeds the 64 KiB limit.');
  if (!isRecord(value)) throw new Error('UI bridge message must be an object.');
  if (!matchesCanonicalV2Schema('bridgeMessage', value)) throw new Error('UI bridge message does not match the v2 contract.');
  if (value.sessionId !== expectedSessionId) throw new Error('UI bridge session does not match.');
  if (typeof value.type !== 'string' || !messageTypes.has(value.type as UiBridgeMessageType)) {
    throw new Error('UI bridge message type is unsupported.');
  }
  return value as unknown as UiBridgeEnvelope;
}

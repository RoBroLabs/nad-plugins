import type { HostApi, ModuleRequest } from '@nad/sdk';

interface AcknowledgeBody {
  incidentId?: unknown;
  requestId?: unknown;
}

interface AcknowledgeResult {
  acknowledged: boolean;
  duplicate: boolean;
}

const safeIdentifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

function requiredIdentifier(value: unknown, field: string): string {
  if (typeof value !== 'string' || !safeIdentifier.test(value)) {
    throw new Error(`${field} must be a safe identifier of at most 64 characters.`);
  }
  return value;
}

export async function acknowledgeIncident(
  request: ModuleRequest<AcknowledgeBody>,
  host: HostApi,
): Promise<AcknowledgeResult> {
  const incidentId = requiredIdentifier(request.body?.incidentId, 'incidentId');
  const requestId = requiredIdentifier(request.body?.requestId, 'requestId');
  const idempotencyKey = `ack:${requestId}`;

  if (await host.storage.get(idempotencyKey)) {
    await host.audit.annotate({ incidentId, outcome: 'duplicate' });
    return { acknowledged: true, duplicate: true };
  }

  await host.storage.set(idempotencyKey, { incidentId, acknowledged: true });
  await host.audit.annotate({ incidentId, outcome: 'acknowledged' });
  await host.notifications.emit({
    key: 'incident.acknowledged',
    severity: 'info',
    title: 'Incident acknowledged',
    body: `Incident ${incidentId} was acknowledged.`,
    dedupeKey: requestId,
  });

  return { acknowledged: true, duplicate: false };
}

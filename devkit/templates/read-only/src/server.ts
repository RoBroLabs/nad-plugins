import type { HostApi, ModuleRequest } from '@nad/sdk';

interface SummaryResponse {
  moduleId: string;
  publisher: string;
  headline: string;
  statusMessage: string;
  statusTone: 'ok';
  mode: 'read-only';
}

function asString(value: string | { secretRef: string; present: boolean } | undefined): string {
  return typeof value === 'string' ? value : '';
}

export async function summary(_request: ModuleRequest, host: HostApi): Promise<SummaryResponse> {
  const headline = asString(await host.config.get('headline')) || '__MODULE_NAME__';
  const statusMessage = asString(await host.config.get('status_message')) || 'Scaffold created successfully.';

  return {
    moduleId: '__MODULE_ID__',
    publisher: '__MODULE_PUBLISHER__',
    headline,
    statusMessage,
    statusTone: 'ok',
    mode: 'read-only',
  };
}

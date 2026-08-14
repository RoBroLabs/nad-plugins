import type { AppRequestV2, HostApiV2 } from '@nad/sdk';

export async function summary(_request: AppRequestV2, host: HostApiV2): Promise<{
  profile: string;
  headline: string;
  status: string;
}> {
  const [profile, headline, status] = await Promise.all([
    host.connections.current(),
    host.connections.get('headline'),
    host.connections.get('status_message'),
  ]);
  return {
    profile: profile?.name ?? 'Unknown connection',
    headline: typeof headline === 'string' ? headline : '__PACKAGE_NAME__',
    status: typeof status === 'string' ? status : 'Not configured',
  };
}

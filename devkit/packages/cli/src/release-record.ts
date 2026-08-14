import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { generateReleaseRecord } from '@nad/sdk';

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

export async function commandReleaseRecord(args: string[]): Promise<void> {
  const moduleDir = args[0];
  const packagePath = args[1];
  if (!moduleDir || !packagePath) {
    throw new Error('Usage: nad-module release-record <module-dir> <file.nadmod> --out <dir> --trusted-key <public.pem> --key-id <id> --source-revision <rev>');
  }
  const outDir = valueAfter(args, '--out') ?? 'dist';
  const trustedKeyPath = valueAfter(args, '--trusted-key') ?? process.env.NAD_MODULE_TRUSTED_KEY_FILE;
  const keyId = valueAfter(args, '--key-id') ?? process.env.NAD_MODULE_TRUSTED_KEY_ID;
  const sourceRevision = valueAfter(args, '--source-revision') ?? process.env.NAD_MODULE_SOURCE_REVISION;
  if (!trustedKeyPath || !keyId) {
    throw new Error('Release-record generation requires --trusted-key <public.pem> and --key-id <id>.');
  }
  if (!sourceRevision) {
    throw new Error('Release-record generation requires --source-revision <rev> or NAD_MODULE_SOURCE_REVISION.');
  }
  const publicKeyPem = await readFile(resolve(trustedKeyPath), 'utf8');
  const generated = await generateReleaseRecord(
    resolve(moduleDir),
    resolve(packagePath),
    resolve(outDir),
    {
      sourceRevision,
      trustedKeys: { [keyId]: publicKeyPem },
      expectedKeyId: keyId,
    },
  );
  console.log(`Release record ${generated.filePath}`);
  console.log(`Module ${generated.record.module.id} ${generated.record.module.version}`);
  console.log(`SHA-256 ${generated.record.artifact.sha256}`);
}

#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildNadPackage, checkPackageDirectory, verifyNadPackage } from '@nad/sdk';
import { runContractChecks } from '@nad/testkit';
import { commandChangelog } from './changelog.js';
import { commandCreate } from './create.js';
import { commandCreateV2 } from './create-v2.js';
import { commandDev } from './dev.js';
import { commandReleaseRecord } from './release-record.js';

function usage(): string {
  return [
    'Usage:',
    '  nad app create <target-dir> --id <reverse.domain.id> [--name <name>] [--publisher <publisher>]',
    '  nad addon create <target-dir> --id <reverse.domain.id> --app <app-id> [--app-version <range>]',
    '  nad-module create <target-dir> --id <reverse.domain.id> [--name <name>] [--publisher <publisher>]',
    '  nad-module check <module-dir>',
    '  nad-module pack <module-dir> --out <dir> [--signing-key <pem>] [--key-id <id>] [--require-signature] [--release-record] [--source-revision <rev>]',
    '  nad-module verify <file.nadmod> [--trusted-key <public.pem>] [--key-id <id>]',
    '  nad-module dev <module-dir> [--once] [--scenario <name>] [--role <name>] [--endpoint <name>]',
    '  nad-module changelog <module-dir> --summary <text> --entry <text> --preserve <contract>',
    '  nad-module release-record <module-dir> <file.nadmod> --out <dir> --trusted-key <public.pem> --key-id <id> --source-revision <rev>',
  ].join('\n');
}

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function printIssues(result: Awaited<ReturnType<typeof runContractChecks>>): void {
  for (const warning of result.warnings) console.warn(`warning: ${warning}`);
  for (const issue of result.issues) console.error(`${issue.path}: ${issue.message}`);
}

async function commandCheck(args: string[]): Promise<void> {
  const moduleDir = args[0];
  if (!moduleDir) throw new Error(usage());
  const result = await runContractChecks(resolve(moduleDir));
  printIssues(result);
  if (!result.valid) process.exitCode = 1;
  else console.log(`Contract check passed for ${moduleDir}`);
}

async function commandPack(args: string[]): Promise<void> {
  const moduleDir = args[0];
  const outDir = valueAfter(args, '--out') ?? 'dist';
  if (!moduleDir) throw new Error(usage());
  const check = await checkPackageDirectory(resolve(moduleDir));
  if (!check.valid) {
    printIssues(check);
    process.exitCode = 1;
    return;
  }
  const signingKeyPath = valueAfter(args, '--signing-key') ?? process.env.NAD_MODULE_SIGNING_KEY_FILE;
  const keyId = valueAfter(args, '--key-id') ?? process.env.NAD_MODULE_SIGNING_KEY_ID;
  if (args.includes('--require-signature') && (!signingKeyPath || !keyId)) {
    throw new Error('This release command requires a signing key and key ID.');
  }
  const result = await buildNadPackage(resolve(moduleDir), resolve(outDir), {
    privateKeyPem: signingKeyPath ? await readFile(resolve(signingKeyPath), 'utf8') : undefined,
    keyId,
    generateReleaseRecord: args.includes('--release-record'),
    sourceRevision: valueAfter(args, '--source-revision') ?? process.env.NAD_MODULE_SOURCE_REVISION,
  });
  console.log(`Wrote ${result.filePath}`);
  if (result.releaseRecordPath) console.log(`Release record ${result.releaseRecordPath}`);
  console.log(`SHA-256 ${result.sha256}`);
}

async function commandVerify(args: string[]): Promise<void> {
  const filePath = args[0];
  if (!filePath) throw new Error(usage());
  const structural = await verifyNadPackage(resolve(filePath));
  const trustedKeyPath = valueAfter(args, '--trusted-key') ?? process.env.NAD_MODULE_TRUSTED_KEY_FILE;
  const expectedKeyId = valueAfter(args, '--key-id') ?? process.env.NAD_MODULE_TRUSTED_KEY_ID;
  let result = structural;
  if (structural.signature.mode === 'signed') {
    if (!trustedKeyPath) throw new Error('Signed package verification requires --trusted-key <public.pem>.');
    if (expectedKeyId && expectedKeyId !== structural.signature.keyId) throw new Error('Package signer does not match expected key.');
    result = await verifyNadPackage(resolve(filePath), {
      trustedKeys: { [structural.signature.keyId]: await readFile(resolve(trustedKeyPath), 'utf8') },
      requireTrustedSignature: true,
    });
  }
  console.log(`Verified ${filePath}`);
  console.log(`Entries ${result.entries.length}`);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'app') return commandCreateV2('app', args);
  if (command === 'addon') return commandCreateV2('addon', args);
  if (command === 'create') return commandCreate(args);
  if (command === 'check') return commandCheck(args);
  if (command === 'pack') return commandPack(args);
  if (command === 'verify') return commandVerify(args);
  if (command === 'dev') return commandDev(args);
  if (command === 'changelog') return commandChangelog(args);
  if (command === 'release-record') return commandReleaseRecord(args);
  throw new Error(usage());
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

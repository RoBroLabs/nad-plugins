#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildNadPackage, checkPackageDirectory, verifyNadPackage } from '@nad/sdk';
import { runContractChecks } from '@nad/testkit';
import { commandChangelog } from './changelog.js';
import { commandCreate } from './create.js';
import { commandCreateV2 } from './create-v2.js';
import { commandCommunity } from './community.js';
import { commandDev } from './dev.js';
import { commandReleaseRecord } from './release-record.js';

function usage(): string {
  return [
    'Usage:',
    '  nad app create <target-dir> --id <reverse.domain.id> [--name <name>] [--publisher <publisher>]',
    '  nad addon create <target-dir> --id <reverse.domain.id> --app <app-id> [--app-version <range>]',
    '  nad community keygen --key-id <id> [--out <private-dir>]',
    '  nad community submission <source.zip|tar.gz> <artifact.nadmod> <release.json> --namespace <namespace> --key-id <id> --public-key <pem> [--out <file.json>]',
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
  if (index === -1) return undefined;
  return args[index + 1];
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
  const generateReleaseRecord = args.includes('--release-record');
  const sourceRevision = valueAfter(args, '--source-revision') ?? process.env.NAD_MODULE_SOURCE_REVISION;
  if (args.includes('--require-signature') && (!signingKeyPath || !keyId)) {
    throw new Error('This release command requires NAD_MODULE_SIGNING_KEY_FILE and NAD_MODULE_SIGNING_KEY_ID.');
  }
  const privateKeyPem = signingKeyPath ? await readFile(resolve(signingKeyPath), 'utf8') : undefined;
  const result = await buildNadPackage(resolve(moduleDir), resolve(outDir), {
    privateKeyPem,
    keyId,
    generateReleaseRecord,
    sourceRevision,
  });
  for (const warning of result.warnings) console.warn(`warning: ${warning}`);
  console.log(`Wrote ${result.filePath}`);
  if (result.releaseRecordPath) console.log(`Release record ${result.releaseRecordPath}`);
  console.log(`Module ${result.manifest.id} ${result.manifest.version}`);
  console.log(`SHA-256 ${result.sha256}`);
  console.log(`Bytes ${result.bytes}`);
}

async function commandVerify(args: string[]): Promise<void> {
  const filePath = args[0];
  if (!filePath) throw new Error(usage());
  const resolvedPath = resolve(filePath);
  const structural = await verifyNadPackage(resolvedPath);
  const trustedKeyPath = valueAfter(args, '--trusted-key') ?? process.env.NAD_MODULE_TRUSTED_KEY_FILE;
  const expectedKeyId = valueAfter(args, '--key-id') ?? process.env.NAD_MODULE_TRUSTED_KEY_ID;
  let result = structural;
  if (structural.signature.mode === 'signed') {
    if (!trustedKeyPath) throw new Error('Signed package verification requires --trusted-key <public.pem>.');
    if (expectedKeyId && expectedKeyId !== structural.signature.keyId) {
      throw new Error(`Package signer ${structural.signature.keyId} does not match expected key ${expectedKeyId}.`);
    }
    const publicKeyPem = await readFile(resolve(trustedKeyPath), 'utf8');
    result = await verifyNadPackage(resolvedPath, {
      trustedKeys: { [structural.signature.keyId]: publicKeyPem },
      requireTrustedSignature: true,
    });
  }
  for (const warning of result.warnings) console.warn(`warning: ${warning}`);
  console.log(`Verified ${filePath}`);
  console.log(`Module ${result.manifest.id} ${result.manifest.version}`);
  console.log(`Entries ${result.entries.length}`);
  console.log(`Signature ${result.signature.mode}${result.signature.mode === 'signed' ? ` (${result.signature.keyId}, cryptographically verified)` : ''}`);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'app') return commandCreateV2('app', args);
  if (command === 'addon') return commandCreateV2('addon', args);
  if (command === 'community') return commandCommunity(args);
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

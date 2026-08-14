import { createHash, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { basename, join, resolve } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { assertCommunitySubmissionEnvelope } from '@nad/sdk';

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
}

function required(args: string[], flag: string): string {
  const value = valueAfter(args, flag)?.trim();
  if (!value) throw new Error(`${flag} is required.`);
  return value;
}

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function commandCommunity(args: string[]): Promise<void> {
  const [command, ...rest] = args;
  if (command === 'keygen') {
    const outDir = resolve(valueAfter(rest, '--out') ?? '.nad-keys');
    const keyId = required(rest, '--key-id');
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(keyId)) throw new Error('Key ID is invalid.');
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    await mkdir(outDir, { recursive: true, mode: 0o700 });
    const privatePath = join(outDir, `${keyId}.private.pem`);
    const publicPath = join(outDir, `${keyId}.public.pem`);
    await writeFile(privatePath, privatePem, { mode: 0o600, flag: 'wx' });
    await writeFile(publicPath, publicPem, { mode: 0o644, flag: 'wx' });
    console.log(`Private key ${privatePath}`);
    console.log(`Public key ${publicPath}`);
    console.log(`Public SHA-256 ${sha256(publicPem)}`);
    console.log('Keep the private key outside repositories, build contexts, prompts and Marketplace uploads.');
    return;
  }
  if (command === 'submission') {
    const [sourcePathValue, artifactPathValue, releaseRecordPathValue] = rest;
    if (!sourcePathValue || !artifactPathValue || !releaseRecordPathValue) {
      throw new Error('Usage: nad community submission <source.zip|tar.gz> <artifact.nadmod> <release.json> --namespace <namespace> --key-id <id> --public-key <pem> --out <file.json>');
    }
    const [source, artifact, releaseRecordBytes, publicKeyInput] = await Promise.all([
      readFile(resolve(sourcePathValue)),
      readFile(resolve(artifactPathValue)),
      readFile(resolve(releaseRecordPathValue)),
      readFile(resolve(required(rest, '--public-key')), 'utf8'),
    ]);
    const publicKey = createPublicKey(publicKeyInput);
    if (publicKey.asymmetricKeyType !== 'ed25519') throw new Error('Publisher public key must be Ed25519.');
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const releaseRecord = JSON.parse(releaseRecordBytes.toString('utf8')) as {
      schemaVersion?: unknown;
      provenance?: { repositoryUrl?: string | null; sourceRevision?: string; sourceDirectory?: string };
      artifact?: { fileName?: string; sha256?: string; bytes?: number };
      signature?: { keyId?: string };
    };
    if (releaseRecord.schemaVersion !== 2 || !releaseRecord.provenance || !releaseRecord.artifact || !releaseRecord.signature) {
      throw new Error('Community submission requires a canonical schema-v2 release record.');
    }
    const namespace = required(rest, '--namespace');
    const keyId = required(rest, '--key-id');
    const sourceName = basename(sourcePathValue);
    const repositoryUrl = valueAfter(rest, '--repository') ?? releaseRecord.provenance.repositoryUrl ?? undefined;
    const envelope = assertCommunitySubmissionEnvelope({
      schemaVersion: 1,
      namespace,
      source: {
        mode: repositoryUrl ? 'repository' : 'archive',
        archive: { fileName: sourceName, sha256: sha256(source), bytes: source.byteLength },
        ...(repositoryUrl ? { repositoryUrl } : {}),
        revision: valueAfter(rest, '--revision') ?? releaseRecord.provenance.sourceRevision,
        directory: valueAfter(rest, '--directory') ?? releaseRecord.provenance.sourceDirectory,
      },
      candidate: {
        artifactFileName: basename(artifactPathValue),
        artifactSha256: sha256(artifact),
        artifactBytes: artifact.byteLength,
        releaseRecordSha256: sha256(releaseRecordBytes),
      },
      publisher: { keyId, publicKeySha256: sha256(publicKeyPem) },
      createdAt: new Date().toISOString(),
    });
    if (releaseRecord.artifact.fileName !== envelope.candidate.artifactFileName
      || releaseRecord.artifact.sha256 !== envelope.candidate.artifactSha256
      || releaseRecord.artifact.bytes !== envelope.candidate.artifactBytes
      || releaseRecord.signature.keyId !== keyId) {
      throw new Error('Candidate package, release record and publisher key ID do not match.');
    }
    const outPath = resolve(valueAfter(rest, '--out') ?? 'community-submission.json');
    await writeFile(outPath, `${JSON.stringify(envelope, null, 2)}\n`, { flag: 'wx' });
    console.log(`Submission envelope ${outPath}`);
    console.log(`Source SHA-256 ${envelope.source.archive.sha256}`);
    console.log(`Candidate SHA-256 ${envelope.candidate.artifactSha256}`);
    return;
  }
  throw new Error('Usage: nad community <keygen|submission> [options]');
}

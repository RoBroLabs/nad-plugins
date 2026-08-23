#!/usr/bin/env node
// Records what the release workflow proved about a candidate build.
//
// Two forms of the same facts: provenance.json for the promotion step to read,
// and PROVENANCE.txt for the operator carrying the release across to the
// offline signing environment, where a JSON file is less useful than something
// legible on screen.

import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const outputDirectory = resolve(process.argv[2] ?? 'release-candidate');

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Release provenance needs ${name}.`);
  return value;
}

const provenance = {
  schemaVersion: 1,
  moduleId: required('MODULE_ID'),
  slug: required('SLUG'),
  version: required('VERSION'),
  sourceTag: process.env.TAG || null,
  sourceRevision: required('REVISION'),
  unsignedArtifact: {
    fileName: `${required('SLUG')}-${required('VERSION')}.nadmod`,
    sha256: required('DIGEST'),
    bytes: Number(required('BYTES')),
  },
  reproducibility: {
    packsCompared: 3,
    nodeVersions: [required('NODE_PRIMARY'), required('NODE_SECONDARY')],
    identical: true,
  },
  builtBy: {
    repository: process.env.GITHUB_REPOSITORY ?? null,
    runId: process.env.GITHUB_RUN_ID ?? null,
  },
  signed: false,
};

const summary = `NAD plugin release candidate
============================

Module ID        ${provenance.moduleId}
Slug             ${provenance.slug}
Version          ${provenance.version}
Source tag       ${provenance.sourceTag ?? '(dry run, no tag)'}
Source revision  ${provenance.sourceRevision}

Unsigned artifact
  SHA-256        ${provenance.unsignedArtifact.sha256}
  Bytes          ${provenance.unsignedArtifact.bytes}

Reproducibility  ${provenance.reproducibility.packsCompared} packs across Node \
${provenance.reproducibility.nodeVersions.join(' and ')} produced identical bytes
Built by         ${provenance.builtBy.repository} run ${provenance.builtBy.runId}

These bytes are UNSIGNED and must not be published. Re-pack this exact source
revision in the offline signing environment. The signed artifact has a different
digest, because the signature is carried inside the package; this digest is the
reproducibility proof for the source, not the identity of the release.

See docs/RELEASING.md.
`;

await mkdir(outputDirectory, { recursive: true });
await writeFile(join(outputDirectory, 'provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`);
await writeFile(join(outputDirectory, 'PROVENANCE.txt'), summary);
if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(process.env.GITHUB_STEP_SUMMARY, `\`\`\`\n${summary}\`\`\`\n`);
}
process.stdout.write(summary);

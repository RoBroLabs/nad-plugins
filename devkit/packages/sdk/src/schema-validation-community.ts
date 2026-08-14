import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import {
  communityContractSchemas,
  type NADCommunitySubmissionEnvelope,
} from './generated/community/v1/index.js';

const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: false });
for (const schema of Object.values(communityContractSchemas)) ajv.addSchema(schema);
const compiled = ajv.getSchema('https://schemas.nad.robrolabs.com/community/submission.v1.schema.json') as ValidateFunction<NADCommunitySubmissionEnvelope> | undefined;
if (!compiled) throw new Error('Community submission schema is unavailable.');
const validator: ValidateFunction<NADCommunitySubmissionEnvelope> = compiled;

export function assertCommunitySubmissionEnvelope(value: unknown): NADCommunitySubmissionEnvelope {
  if (!validator(value)) {
    throw new Error((validator.errors ?? []).map((issue) => `${issue.instancePath || '/'} ${issue.message ?? issue.keyword}`).join('; '));
  }
  return value;
}

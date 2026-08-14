import { checkPackageDirectory, type ValidationResult } from '@nad/sdk';

export async function runContractChecks(moduleDir: string): Promise<ValidationResult> {
  return checkPackageDirectory(moduleDir);
}

export function expectValidContract(result: ValidationResult): void {
  if (!result.valid) {
    throw new Error(result.issues.map(({ path, message }) => `${path}: ${message}`).join('\n'));
  }
}

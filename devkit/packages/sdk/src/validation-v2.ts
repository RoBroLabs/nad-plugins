import type {
  ConnectionProfileSchemaV2,
  PackageManifestV2,
  SurfacesFileV2,
} from './types-v2.js';
import type { ValidationIssue, ValidationResult } from './types.js';
import { canonicalV2SchemaIssues } from './schema-validation-v2.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function addIssue(issues: ValidationIssue[], path: string, message: string): void {
  issues.push({ path, message });
}

function duplicates(values: string[]): Set<string> {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return repeated;
}

export function validatePackageManifestV2(value: unknown): ValidationResult {
  const issues = canonicalV2SchemaIssues('manifest', value);
  if (!isRecord(value) || value.schemaVersion !== 2) return { valid: false, issues, warnings: [] };

  const capabilities = Array.isArray(value.capabilities)
    ? value.capabilities.filter(isRecord).map((item) => String(item.name))
    : [];
  for (const name of duplicates(capabilities)) addIssue(issues, 'manifest.capabilities', `capability ${name} must be unique`);

  const permissions = Array.isArray(value.permissions)
    ? value.permissions.filter(isRecord).map((item) => String(item.action))
    : [];
  const permissionSet = new Set(permissions);
  for (const action of duplicates(permissions)) addIssue(issues, 'manifest.permissions', `permission ${action} must be unique`);

  const operations = isRecord(value.operations) ? value.operations : {};
  for (const [name, operation] of Object.entries(operations)) {
    if (!isRecord(operation)) continue;
    if (typeof operation.permission === 'string' && !permissionSet.has(operation.permission)) {
      addIssue(issues, `manifest.operations.${name}.permission`, 'must reference a declared permission');
    }
    if (operation.connection !== 'none' && !isRecord(value.connections)) {
      addIssue(issues, `manifest.operations.${name}.connection`, 'requires an App connection schema');
    }
  }

  if (isRecord(value.connections) && typeof value.connections.testOperation === 'string') {
    if (!Object.hasOwn(operations, value.connections.testOperation)) {
      addIssue(issues, 'manifest.connections.testOperation', 'must reference a declared operation');
    }
  }

  if (Array.isArray(value.httpAccess)) {
    const scopeIds = value.httpAccess.filter(isRecord).map((scope) => String(scope.id));
    for (const id of duplicates(scopeIds)) addIssue(issues, 'manifest.httpAccess', `scope ${id} must be unique`);
  }

  if (Array.isArray(value.dependencies)) {
    const aliases = value.dependencies.filter(isRecord).map((dependency) => String(dependency.alias));
    for (const alias of duplicates(aliases)) addIssue(issues, 'manifest.dependencies', `alias ${alias} must be unique`);
  }

  if (value.kind === 'addon' && !capabilities.includes('apps.invoke')) {
    addIssue(issues, 'manifest.capabilities', 'Add-ons must request apps.invoke to call declared App operations');
  }

  return { valid: issues.length === 0, issues, warnings: [] };
}

export function validateConnectionProfileSchemaV2(value: unknown): ValidationResult {
  const issues = canonicalV2SchemaIssues('connectionSchema', value);
  if (!isRecord(value) || !isRecord(value.properties)) return { valid: false, issues, warnings: [] };
  const required = new Set(Array.isArray(value.required) ? value.required.filter((item): item is string => typeof item === 'string') : []);
  for (const field of required) {
    if (!Object.hasOwn(value.properties, field)) addIssue(issues, `connectionSchema.required.${field}`, 'must name a declared property');
  }
  for (const [name, field] of Object.entries(value.properties)) {
    if (!isRecord(field) || !isRecord(field['x-nad'])) continue;
    const control = field['x-nad'].control;
    if (control === 'secret' && field.default !== undefined) {
      addIssue(issues, `connectionSchema.properties.${name}.default`, 'secret fields must not declare defaults');
    }
    if ((control === 'text' || control === 'url' || control === 'secret' || control === 'select') && field.type !== 'string') {
      addIssue(issues, `connectionSchema.properties.${name}.type`, `${String(control)} controls require string fields`);
    }
    if (control === 'boolean' && field.type !== 'boolean') {
      addIssue(issues, `connectionSchema.properties.${name}.type`, 'boolean controls require boolean fields');
    }
    if (control === 'number' && field.type !== 'number' && field.type !== 'integer') {
      addIssue(issues, `connectionSchema.properties.${name}.type`, 'number controls require number or integer fields');
    }
    if (control === 'select' && !Array.isArray(field.enum)) {
      addIssue(issues, `connectionSchema.properties.${name}.enum`, 'select controls require a bounded enum');
    }
  }
  return { valid: issues.length === 0, issues, warnings: [] };
}

function connectionField(
  schema: ConnectionProfileSchemaV2,
  name: string,
): Record<string, unknown> | undefined {
  const fields = schema.properties as Record<string, unknown>;
  const value = fields[name];
  return isRecord(value) ? value : undefined;
}

function fieldControl(field: Record<string, unknown> | undefined): unknown {
  return field && isRecord(field['x-nad']) ? field['x-nad'].control : undefined;
}

export function validateHttpAccessAgainstConnectionSchemaV2(
  manifest: PackageManifestV2,
  schema: ConnectionProfileSchemaV2,
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const required = new Set(schema.required ?? []);
  for (const [index, scope] of (manifest.httpAccess ?? []).entries()) {
    const path = `manifest.httpAccess[${index}]`;
    const host = connectionField(schema, scope.hostField);
    if (!host || host.type !== 'string' || !['text', 'url'].includes(String(fieldControl(host)))) {
      addIssue(issues, `${path}.hostField`, 'must reference a non-secret string text/url connection field');
    }
    if (scope.portField) {
      const port = connectionField(schema, scope.portField);
      if (!port || !['number', 'integer'].includes(String(port.type)) || fieldControl(port) !== 'number') {
        addIssue(issues, `${path}.portField`, 'must reference a numeric connection field');
      }
    }
    if (scope.tlsVerifyField) {
      const tls = connectionField(schema, scope.tlsVerifyField);
      if (!tls || tls.type !== 'boolean' || fieldControl(tls) !== 'boolean') {
        addIssue(issues, `${path}.tlsVerifyField`, 'must reference a boolean connection field');
      }
    }
    if (scope.credential) {
      const secret = connectionField(schema, scope.credential.field);
      if (!secret || secret.type !== 'string' || fieldControl(secret) !== 'secret') {
        addIssue(issues, `${path}.credential.field`, 'must reference a secret string connection field');
      } else if (!required.has(scope.credential.field)) {
        addIssue(issues, `${path}.credential.field`, 'credential fields used by signed HTTP scopes must be required');
      }
      if (scope.credential.publicField) {
        const publicField = connectionField(schema, scope.credential.publicField);
        if (
          !publicField
          || publicField.type !== 'string'
          || !['text', 'url', 'select'].includes(String(fieldControl(publicField)))
        ) {
          addIssue(issues, `${path}.credential.publicField`, 'must reference a compatible non-secret string connection field');
        }
      }
    }
  }
  return { valid: issues.length === 0, issues, warnings: [] };
}

export function validateSurfacesV2(value: unknown, manifest: PackageManifestV2): ValidationResult {
  const issues = canonicalV2SchemaIssues('surfaces', value);
  if (!isRecord(value) || !Array.isArray(value.surfaces)) return { valid: false, issues, warnings: [] };
  const permissions = new Set(manifest.permissions.map((permission) => permission.action));
  const operations = manifest.operations ?? {};
  const dependencies = new Map((manifest.dependencies ?? []).map((dependency) => [dependency.alias, dependency]));
  const surfaceIds: string[] = [];
  const entryFiles: string[] = [];

  value.surfaces.forEach((surface, surfaceIndex) => {
    if (!isRecord(surface)) return;
    const path = `surfaces.surfaces[${surfaceIndex}]`;
    const surfacePermissions = Array.isArray(surface.permissions)
      ? surface.permissions.filter((permission): permission is string => typeof permission === 'string')
      : [];
    if (typeof surface.id === 'string') surfaceIds.push(surface.id);
    if (typeof surface.entry === 'string') entryFiles.push(surface.entry);
    if (Array.isArray(surface.permissions)) {
      surface.permissions.forEach((permission, permissionIndex) => {
        if (typeof permission === 'string' && !permissions.has(permission)) {
          addIssue(issues, `${path}.permissions[${permissionIndex}]`, 'must reference a declared permission');
        }
      });
    }

    const slots = new Map<string, string>();
    if (Array.isArray(surface.connectionSlots)) {
      surface.connectionSlots.forEach((slot, slotIndex) => {
        if (!isRecord(slot) || typeof slot.slot !== 'string' || typeof slot.target !== 'string') return;
        if (slots.has(slot.slot)) addIssue(issues, `${path}.connectionSlots[${slotIndex}].slot`, 'must be unique');
        slots.set(slot.slot, slot.target);
        if (slot.target === 'self' && manifest.kind !== 'app') {
          addIssue(issues, `${path}.connectionSlots[${slotIndex}].target`, 'self connections are available only to Apps');
        }
        if (slot.target !== 'self' && !dependencies.has(slot.target)) {
          addIssue(issues, `${path}.connectionSlots[${slotIndex}].target`, 'must reference a declared dependency alias');
        }
      });
    }

    if (isRecord(surface.bindings)) {
      for (const [bindingName, binding] of Object.entries(surface.bindings)) {
        if (!isRecord(binding) || typeof binding.target !== 'string' || typeof binding.operation !== 'string') continue;
        if (binding.target === 'self') {
          const operation = operations[binding.operation];
          if (!operation) {
            addIssue(issues, `${path}.bindings.${bindingName}.operation`, 'must reference a declared self operation');
          } else {
            if (!operation.consumers.includes('self')) {
              addIssue(issues, `${path}.bindings.${bindingName}.operation`, 'self surface operations must allow the self consumer');
            }
            if (!surfacePermissions.includes(operation.permission)) {
              addIssue(issues, `${path}.permissions`, `must include the ${operation.permission} permission required by ${bindingName}`);
            }
            if (operation.connection === 'required' && binding.connectionSlot === undefined) {
              addIssue(issues, `${path}.bindings.${bindingName}.connectionSlot`, 'is required by the selected operation');
            }
            if (operation.connection === 'none' && binding.connectionSlot !== undefined) {
              addIssue(issues, `${path}.bindings.${bindingName}.connectionSlot`, 'must be omitted for a connection-free operation');
            }
          }
        } else {
          const dependency = dependencies.get(binding.target);
          if (!dependency || !Object.hasOwn(dependency.operations, binding.operation)) {
            addIssue(issues, `${path}.bindings.${bindingName}.operation`, 'must reference an allowed dependency operation');
          }
          if (binding.connectionSlot === undefined) {
            addIssue(issues, `${path}.bindings.${bindingName}.connectionSlot`, 'Add-on bindings must select a declared App connection slot');
          }
        }
        if (binding.connectionSlot !== undefined) {
          if (typeof binding.connectionSlot !== 'string' || !slots.has(binding.connectionSlot)) {
            addIssue(issues, `${path}.bindings.${bindingName}.connectionSlot`, 'must reference a declared connection slot');
          } else if (slots.get(binding.connectionSlot) !== binding.target) {
            addIssue(issues, `${path}.bindings.${bindingName}.connectionSlot`, 'must target the same App as the binding');
          }
        }
      }
    }
  });

  for (const id of duplicates(surfaceIds)) addIssue(issues, 'surfaces.surfaces', `surface ID ${id} must be unique`);
  for (const entry of duplicates(entryFiles)) addIssue(issues, 'surfaces.surfaces', `entry ${entry} must be unique`);
  return { valid: issues.length === 0, issues, warnings: [] };
}

export function assertValidPackageManifestV2(value: unknown): PackageManifestV2 {
  const result = validatePackageManifestV2(value);
  if (!result.valid) throw new Error(result.issues.map(({ path, message }) => `${path}: ${message}`).join('\n'));
  return value as PackageManifestV2;
}

export function assertValidConnectionProfileSchemaV2(value: unknown): ConnectionProfileSchemaV2 {
  const result = validateConnectionProfileSchemaV2(value);
  if (!result.valid) throw new Error(result.issues.map(({ path, message }) => `${path}: ${message}`).join('\n'));
  return value as ConnectionProfileSchemaV2;
}

export function assertValidSurfacesV2(value: unknown, manifest: PackageManifestV2): SurfacesFileV2 {
  const result = validateSurfacesV2(value, manifest);
  if (!result.valid) throw new Error(result.issues.map(({ path, message }) => `${path}: ${message}`).join('\n'));
  return value as SurfacesFileV2;
}

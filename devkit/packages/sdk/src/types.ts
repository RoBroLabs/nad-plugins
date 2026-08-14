import { contractLock } from './generated/v1/index.js';
import type {
  ModuleChecksumsDocument,
  ModuleManifestDocument,
  ModulePagesDocument,
  ModuleReleaseMetadataDocument,
  ModuleReleaseRecordDocument,
  ModuleSignatureDocument,
  ModuleUiElementDocument,
  ModuleWidgetsDocument,
} from './generated/v1/index.js';

/** Public contract versions are generated from the canonical schema lock. */
export const PACKAGE_SCHEMA_VERSION = contractLock.packageSchemaVersion;
export const HOST_API_VERSION = contractLock.hostApiCompatibility;
export const UI_API_VERSION = contractLock.uiApiCompatibility;
/** Latest versions for new packages. Existing v1 constants above remain frozen aliases. */
export const SUPPORTED_PACKAGE_SCHEMA_VERSIONS = [1, 2] as const;
export const LATEST_PACKAGE_SCHEMA_VERSION = 2 as const;
export const LATEST_HOST_API_VERSION = '2.x' as const;
export const LATEST_UI_API_VERSION = '2.x' as const;

export type ModuleManifest = ModuleManifestDocument;
export type ModuleCompatibility = ModuleManifest['compatibility'];
export type ModuleCategory = ModuleManifest['category'];
export type CapabilityDeclaration = ModuleManifest['capabilities'][number];
export type CapabilityName = CapabilityDeclaration['name'];
export type HttpAccessScope = NonNullable<ModuleManifest['httpAccess']>[number];
export type HttpAccessScheme = HttpAccessScope['scheme'];
export type HttpMethod = HttpAccessScope['methods'][number];
export type PermissionDeclaration = ModuleManifest['permissions'][number];
export type ConfigField = ModuleManifest['configSchema'][number];
export type ConfigFieldType = ConfigField['type'];
export type SelectOption = NonNullable<ConfigField['options']>[number];
export type EntrypointDeclaration = ModuleManifest['entrypoints'][string];
export type EntrypointKind = EntrypointDeclaration['kind'];
export type TimeoutClass = EntrypointDeclaration['timeoutClass'];

export type WidgetsFile = ModuleWidgetsDocument;
export type DeclarativeWidget = WidgetsFile['widgets'][number];
export type GridSize = DeclarativeWidget['defaultSize'];
export type WidgetSource = DeclarativeWidget['source'];
export type PagesFile = ModulePagesDocument;
export type DeclarativePage = PagesFile['pages'][number];
export type UiElement = ModuleUiElementDocument;

export type ChecksumsFile = ModuleChecksumsDocument;
export type SignatureFile = ModuleSignatureDocument;
export type DevUnsignedSignatureFile = Extract<SignatureFile, { mode: 'unsigned-dev' }>;
export type SignedSignatureFile = Extract<SignatureFile, { mode: 'signed' }>;

export type ReleaseMetadata = ModuleReleaseMetadataDocument;
export type ReleaseMetadataChangelog = ReleaseMetadata['changelog'];
export type ReleaseMetadataHotUpdate = ReleaseMetadata['hotUpdate'];
export type ReleaseRecord = ModuleReleaseRecordDocument;
export type ReleaseRecordCheck = ReleaseRecord['conformance']['checks'][number];

export interface PackageVerification {
  manifest: ModuleManifest;
  checksums: ChecksumsFile;
  signature: SignatureFile;
  signatureVerified: boolean;
  entries: string[];
  warnings: string[];
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  warnings: string[];
}

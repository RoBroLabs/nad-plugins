import { contractV2Lock } from './generated/v2/index.js';
import type {
  NADUIAPIV2SurfaceConnectionBootstrap,
  NADUIAPIV2Surfaces,
  NADV2AppOperation,
  NADV2AppOrAddOnManifest,
  NADV2ConnectionProfileSchema,
  NADV2PackageReleaseRecord,
  NADV2ScopedHTTPAccess,
} from './generated/v2/index.js';

export const PACKAGE_SCHEMA_V2 = contractV2Lock.packageSchemaVersion;
export const HOST_API_V2 = contractV2Lock.hostApiCompatibility;
export const UI_API_V2 = contractV2Lock.uiApiCompatibility;

export type PackageManifestV2 = NADV2AppOrAddOnManifest;
export type AppManifestV2 = PackageManifestV2 & { kind: 'app' };
export type AddonManifestV2 = PackageManifestV2 & { kind: 'addon' };
export type PackageKindV2 = PackageManifestV2['kind'];
export type AppOperationV2 = NADV2AppOperation;
export type ConnectionProfileSchemaV2 = NADV2ConnectionProfileSchema;
export type HttpAccessScopeV2 = NADV2ScopedHTTPAccess;
export type UiBridgeConnectV2 = NADUIAPIV2SurfaceConnectionBootstrap;
export type SurfacesFileV2 = NADUIAPIV2Surfaces;
export type SurfaceV2 = SurfacesFileV2['surfaces'][number];
export type PackageReleaseRecordV2 = NADV2PackageReleaseRecord;
export interface PackageVerificationV2 {
  manifest: PackageManifestV2;
  checksums: import('./types.js').ChecksumsFile;
  signature: import('./types.js').SignatureFile;
  signatureVerified: boolean;
  entries: string[];
  warnings: string[];
}

/**
 * Engine-facing managed-drive policy contract.
 *
 * Storage Studio supplies the implementation. Core object operations consume
 * this narrow seam so HTTP, scoped server services, workflows, and trusted
 * package callers all enforce the same lifecycle and public-object rules.
 */

export interface StorageManagedObjectPolicy {
  assertLegacyDriveCreationAllowed(): void;
  assertLegacyDriveControlAllowed(driveId: string): void;
  assertObjectAccessAllowed(driveId: string): unknown;
  assertObjectVisibilityAllowed(driveId: string, isPublic: boolean): void;
  captureObjectAccess(driveId: string): Readonly<{ generation?: number }>;
  assertObjectAccessCurrent(driveId: string, generation: number | undefined): void;
}

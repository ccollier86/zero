/** Global avatar identity and presentation policy; image possession is not authorization. */
export interface AuthUserAvatarConfig {
  enabled?: boolean;
  /** Permit explicit publication; existing photos are never made public implicitly. */
  publicAccess?: boolean;
  editable?: boolean;
  shape?: 'circle' | 'rounded' | 'square';
  size?: 'sm' | 'default' | 'lg';
  fallback?: 'initials' | 'username' | 'email' | 'none';
  maxUploadBytes?: number;
  maxPixels?: number;
  outputSize?: number;
}
export interface ResolvedAuthUserAvatarConfig {
  enabled: boolean;
  publicAccess: boolean;
  editable: boolean;
  shape: 'circle' | 'rounded' | 'square';
  size: 'sm' | 'default' | 'lg';
  fallback: 'initials' | 'username' | 'email' | 'none';
  maxUploadBytes: number;
  maxPixels: number;
  outputSize: number;
}
export interface UserAvatarCapabilities extends ResolvedAuthUserAvatarConfig {
  state: 'ready' | 'blocked' | 'disabled';
  publicState?: 'ready' | 'blocked' | 'disabled';
}
export interface UserAvatarAsset {
  id: string;
  width: number;
  height: number;
  byteLength: number;
  mimeType: 'image/webp';
  /** Authenticated SDK delivery path, never an arbitrary external image URL. */
  deliveryPath: string;
}
export interface UserAvatarSnapshot {
  userId: string;
  /** Shared profile revision: avatar and profile edits cannot silently overwrite one another. */
  revision: number;
  asset: UserAvatarAsset | null;
  /** Separately admitted public representation, never the private delivery URL. */
  publicAsset?: UserPublicAvatarAsset | null;
  capabilities: UserAvatarCapabilities;
}
export interface UserPublicAvatarAsset {
  id: string; width: number; height: number; byteLength: number;
  mimeType: 'image/webp'; deliveryPath: string;
}
export interface UserAvatarStage {
  id: string;
  receipt: string;
  expectedRevision: number;
  expiresAt: number;
  upload: import('../storage/types').StorageUploadGrant;
}

'use client';

/** Connected own-avatar editor. Existing Dropzone selects files, Cropper edits them and the Guardian SDK acknowledges persistence. */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useDropzone } from 'react-dropzone';
import { ImagePlus, Trash2, UploadCloud } from 'lucide-react';
import { Avatar, AvatarImage, AvatarFallback } from '../ui/avatar';
import { AvatarPresenceIndicator } from '../avatar-group';
import { Popover, PopoverContent, PopoverTrigger } from '../animate-ui/components/radix/popover';
import { Button } from '../ui/button';
import { useUserAvatar } from '../../frontend/client/user-avatar-hooks';
import { useAuthConfig } from '../../frontend/client/auth-hooks';
import { useClientMaybe } from '../../frontend/client/client-context';
import { useAvatarPresence } from '../../frontend/client/guardian-presence-hooks';
import { getAuthConfigController } from '../../frontend/client/auth-config-controller';
import { isAuthorizationDataReady, isAuthorizationScopeReady, readAuthorizationScopeBoundaryKey, useAuthorizationScopeBoundary } from '../../frontend/client/authorization-scope-hooks';
import type { InternalClient } from '../../frontend/client/sdk';
import type { UserAvatarSnapshot } from '../../auth/auth-user-avatar-types';
import type { UserProfileSnapshot } from '../../auth/auth-user-profile-types';
import { cn } from '../../lib/utils';
import { profileDisplayName, profileInitials } from '../profile-settings/profile-draft';
import { AvatarCropDialog } from './avatar-crop-dialog';
import { userAvatarError } from '../../frontend/client/user-avatar-errors';
import { reportAuthClientActionFailure } from '../../frontend/client/auth-action-observability';

export interface AvatarEditorProps {
  /** Optional profile presentation; no user selector or authority is derived from this snapshot. */
  profile?: UserProfileSnapshot;
  /** Shared profile CAS revision. When omitted, the current avatar snapshot's revision is used. */
  expectedRevision?: number;
  readOnly?: boolean;
  onAccepted?(snapshot: UserAvatarSnapshot): void;
  /** Optional app/profile dirty guard; false leaves the failed crop in place. */
  onReviewLatest?(): Promise<boolean>;
  className?: string;
}
/** Optional feature: disabled capabilities render nothing and do not request private media. */
export function AvatarEditor(props: AvatarEditorProps) {
  const config = useAuthConfig(), boundary = useAuthorizationScopeBoundary();
  const policy = config.status === 'ready' ? config.config?.userProfile?.avatars : undefined;
  const avatar = useUserAvatar({ enabled: policy?.state === 'ready', capabilityKey: JSON.stringify(policy) });
  if (!policy || policy.state === 'disabled') return null;
  if (policy.state === 'blocked') return <span role="status" className="zero-avatar-editor-error">Profile pictures need storage setup.</span>;
  if (!boundary.ready || config.isLoading || avatar.isLoading) return <span role="status" className="zero-avatar-editor-hint">Loading picture…</span>;
  if (!avatar.snapshot) return <span className="zero-avatar-editor-hint">Picture unavailable <Button size="sm" variant="ghost" onClick={() => { void avatar.refresh(); }}>Retry</Button></span>;
  return <AvatarEditorReady key={`${boundary.key}:${JSON.stringify(avatar.snapshot.capabilities)}:${props.readOnly ? 'readonly' : 'editable'}`}
    {...props} avatar={avatar} />;
}
function AvatarEditorReady({ profile, expectedRevision, readOnly, onAccepted, onReviewLatest, className, avatar }: AvatarEditorProps & {
  avatar: ReturnType<typeof useUserAvatar>;
}) {
  const client = useClientMaybe(), boundary = useAuthorizationScopeBoundary(client), snapshot = avatar.snapshot!;
  const presence = useAvatarPresence(snapshot.userId);
  const [picker, setPicker] = useState(false), [candidate, setCandidate] = useState<{ image: File; revision: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const operation = useRef<AbortController | null>(null), mounted = useRef(true), candidateRef = useRef(candidate);
  const trigger = useRef<HTMLButtonElement | null>(null);
  candidateRef.current = candidate;
  const live = useRef({ readOnly, onAccepted, onReviewLatest }); live.current = { readOnly, onAccepted, onReviewLatest };
  const policyKey = JSON.stringify(snapshot.capabilities), editable = !readOnly && snapshot.capabilities.editable;
  const current = () => {
    const internal = client as InternalClient | null, auth = internal?.auth, revision = internal?._authorizationDataBoundary?.revision ?? 0;
    if (!mounted.current || live.current.readOnly || !auth || !auth.isAuthenticated || auth.user?.userId !== snapshot.userId
      || readAuthorizationScopeBoundaryKey(auth, revision) !== boundary.key
      || !isAuthorizationScopeReady(auth.sessionTransition, auth.isRestoring)
      || !isAuthorizationDataReady(revision, auth.authorizationState.status, auth.isAuthenticated)) return false;
    const config = getAuthConfigController(auth).getSnapshot();
    return config.status === 'ready' && JSON.stringify(config.config?.userProfile?.avatars) === policyKey && snapshot.capabilities.editable;
  };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; operation.current?.abort(); }; }, []);
  const dropzone = useDropzone({ multiple: false, maxFiles: 1, maxSize: snapshot.capabilities.maxUploadBytes,
    accept: { 'image/jpeg': [], 'image/png': [], 'image/webp': [] }, disabled: !editable || avatar.isSaving,
    onDropAccepted(files) {
      if (!current() || !files[0]) return;
      setError(null); setCandidate({ image: files[0], revision: expectedRevision ?? snapshot.revision }); setPicker(false);
    }, onDropRejected() { if (current()) setError('Choose one JPEG, PNG or WebP image within the configured size limit.'); },
  });
  const save = async (image: Blob, signal: AbortSignal) => {
    if (!current() || !candidateRef.current || operation.current) throw new DOMException('Avatar scope changed.', 'AbortError');
    const submitted = candidateRef.current;
    const accepted = await avatar.mutate((api, scopedSignal) => api.replace(image, submitted.revision, scopedSignal), signal);
    if (current()) notifyAccepted(accepted);
  };
  const remove = async () => {
    if (!current() || operation.current) return;
    const controller = new AbortController(); operation.current = controller; setError(null);
    try {
      const accepted = await avatar.mutate((api, signal) => api.remove(expectedRevision ?? snapshot.revision, signal), controller.signal);
      if (current() && !controller.signal.aborted) { notifyAccepted(accepted); setPicker(false); }
    } catch (cause) { if (current() && !controller.signal.aborted) setError(userAvatarError(cause)); }
    finally { if (operation.current === controller) operation.current = null; }
  };
  const notifyAccepted = (accepted: UserAvatarSnapshot) => {
    const failed = (cause: unknown) => {
      if (current()) reportAuthClientActionFailure('userAvatarAcceptedCallback', cause, { codeOnly: true });
    };
    // Notifications cannot undo an acknowledged image. Observe async consumer
    // failures as well as synchronous throws, without retrying the media write.
    try { void Promise.resolve(live.current.onAccepted?.(accepted)).catch(failed); }
    catch (cause) { failed(cause); }
  };
  const reviewLatest = async () => {
    if (!current()) return false;
    if (live.current.onReviewLatest) return live.current.onReviewLatest();
    await avatar.refresh(); return current();
  };
  const policy = snapshot.capabilities;
  const fallback = !profile || profile.userId !== snapshot.userId ? policy.fallback === 'none' ? '' : '?' : policy.fallback === 'none' ? ''
    : policy.fallback === 'email' ? profile.email?.slice(0, 2).toUpperCase() ?? ''
    : policy.fallback === 'username' ? profile.values.username.slice(0, 2).toUpperCase() : profileInitials(profile);
  const label = profile?.userId === snapshot.userId ? profileDisplayName(profile) : 'Profile picture';
  const visual = <span className="zero-avatar-editor-visual"><Avatar className="zero-avatar-editor-image">
    {avatar.imageUrl && <AvatarImage src={avatar.imageUrl} alt="" />}
    <AvatarFallback className="zero-avatar-editor-fallback">{fallback}</AvatarFallback></Avatar>
    <AvatarPresenceIndicator enabled={Boolean(presence)} presence={presence} />
  </span>;
  return <div data-slot="avatar-editor" data-shape={policy.shape} data-size={policy.size} className={cn('zero-avatar-editor', className)}
    style={{ '--_avatar-editor-radius': policy.shape === 'circle' ? 'var(--avatar-editor-circle-radius,9999px)'
      : policy.shape === 'rounded' ? 'var(--avatar-editor-rounded-radius,var(--radius))' : 'var(--avatar-editor-square-radius,0px)' } as CSSProperties}>
    {editable ? <Popover open={picker} onOpenChange={setPicker}>
      <PopoverTrigger asChild><button ref={trigger} type="button" className="zero-avatar-editor-trigger" aria-label={`Change ${label}'s profile picture${presence ? ` · ${presence.label}` : ''}`}
        disabled={avatar.isSaving}>{visual}<span className="zero-avatar-editor-overlay"><ImagePlus aria-hidden="true" /></span></button></PopoverTrigger>
      <PopoverContent align="start" className="zero-avatar-editor-picker" onCloseAutoFocus={event => { if (candidateRef.current) event.preventDefault(); }}>
        <div {...dropzone.getRootProps({ className: 'zero-avatar-editor-dropzone', 'aria-label': 'Choose or drop a profile picture' })}>
          <input {...dropzone.getInputProps({ 'aria-label': 'Profile picture file' })} /><UploadCloud aria-hidden="true" />
          <strong>Drop a picture here</strong><span>JPEG, PNG or WebP</span>
          <Button type="button" variant="outline" size="sm" onClick={event => { event.stopPropagation(); dropzone.open(); }}>Choose file</Button>
        </div>
        {snapshot.asset && <Button type="button" size="sm" variant="ghost" className="text-destructive" disabled={avatar.isSaving}
          onClick={() => { void remove(); }}><Trash2 />Remove picture</Button>}
        {error && <p role="alert" className="zero-avatar-editor-error">{error}</p>}
      </PopoverContent>
    </Popover> : <span role="img" className="zero-avatar-editor-trigger" aria-label={`${label}${presence ? ` · ${presence.label}` : ''}`}>{visual}</span>}
    {candidate && <AvatarCropDialog open image={candidate.image} capabilities={policy} readOnly={!editable}
      onOpenChange={open => { if (!open) setCandidate(null); }} onSave={save} onReviewLatest={reviewLatest} onCloseAutoFocus={event => {
        event.preventDefault(); requestAnimationFrame(() => { if (current()) trigger.current?.focus({ preventScroll: true }); });
      }} />}
    {!candidate && avatar.error && <span role="alert" className="zero-avatar-editor-error">{avatar.error}</span>}
  </div>;
}

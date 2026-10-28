'use client';
import { useEffect } from 'react';
import { useClientMaybe } from '../../frontend/client/client-context';
import type { InternalClient } from '../../frontend/client/sdk';
import { useMessagingTyping } from './use-messaging-typing';
import type { MessagingWorkspaceController } from './messaging-workspace-controller';
import type { MessagingWorkspaceState } from './workspace-state';
import type { MessagingParticipant } from '../../messaging/presentation';
import { MessagingComposer, type MessagingComposerProps } from './messaging-composer';
import { ConversationTypingIndicator } from './conversation-activity';
import { Button } from '../ui/button';
import type { MessagingWorkspaceTyping } from './use-support-typing';
interface Props { controller: MessagingWorkspaceController; state: MessagingWorkspaceState; visibility: 'conversation' | 'staff'; disabled: boolean; publish: boolean; nativeTyping?: boolean; externalTyping?: MessagingWorkspaceTyping; participantFor(id: string): MessagingParticipant }
export function WorkspaceComposer(props: Props) {
  const client = useClientMaybe() as InternalClient | null;
  if (props.externalTyping) return <ExternalComposer {...props} typing={props.externalTyping} />;
  return client?.auth && props.nativeTyping !== false ? <NativeComposer {...props} /> : <ComposerBody {...props} />;
}
function ExternalComposer(props: Props & { typing: MessagingWorkspaceTyping }) {
  const uploading = props.state.uploads.some(file => file.state === 'uploading');
  useEffect(() => { if (props.disabled || !props.publish) props.typing.clearTyping(); }, [props.disabled, props.publish, props.typing.clearTyping]);
  useEffect(() => { if (!uploading || props.disabled || !props.publish) return;
    props.typing.markTyping('uploading'); const timer = setInterval(() => props.typing.markTyping('uploading'), 1500);
    return () => { clearInterval(timer); props.typing.clearTyping(); };
  }, [uploading, props.disabled, props.publish, props.typing.markTyping, props.typing.clearTyping]);
  return <><ConversationTypingIndicator participants={props.typing.participants} participantFor={props.participantFor} />
    {props.typing.error && <p role="status" className="zero-messaging-workspace-notice">{props.typing.error}</p>}<ComposerBody {...props} /></>;
}
function NativeComposer(props: Props) {
  const uploading = props.state.uploads.some(file => file.state === 'uploading');
  const typing = useMessagingTyping(props.state.selectedId!, { visibility: props.visibility, publish: props.publish && !props.disabled,
    activity: uploading ? 'uploading' : 'typing' });
  useEffect(() => {
    if (!uploading) return;
    typing.markTyping(); const timer = setInterval(typing.markTyping, 1500);
    return () => { clearInterval(timer); typing.clearTyping(); };
  }, [uploading, typing.markTyping, typing.clearTyping]);
  return <><ConversationTypingIndicator participants={typing.participants} participantFor={props.participantFor} />
    {typing.error && <p className="zero-messaging-workspace-notice" role="status">Typing is unavailable. Message sending has its own authorization.<Button size="xs" variant="ghost" onClick={() => { typing.resetError(); }}>Retry typing connection</Button></p>}
    <ComposerBody {...props} typing={typing} /></>;
}
function ComposerBody({ controller, state, visibility, disabled, typing }: Props & { typing?: Pick<MessagingWorkspaceTyping, 'onTextChange' | 'clearTyping' | 'onCompositionStart' | 'onCompositionEnd'> }) {
  const pending = state.draft.phase === 'sending' || state.draft.phase === 'unknown';
  const safe = (work: Promise<unknown>) => { void work.catch(() => {}); };
  const composer: MessagingComposerProps = { value: state.draft.text, onChange: text => controller.edit(text, state.selectedId, visibility),
    maxLength: state.capabilities?.maxMessageLength,
    disabled: disabled || state.draft.phase === 'unknown', sending: state.draft.phase === 'sending', files: state.uploads,
    onSubmit: () => safe(controller.send(false, visibility, state.selectedId)),
    onAttach: files => controller.addFiles(files, visibility, state.selectedId),
    onRemoveFile: id => safe(controller.removeFile(id)),
    onTyping: typing?.onTextChange, onStopTyping: typing?.clearTyping, onCompositionStart: typing?.onCompositionStart, onCompositionEnd: typing?.onCompositionEnd };
  return <>
    {state.draft.error && <p role="alert" className="zero-messaging-workspace-notice">{state.draft.error}</p>}
    {state.draft.phase === 'unknown' && <div className="zero-messaging-workspace-tools"><Button size="sm" variant="outline" onClick={() => safe(controller.reconcileSend(state.selectedId))}>Check send result</Button>
      <Button size="sm" variant="ghost" onClick={() => safe(controller.send(true, visibility, state.selectedId))}>Retry same message</Button></div>}
    {state.uploads.some(file => file.state === 'failed') && <div className="zero-messaging-workspace-tools">{state.uploads.filter(file => file.state === 'failed').map(file =>
      <Button key={file.id} size="xs" variant="outline" disabled={pending} onClick={() => safe(controller.retryFile(file.id))}>Retry {file.name}</Button>)}</div>}
    <MessagingComposer {...composer} />
    <p className="zero-messaging-workspace-hint">Up to 10 supported files · {Math.floor((state.capabilities?.maxUploadBytes ?? 0) / 1024 / 1024)} MiB per file. Uploads use private conversation storage.</p>
  </>;
}

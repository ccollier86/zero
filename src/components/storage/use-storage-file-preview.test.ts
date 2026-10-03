import { describe, expect, test } from 'bun:test';
import type { FileInfo } from '../../storage/types';
import {
  readBoundedTextResponse,
  storageFilePreviewKind,
} from './use-storage-file-preview';

describe('storage file preview safety', () => {
  test('admits common passive media and text without rendering stored markup', () => {
    expect(storageFilePreviewKind(file('photo.png', 'image/png'))).toBe('image');
    expect(storageFilePreviewKind(file('voice.mp3', 'audio/mpeg'))).toBe('audio');
    expect(storageFilePreviewKind(file('clip.mp4', 'video/mp4'))).toBe('video');
    expect(storageFilePreviewKind(file('report.pdf', 'application/pdf'))).toBe('pdf');
    expect(storageFilePreviewKind(file('notes.md', null))).toBe('text');
    expect(storageFilePreviewKind(file('payload.html', 'text/html'))).toBe('text');
    expect(storageFilePreviewKind(file('active.svg', 'image/svg+xml'))).toBe('unsupported');
    expect(storageFilePreviewKind(file('binary.bin', 'application/octet-stream'))).toBe('unsupported');
  });

  test('bounds streamed text before exposing it to presentation', async () => {
    await expect(readBoundedTextResponse(new Response('hello'), 5)).resolves.toBe('hello');
    await expect(readBoundedTextResponse(new Response('hello!'), 5)).rejects.toThrow(
      'Text preview exceeds',
    );
  });
});

function file(name: string, mimeType: string | null): Pick<FileInfo, 'type' | 'name' | 'mimeType'> {
  return { type: 'file', name, mimeType };
}

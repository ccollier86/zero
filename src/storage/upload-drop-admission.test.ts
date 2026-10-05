import { describe, expect, test } from 'bun:test';
import type { FileRejection } from 'react-dropzone';
import { admitStorageDrop } from './upload-drop-admission';

describe('storage drop event admission', () => {
  test('observes an upload rejection after the upload layer reports it', async () => {
    let observed = false;
    let reported = 0;
    const failure = new Error('Synthetic upload rejection');
    const promise = Promise.reject(failure);
    const originalCatch = promise.catch.bind(promise);
    promise.catch = (handler) => { observed = true; return originalCatch(handler); };
    admitStorageDrop({
      disabled: false,
      isCurrent: () => true,
      upload: () => { reported += 1; return promise; },
    }, [new File(['test'], 'test.txt')], []);
    expect(observed).toBe(true);
    await Promise.resolve();
    expect(reported).toBe(1);
  });

  test('disabled and obsolete admission never starts an upload', () => {
    let calls = 0;
    const upload = async () => { calls += 1; };
    const files = [new File(['test'], 'test.txt')];
    admitStorageDrop({ disabled: true, isCurrent: () => true, upload }, files, []);
    admitStorageDrop({ disabled: false, isCurrent: () => false, upload }, files, []);
    admitStorageDrop({ disabled: false, isCurrent: () => true, upload }, [], []);
    expect(calls).toBe(0);
  });

  test('reports rejected files only within the current scope and does not upload them', () => {
    const rejected: FileRejection[] = [{ file: new File(['test'], 'test.txt'), errors: [{ code: 'file-too-large', message: 'Too large' }] }];
    let result: FileRejection[] | undefined;
    const onRejected = (value: FileRejection[]) => { result = value; };
    const upload = async () => { throw new Error('No accepted files'); };
    admitStorageDrop({ disabled: false, isCurrent: () => false, upload, onRejected }, [], rejected);
    expect(result).toBeUndefined();
    admitStorageDrop({ disabled: false, isCurrent: () => true, upload, onRejected }, [], rejected);
    expect(result).toBe(rejected);
  });
});

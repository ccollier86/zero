import { expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ClientProvider } from '../../frontend/client/client-context';
import { createStorageStudioSdkSurface } from '../../frontend/client/storage-studio-client';
import type { Client } from '../../frontend/client/sdk';
import { StorageStudioManagement } from './storage-studio-management';

test('StorageStudioManagement composes the native controller without replacing legacy StorageManagement', () => {
  const storageStudio = createStorageStudioSdkSurface(async () => undefined as never);
  const client = {
    url: 'http://zero.test',
    isAuthenticated: true,
    storageStudio,
    fetch: async () => undefined,
  } as unknown as Client;

  const markup = renderToStaticMarkup(createElement(
    ClientProvider,
    {
      client,
      children: createElement(StorageStudioManagement, { className: 'native-studio' }),
    },
  ));

  expect(markup).toContain('native-studio');
  expect(markup).toContain('aria-label="Choose files to upload"');
  expect(markup).toContain('Loading drives');
});

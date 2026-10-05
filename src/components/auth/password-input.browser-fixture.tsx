/** Isolated password primitive with a synthetic value and no auth provider. */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { PasswordInput } from './password-input';

createRoot(document.getElementById('root')!).render(
  <>
    <label htmlFor="example-password">Password</label>
    <PasswordInput id="example-password" defaultValue="synthetic-password" />
    <button type="button">Continue</button>
  </>,
);

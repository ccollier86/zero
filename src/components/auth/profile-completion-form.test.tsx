/** SSR and reset-boundary tests for restricted first-use fields, unavailable substrate and proof retirement. */
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { profileCompletionResult } from '../../frontend/client/auth-user-profile-completion.test-fixtures';
import { ProfileCompletionForm, profileCompletionFlowKey } from './profile-completion-form';
import { AuthFlowContinuation, authFlowContinuationKey } from './auth-flow-continuation';
test('SSR renders actual required controls without application-only security or credentials', () => {
  const result = profileCompletionResult(), html = renderToStaticMarkup(<ProfileCompletionForm result={result} />);
  expect(html).toContain('Complete your profile'); expect(html).toContain('First name'); expect(html).toContain('aria-label="required"');
  expect(html).toContain('readOnly=""'); expect(html).not.toContain(result.profileCompletion.continuation);
  expect(html).not.toContain('Change password'); expect(html).not.toContain('Multi-factor'); expect(html).not.toContain('Upload avatar');
  expect(html).not.toContain('Last name'); expect(html).not.toContain('Preferred name'); expect(html).not.toContain('Social profiles');
  expect(html).toMatch(/<button[^>]+disabled=""[^>]*>Continue<\/button>/);
});
test('additional server-required fields render without promoting optional policy or mutating the server snapshot', () => {
  const result = profileCompletionResult();
  result.profileCompletion.profile!.capabilities.fields.lastName.required = true;
  const html = renderToStaticMarkup(<ProfileCompletionForm result={result} />);
  expect(html).toContain('First name'); expect(html).toContain('Last name');
  expect(result.profileCompletion.profile!.capabilities.fields.username.enabled).toBe(false);
  expect(result.profileCompletion.profile!.capabilities.fields.firstName.enabled).toBe(true);
});
test('the shared auth coordinator recognizes the restricted result instead of generic success/onboarding', () => {
  expect(renderToStaticMarkup(<AuthFlowContinuation result={profileCompletionResult()} />)).toContain('data-slot="profile-completion-form"');
});
test('blocked and absent proofs remain explicit, without an empty profile or fabricated credentials', () => {
  const blocked = profileCompletionResult(); blocked.profileCompletion = { ...blocked.profileCompletion, profile: null, state: 'blocked' };
  const unavailable = renderToStaticMarkup(<ProfileCompletionForm result={blocked} />);
  expect(unavailable).toContain('database migration or configuration update'); expect(unavailable).not.toContain('<input');
  expect(renderToStaticMarkup(<ProfileCompletionForm />)).toContain('Start sign-in again');
});
test('proof, owner, revision, readiness and required capability changes synchronously reset both form and coordinator', () => {
  const a = profileCompletionResult();
  const variants = [profileCompletionResult('user-b'),
    { ...a, profileCompletion: { ...a.profileCompletion, continuation: `${a.profileCompletion.continuation}b` } },
    { ...a, profileCompletion: { ...a.profileCompletion, profile: { ...a.profileCompletion.profile!, revision: 2 } } },
    { ...a, profileCompletion: { ...a.profileCompletion, state: 'blocked' as const, profile: null } }];
  for (const b of variants) { expect(profileCompletionFlowKey(a)).not.toBe(profileCompletionFlowKey(b)); expect(authFlowContinuationKey(a)).not.toBe(authFlowContinuationKey(b)); }
});

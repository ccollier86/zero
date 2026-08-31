/** Generous hard limits for untrusted auth HTTP input. */

export const AUTH_REQUEST_LIMITS = Object.freeze({
  username: 254,
  loginIdentifier: 254,
  password: 1_024,
  displayName: 256,
  role: 128,
  userId: 128,
  token: 8_192,
  mfaCode: 128,
  mfaLabel: 128,
  nativeContinuation: 512,
  userSearch: 256,
  propertyKey: 128,
  propertyCount: 256,
  propertyValue: 65_536,
  propertiesPayload: 262_144,
} as const);

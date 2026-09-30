/** Canonical, same-origin path validation shared by auth redirect surfaces. */

const LOCAL_ORIGIN = 'https://zero.local';
const MAX_LOCAL_PATH_LENGTH = 4_096;

/** Normalize a root-relative local URL, including query and hash. */
export function normalizeAbsoluteLocalPath(value: unknown): string | null {
  if (typeof value !== 'string' || !isSafeRootRelativeShape(value)) return null;

  try {
    const url = new URL(value, LOCAL_ORIGIN);
    if (url.origin !== LOCAL_ORIGIN) return null;

    const normalized = `${url.pathname}${url.search}${url.hash}`;
    if (!isSafeRootRelativeShape(normalized)) return null;

    // URL parsing removes dot segments before serialization. Rechecking the
    // decoded pathname prevents encoded slash/backslash/control ambiguity from
    // turning that canonical output into a protocol-relative target later.
    const decodedPathname = decodeURIComponent(url.pathname);
    if (
      decodedPathname.startsWith('//')
      || /[\\\u0000-\u001f\u007f]/.test(decodedPathname)
    ) {
      return null;
    }

    return normalized;
  } catch {
    return null;
  }
}

/** Normalize a trusted app setting, accepting an omitted leading slash. */
export function normalizeConfiguredLocalPath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (
    !trimmed
    || trimmed.startsWith('//')
    || /^[a-z][a-z\d+.-]*:/i.test(trimmed)
  ) {
    return null;
  }

  return normalizeAbsoluteLocalPath(
    trimmed.startsWith('/') ? trimmed : `/${trimmed}`,
  );
}

function isSafeRootRelativeShape(value: string): boolean {
  return value.length > 0
    && value.length <= MAX_LOCAL_PATH_LENGTH
    && value === value.trim()
    && value.startsWith('/')
    && !value.startsWith('//')
    && !/[\\\u0000-\u001f\u007f]/.test(value);
}

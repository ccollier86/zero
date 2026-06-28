// ─── Server-Side MIME Detection ──────────────────────────────────────────

/**
 * Detect MIME type from file magic bytes.
 * Never trust the client's Content-Type header — always verify server-side.
 *
 * Covers the most common file types. Falls back to `application/octet-stream`.
 */
export function detectMimeType(bytes: Uint8Array, fileName?: string): string {
  // Check magic bytes first (most reliable)
  const magic = detectFromMagicBytes(bytes);
  if (magic) return magic;

  // Fall back to file extension
  if (fileName) {
    const ext = detectFromExtension(fileName);
    if (ext) return ext;
  }

  return 'application/octet-stream';
}

// ─── Magic Byte Signatures ───────────────────────────────────────────────

interface MagicSignature {
  bytes: number[];
  offset?: number;
  mime: string;
}

const SIGNATURES: MagicSignature[] = [
  // Images
  { bytes: [0xFF, 0xD8, 0xFF], mime: 'image/jpeg' },
  { bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], mime: 'image/png' },
  { bytes: [0x47, 0x49, 0x46, 0x38], mime: 'image/gif' },
  { bytes: [0x52, 0x49, 0x46, 0x46], mime: 'image/webp' }, // RIFF....WEBP — checked with extra logic below
  { bytes: [0x42, 0x4D], mime: 'image/bmp' },
  { bytes: [0x00, 0x00, 0x01, 0x00], mime: 'image/x-icon' },
  { bytes: [0x00, 0x00, 0x02, 0x00], mime: 'image/x-icon' },

  // PDF
  { bytes: [0x25, 0x50, 0x44, 0x46], mime: 'application/pdf' },

  // ZIP-based (docx, xlsx, pptx, jar, etc.)
  { bytes: [0x50, 0x4B, 0x03, 0x04], mime: 'application/zip' },

  // Audio
  { bytes: [0x49, 0x44, 0x33], mime: 'audio/mpeg' }, // ID3 tag
  { bytes: [0xFF, 0xFB], mime: 'audio/mpeg' }, // MP3 frame sync
  { bytes: [0xFF, 0xF3], mime: 'audio/mpeg' },
  { bytes: [0xFF, 0xF2], mime: 'audio/mpeg' },
  { bytes: [0x4F, 0x67, 0x67, 0x53], mime: 'audio/ogg' },
  { bytes: [0x66, 0x4C, 0x61, 0x43], mime: 'audio/flac' },

  // Video
  { bytes: [0x1A, 0x45, 0xDF, 0xA3], mime: 'video/webm' },
  { bytes: [0x00, 0x00, 0x00], mime: 'video/mp4' }, // ftyp check done separately

  // Archives
  { bytes: [0x1F, 0x8B], mime: 'application/gzip' },
  { bytes: [0x42, 0x5A, 0x68], mime: 'application/x-bzip2' },
  { bytes: [0xFD, 0x37, 0x7A, 0x58, 0x5A, 0x00], mime: 'application/x-xz' },
  { bytes: [0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C], mime: 'application/x-7z-compressed' },

  // Documents
  { bytes: [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1], mime: 'application/msword' },

  // WASM
  { bytes: [0x00, 0x61, 0x73, 0x6D], mime: 'application/wasm' },

  // SQLite
  { bytes: [0x53, 0x51, 0x4C, 0x69, 0x74, 0x65], mime: 'application/x-sqlite3' },
];

function detectFromMagicBytes(bytes: Uint8Array): string | null {
  if (bytes.length < 12) {
    // Still try short signatures
    for (const sig of SIGNATURES) {
      const offset = sig.offset ?? 0;
      if (bytes.length < offset + sig.bytes.length) continue;
      if (matchesAt(bytes, sig.bytes, offset)) return sig.mime;
    }
    return null;
  }

  // RIFF container — check for WEBP or AVI
  if (matchesAt(bytes, [0x52, 0x49, 0x46, 0x46], 0)) {
    if (matchesAt(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
    if (matchesAt(bytes, [0x41, 0x56, 0x49, 0x20], 8)) return 'video/avi';
    if (matchesAt(bytes, [0x57, 0x41, 0x56, 0x45], 8)) return 'audio/wav';
  }

  // MP4/MOV — ftyp box at offset 4
  if (matchesAt(bytes, [0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    if (brand === 'qt  ' || brand === 'mqt ') return 'video/quicktime';
    if (brand.startsWith('M4A')) return 'audio/mp4';
    return 'video/mp4';
  }

  // SVG: only detect via file extension (content sniffing enables XSS
  // if the file is served inline — attacker uploads HTML-in-SVG with scripts)

  // Check all signatures
  for (const sig of SIGNATURES) {
    const offset = sig.offset ?? 0;
    if (bytes.length < offset + sig.bytes.length) continue;

    // Skip the generic 0x00,0x00,0x00 signature — handled by ftyp check above
    if (sig.bytes.length === 3 && sig.bytes[0] === 0 && sig.bytes[1] === 0 && sig.bytes[2] === 0) continue;
    // Skip RIFF — handled above
    if (sig.bytes[0] === 0x52 && sig.bytes[1] === 0x49) continue;

    if (matchesAt(bytes, sig.bytes, offset)) return sig.mime;
  }

  return null;
}

function matchesAt(bytes: Uint8Array, signature: number[], offset: number): boolean {
  for (let i = 0; i < signature.length; i++) {
    if (bytes[offset + i] !== signature[i]) return false;
  }
  return true;
}

// ─── Extension Fallback ──────────────────────────────────────────────────

const EXTENSION_MAP: Record<string, string> = {
  // Text
  '.txt': 'text/plain',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.csv': 'text/csv',
  '.xml': 'text/xml',
  '.md': 'text/markdown',

  // JavaScript / TypeScript
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.ts': 'text/typescript',
  '.tsx': 'text/typescript',
  '.jsx': 'text/javascript',
  '.json': 'application/json',
  '.jsonl': 'application/jsonl',

  // Images
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff',

  // Fonts
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',

  // Office
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',

  // Media
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.opus': 'audio/opus',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',

  // Archive
  '.tar': 'application/x-tar',
  '.rar': 'application/vnd.rar',

  // Misc
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
  '.toml': 'application/toml',
  '.wasm': 'application/wasm',
};

function detectFromExtension(fileName: string): string | null {
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot === -1) return null;
  const ext = fileName.slice(lastDot).toLowerCase();
  return EXTENSION_MAP[ext] ?? null;
}

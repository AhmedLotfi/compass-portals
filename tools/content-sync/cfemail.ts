/**
 * Decodes a Cloudflare email-obfuscation string (`data-cfemail` attribute or `/cdn-cgi/l/email-protection#…`).
 * The first byte is an XOR key applied to every following byte; the result is UTF-8.
 */
export function decodeCfEmail(encoded: string): string | undefined {
  const hex = encoded.trim().replace(/^#/, '');
  if (hex.length < 4 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) return undefined;
  const key = parseInt(hex.slice(0, 2), 16);
  const bytes = new Uint8Array(hex.length / 2 - 1);
  for (let i = 2; i < hex.length; i += 2) {
    bytes[i / 2 - 1] = parseInt(hex.slice(i, i + 2), 16) ^ key;
  }
  return new TextDecoder().decode(bytes);
}

/** Encodes an email the way Cloudflare does; used to build test fixtures. */
export function encodeCfEmail(email: string, key = 0x5a): string {
  let hex = key.toString(16).padStart(2, '0');
  for (const byte of new TextEncoder().encode(email)) {
    hex += (byte ^ key).toString(16).padStart(2, '0');
  }
  return hex;
}

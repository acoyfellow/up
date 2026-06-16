const encoder = new TextEncoder();
const decoder = new TextDecoder();
const base64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const raw = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index++) bytes[index] = raw.charCodeAt(index);
  return bytes;
}
async function key(value: string): Promise<CryptoKey> {
  const bytes = decodeBase64Url(value);
  if (bytes.byteLength !== 32) throw new Error('SECRETS_KEY must be 32 bytes of base64url');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export interface EncryptedSecret {
  ciphertext: string;
  iv: string;
}
export async function encryptSecret(value: string, secretKey: string): Promise<EncryptedSecret> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await key(secretKey),
    encoder.encode(value),
  );
  return { ciphertext: base64Url(new Uint8Array(ciphertext)), iv: base64Url(iv) };
}
export async function decryptSecret(
  encrypted: EncryptedSecret,
  secretKey: string,
): Promise<string> {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: decodeBase64Url(encrypted.iv) },
    await key(secretKey),
    decodeBase64Url(encrypted.ciphertext),
  );
  return decoder.decode(plaintext);
}
export function cleanSecretName(value: string): string | null {
  const name = value.trim().toUpperCase();
  return /^[A-Z][A-Z0-9_]{0,63}$/.test(name) ? name : null;
}
export function cleanAllowedHosts(input: unknown): string[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > 20)
    throw new Error('Secrets require 1-20 allowed hosts');
  const hosts = input.map((value) => {
    if (typeof value !== 'string') throw new Error('Invalid allowed host');
    const host = value.trim().toLowerCase();
    if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host))
      throw new Error('Invalid allowed host');
    return host;
  });
  return [...new Set(hosts)];
}

const utf8 = new TextEncoder();
const utf8Decoder = new TextDecoder();

export function encodeJson(value: unknown): Uint8Array {
  return utf8.encode(JSON.stringify(value));
}

export function decodeJson(body: Uint8Array): unknown {
  return JSON.parse(utf8Decoder.decode(body));
}

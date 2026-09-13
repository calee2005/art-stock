export async function sha256Hex(body: Uint8Array): Promise<string> {
  const copy = new Uint8Array(body.byteLength);
  copy.set(body);
  const digest = await crypto.subtle.digest("SHA-256", copy);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

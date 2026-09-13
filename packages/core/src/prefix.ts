/** Default RemoteConfig.prefix: bucket root. Protocol lives under `.artstock/v1/`, not in this field. */
export const DEFAULT_REMOTE_PREFIX = "";

/**
 * Normalize a bucket-global prefix.
 * Empty stays empty. Non-empty values have extra slashes stripped and end with `/`.
 */
export function normalizePrefix(raw: string | undefined | null): string {
  if (raw == null) {
    return DEFAULT_REMOTE_PREFIX;
  }
  let value = raw.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  if (value === "") {
    return DEFAULT_REMOTE_PREFIX;
  }
  return `${value}/`;
}

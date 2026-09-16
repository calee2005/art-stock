export type AssetKind = "image" | "video" | "model" | "other";

const MODEL_EXT = /\.(gltf|glb|fbx|obj|blend|ma|mb|c4d|ztl|spp|stl)$/i;
const VIDEO_EXT = /\.(mp4|mov|webm|mkv|avi)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|tif|tiff|psd|clip|kra)$/i;

export function assetKind(mimeType: string, name: string): AssetKind {
  const mime = mimeType.toLowerCase();
  if (mime.startsWith("image/")) {
    return "image";
  }
  if (mime.startsWith("video/")) {
    return "video";
  }
  if (MODEL_EXT.test(name) || mime.includes("model") || mime.includes("gltf")) {
    return "model";
  }
  if (VIDEO_EXT.test(name)) {
    return "video";
  }
  if (IMAGE_EXT.test(name)) {
    return "image";
  }
  return "other";
}

export function formatLabel(mimeType: string, name: string): string {
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toUpperCase() : "";
  if (ext) {
    return ext === "JPEG" ? "JPG" : ext;
  }
  if (mimeType.startsWith("image/")) {
    return mimeType.slice(6).toUpperCase();
  }
  return mimeType || "FILE";
}

export function countAssetKinds(
  items: { mimeType: string; name: string }[],
): Record<AssetKind, number> {
  const counts: Record<AssetKind, number> = {
    image: 0,
    video: 0,
    model: 0,
    other: 0,
  };
  for (const item of items) {
    counts[assetKind(item.mimeType, item.name)] += 1;
  }
  return counts;
}

export function matchesFormat(
  mimeType: string,
  name: string,
  format: string,
): boolean {
  if (!format || format === "all") {
    return true;
  }
  return formatLabel(mimeType, name).toLowerCase() === format.toLowerCase();
}

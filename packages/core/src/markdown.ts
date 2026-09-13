export const ARTSTOCK_ASSET_PREFIX = "artstock://asset/";

export function artstockAssetUrl(assetId: string): string {
  return `${ARTSTOCK_ASSET_PREFIX}${assetId}`;
}

export function parseArtstockAssetId(href: string): string | null {
  const trimmed = href.trim();
  if (!trimmed.startsWith(ARTSTOCK_ASSET_PREFIX)) {
    return null;
  }
  const id = trimmed.slice(ARTSTOCK_ASSET_PREFIX.length).split(/[?#]/)[0];
  return id || null;
}

export function isPublicNetworkUrl(href: string): boolean {
  return /^https?:\/\//i.test(href.trim());
}

export type TocEntry = {
  level: number;
  text: string;
  id: string;
};

export function slugifyHeading(text: string): string {
  const slug = text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w\u4e00-\u9fff-]/g, "");
  return slug || "heading";
}

export function markdownToc(md: string): TocEntry[] {
  const entries: TocEntry[] = [];
  const seen = new Map<string, number>();
  for (const line of md.split("\n")) {
    const match = /^(#{1,6})\s+(.+)$/.exec(line);
    if (!match?.[1] || !match[2]) {
      continue;
    }
    const text = match[2].trim();
    let id = slugifyHeading(text);
    const count = (seen.get(id) ?? 0) + 1;
    seen.set(id, count);
    if (count > 1) {
      id = `${id}-${count}`;
    }
    entries.push({ level: match[1].length, text, id });
  }
  return entries;
}

/**
 * Resolve media src for preview. artstock://asset/{id} never becomes http(s).
 */
export function resolveMarkdownMediaSrc(
  href: string,
  resolveAsset: (assetId: string) => string | null,
): string | null {
  const assetId = parseArtstockAssetId(href);
  if (assetId) {
    const local = resolveAsset(assetId);
    if (!local) {
      return null;
    }
    if (isPublicNetworkUrl(local)) {
      throw new Error("artstock://asset must not resolve to a public URL");
    }
    return local;
  }
  if (href.trim().toLowerCase().startsWith("artstock:")) {
    return null;
  }
  return href;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function markdownToHtml(
  md: string,
  resolveAsset: (assetId: string) => string | null = () => null,
): string {
  const toc = markdownToc(md);
  let headingIndex = 0;
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let inList = false;
  const flushList = () => {
    if (inList) {
      html.push("</ul>");
      inList = false;
    }
  };
  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading?.[1] && heading[2]) {
      flushList();
      const level = heading[1].length;
      const text = heading[2].trim();
      const id = toc[headingIndex]?.id ?? slugifyHeading(text);
      headingIndex += 1;
      html.push(`<h${level} id="${escapeHtml(id)}">${escapeHtml(text)}</h${level}>`);
      continue;
    }
    const image = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(line.trim());
    if (image) {
      flushList();
      const alt = image[1] ?? "";
      const href = image[2] ?? "";
      const assetId = parseArtstockAssetId(href);
      const src = resolveMarkdownMediaSrc(href, resolveAsset) ?? "";
      const assetAttr = assetId
        ? ` data-artstock-asset="${escapeHtml(assetId)}"`
        : "";
      html.push(
        `<p><img alt="${escapeHtml(alt)}" src="${escapeHtml(src)}"${assetAttr} /></p>`,
      );
      continue;
    }
    const list = /^[-*]\s+(.+)$/.exec(line);
    if (list?.[1]) {
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${escapeHtml(list[1])}</li>`);
      continue;
    }
    flushList();
    if (line.trim() === "") {
      continue;
    }
    html.push(`<p>${escapeHtml(line)}</p>`);
  }
  flushList();
  return html.join("");
}

export function htmlToMarkdown(html: string): string {
  const lines: string[] = [];
  const normalized = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/&nbsp;/g, " ");
  const block =
    /<(h[1-6]|p|li|ul|ol)(\s[^>]*)?>([\s\S]*?)<\/\1>|<(img)(\s[^>]*)\/?>/gi;
  let match: RegExpExecArray | null;
  while ((match = block.exec(normalized))) {
    const tag = (match[1] ?? match[4] ?? "").toLowerCase();
    if (tag.startsWith("h")) {
      const level = Number(tag.slice(1));
      const text = stripTags(match[3] ?? "").trim();
      if (text) {
        lines.push(`${"#".repeat(level)} ${text}`);
      }
      continue;
    }
    if (tag === "li") {
      const text = stripTags(match[3] ?? "").trim();
      if (text) {
        lines.push(`- ${text}`);
      }
      continue;
    }
    if (tag === "img") {
      const attrs = match[5] ?? "";
      const asset = /data-artstock-asset="([^"]+)"/.exec(attrs)?.[1];
      const alt = /alt="([^"]*)"/.exec(attrs)?.[1] ?? "";
      const src = /src="([^"]*)"/.exec(attrs)?.[1] ?? "";
      const href = asset ? artstockAssetUrl(asset) : src;
      lines.push(`![${alt}](${href})`);
      continue;
    }
    if (tag === "p") {
      const inner = match[3] ?? "";
      const img = /<img(\s[^>]*)\/?>/i.exec(inner);
      if (img) {
        const attrs = img[1] ?? "";
        const asset = /data-artstock-asset="([^"]+)"/.exec(attrs)?.[1];
        const alt = /alt="([^"]*)"/.exec(attrs)?.[1] ?? "";
        const src = /src="([^"]*)"/.exec(attrs)?.[1] ?? "";
        const href = asset ? artstockAssetUrl(asset) : src;
        lines.push(`![${alt}](${href})`);
      } else {
        const text = stripTags(inner).trim();
        if (text) {
          lines.push(text);
        }
      }
    }
  }
  return lines.join("\n");
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
}

export function insertAssetEmbed(md: string, assetId: string, alt = ""): string {
  const embed = `![${alt}](${artstockAssetUrl(assetId)})`;
  if (!md.trim()) {
    return embed;
  }
  return `${md.replace(/\s+$/, "")}\n${embed}`;
}

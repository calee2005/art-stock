import { encodeJson, decodeJson } from "./json.ts";
import { blobKey, objectMetaKey } from "./keys.ts";
import { compareHlc, createHlcClock, tickHlc, type HlcClock } from "./hlc.ts";
import {
  withRemoteLock,
  type RemoteLockTarget,
  type WithRemoteLockOptions,
} from "./lock.ts";
import type { Hlc, ObjectMeta } from "./types.ts";
import type { ObjectStore } from "./store.ts";
import { readBranchSnapshot } from "./versions.ts";

const lockOpts = (options?: WithRemoteLockOptions): WithRemoteLockOptions => ({
  probe: false,
  scheduleHeartbeat: () => () => {},
  ...options,
});

export type PdfViewer = {
  objectId: string;
  blobSha256: string;
  pageCount: number | null;
  currentPage: number;
  bytes: Uint8Array | null;
};

export type PdfWriteOptions = WithRemoteLockOptions & {
  clock?: HlcClock;
  nowMs?: number;
};

function pdfEscape(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/** ASCII-only fixture PDF used in tests and as a viewer sample. */
export function encodeMinimalPdf(pageTexts: string[]): Uint8Array {
  if (pageTexts.length < 1) {
    throw new Error("PDF needs at least one page");
  }
  const n = pageTexts.length;
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let pos = 0;
  const push = (text: string) => {
    const bytes = encoder.encode(text);
    chunks.push(bytes);
    pos += bytes.length;
  };
  push("%PDF-1.4\n");
  const addObj = (body: string): number => {
    offsets.push(pos);
    const id = offsets.length;
    push(`${id} 0 obj\n${body}\nendobj\n`);
    return id;
  };
  const fontId = 3 + 2 * n;
  addObj("<< /Type /Catalog /Pages 2 0 R >>");
  const kids = Array.from({ length: n }, (_, i) => `${3 + i} 0 R`).join(" ");
  addObj(`<< /Type /Pages /Kids [${kids}] /Count ${n} >>`);
  for (let i = 0; i < n; i++) {
    addObj(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${3 + n + i} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`,
    );
  }
  for (const text of pageTexts) {
    const stream = `BT /F1 24 Tf 72 720 Td (${pdfEscape(text)}) Tj ET`;
    addObj(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  addObj("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const xrefPos = pos;
  let xref = `xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    xref += `${String(off).padStart(10, "0")} 00000 n \n`;
  }
  push(xref);
  push(
    `trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`,
  );
  const out = new Uint8Array(pos);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function decodePdf(bytes: Uint8Array): string {
  return new TextDecoder("latin1").decode(bytes);
}

/** Read /Count from the Pages tree root. */
export function countPdfPages(bytes: Uint8Array): number | null {
  const text = decodePdf(bytes);
  const withKids = /\/Type\s*\/Pages\b[\s\S]{0,400}?\/Kids\s*\[[^\]]*\][\s\S]{0,80}?\/Count\s+(\d+)/.exec(
    text,
  );
  if (withKids?.[1]) {
    return Number(withKids[1]);
  }
  const countFirst =
    /\/Count\s+(\d+)[\s\S]{0,400}?\/Type\s*\/Pages\b[\s\S]{0,80}?\/Kids/.exec(text);
  if (countFirst?.[1]) {
    return Number(countFirst[1]);
  }
  return null;
}

export function extractPdfPageText(
  bytes: Uint8Array,
  page: number,
): string | null {
  const texts = [...decodePdf(bytes).matchAll(/\((?:\\.|[^\\)])*\) Tj/g)].map(
    (match) =>
      match[0]
        .slice(1, match[0].length - 4)
        .replace(/\\([()\\])/g, "$1"),
  );
  return texts[page - 1] ?? null;
}

export function isPdfName(name: string, mimeType?: string): boolean {
  const mime = mimeType?.toLowerCase() ?? "";
  if (mime === "application/pdf" || mime === "application/x-pdf") {
    return true;
  }
  return /\.pdf$/i.test(name);
}

export function createPdfViewer(input: {
  objectId: string;
  blobSha256: string;
  pageCount?: number | null;
}): PdfViewer {
  return {
    objectId: input.objectId,
    blobSha256: input.blobSha256,
    pageCount: input.pageCount ?? null,
    currentPage: 1,
    bytes: null,
  };
}

/** Snapshot + meta only. Does not GET `blobs/{sha}`. */
export async function preparePdfViewer(
  store: ObjectStore,
  prefix: string,
  objectId: string,
  branch?: string,
): Promise<PdfViewer | null> {
  const snapshot = await readBranchSnapshot(store, prefix, objectId, branch);
  if (!snapshot) {
    return null;
  }
  const metaGot = await store.get(objectMetaKey(prefix, objectId));
  const meta = metaGot ? (decodeJson(metaGot.body) as ObjectMeta) : null;
  return createPdfViewer({
    objectId,
    blobSha256: snapshot.blobSha256,
    pageCount: meta?.pageCount ?? null,
  });
}

export function goToPdfPage(viewer: PdfViewer, page: number): PdfViewer {
  const max = viewer.pageCount ?? Math.max(page, 1);
  const currentPage = Math.min(max, Math.max(1, Math.trunc(page)));
  return { ...viewer, currentPage };
}

export async function loadPdfOriginal(
  store: ObjectStore,
  prefix: string,
  viewer: PdfViewer,
): Promise<PdfViewer> {
  const got = await store.get(blobKey(prefix, viewer.blobSha256));
  if (!got) {
    throw new Error("CACHE_MISS");
  }
  const pageCount = countPdfPages(got.body) ?? viewer.pageCount;
  return {
    ...viewer,
    bytes: got.body,
    pageCount,
    currentPage: 1,
  };
}

export function pickLwwPageCount(
  a: Pick<ObjectMeta, "pageCount" | "pageCountHlc">,
  b: Pick<ObjectMeta, "pageCount" | "pageCountHlc">,
): Pick<ObjectMeta, "pageCount" | "pageCountHlc"> {
  const empty: Hlc = { ts: 0, c: 0, deviceId: "" };
  return compareHlc(a.pageCountHlc ?? empty, b.pageCountHlc ?? empty) >= 0
    ? { pageCount: a.pageCount, pageCountHlc: a.pageCountHlc }
    : { pageCount: b.pageCount, pageCountHlc: b.pageCountHlc };
}

export async function writeObjectPageCount(
  remote: RemoteLockTarget,
  objectId: string,
  pageCount: number,
  options?: PdfWriteOptions,
): Promise<ObjectMeta> {
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    throw new Error("pageCount must be a positive integer");
  }
  const prefix = remote.prefix ?? "";
  const clock = options?.clock ?? createHlcClock(remote.deviceId);
  return withRemoteLock(
    remote,
    "sync",
    async () => {
      const metaGot = await remote.store.get(objectMetaKey(prefix, objectId));
      if (!metaGot) {
        throw new Error(`Object not found: ${objectId}`);
      }
      const meta = decodeJson(metaGot.body) as ObjectMeta;
      meta.pageCount = pageCount;
      meta.pageCountHlc = tickHlc(clock, options?.nowMs ?? Date.now());
      meta.updatedAt = new Date().toISOString();
      await remote.store.put(objectMetaKey(prefix, objectId), encodeJson(meta), {
        contentType: "application/json",
        ifMatch: metaGot.etag,
      });
      return meta;
    },
    lockOpts(options),
  );
}

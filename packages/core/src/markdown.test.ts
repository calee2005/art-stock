import assert from "node:assert/strict";
import { test } from "node:test";
import {
  artstockAssetUrl,
  htmlToMarkdown,
  insertAssetEmbed,
  markdownToHtml,
  markdownToc,
  parseArtstockAssetId,
  resolveMarkdownMediaSrc,
} from "./markdown.ts";

test("TOC follows ATX headings for jump targets", () => {
  const md = "# 标题\n\n## 列表\n\n- a\n";
  const toc = markdownToc(md);
  assert.equal(toc.length, 2);
  assert.equal(toc[0]?.level, 1);
  assert.equal(toc[0]?.text, "标题");
  assert.equal(toc[1]?.id, "列表");
  const html = markdownToHtml(md);
  assert.match(html, /id="标题"/);
  assert.match(html, /<h2 id="列表">/);
});

test("artstock://asset embeds never resolve to the public network", () => {
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const href = artstockAssetUrl(id);
  assert.equal(parseArtstockAssetId(href), id);
  const local = resolveMarkdownMediaSrc(href, (assetId) =>
    assetId === id ? "blob:local-thumb" : null,
  );
  assert.equal(local, "blob:local-thumb");
  assert.equal(resolveMarkdownMediaSrc(href, () => null), null);
  assert.throws(
    () => resolveMarkdownMediaSrc(href, () => "https://cdn.example/x.png"),
    /must not resolve to a public URL/,
  );
  const md = insertAssetEmbed("# Doc", id, "cover");
  assert.match(md, /artstock:\/\/asset\//);
  assert.equal(md.includes("https://"), false);
  const html = markdownToHtml(md, () => "blob:local-thumb");
  assert.match(html, /data-artstock-asset=/);
  assert.equal(html.includes("https://"), false);
  const roundTrip = htmlToMarkdown(html);
  assert.match(roundTrip, /!\[cover\]\(artstock:\/\/asset\/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\)/);
});

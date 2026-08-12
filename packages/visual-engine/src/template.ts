import type { VisualBrand, VisualPageScript } from "./types.js";

const HEX_COLOR = /^#[a-f0-9]{6}$/i;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function color(value: string): string {
  if (!HEX_COLOR.test(value)) throw new Error("VISUAL_BRAND_INVALID");
  return value;
}

export function createPageTemplate(input: {
  page: VisualPageScript;
  brand: VisualBrand;
  fontBase64: string;
  screenshotDataUrl: string | null;
}): string {
  const { page, brand } = input;
  const screenshot = input.screenshotDataUrl === null
    ? `<div class="fallback" aria-label="brand illustration"><span></span><span></span><span></span></div>`
    : `<div class="media"><img src="${escapeHtml(input.screenshotDataUrl)}" alt="verified product screenshot" /></div>`;

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=1080, initial-scale=1" />
  <style>
    @font-face {
      font-family: "Noto Sans SC Local";
      src: url("data:font/woff2;base64,${input.fontBase64}") format("woff2");
      font-style: normal;
      font-weight: 400;
      font-display: block;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; width: 1080px; height: 1440px; overflow: hidden; }
    body {
      background: ${color(brand.background)};
      color: ${color(brand.foreground)};
      font-family: "Noto Sans SC Local";
    }
    .canvas { position: relative; width: 1080px; height: 1440px; overflow: hidden; }
    .safe-area {
      position: absolute;
      inset: 80px;
      display: flex;
      flex-direction: column;
      gap: 28px;
      overflow: hidden;
    }
    .meta { display: flex; align-items: center; justify-content: space-between; min-height: 56px; }
    .page-number { font-size: 30px; letter-spacing: .08em; }
    .brand-mark { font-size: 28px; letter-spacing: .08em; }
    .headline {
      flex: none;
      max-height: 292px;
      overflow: hidden;
      font-size: 82px;
      line-height: 1.12;
      letter-spacing: -.035em;
    }
    .body {
      flex: none;
      max-height: ${input.screenshotDataUrl === null ? "390px" : "250px"};
      overflow: hidden;
      font-size: 40px;
      line-height: 1.55;
      white-space: pre-wrap;
    }
    .media {
      flex: 1 1 auto;
      min-height: 0;
      padding: 26px;
      border: 4px solid ${color(brand.foreground)};
      border-radius: 38px;
      background: #ffffff;
      overflow: hidden;
    }
    .media img { width: 100%; height: 100%; display: block; object-fit: contain; }
    .fallback {
      flex: 1 1 auto;
      min-height: 0;
      position: relative;
      border: 4px solid ${color(brand.foreground)};
      border-radius: 38px;
      overflow: hidden;
      background: ${color(brand.accent)};
    }
    .fallback span { position: absolute; display: block; border-radius: 999px; background: ${color(brand.background)}; }
    .fallback span:nth-child(1) { width: 420px; height: 420px; left: -80px; bottom: -110px; }
    .fallback span:nth-child(2) { width: 260px; height: 260px; right: 70px; top: 70px; }
    .fallback span:nth-child(3) { width: 150px; height: 150px; right: 280px; bottom: 80px; }
    .purpose { flex: none; font-size: 24px; letter-spacing: .08em; opacity: .72; }
  </style>
</head>
<body>
  <main class="canvas">
    <section class="safe-area" data-safe-area>
      <header class="meta">
        <span class="page-number" data-measure>${String(page.page).padStart(2, "0")} / 07</span>
        <span class="brand-mark" data-measure>${escapeHtml(brand.mark)}</span>
      </header>
      <div class="headline" data-measure>${escapeHtml(page.headline)}</div>
      <div class="body" data-measure>${escapeHtml(page.body)}</div>
      ${screenshot}
      <footer class="purpose" data-measure>${escapeHtml(page.purpose)}</footer>
    </section>
  </main>
</body>
</html>`;
}

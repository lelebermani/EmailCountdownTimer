import express from "express";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
import { Resvg } from "@resvg/resvg-js";
import GIFEncoder from "gif-encoder-2";
import { PNG } from "pngjs";

dayjs.extend(utc);
dayjs.extend(timezone);

const app = express();

function getParams(q) {
  const to   = q.to || "";
  const tz   = q.tz || "UTC";

  // Defaults tuned for email
  const width  = Math.max(300, Math.min(1200, parseInt(q.w || "540", 10)));
  const height = Math.max(100, Math.min(400,  parseInt(q.h || "160", 10)));

  const bg     = `#${(q.bg || "FFFFFF").replace("#","")}`;
  const fg     = `#${(q.fg || "111827").replace("#","")}`;
  const accent = `#${(q.accent || "D9D6FE").replace("#","")}`;
  const font   = q.font || "monospace, Menlo, Consolas, 'Liberation Mono', Arial";

  // duration in seconds; cap to 120 to avoid Render timeouts
  const dur = Math.max(30, Math.min(parseInt(q.dur || "120", 10), 120));

  // GIF quality: higher = more compression (smaller file), default 25
  const qfactor = Math.max(1, Math.min(parseInt(q.q || "25", 10), 40));

  let target = to ? dayjs.tz(to, tz) : null;
  if (!target || !target.isValid()) target = dayjs().tz(tz).add(1, "day");

  return { target, tz, width, height, bg, fg, accent, font, dur, qfactor };
}

function splitDHMS(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  return {
    days: Math.floor(s / 86400),
    hours: Math.floor((s % 86400) / 3600),
    minutes: Math.floor((s % 3600) / 60),
    seconds: s % 60
  };
}
const pad2 = (n) => String(n).padStart(2, "0");

function svgMarkupGrid(p, dhms) {
  const { width, height, bg, fg, accent, font } = p;
  const { days, hours, minutes, seconds } = dhms;

  // Grid layout: M margin, 4 equal cells
  const M = Math.max(10, Math.floor(width * 0.06));
  const usable = width - M * 2;
  const cells = 4;
  const cellW = usable / cells;

  // Digit font scales by height and cell width (so 2 vs 3 digits won’t overflow)
  const numFont = Math.floor(Math.min(height * 0.52, cellW * 0.65));
  const labFont = Math.floor(Math.max(10, height * 0.18));

  // Centers of each cell
  const cx = Array.from({ length: cells }, (_, i) => Math.round(M + cellW * i + cellW / 2));
  const baseY  = Math.round(height * 0.60);
  const labelY = Math.round(height * 0.92);

  // Colon positions between cells
  const c12 = Math.round(M + cellW * 1);
  const c23 = Math.round(M + cellW * 2);
  const c34 = Math.round(M + cellW * 3);

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <style>
    text{ font-family:${font}; fill:${fg}; }
    .num{ font-weight:700; font-size:${numFont}px; text-anchor:middle; }
    .lab{ font-weight:500; font-size:${labFont}px; text-anchor:middle; }
  </style>
  <rect width="100%" height="100%" fill="${bg}"/>

  <!-- Numbers -->
  <g class="num">
    <text x="${cx[0]}" y="${baseY}">${String(days).padStart(2,"0")}</text>
    <text x="${cx[1]}" y="${baseY}">${pad2(hours)}</text>
    <text x="${cx[2]}" y="${baseY}">${pad2(minutes)}</text>
    <text x="${cx[3]}" y="${baseY}">${pad2(seconds)}</text>
  </g>

  <!-- Colons (no blink) -->
  <g fill="${accent}" font-weight="700" font-size="${Math.floor(numFont * 0.9)}" text-anchor="middle">
    <text x="${c12}" y="${baseY}">:</text>
    <text x="${c23}" y="${baseY}">:</text>
    <text x="${c34}" y="${baseY}">:</text>
  </g>

  <!-- Labels -->
  <g class="lab">
    <text x="${cx[0]}" y="${labelY}">DAYS</text>
    <text x="${cx[1]}" y="${labelY}">HOURS</text>
    <text x="${cx[2]}" y="${labelY}">MINUTES</text>
    <text x="${cx[3]}" y="${labelY}">SECONDS</text>
  </g>
</svg>`;
}

async function renderGIF(p) {
  // 1 fps for real-time ticking
  const frames = p.dur;       // seconds
  const delay  = 1000;        // ms per frame
  const total  = Math.max(0, p.target.diff(dayjs(), "second"));

  const enc = new GIFEncoder(p.width, p.height);
  enc.start();
  enc.setRepeat(0);
  enc.setDelay(delay);
  enc.setQuality(p.qfactor);  // higher = smaller/faster

  for (let i = 0; i < frames; i++) {
    const remain = total - i;
    const dhms = splitDHMS(remain);
    const svg = svgMarkupGrid(p, dhms);
    const png = new Resvg(svg, { fitTo: { mode: "width", value: p.width } }).render().asPng();
    const { data } = PNG.sync.read(png); // RGBA
    enc.addFrame(data);
  }
  enc.finish();
  return Buffer.from(enc.out.getData());
}

app.get(["/countdown.gif", "/gif"], async (req, res) => {
  try {
    const p = getParams(req.query);
    const buf = await renderGIF(p);
    res.set("Content-Type", "image/gif");
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    res.send(buf);
  } catch (e) {
    console.error("GIF error:", e);
    res.status(500).send("GIF error");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Countdown GIF server on :" + PORT));

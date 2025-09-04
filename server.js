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
  const font   = q.font || "Arial, Helvetica, sans-serif";

  // Duration (cap 120s to avoid timeouts on free tiers)
  const dur = Math.max(30, Math.min(parseInt(q.dur || "120", 10), 120));

  // GIF quality: higher value => more compression (smaller file)
  const qfactor = Math.max(1, Math.min(parseInt(q.q || "30", 10), 40));

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

/**
 * Numbers always fit:
 * - 4 equal cells; each value is rendered with textLength so it scales to fit cell width,
 *   regardless of 2-digit vs 3-digit DAYS or narrow widths.
 */
function svgMarkupFitted(p, dhms) {
  const { width, height, bg, fg, accent, font } = p;
  const { days, hours, minutes, seconds } = dhms;

  const M = Math.max(8, Math.floor(width * 0.05));   // outer margin
  const usable = width - M * 2;
  const cells = 4;
  const cellW = usable / cells;

  // areas: numbers zone (top ~70%), labels (bottom ~30%)
  const numH = Math.floor(height * 0.68);
  const labH = height - numH;

  // font sizes bounded by height; actual horizontal size is forced by textLength
  const numFont = Math.floor(numH * 0.78); // slightly less than numH to keep ascenders inside
  const labFont = Math.max(10, Math.floor(labH * 0.55));

  // padding inside each cell for the number "box"
  const padX = Math.floor(cellW * 0.10);
  const numBoxW = Math.max(1, cellW - padX * 2);

  // y positions
  const numBaseY = Math.round(numH * 0.8);         // baseline for numbers
  const labY     = numH + Math.round(labH * 0.8);  // baseline for labels

  // left x of each cell’s number box
  const xLeft = (i) => Math.round(M + cellW * i + padX);
  const xMid  = (i) => Math.round(M + cellW * i + cellW / 2);

  // “fit” a string into the box with textLength
  const fitText = (x, y, text) =>
    `<text x="${x}" y="${y}" font-size="${numFont}" font-weight="700"
            textLength="${numBoxW}" lengthAdjust="spacingAndGlyphs">${text}</text>`;

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <style>
    .num { font-family:${font}; fill:${fg}; }
    .lab { font-family:${font}; fill:${fg}; font-size:${labFont}px; font-weight:500; text-anchor:middle; }
  </style>

  <rect width="100%" height="100%" fill="${bg}"/>

  <!-- Numbers (fit to each cell) -->
  <g class="num">
    ${fitText(xLeft(0), numBaseY, String(days).padStart(2,"0"))}
    ${fitText(xLeft(1), numBaseY, pad2(hours))}
    ${fitText(xLeft(2), numBaseY, pad2(minutes))}
    ${fitText(xLeft(3), numBaseY, pad2(seconds))}
  </g>

  <!-- Colons at cell boundaries (no blink) -->
  <g fill="${accent}" font-family="${font}" font-weight="700" font-size="${Math.floor(numFont * 0.9)}" text-anchor="middle">
    <text x="${M + cellW * 1}" y="${numBaseY}">:</text>
    <text x="${M + cellW * 2}" y="${numBaseY}">:</text>
    <text x="${M + cellW * 3}" y="${numBaseY}">:</text>
  </g>

  <!-- Labels -->
  <g class="lab">
    <text x="${xMid(0)}" y="${labY}">DAYS</text>
    <text x="${xMid(1)}" y="${labY}">HOURS</text>
    <text x="${xMid(2)}" y="${labY}">MINUTES</text>
    <text x="${xMid(3)}" y="${labY}">SECONDS</text>
  </g>
</svg>`;
}

async function renderGIF(p) {
  const frames = p.dur;   // 1 fps => seconds of animation
  const delay  = 1000;    // ms/frame
  const total  = Math.max(0, p.target.diff(dayjs(), "second"));

  const enc = new GIFEncoder(p.width, p.height);
  enc.start();
  enc.setRepeat(0);
  enc.setDelay(delay);
  enc.setQuality(p.qfactor);   // higher => smaller GIF (more compression)

  for (let i = 0; i < frames; i++) {
    const remain = total - i;
    const dhms = splitDHMS(remain);

    const svg = svgMarkupFitted(p, dhms);
    const png = new Resvg(svg, { fitTo: { mode: "width", value: p.width } }).render().asPng();
    const { data } = PNG.sync.read(png); // RGBA pixels
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

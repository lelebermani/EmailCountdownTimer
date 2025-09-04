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
  const to = q.to || "";
  const tz = q.tz || "UTC";

  // Default smaller size to keep 2-minute GIFs lightweight
  const width  = Math.max(360, Math.min(1200, parseInt(q.w || "540", 10)));
  const height = Math.max(120, Math.min(400,  parseInt(q.h || "160", 10)));

  const bg     = `#${(q.bg || "FFFFFF").replace("#", "")}`;
  const fg     = `#${(q.fg || "111827").replace("#", "")}`;
  const accent = `#${(q.accent || "D9D6FE").replace("#", "")}`;
  const font   = q.font || "Arial, Helvetica, sans-serif";

  // Duration in seconds (cap 120 to avoid timeouts on free tiers)
  const dur = Math.max(30, Math.min(parseInt(q.dur || "120", 10), 120)); // 30–120s

  let target = to ? dayjs.tz(to, tz) : null;
  if (!target || !target.isValid()) target = dayjs().tz(tz).add(1, "day");

  return { target, tz, width, height, bg, fg, accent, font, dur };
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

function svgMarkup({ width, height, bg, fg, accent, font }, dhms) {
  const { days, hours, minutes, seconds } = dhms;
  const big   = Math.floor(height * 0.50);
  const small = Math.floor(height * 0.18);

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect width="100%" height="100%" fill="${bg}"/>
  <g font-family="${font}" text-anchor="middle" fill="${fg}">
    <g font-weight="700" font-size="${big}">
      <text x="${width*0.14}" y="${height*0.60}">${String(days).padStart(2,"0")}</text>
      <text x="${width*0.27}" y="${height*0.60}" fill="${accent}">:</text>
      <text x="${width*0.40}" y="${height*0.60}">${pad2(hours)}</text>
      <text x="${width*0.53}" y="${height*0.60}" fill="${accent}">:</text>
      <text x="${width*0.66}" y="${height*0.60}">${pad2(minutes)}</text>
      <text x="${width*0.79}" y="${height*0.60}" fill="${accent}">:</text>
      <text x="${width*0.92}" y="${height*0.60}">${pad2(seconds)}</text>
    </g>
    <g font-size="${small}" font-weight="500">
      <text x="${width*0.14}" y="${height*0.92}">DAYS</text>
      <text x="${width*0.40}" y="${height*0.92}">HOURS</text>
      <text x="${width*0.66}" y="${height*0.92}">MINUTES</text>
      <text x="${width*0.92}" y="${height*0.92}">SECONDS</text>
    </g>
  </g>
</svg>`;
}

async function renderGIF(params) {
  // 1 fps: one frame per real second
  const frames = params.dur;   // default 120s
  const delay  = 1000;         // ms per frame (exactly 1 second)

  const total = Math.max(0, params.target.diff(dayjs(), "second"));

  const encoder = new GIFEncoder(params.width, params.height);
  encoder.start();
  encoder.setRepeat(0);   // loop forever after 2 minutes
  encoder.setDelay(delay);
  encoder.setQuality(10);

  for (let i = 0; i < frames; i++) {
    const remain = total - i;       // tick down by 1s each frame
    const dhms   = splitDHMS(remain);

    const svg        = svgMarkup(params, dhms); // no blinking colon
    const pngBuffer  = new Resvg(svg, { fitTo: { mode: "width", value: params.width }}).render().asPng();
    const { data }   = PNG.sync.read(pngBuffer); // RGBA pixels
    encoder.addFrame(data);
  }

  encoder.finish();
  return Buffer.from(encoder.out.getData());
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

import express from "express";
import { Resvg } from "@resvg/resvg-js";
import fs from "fs";
import path from "path";
import dayjs from "dayjs";
import utc from "dayjs-plugin-utc";
import tz from "dayjs-plugin-timezone";
import GIFEncoder from "gif-encoder-2";

dayjs.extend(utc);
dayjs.extend(tz);

const app = express();

/**
 * Helper to parse query with sensible defaults.
 * Example URL:
 * /countdown.png?to=2025-12-31T23:59:59&tz=Australia/Perth&bg=FFFFFF&fg=111827&w=800&h=200
 * /countdown.gif?to=2025-12-31T23:59:59&tz=Australia/Perth&bg=FFFFFF&fg=111827&w=800&h=200&fps=10
 */
function getParams(q) {
  const to = q.to || ""; // ISO string or "YYYY-MM-DD HH:mm:ss"
  const timezone = q.tz || "UTC";
  const width = Math.max(400, Math.min(2000, parseInt(q.w || "800", 10)));
  const height = Math.max(120, Math.min(800, parseInt(q.h || "200", 10)));
  const bg = `#${(q.bg || "FFFFFF").replace("#", "")}`;
  const fg = `#${(q.fg || "111827").replace("#", "")}`;
  const accent = `#${(q.accent || "6366F1").replace("#", "")}`; // colon dots
  const fps = Math.max(1, Math.min(20, parseInt(q.fps || "10", 10)));
  const font = q.font || "Arial, Helvetica, sans-serif";
  const label = (s) => s.toUpperCase();

  // compute target time
  let target = to ? dayjs.tz(to, timezone) : null;
  if (!target || !target.isValid()) {
    // default: 24h from now
    target = dayjs().tz(timezone).add(24, "hour");
  }
  return { target, timezone, width, height, bg, fg, accent, fps, font, label };
}

function splitDHMS(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  return { days, hours, minutes, seconds };
}

function pad2(n) { return n.toString().padStart(2, "0"); }

function svgMarkup({ width, height, bg, fg, accent, font }, dhms, blink = false) {
  const { days, hours, minutes, seconds } = dhms;
  const padDays = days.toString().padStart(2, "0");
  const sepOpacity = blink ? 0.25 : 1; // blink effect for colons

  // responsive sizing
  const big = Math.floor(height * 0.48);
  const small = Math.floor(height * 0.16);

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect width="100%" height="100%" fill="${bg}"/>
  <g font-family="${font}" fill="${fg}" text-anchor="middle">
    <g font-weight="700" font-size="${big}">
      <text x="${width*0.14}" y="${height*0.58}">${padDays}</text>
      <text x="${width*0.27}" y="${height*0.58}" fill="${accent}" opacity="${sepOpacity}">:</text>
      <text x="${width*0.40}" y="${height*0.58}">${pad2(hours)}</text>
      <text x="${width*0.53}" y="${height*0.58}" fill="${accent}" opacity="${sepOpacity}">:</text>
      <text x="${width*0.66}" y="${height*0.58}">${pad2(minutes)}</text>
      <text x="${width*0.79}" y="${height*0.58}" fill="${accent}" opacity="${sepOpacity}">:</text>
      <text x="${width*0.92}" y="${height*0.58}">${pad2(seconds)}</text>
    </g>
    <g font-size="${small}" font-weight="500" fill="${fg}">
      <text x="${width*0.14}" y="${height*0.90}">DAYS</text>
      <text x="${width*0.40}" y="${height*0.90}">HOURS</text>
      <text x="${width*0.66}" y="${height*0.90}">MINUTES</text>
      <text x="${width*0.92}" y="${height*0.90}">SECONDS</text>
    </g>
  </g>
</svg>`;
}

function renderPNGBuffer(params, now = dayjs()) {
  const diff = params.target.diff(now, "second");
  const dhms = splitDHMS(diff);
  const svg = svgMarkup(params, dhms, false);
  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: params.width } });
  const png = resvg.render();
  return png.asPng();
}

async function renderGIFBuffer(params) {
  // 60 frames max to keep files small (~100–300KB depending on size).
  // If the timer will run longer than 60s, we still animate blinking colons and keep HH:MM static,
  // while seconds tick modulo 60.
  const totalSeconds = Math.max(0, params.target.diff(dayjs(), "second"));
  const frames = Math.min(60, Math.max(1, Math.round(params.fps * 6))); // ~6s animation by default
  const delayCs = Math.round(100 / params.fps); // centiseconds/frame

  const enc = new GIFEncoder(params.width, params.height, "octree", true);
  enc.setRepeat(0); // loop forever
  enc.setDelay(delayCs * 10); // ms
  enc.start();

  for (let i = 0; i < frames; i++) {
    const frameNow = dayjs().add(i / params.fps, "second");
    const remain = Math.max(0, totalSeconds - i);
    const dhms = splitDHMS(remain);
    const blink = (i % Math.round(params.fps / 2)) === 0; // blink roughly 2Hz
    const svg = svgMarkup(params, dhms, blink);
    const png = new Resvg(svg, { fitTo: { mode: "width", value: params.width } }).render().asPng();
    // GIFEncoder needs raw RGBA; let resvg give us PNG, then decode quickly via Resvg again (faster path: asImage() not exposed).
    // Tiny decode shim using PNG built-in decoder would add deps; encoder2 can accept PNG via addFrame(png) directly:
    enc.addFrame(png);
  }

  enc.finish();
  return Buffer.from(enc.out.getData());
}

/** PNG endpoint (recommended for email) */
app.get(["/countdown.png", "/png"], (req, res) => {
  try {
    const p = getParams(req.query);
    const buf = renderPNGBuffer(p);
    res.set("Content-Type", "image/png");
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    res.send(buf);
  } catch (e) {
    console.error(e);
    res.status(500).send("PNG rendering error");
  }
});

/** Short animated GIF endpoint */
app.get(["/countdown.gif", "/gif"], async (req, res) => {
  try {
    const p = getParams(req.query);
    const buf = await renderGIFBuffer(p);
    res.set("Content-Type", "image/gif");
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    res.send(buf);
  } catch (e) {
    console.error(e);
    res.status(500).send("GIF rendering error");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Countdown image server on :" + PORT);
});

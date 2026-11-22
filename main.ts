// The World in a Day — Sunday, November 22, 2026
// A program that draws one front-page digest image of the day's world news
// and writes it to the output directory as entry.png.
// Pure Node standard library: the picture is painted pixel by pixel into an
// RGB buffer, text is drawn with a small hand-made 5x7 bitmap font, and the
// PNG file is encoded by hand (chunks, CRC32, zlib deflate from node:zlib).
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Rgb = [number, number, number];

const W = 1024;
const H = 1024;
const px = new Uint8Array(W * H * 3);

function setPx(x: number, y: number, c: Rgb): void {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  px[i] = c[0];
  px[i + 1] = c[1];
  px[i + 2] = c[2];
}

function fillRect(x: number, y: number, w: number, h: number, c: Rgb): void {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) setPx(xx, yy, c);
  }
}

function fillCircle(cx: number, cy: number, r: number, c: Rgb): void {
  for (let yy = cy - r; yy <= cy + r; yy++) {
    for (let xx = cx - r; xx <= cx + r; xx++) {
      const dx = xx - cx;
      const dy = yy - cy;
      if (dx * dx + dy * dy <= r * r) setPx(xx, yy, c);
    }
  }
}

function ringCircle(cx: number, cy: number, r: number, t: number, c: Rgb): void {
  for (let yy = cy - r - t; yy <= cy + r + t; yy++) {
    for (let xx = cx - r - t; xx <= cx + r + t; xx++) {
      const d = Math.sqrt((xx - cx) * (xx - cx) + (yy - cy) * (yy - cy));
      if (d >= r - t && d <= r + t) setPx(xx, yy, c);
    }
  }
}

function thickLine(x0: number, y0: number, x1: number, y1: number, t: number, c: Rgb): void {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  const half = Math.floor(t / 2);
  for (let s = 0; s <= steps; s++) {
    const x = Math.round(x0 + ((x1 - x0) * s) / steps);
    const y = Math.round(y0 + ((y1 - y0) * s) / steps);
    fillRect(x - half, y - half, t, t, c);
  }
}

function fillTri(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, c: Rgb): void {
  const minX = Math.min(x0, x1, x2);
  const maxX = Math.max(x0, x1, x2);
  const minY = Math.min(y0, y1, y2);
  const maxY = Math.max(y0, y1, y2);
  const area = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0);
  if (area === 0) return;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const w0 = ((x1 - x) * (y2 - y) - (y1 - y) * (x2 - x)) / area;
      const w1 = ((x2 - x) * (y0 - y) - (y2 - y) * (x0 - x)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 >= 0 && w1 >= 0 && w2 >= 0) setPx(x, y, c);
    }
  }
}

// ---- PNG encoding -----------------------------------------------------------
const crcTable: number[] = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable.push(c >>> 0);
}

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function encodePng(): Uint8Array {
  const raw = new Uint8Array((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 3 + 1)] = 0;
    raw.set(px.subarray(y * W * 3, (y + 1) * W * 3), y * (W * 3 + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, W);
  dv.setUint32(4, H);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const idat = deflateSync(raw, { level: 9 });
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [sig, chunk("IHDR", ihdr), chunk("IDAT", new Uint8Array(idat)), chunk("IEND", new Uint8Array(0))];
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

// ---- 5x7 bitmap font, drawn by hand ----------------------------------------
// Each glyph is seven rows of five pixels; '#' paints, anything else is clear.
const GLYPHS: Record<string, string[]> = {
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  B: ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
  C: [".####", "#....", "#....", "#....", "#....", "#....", ".####"],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  F: ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
  G: [".####", "#....", "#....", "#.###", "#...#", "#...#", ".###."],
  H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  I: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"],
  J: ["..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."],
  K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
  N: ["#...#", "#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
  Q: [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  V: ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
  W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
  X: ["#...#", ".#.#.", "..#..", "..#..", "..#..", ".#.#.", "#...#"],
  Y: ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
  Z: ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
  "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
  "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", "#####"],
  "2": [".###.", "#...#", "....#", "..##.", ".#...", "#....", "#####"],
  "3": ["####.", "....#", "....#", ".###.", "....#", "....#", "####."],
  "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  "6": [".###.", "#....", "#....", "####.", "#...#", "#...#", ".###."],
  "7": ["#####", "....#", "...#.", "..#..", "..#..", "..#..", "..#.."],
  "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "....#", ".###."],
  " ": [".....", ".....", ".....", ".....", ".....", ".....", "....."],
  ".": [".....", ".....", ".....", ".....", ".....", ".....", "..#.."],
  ",": [".....", ".....", ".....", ".....", ".....", "..#..", ".#..."],
  "'": ["..#..", "..#..", ".#...", ".....", ".....", ".....", "....."],
  "-": [".....", ".....", ".....", "#####", ".....", ".....", "....."],
  "&": [".##..", "#..#.", "#.#..", ".#...", "#.#.#", "#..#.", ".##.#"],
  "%": ["##..#", "##.#.", "....#", "...#.", "..#..", ".#...", "#.##."],
  "$": ["..#..", ".####", "#.#..", ".###.", "..#.#", "####.", "..#.."],
  "/": ["....#", "....#", "...#.", "..#..", ".#...", "#....", "#...."],
  ":": [".....", "..#..", "..#..", ".....", "..#..", "..#..", "....."],
  ";": [".....", "..#..", "..#..", ".....", "..#..", "..#..", ".#..."],
  "!": ["..#..", "..#..", "..#..", "..#..", "..#..", ".....", "..#.."],
  "?": [".###.", "#...#", "....#", "...#.", "..#..", ".....", "..#.."],
  "(": ["...#.", "..#..", ".#...", ".#...", ".#...", "..#..", "...#."],
  ")": [".#...", "..#..", "...#.", "...#.", "...#.", "..#..", ".#..."],
  "+": [".....", "..#..", "..#..", "#####", "..#..", "..#..", "....."],
  "|": ["..#..", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
};

function textWidth(s: string, scale: number): number {
  if (s.length === 0) return 0;
  return s.length * 6 * scale - scale;
}

function drawText(x: number, y: number, s: string, scale: number, c: Rgb): void {
  let cx = x;
  for (const ch of s.toUpperCase()) {
    const g = GLYPHS[ch] ?? GLYPHS["?"];
    for (let r = 0; r < 7; r++) {
      for (let col = 0; col < 5; col++) {
        if (g[r][col] === "#") fillRect(cx + col * scale, y + r * scale, scale, scale, c);
      }
    }
    cx += 6 * scale;
  }
}

function wrapText(s: string, scale: number, maxW: number): string[] {
  const words = s.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const trial = cur === "" ? w : cur + " " + w;
    if (textWidth(trial, scale) <= maxW || cur === "") {
      cur = trial;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur !== "") lines.push(cur);
  return lines;
}

function drawWrapped(x: number, y: number, s: string, scale: number, maxW: number, lineGap: number, c: Rgb): number {
  const lines = wrapText(s, scale, maxW);
  let yy = y;
  for (const ln of lines) {
    drawText(x, yy, ln, scale, c);
    yy += 7 * scale + lineGap;
  }
  return yy;
}

// ---- Palette ------------------------------------------------------------------
const INK: Rgb = [16, 24, 40];
const PAPER: Rgb = [247, 243, 234];
const CARD: Rgb = [255, 253, 248];
const GREY: Rgb = [90, 98, 112];
const FAINT: Rgb = [196, 188, 168];
const RED: Rgb = [186, 42, 44];
const GOLD: Rgb = [214, 152, 32];
const TEAL: Rgb = [24, 128, 116];
const BLUE: Rgb = [38, 92, 168];
const SKY: Rgb = [64, 132, 204];
const YELLOW: Rgb = [240, 192, 48];
const GREEN: Rgb = [52, 138, 72];
const WHITE: Rgb = [255, 255, 255];

// ---- Small spot illustrations, one per story ----------------------------------
function iconThermometer(cx: number, cy: number): void {
  fillCircle(cx - 40, cy + 52, 26, WHITE);
  fillCircle(cx - 40, cy + 52, 17, RED);
  fillRect(cx - 49, cy - 62, 18, 104, WHITE);
  fillRect(cx - 44, cy - 20, 8, 66, RED);
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI * i) / 4 + 0.4;
    const x0 = cx + 44 + Math.round(Math.cos(a) * 20);
    const y0 = cy - 52 + Math.round(Math.sin(a) * 20);
    const x1 = cx + 44 + Math.round(Math.cos(a) * 34);
    const y1 = cy - 52 + Math.round(Math.sin(a) * 34);
    thickLine(x0, y0, x1, y1, 5, GOLD);
  }
  fillCircle(cx + 44, cy - 52, 15, GOLD);
}

function iconThreePowers(cx: number, cy: number): void {
  ringCircle(cx - 24, cy + 10, 27, 5, RED);
  ringCircle(cx + 24, cy + 10, 27, 5, GOLD);
  ringCircle(cx, cy - 20, 27, 5, SKY);
  fillCircle(cx, cy, 7, WHITE);
}

function iconBurst(cx: number, cy: number): void {
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI * i) / 4;
    const x1 = cx + Math.round(Math.cos(a) * 38);
    const y1 = cy + Math.round(Math.sin(a) * 38);
    thickLine(cx, cy, x1, y1, 6, GOLD);
  }
  fillCircle(cx, cy, 15, RED);
  fillCircle(cx, cy, 7, YELLOW);
}

function iconTanker(cx: number, cy: number): void {
  fillRect(cx - 44, cy - 4, 88, 11, INK);
  fillTri(cx - 44, cy + 7, cx - 44, cy - 4, cx - 28, cy + 7, INK);
  fillTri(cx + 44, cy - 4, cx + 44, cy + 7, cx + 28, cy + 7, INK);
  fillRect(cx - 32, cy - 20, 24, 16, RED);
  fillRect(cx - 4, cy - 20, 24, 16, TEAL);
  fillRect(cx + 24, cy - 28, 11, 24, GREY);
  for (let i = 0; i < 3; i++) {
    const wx = cx - 46 + i * 34;
    for (let t = 0; t < 27; t++) {
      const y = cy + 20 + Math.round(Math.sin((t / 27) * Math.PI * 2) * 4);
      fillRect(wx + t, y, 1, 3, SKY);
    }
  }
}

function iconChart(cx: number, cy: number): void {
  thickLine(cx - 42, cy - 38, cx - 42, cy + 38, 4, GREY);
  thickLine(cx - 42, cy + 38, cx + 44, cy + 38, 4, GREY);
  const pts: Array<[number, number]> = [
    [cx - 34, cy - 24],
    [cx - 13, cy - 11],
    [cx + 4, cy - 21],
    [cx + 21, cy + 7],
    [cx + 38, cy + 28],
  ];
  for (let i = 0; i + 1 < pts.length; i++) thickLine(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], 6, RED);
  fillTri(cx + 38, cy + 28, cx + 24, cy + 26, cx + 36, cy + 14, RED);
}

function iconBadge(cx: number, cy: number): void {
  fillRect(cx - 24, cy - 36, 48, 54, GOLD);
  fillTri(cx - 24, cy + 18, cx + 24, cy + 18, cx, cy + 42, GOLD);
  fillCircle(cx, cy - 8, 13, INK);
  fillCircle(cx, cy - 8, 6, GOLD);
}

function iconBoat(cx: number, cy: number): void {
  fillRect(cx - 38, cy + 2, 76, 10, INK);
  fillTri(cx - 38, cy + 12, cx - 38, cy + 2, cx - 22, cy + 12, INK);
  fillTri(cx + 38, cy + 2, cx + 38, cy + 12, cx + 22, cy + 12, INK);
  thickLine(cx, cy + 2, cx, cy - 32, 5, GREY);
  fillTri(cx + 3, cy - 32, cx + 3, cy - 4, cx + 28, cy - 4, RED);
  for (let i = 0; i < 3; i++) {
    const wx = cx - 44 + i * 32;
    for (let t = 0; t < 25; t++) {
      const y = cy + 22 + Math.round(Math.sin((t / 25) * Math.PI * 2) * 4);
      fillRect(wx + t, y, 1, 3, SKY);
    }
  }
}

// ---- Page composition ---------------------------------------------------------
function storyCard(
  x: number, y: number, w: number, h: number,
  accent: Rgb, tag: string, headline: string, caption: string,
  icon: (cx: number, cy: number) => void,
): void {
  fillRect(x, y, w, h, CARD);
  fillRect(x, y, w, 6, accent);
  fillRect(x + 16, y + 20, 92, 92, PAPER);
  icon(x + 62, y + 66);
  drawText(x + 124, y + 28, tag, 2, accent);
  drawWrapped(x + 124, y + 64, headline, 3, w - 140, 6, INK);
  drawWrapped(x + 16, y + 124, caption, 2, w - 32, 5, GREY);
}

function miniCard(
  x: number, y: number, w: number, h: number,
  accent: Rgb, tag: string, headline: string, caption: string,
  icon: (cx: number, cy: number) => void,
): void {
  fillRect(x, y, w, h, CARD);
  fillRect(x, y, 6, h, accent);
  icon(x + 58, y + Math.floor(h / 2));
  drawText(x + 116, y + 12, tag, 2, accent);
  drawWrapped(x + 116, y + 38, headline, 3, w - 132, 5, INK);
  drawWrapped(x + 116, y + 90, caption, 2, w - 132, 4, GREY);
}

function paint(): void {
  fillRect(0, 0, W, H, INK);
  fillRect(28, 28, W - 56, H - 56, PAPER);
  fillRect(28, 28, W - 56, 10, RED);

  // Masthead
  drawText(56, 54, "THE WORLD IN A DAY", 8, INK);
  fillRect(56, 122, W - 112, 4, INK);
  drawText(56, 136, "SUNDAY, NOVEMBER 22, 2026", 3, RED);
  const edW = textWidth("ONE IMAGE, THE WHOLE DAY", 2);
  drawText(W - 56 - edW, 140, "ONE IMAGE, THE WHOLE DAY", 2, GREY);
  fillRect(56, 170, W - 112, 2, FAINT);

  // Lead story: COP31 collapse in Antalya
  const lx = 56;
  const ly = 190;
  const lw = W - 112;
  const lh = 218;
  fillRect(lx, ly, lw, lh, INK);
  fillRect(lx, ly, 300, lh, [24, 44, 66]);
  iconThermometer(lx + 150, ly + 109);
  drawText(lx + 330, ly + 24, "LEAD STORY | CLIMATE - ANTALYA, TURKIYE", 2, GOLD);
  drawWrapped(lx + 330, ly + 52, "COP31 CLIMATE TALKS COLLAPSE WITHOUT A DEAL", 4, lw - 360, 8, WHITE);
  drawWrapped(
    lx + 330, ly + 162,
    "EU REJECTS THE FINAL DRAFT AFTER TWO DAYS OF OVERTIME. IT NEVER NAMES FOSSIL FUELS; THE 1.5C LIMIT WILL BE BREACHED.",
    2, lw - 360, 5, [206, 216, 228],
  );

  // Four main cards in a 2x2 grid
  const gx = 56;
  const gy = 424;
  const cw = 448;
  const ch = 182;
  const gap = 14;
  storyCard(gx, gy, cw, ch, SKY, "DIPLOMACY - SHENZHEN, CHINA",
    "TRUMP, XI + PUTIN FIRST TRILATERAL",
    "THE THREE LEADERS AGREE TO OPEN TALKS ON CUTTING NUCLEAR-WAR RISK.",
    iconThreePowers);
  storyCard(gx + cw + gap, gy, cw, ch, RED, "WAR - KRYVYI RIH, UKRAINE",
    "MISSILE STRIKES ZELENSKY HOMETOWN",
    "STRIKE KILLS 2, WOUNDS DOZENS. UKRAINE DRONES SET A RUSSIAN SHIP ABLAZE.",
    iconBurst);
  storyCard(gx, gy + ch + gap, cw, ch, TEAL, "MIDEAST - BAHRAIN + HORMUZ",
    "IRAN STRIKES BAHRAIN + TANKERS",
    "TEHRAN HITS A SITE BAHRAIN CALLS CIVILIAN. TANKERS HIT; OIL NEAR $90.",
    iconTanker);
  storyCard(gx + cw + gap, gy + ch + gap, cw, ch, GOLD, "ECONOMY - NEW YORK, USA",
    "AI SELL-OFF HITS US STOCKS",
    "S+P 500 FALLS 3.7% INTO CORRECTION. NVIDIA DROPS ON SEC INQUIRY REPORT.",
    iconChart);

  // Bottom pair
  const by = gy + 2 * ch + 2 * gap;
  miniCard(gx, by, cw, 124, GREEN, "AMERICAS - SINALOA, MEXICO",
    "MEXICO CAPTURES 'EL CHAPO ISIDRO'",
    "FBI MOST-WANTED BOSS HELD. 11 KILLED.",
    iconBadge);
  miniCard(gx + cw + gap, by, cw, 124, BLUE, "AFRICA - BAYELSA, NIGERIA",
    "FUNERAL BOAT CAPSIZES: 24 DEAD",
    "CROWDED BOAT SINKS. 24 RESCUED.",
    iconBoat);

  // Footer ticker
  const fy = by + 124 + 10;
  fillRect(56, fy, W - 112, 2, FAINT);
  drawText(56, fy + 10, "ALSO TODAY:", 2, RED);
  drawText(56 + textWidth("ALSO TODAY:", 2) + 14, fy + 10,
    "EU-INDONESIA DEAL CUTS 98.5% OF TARIFFS | INDIA 720/9 VS NZ", 2, INK);
  drawText(56, fy + 32, "SOURCES: REUTERS | AP | WSJ | ONE TURN NEWS - AS REPORTED ON NOV 22, 2026", 2, GREY);
}

paint();
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "entry.png"), encodePng());

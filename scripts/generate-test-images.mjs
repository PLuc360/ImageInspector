import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = process.cwd();
const outDir = path.join(root, 'test-images');

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#2D6CDF"/>
      <stop offset="100%" stop-color="#11B57C"/>
    </linearGradient>
  </defs>
  <rect width="640" height="400" fill="url(#bg)"/>
  <circle cx="180" cy="180" r="95" fill="#FFD166" fill-opacity="0.92"/>
  <rect x="350" y="95" width="180" height="180" rx="20" fill="#EF476F" fill-opacity="0.9"/>
  <text x="28" y="360" font-family="Arial, Helvetica, sans-serif" font-size="36" fill="#FFFFFF">ImageDetails Format Test</text>
</svg>`;

await fs.mkdir(outDir, { recursive: true });
await fs.writeFile(path.join(outDir, 'sample.svg'), svg, 'utf8');

const base = sharp(Buffer.from(svg));

const targets = [
  { name: 'sample.png' },
  { name: 'sample.jpg' },
  { name: 'sample.jpeg' },
  { name: 'sample.webp' },
  { name: 'sample.gif' },
  { name: 'sample.bmp' },
  { name: 'sample.tif' },
  { name: 'sample.tiff' },
  { name: 'sample.avif' }
];

for (const target of targets) {
  try {
    await base.clone().toFile(path.join(outDir, target.name));
    console.log(`Generated ${target.name}`);
  } catch (error) {
    console.log(`Skipped ${target.name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

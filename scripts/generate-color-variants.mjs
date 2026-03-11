import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = process.cwd();
const outDir = path.join(root, 'test-images');
const baseInput = path.join(outDir, 'sample.png');

const variants = [
  { suffix: 'cool-1', hue: -4, saturation: 0.98, brightness: 1.0 },
  { suffix: 'cool-2', hue: -8, saturation: 0.96, brightness: 0.99 },
  { suffix: 'warm-1', hue: 4, saturation: 1.02, brightness: 1.0 },
  { suffix: 'warm-2', hue: 8, saturation: 1.04, brightness: 1.01 },
  { suffix: 'green-1', hue: 12, saturation: 1.03, brightness: 1.0 },
  { suffix: 'magenta-1', hue: -12, saturation: 1.03, brightness: 1.0 }
];

const outputFormats = ['png', 'webp', 'avif'];

/**
 * Generates subtle color variants from a base PNG.
 */
async function main() {
  await fs.access(baseInput);

  for (const variant of variants) {
    for (const format of outputFormats) {
      const outputPath = path.join(outDir, `sample-variant-${variant.suffix}.${format}`);

      await sharp(baseInput)
        .modulate({
          brightness: variant.brightness,
          saturation: variant.saturation,
          hue: variant.hue
        })
        .toFormat(format)
        .toFile(outputPath);

      console.log(`Generated ${path.basename(outputPath)}`);
    }
  }
}

await main();

import fs from 'node:fs';
import sharp from 'sharp';

/**
 * Creates an SVG icon with a solid background and centered size label.
 *
 * @param {number} size Icon size in pixels.
 * @param {string} backgroundColor Hex background color.
 * @returns {Buffer} SVG buffer.
 */
function createNumberedIconSvg(size, backgroundColor) {
  const fontSize = Math.round(size * 0.42);

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <rect x="0" y="0" width="${size}" height="${size}" fill="${backgroundColor}"/>
      <text
        x="50%"
        y="50%"
        dominant-baseline="middle"
        text-anchor="middle"
        fill="#ffffff"
        font-family="Segoe UI, Arial, sans-serif"
        font-size="${fontSize}"
        font-weight="700"
      >${size}</text>
    </svg>
  `;

  return Buffer.from(svg);
}

/**
 * Builds an ICO binary from PNG buffers.
 *
 * @param {{size:number, pngBuffer:Buffer}[]} images Ordered image entries.
 * @returns {Buffer} ICO file buffer.
 */
function buildIcoFile(images) {
  const iconDirectoryHeader = Buffer.alloc(6);
  iconDirectoryHeader.writeUInt16LE(0, 0);
  iconDirectoryHeader.writeUInt16LE(1, 2);
  iconDirectoryHeader.writeUInt16LE(images.length, 4);

  const directoryEntries = [];
  const imagePayloads = [];

  let currentOffset = 6 + images.length * 16;

  for (const image of images) {
    const iconEntry = Buffer.alloc(16);

    iconEntry.writeUInt8(image.size === 256 ? 0 : image.size, 0);
    iconEntry.writeUInt8(image.size === 256 ? 0 : image.size, 1);
    iconEntry.writeUInt8(0, 2);
    iconEntry.writeUInt8(0, 3);
    iconEntry.writeUInt16LE(1, 4);
    iconEntry.writeUInt16LE(32, 6);
    iconEntry.writeUInt32LE(image.pngBuffer.length, 8);
    iconEntry.writeUInt32LE(currentOffset, 12);

    directoryEntries.push(iconEntry);
    imagePayloads.push(image.pngBuffer);
    currentOffset += image.pngBuffer.length;
  }

  return Buffer.concat([iconDirectoryHeader, ...directoryEntries, ...imagePayloads]);
}

/**
 * Generates a multi-size ICO test image.
 */
async function generateMultiSizeIco() {
  const specs = [
    { size: 32, backgroundColor: '#1f6fd2' },
    { size: 48, backgroundColor: '#2f9e44' },
    { size: 64, backgroundColor: '#d9480f' }
  ];

  const images = [];

  for (const spec of specs) {
    const svgBuffer = createNumberedIconSvg(spec.size, spec.backgroundColor);
    const pngBuffer = await sharp(svgBuffer)
      .png()
      .toBuffer();

    images.push({ size: spec.size, pngBuffer });
  }

  const icoBuffer = buildIcoFile(images);
  const outputPath = 'test-images/sample-multisize-32-48-64.ico';
  fs.writeFileSync(outputPath, icoBuffer);

  console.log(`Created ${outputPath} (${icoBuffer.length} bytes)`);
  console.log('Entries:', specs.map((spec) => `${spec.size}x${spec.size}`).join(', '));
}

generateMultiSizeIco().catch((error) => {
  console.error(error);
  process.exit(1);
});

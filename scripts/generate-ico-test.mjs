import fs from 'node:fs';
import sharp from 'sharp';

/**
 * Generates a test ICO file by embedding a generated PNG image.
 */
async function generateIcoTestFile() {
  const pngBuffer = await sharp({
    create: {
      width: 32,
      height: 32,
      channels: 4,
      background: { r: 35, g: 120, b: 210, alpha: 1 }
    }
  })
    .png()
    .toBuffer();

  const iconHeader = Buffer.alloc(6);
  iconHeader.writeUInt16LE(0, 0);
  iconHeader.writeUInt16LE(1, 2);
  iconHeader.writeUInt16LE(1, 4);

  const iconEntry = Buffer.alloc(16);
  iconEntry.writeUInt8(32, 0);
  iconEntry.writeUInt8(32, 1);
  iconEntry.writeUInt8(0, 2);
  iconEntry.writeUInt8(0, 3);
  iconEntry.writeUInt16LE(1, 4);
  iconEntry.writeUInt16LE(32, 6);
  iconEntry.writeUInt32LE(pngBuffer.length, 8);
  iconEntry.writeUInt32LE(22, 12);

  const icoBuffer = Buffer.concat([iconHeader, iconEntry, pngBuffer]);
  const outputPath = 'test-images/sample-generated.ico';
  fs.writeFileSync(outputPath, icoBuffer);

  console.log(`Created ${outputPath} (${icoBuffer.length} bytes)`);
}

generateIcoTestFile().catch((error) => {
  console.error(error);
  process.exit(1);
});

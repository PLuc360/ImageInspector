import fs from 'node:fs';
import sharp from 'sharp';

/**
 * Generates a patterned ICO test file with transparency.
 */
async function generatePatternIcoTestFile() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <rect x="6" y="6" width="52" height="52" rx="12" fill="#1f6fd2"/>
      <path d="M22 18h20v8h-6v20h6v8H22v-8h6V26h-6z" fill="#ffffff"/>
    </svg>
  `;

  const pngBuffer = await sharp(Buffer.from(svg))
    .png()
    .toBuffer();

  const iconHeader = Buffer.alloc(6);
  iconHeader.writeUInt16LE(0, 0);
  iconHeader.writeUInt16LE(1, 2);
  iconHeader.writeUInt16LE(1, 4);

  const iconEntry = Buffer.alloc(16);
  iconEntry.writeUInt8(64, 0);
  iconEntry.writeUInt8(64, 1);
  iconEntry.writeUInt8(0, 2);
  iconEntry.writeUInt8(0, 3);
  iconEntry.writeUInt16LE(1, 4);
  iconEntry.writeUInt16LE(32, 6);
  iconEntry.writeUInt32LE(pngBuffer.length, 8);
  iconEntry.writeUInt32LE(22, 12);

  const icoBuffer = Buffer.concat([iconHeader, iconEntry, pngBuffer]);
  const outputPath = 'test-images/sample-pattern.ico';
  fs.writeFileSync(outputPath, icoBuffer);

  console.log(`Created ${outputPath} (${icoBuffer.length} bytes)`);
}

generatePatternIcoTestFile().catch((error) => {
  console.error(error);
  process.exit(1);
});

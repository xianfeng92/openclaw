import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const icoTempDir = path.resolve(__dirname, "../resources/icons/ico-temp");
const outputIco = path.resolve(__dirname, "../resources/icons/icon.ico");

// Simple ICO generator - creates a basic ICO file with one image
async function createSimpleIco(): Promise<void> {
  // Use the 256x256 version as the main icon
  const png256Path = path.join(icoTempDir, "256x256.png");
  const pngData = fs.readFileSync(png256Path);

  // ICO file format:
  // - 6 byte header
  // - 16 byte directory entry per image
  // - Image data (PNG or BMP)

  const iconDir = Buffer.alloc(6);
  iconDir.writeUInt16LE(0, 0); // Reserved
  iconDir.writeUInt16LE(1, 2); // Type: 1 = ICO
  iconDir.writeUInt16LE(1, 4); // Number of images

  // Read PNG dimensions
  const png = fs.readFileSync(png256Path);
  const width = 256; // We know this from generation
  const height = 256;

  const iconDirEntry = Buffer.alloc(16);
  iconDirEntry.writeUInt8(width === 256 ? 0 : width, 0); // Width (0 = 256)
  iconDirEntry.writeUInt8(height === 256 ? 0 : height, 1); // Height (0 = 256)
  iconDirEntry.writeUInt8(0, 2); // Color palette count (0 = no palette)
  iconDirEntry.writeUInt8(0, 3); // Reserved
  iconDirEntry.writeUInt16LE(1, 4); // Color planes
  iconDirEntry.writeUInt16LE(32, 6); // Bits per pixel
  iconDirEntry.writeUInt32LE(png.length, 8); // Size of image data
  iconDirEntry.writeUInt32LE(6 + 16, 12); // Offset to image data

  const icoBuffer = Buffer.concat([iconDir, iconDirEntry, png]);
  fs.writeFileSync(outputIco, icoBuffer);

  console.log(`Created: ${outputIco}`);
}

createSimpleIco().catch(console.error);

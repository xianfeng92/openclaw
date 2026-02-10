import sharp from "sharp";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve paths from the script location
const scriptDir = path.resolve(__dirname);
const appsWindowsDir = path.dirname(scriptDir);
const projectRoot = path.dirname(appsWindowsDir);
const sourceIcon = path.join(projectRoot, "macos/Icon.icon/Assets/openclaw-mac.png");
const outputDir = path.join(appsWindowsDir, "resources/icons");

// Ensure output directory exists
fs.mkdirSync(outputDir, { recursive: true });

// Tray icon sizes (small for system tray)
const TRAY_SIZE = 16;

// Status colors
const STATUS_COLORS = {
  default: { r: 150, g: 150, b: 150 },  // Gray (stopped)
  active: { r: 76, g: 175, b: 80 },     // Green (running)
  error: { r: 244, g: 67, b: 54 },      // Red (error)
};

async function generateTrayIcon(
  suffix: string,
  tintColor: { r: number; g: number; b: number },
): Promise<void> {
  const outputPath = path.join(outputDir, `icon${suffix}.png`);

  // Load and resize source image
  const image = sharp(sourceIcon)
    .resize(TRAY_SIZE, TRAY_SIZE, {
      fit: "cover",
      position: "center",
    });

  // Get metadata and create tinted version
  const metadata = await image.metadata();
  const hasAlpha = metadata.hasAlpha;

  if (hasAlpha) {
    // Create a tinted overlay
    await image
      .linear(
        // RGB multipliers for tinting
        [tintColor.r / 255, tintColor.g / 255, tintColor.b / 255],
        // Alpha channel multiplier (keep original)
        [1, 1, 1, 1]
      )
      .toFile(outputPath);
    console.log(`Created: ${outputPath}`);
  } else {
    // Simple resize if no alpha
    await image.toFile(outputPath);
    console.log(`Created: ${outputPath}`);
  }
}

async function generateAppIcon(): Promise<void> {
  // For Windows app icon, we need multi-size ICO
  // We'll create a PNG version first, ICO conversion requires additional tooling
  const sizes = [16, 32, 48, 64, 128, 256];
  const icoDir = path.join(outputDir, "ico-temp");
  fs.mkdirSync(icoDir, { recursive: true });

  for (const size of sizes) {
    const outputPath = path.join(icoDir, `${size}x${size}.png`);
    await sharp(sourceIcon)
      .resize(size, size, { fit: "cover", position: "center" })
      .toFile(outputPath);
    console.log(`Created: ${outputPath}`);
  }

  // Create a simple 256x256 PNG as the main icon for now
  // Full ICO generation requires png-to-ico package or ImageMagick
  const mainIconPath = path.join(outputDir, "icon.ico");
  const largeIconPath = path.join(outputDir, "icon-256.png");

  await sharp(sourceIcon)
    .resize(256, 256, { fit: "cover", position: "center" })
    .toFile(largeIconPath);
  console.log(`Created: ${largeIconPath}`);

  console.log(`\nNote: To create a proper .ico file, use ImageMagick:`);
  console.log(`  magick convert ${icoDir}/*.png ${mainIconPath}`);
}

async function main(): Promise<void> {
  console.log("Generating Windows tray icons from macOS source...\n");

  // Check if source exists
  if (!fs.existsSync(sourceIcon)) {
    console.error(`Source icon not found: ${sourceIcon}`);
    process.exit(1);
  }

  // Generate tray icons
  await generateTrayIcon("", STATUS_COLORS.default);
  await generateTrayIcon("-active", STATUS_COLORS.active);
  await generateTrayIcon("-error", STATUS_COLORS.error);

  // Generate app icon
  await generateAppIcon();

  console.log("\n✅ Icon generation complete!");
  console.log(`\nIcons created in: ${outputDir}`);
}

main().catch(console.error);

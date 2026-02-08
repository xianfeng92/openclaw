# Icon Resources

This directory should contain tray icons for the Windows desktop app.

## Required Icons

- `icon.png` - Default (stopped) state - 16x16px or 32x32px PNG
- `icon-active.png` - Running state - 16x16px or 32x32px PNG (green accent)
- `icon-error.png` - Error state - 16x16px or 32x32px PNG (red accent)
- `icon.ico` - Windows application icon - Multi-size ICO file

## Icon Source

The macOS app has source icons at:
`apps/macos/Icon.icon/Assets/openclaw-mac.png`

You can convert these using:
- Online converters (e.g., convertio.co, cloudconvert.com)
- ImageMagick: `convert openclaw-mac.png -define icon:auto-resize=256,128,64,48,32,16 icon.ico`
- GIMP with ICO plugin

## Temporary Status

For development, Electron will use a default icon if these files are missing.

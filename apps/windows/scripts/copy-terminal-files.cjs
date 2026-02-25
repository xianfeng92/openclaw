const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '../src/terminal');
const distDir = path.join(__dirname, '../dist/terminal');

// Ensure dist directory exists
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// Copy index.html
const srcHtml = path.join(srcDir, 'index.html');
const distHtml = path.join(distDir, 'index.html');

if (fs.existsSync(srcHtml)) {
  fs.copyFileSync(srcHtml, distHtml);
  console.log('[Terminal] Copied index.html to dist/terminal/');
} else {
  console.error('[Terminal] Source index.html not found');
}

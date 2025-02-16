const fs = require('fs');
const path = require('path');

// Create dist directory
const distDir = path.join(__dirname, 'dist');
if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir);
}

// Copy files from src to dist
const srcDir = path.join(__dirname, 'src');
const filesToCopy = [
    'manifest.json',
    'popup.html',
    'popup.js',
    'content.js',
    'api.js',
    'styles.css',
    'icon.png',
    'background.js'
];

filesToCopy.forEach(file => {
    const srcPath = path.join(srcDir, file);
    const distPath = path.join(distDir, file);

    if (fs.existsSync(srcPath)) {
        fs.copyFileSync(srcPath, distPath);
        console.log(`Copied ${file} to dist/`);
    } else {
        console.warn(`Warning: ${file} not found in src/`);
    }
}); 
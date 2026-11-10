// Copies the phone page, icon and the offline OCR / computer-vision engines into build/.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const out = path.join(root, 'build');
const vendor = path.join(out, 'vendor');
const nm = p => path.join(root, 'node_modules', p);
fs.mkdirSync(path.join(vendor, 'tesseract', 'core'), { recursive: true });
fs.mkdirSync(path.join(vendor, 'tesseract', 'lang'), { recursive: true });
const copy = (from, to) => fs.copyFileSync(from, to);
copy(path.join(root, 'electron', 'phone.html'), path.join(out, 'phone.html'));
copy(path.join(root, 'assets', 'icon.png'), path.join(out, 'icon.png'));
copy(nm('@techstark/opencv-js/dist/opencv.js'), path.join(vendor, 'opencv.js'));
copy(nm('tesseract.js/dist/worker.min.js'), path.join(vendor, 'tesseract', 'worker.min.js'));
for (const f of fs.readdirSync(nm('tesseract.js-core'))) {
  if (/^tesseract-core.*\.(js|wasm)$/.test(f)) copy(nm(`tesseract.js-core/${f}`), path.join(vendor, 'tesseract', 'core', f));
}
copy(nm('@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'), path.join(vendor, 'tesseract', 'lang', 'eng.traineddata.gz'));
console.log('static files copied');

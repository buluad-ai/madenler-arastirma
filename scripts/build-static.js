/**
 * GitHub Pages için statik site üretir.
 * Tüm şirket ve şehir verilerini public/ klasörüne gömülü JSON olarak export eder.
 * Çalıştırma: node scripts/build-static.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const PUBLIC_DIR = path.join(ROOT, 'public');
const DIST_DIR = path.join(ROOT, 'dist');

function readJsonDir(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .sort()
    .map(f => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return null; } })
    .filter(Boolean);
}

function copyDirRecursive(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  for (const item of fs.readdirSync(src)) {
    const srcPath = path.join(src, item);
    const destPath = path.join(dest, item);
    if (fs.statSync(srcPath).isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// dist/ oluştur
if (fs.existsSync(DIST_DIR)) fs.rmSync(DIST_DIR, { recursive: true });
fs.mkdirSync(DIST_DIR, { recursive: true });

// public/ içeriğini kopyala
copyDirRecursive(PUBLIC_DIR, DIST_DIR);

// Statik HTML raporları kopyala
// index.html kasıtla dahil edilmiyor — public/index.html zaten kopyalandı
const htmlFiles = ['demir_export', 'yildizlar', 'metin_rapor.html', 'demir_export_rapor.html', 'yildizlar_sss_holding_rapor.html'];
for (const f of htmlFiles) {
  const src = path.join(ROOT, f);
  const dest = path.join(DIST_DIR, f);
  if (fs.existsSync(src)) {
    if (fs.statSync(src).isDirectory()) copyDirRecursive(src, dest);
    else fs.copyFileSync(src, dest);
  }
}

// Veriyi JSON olarak göm (API'siz çalışma için)
const companies = readJsonDir(path.join(DATA_DIR, 'companies'));
const cities = readJsonDir(path.join(DATA_DIR, 'cities'));

const dataJsContent = `// Otomatik oluşturuldu — düzenlemeyin
window.MADENLER_DATA = {
  companies: ${JSON.stringify(companies, null, 2)},
  cities: ${JSON.stringify(cities, null, 2)}
};
`;

fs.mkdirSync(path.join(DIST_DIR, 'js'), { recursive: true });
fs.writeFileSync(path.join(DIST_DIR, 'js', 'data.js'), dataJsContent);

// index.html'e data.js scriptini ekle (statik mod için)
const indexPath = path.join(DIST_DIR, 'index.html');
const buildVer = Date.now();
if (fs.existsSync(indexPath)) {
  let html = fs.readFileSync(indexPath, 'utf8');
  // Statik modda API yerine window.MADENLER_DATA kullanmak için
  // Mevcut data.js tag'ini versiyonlu URL ile değiştir (CDN cache bypass)
  html = html.replace(
    /<script src="\/js\/data\.js"[^>]*><\/script>/,
    `<script src="/js/data.js?v=${buildVer}"></script>`
  ).replace(
    "fetch('/api/companies')",
    "Promise.resolve(window.MADENLER_DATA?.companies ? { json: () => Promise.resolve(window.MADENLER_DATA.companies) } : fetch('/api/companies'))"
  ).replace(
    "fetch('/api/cities')",
    "Promise.resolve(window.MADENLER_DATA?.cities ? { json: () => Promise.resolve(window.MADENLER_DATA.cities) } : fetch('/api/cities'))"
  );
  fs.writeFileSync(indexPath, html);
}

// robots.txt
fs.copyFileSync(path.join(ROOT, 'robots.txt'), path.join(DIST_DIR, 'robots.txt'));

console.log(`✅ Statik site oluşturuldu: ${DIST_DIR}`);
console.log(`   Şirketler: ${companies.length}`);
console.log(`   Şehirler: ${cities.length}`);

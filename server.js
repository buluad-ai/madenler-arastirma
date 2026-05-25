require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const { Client: ESClient } = require('@elastic/elasticsearch');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Root klasöründeki HTML raporları ve alt dizinleri servis et
app.use('/demir_export', express.static(path.join(__dirname, 'demir_export')));
app.use('/yildizlar', express.static(path.join(__dirname, 'yildizlar')));
[
  'kirsehir_raporu.html',
  'sss_yildizlar_raporu.html',
  'demir_export_rapor.html',
  'yildizlar_sss_holding_rapor.html',
  'metin_rapor.html'
].forEach(f => {
  app.get(`/${f}`, (req, res) => {
    const fp = path.join(__dirname, f);
    if (fs.existsSync(fp)) res.sendFile(fp);
    else res.status(404).send('Rapor bulunamadı');
  });
});

// ─── MongoDB Bağlantısı ───────────────────────────────────────────────────────
let mongoConnected = false;
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/madenler')
  .then(() => { mongoConnected = true; console.log('✓ MongoDB bağlandı'); })
  .catch(e => console.warn('MongoDB bağlanamadı (JSON fallback aktif):', e.message));

// ─── Elasticsearch Bağlantısı ─────────────────────────────────────────────────
let esConnected = false;
const esClient = new ESClient({
  node: process.env.ELASTICSEARCH_URL || 'http://localhost:9200',
  requestTimeout: 5000
});
esClient.ping().then(() => { esConnected = true; console.log('✓ Elasticsearch bağlandı'); })
  .catch(e => console.warn('Elasticsearch bağlanamadı (JSON fallback aktif):', e.message));

// ─── Mongoose Şemaları ───────────────────────────────────────────────────────
const CompanySchema = new mongoose.Schema({
  slug: { type: String, unique: true, required: true },
  ad: String,
  kisaAd: String,
  holding: String,
  sektor: String,
  tip: String,
  bolge: String,
  sehir: String,
  ilce: String,
  koordinatlar: { lat: Number, lon: Number },
  kurulusYili: Number,
  ruhsatSayisi: mongoose.Schema.Types.Mixed,
  isletmeSayisi: mongoose.Schema.Types.Mixed,
  iscSayisi: mongoose.Schema.Types.Mixed,
  maliVeriler: mongoose.Schema.Types.Mixed,
  ozellestirilenSahalar: [mongoose.Schema.Types.Mixed],
  iscOlumleri: [mongoose.Schema.Types.Mixed],
  isgOlaylari: [mongoose.Schema.Types.Mixed],
  cevreIhlalleri: [mongoose.Schema.Types.Mixed],
  siyasiBaglantilar: [mongoose.Schema.Types.Mixed],
  vergiBorclari: [mongoose.Schema.Types.Mixed],
  davalar: [mongoose.Schema.Types.Mixed],
  sendikaDurumu: mongoose.Schema.Types.Mixed,
  ozet: String,
  renkTema: String,
  ikon: String,
  renkGradyan: String,
  guncellenmeTarihi: String,
  raporDosyasi: String,
  kaynaklar: [mongoose.Schema.Types.Mixed]
}, { timestamps: true });

const CitySchema = new mongoose.Schema({
  slug: { type: String, unique: true, required: true },
  ad: String,
  il: String,
  koordinatlar: { lat: Number, lon: Number },
  nufus: String,
  ozellik: String,
  sirketler: [String],
  tarihselBaglam: String,
  facialAr: [mongoose.Schema.Types.Mixed],
  protestolar: [mongoose.Schema.Types.Mixed],
  sendikaDurumu: String,
  guncellenmeTarihi: String
}, { timestamps: true });

const Company = mongoose.models.Company || mongoose.model('Company', CompanySchema);
const City = mongoose.models.City || mongoose.model('City', CitySchema);

// ─── JSON Fallback Yardımcı Fonksiyonlar ─────────────────────────────────────
function loadJsonFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .sort()
    .map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); }
      catch { return null; }
    })
    .filter(Boolean);
}

function loadJsonFile(dir, slug) {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  for (const f of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (data.slug === slug) return data;
    } catch { /* skip */ }
  }
  return null;
}

const DATA_DIR = path.join(__dirname, 'data');

// ─── API ROTALARI ─────────────────────────────────────────────────────────────

// Sağlık kontrolü
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    mongo: mongoConnected,
    elasticsearch: esConnected,
    timestamp: new Date().toISOString()
  });
});

// Tüm şirketleri listele
app.get('/api/companies', async (req, res) => {
  try {
    const { sektor, sehir, holding, tip, q } = req.query;

    if (mongoConnected) {
      const filter = {};
      if (sektor) filter.sektor = new RegExp(sektor, 'i');
      if (sehir) filter.sehir = new RegExp(sehir, 'i');
      if (holding) filter.holding = new RegExp(holding, 'i');
      if (tip) filter.tip = new RegExp(tip, 'i');
      if (q) filter.$or = [
        { ad: new RegExp(q, 'i') },
        { ozet: new RegExp(q, 'i') },
        { bolge: new RegExp(q, 'i') }
      ];
      const companies = await Company.find(filter).lean();
      return res.json(companies);
    }

    // JSON fallback
    let companies = loadJsonFiles(path.join(DATA_DIR, 'companies'));
    if (sektor) companies = companies.filter(c => c.sektor?.toLowerCase().includes(sektor.toLowerCase()));
    if (sehir) companies = companies.filter(c => c.sehir?.toLowerCase().includes(sehir.toLowerCase()));
    if (holding) companies = companies.filter(c => c.holding?.toLowerCase().includes(holding.toLowerCase()));
    if (q) companies = companies.filter(c =>
      c.ad?.toLowerCase().includes(q.toLowerCase()) ||
      c.ozet?.toLowerCase().includes(q.toLowerCase()) ||
      c.bolge?.toLowerCase().includes(q.toLowerCase())
    );
    res.json(companies);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Şirket detayı
app.get('/api/companies/:slug', async (req, res) => {
  try {
    if (mongoConnected) {
      const company = await Company.findOne({ slug: req.params.slug }).lean();
      if (!company) return res.status(404).json({ error: 'Şirket bulunamadı' });
      return res.json(company);
    }
    const company = loadJsonFile(path.join(DATA_DIR, 'companies'), req.params.slug);
    if (!company) return res.status(404).json({ error: 'Şirket bulunamadı' });
    res.json(company);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Şirket ekle/güncelle (upsert)
app.put('/api/companies/:slug', async (req, res) => {
  try {
    const data = { ...req.body, slug: req.params.slug, guncellenmeTarihi: new Date().toISOString().split('T')[0] };
    if (mongoConnected) {
      const result = await Company.findOneAndUpdate({ slug: req.params.slug }, data, { upsert: true, new: true });
      if (esConnected) await indexToES('company', result.slug, result.toObject());
      return res.json(result);
    }
    // JSON fallback: dosyaya yaz
    const fname = `${req.params.slug}.json`;
    fs.writeFileSync(path.join(DATA_DIR, 'companies', fname), JSON.stringify(data, null, 2));
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Tüm şehirleri listele
app.get('/api/cities', async (req, res) => {
  try {
    if (mongoConnected) {
      return res.json(await City.find().lean());
    }
    res.json(loadJsonFiles(path.join(DATA_DIR, 'cities')));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Şehir detayı
app.get('/api/cities/:slug', async (req, res) => {
  try {
    if (mongoConnected) {
      const city = await City.findOne({ slug: req.params.slug }).lean();
      if (!city) return res.status(404).json({ error: 'Şehir bulunamadı' });
      return res.json(city);
    }
    const city = loadJsonFile(path.join(DATA_DIR, 'cities'), req.params.slug);
    if (!city) return res.status(404).json({ error: 'Şehir bulunamadı' });
    res.json(city);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Tam metin arama (Elasticsearch veya JSON regex)
app.get('/api/search', async (req, res) => {
  const { q, type } = req.query;
  if (!q) return res.json([]);

  try {
    if (esConnected) {
      const indices = type === 'company' ? ['companies'] :
                      type === 'city' ? ['cities'] : ['companies', 'cities'];
      const result = await esClient.search({
        index: indices,
        query: {
          multi_match: {
            query: q,
            fields: ['ad^3', 'ozet^2', 'bolge', 'holding', 'siyasiBaglantilar.*', 'iscOlumleri.*', 'cevreIhlalleri.*'],
            fuzziness: 'AUTO'
          }
        },
        size: 20
      });
      return res.json(result.hits.hits.map(h => ({ ...h._source, _score: h._score, _index: h._index })));
    }

    // JSON fallback arama
    const companies = loadJsonFiles(path.join(DATA_DIR, 'companies'));
    const cities = loadJsonFiles(path.join(DATA_DIR, 'cities'));
    const qLow = q.toLowerCase();
    const results = [];

    if (!type || type === 'company') {
      companies.forEach(c => {
        const text = JSON.stringify(c).toLowerCase();
        if (text.includes(qLow)) results.push({ ...c, _type: 'company' });
      });
    }
    if (!type || type === 'city') {
      cities.forEach(c => {
        const text = JSON.stringify(c).toLowerCase();
        if (text.includes(qLow)) results.push({ ...c, _type: 'city' });
      });
    }
    res.json(results);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// HTML Rapor üretimi (şirket)
app.get('/api/report/company/:slug', async (req, res) => {
  try {
    let company;
    if (mongoConnected) {
      company = await Company.findOne({ slug: req.params.slug }).lean();
    } else {
      company = loadJsonFile(path.join(DATA_DIR, 'companies'), req.params.slug);
    }
    if (!company) return res.status(404).send('Şirket bulunamadı');

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(generateCompanyReport(company));
  } catch (e) {
    res.status(500).send(e.message);
  }
});

// HTML Rapor üretimi (şehir)
app.get('/api/report/city/:slug', async (req, res) => {
  try {
    let city;
    if (mongoConnected) {
      city = await City.findOne({ slug: req.params.slug }).lean();
    } else {
      city = loadJsonFile(path.join(DATA_DIR, 'cities'), req.params.slug);
    }
    if (!city) return res.status(404).send('Şehir bulunamadı');

    // Şehirdeki şirketleri yükle
    const companies = [];
    for (const slug of (city.sirketler || [])) {
      const c = mongoConnected
        ? await Company.findOne({ slug }).lean()
        : loadJsonFile(path.join(DATA_DIR, 'companies'), slug);
      if (c) companies.push(c);
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(generateCityReport(city, companies));
  } catch (e) {
    res.status(500).send(e.message);
  }
});

// ─── Elasticsearch İndeksleme ─────────────────────────────────────────────────
async function indexToES(type, id, doc) {
  if (!esConnected) return;
  const index = type === 'company' ? 'companies' : 'cities';
  await esClient.index({ index, id, document: doc });
}

// ─── Rapor Üretici ────────────────────────────────────────────────────────────
function generateCompanyReport(c) {
  const renkTema = c.renkTema || '#1a4a8a';
  const olumSayisi = (c.iscOlumleri || []).reduce((s, o) => s + (o.adet || 1), 0);
  const cevreOlay = (c.cevreIhlalleri || []).length;
  const davaSayisi = (c.davalar || []).length;

  return `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${c.ad} — Araştırma Raporu</title>
<style>
* { box-sizing: border-box; margin:0; padding:0; }
body { font-family: 'Georgia', serif; background: #fafaf8; color: #1a1a1a; max-width: 850px; margin: 0 auto; padding: 40px 32px; font-size: 15px; line-height: 1.85; }
.kapak { text-align: center; border-bottom: 3px solid #1a1a1a; padding-bottom: 40px; margin-bottom: 40px; }
.holding-badge { display: inline-block; background: ${renkTema}22; color: ${renkTema}; border: 1px solid ${renkTema}; padding: 4px 14px; border-radius: 20px; font-size: 0.82em; font-weight: 700; margin-bottom: 12px; font-family: 'Segoe UI', sans-serif; }
.kapak h1 { font-size: 2.2em; font-weight: 900; margin-bottom: 8px; }
.kapak .bolge { color: #555; font-size: 0.95em; margin-bottom: 16px; }
.istatlar { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 24px 0; }
.istat { background: #f0f0ee; border-radius: 8px; padding: 14px; text-align: center; }
.istat .sayi { font-size: 1.8em; font-weight: 900; color: ${renkTema}; }
.istat.kirmizi .sayi { color: #c00; }
.istat .etiket { font-size: 0.72em; color: #666; font-family: 'Segoe UI', sans-serif; text-transform: uppercase; margin-top: 4px; }
h2 { font-size: 1.2em; font-weight: 900; border-top: 2px solid #1a1a1a; padding-top: 24px; margin-top: 36px; margin-bottom: 14px; font-family: 'Segoe UI', sans-serif; text-transform: uppercase; }
h2.kirmizi { border-color: #c00; color: #c00; }
.kutu { border: 1px solid #ccc; border-radius: 6px; padding: 14px 18px; margin: 12px 0; background: #f9f9f7; }
.kutu.kirmizi { border-color: #c00; background: #fff5f5; }
.kutu.mavi { border-color: #1a56b0; background: #f0f5ff; }
.kutu .meta { font-size: 0.8em; color: #888; font-family: 'Segoe UI', sans-serif; margin-bottom: 4px; }
table { width: 100%; border-collapse: collapse; margin: 14px 0; font-size: 0.88em; }
th { background: #1a1a1a; color: white; padding: 8px 12px; text-align: left; }
td { padding: 8px 12px; border-bottom: 1px solid #ddd; }
tr:nth-child(even) td { background: #f5f5f2; }
.print-btn { position: fixed; top: 20px; right: 20px; background: ${renkTema}; color: white; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-size: 0.9em; font-weight: 700; font-family: 'Segoe UI', sans-serif; }
@media print { .print-btn { display: none; } body { padding: 20px; } }
footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 0.8em; color: #888; text-align: center; font-family: 'Segoe UI', sans-serif; }
</style>
</head>
<body>
<button class="print-btn" onclick="window.print()">🖨 Yazdır / PDF</button>
<div class="kapak">
  <div class="holding-badge">${c.holding || 'Bağımsız'}</div>
  <div style="font-size:3em; margin:8px 0;">${c.ikon || '⛏'}</div>
  <h1>${c.ad}</h1>
  <div class="bolge">${c.bolge || c.sehir || ''} · ${c.sektor || ''}</div>
  <div class="istatlar">
    <div class="istat"><div class="sayi">${c.ruhsatSayisi || '?'}</div><div class="etiket">Ruhsat</div></div>
    <div class="istat"><div class="sayi">${c.isletmeSayisi || '?'}</div><div class="etiket">İşletme</div></div>
    <div class="istat kirmizi"><div class="sayi">${olumSayisi || '?'}</div><div class="etiket">İşçi Ölümü</div></div>
    <div class="istat"><div class="sayi">${davaSayisi || '?'}</div><div class="etiket">Dava</div></div>
  </div>
</div>

<h2>ÖZET</h2>
<p>${c.ozet || '—'}</p>

${c.iscOlumleri?.length ? `<h2 class="kirmizi">İŞÇİ ÖLÜMLERI VE İŞ CİNAYETLERİ</h2>
${c.iscOlumleri.map(o => `<div class="kutu kirmizi"><div class="meta">${o.tarih || ''}</div><strong>${o.adet ? o.adet + ' işçi' : ''} ${o.aciklama || ''}</strong>${o.kaynak ? `<div class="meta">Kaynak: ${o.kaynak}</div>` : ''}</div>`).join('')}` : ''}

${c.cevreIhlalleri?.length ? `<h2>ÇEVRE İHLALLERİ</h2>
${c.cevreIhlalleri.map(i => `<div class="kutu mavi"><div class="meta">${i.yer || ''} · ${i.tarih || ''}</div>${i.aciklama || ''}${i.kaynak ? `<div class="meta">Kaynak: ${i.kaynak}</div>` : ''}</div>`).join('')}` : ''}

${c.siyasiBaglantilar?.length ? `<h2>SİYASİ BAĞLANTILAR</h2>
<table><tr><th>Kişi/Kurum</th><th>Bağlantı Türü</th><th>Açıklama</th></tr>
${c.siyasiBaglantilar.map(b => `<tr><td><strong>${b.kisi || ''}</strong></td><td>${b.baglantiTuru || ''}</td><td>${b.aciklama || ''}</td></tr>`).join('')}
</table>` : ''}

${c.ozellestirilenSahalar?.length ? `<h2>ÖZELLEŞTİRİLEN SAHALAR</h2>
${c.ozellestirilenSahalar.map(s => `<div class="kutu"><strong>${s.ad}</strong> (${s.yil || 'tarih bilinmiyor'})<br>${s.aciklama || ''}</div>`).join('')}` : ''}

${c.maliVeriler ? `<h2>MALİ VERİLER</h2>
<div class="kutu">${Object.entries(c.maliVeriler).filter(([k]) => k !== 'notlar').map(([k, v]) => `<p><strong>${k}:</strong> ${v}</p>`).join('')}${c.maliVeriler.notlar ? `<p><em>${c.maliVeriler.notlar}</em></p>` : ''}</div>` : ''}

${c.sendikaDurumu ? `<h2>SENDİKA VE ÖRGÜTLÜLÜK DURUMU</h2>
<div class="kutu ${c.sendikaDurumu.varMi === 'Hayır' ? 'kirmizi' : 'mavi'}">
<strong>Sendika var mı:</strong> ${c.sendikaDurumu.varMi || '?'}<br>
${c.sendikaDurumu.sendikalar?.length ? `<strong>Sendikalar:</strong> ${c.sendikaDurumu.sendikalar.join(', ')}<br>` : ''}
${c.sendikaDurumu.orgutlulukOrani ? `<strong>Örgütlülük oranı:</strong> %${c.sendikaDurumu.orgutlulukOrani}<br>` : ''}
${c.sendikaDurumu.notlar ? `<p>${c.sendikaDurumu.notlar}</p>` : ''}
</div>` : ''}

${c.davalar?.length ? `<h2>DAVALAR</h2>
<table><tr><th>Dava</th><th>Açıklama</th><th>Sonuç</th></tr>
${c.davalar.map(d => `<tr><td><strong>${d.ad}</strong></td><td>${d.aciklama || ''}</td><td>${d.sonuc || 'Devam ediyor'}</td></tr>`).join('')}
</table>` : ''}

${c.kaynaklar?.length ? `<h2>KAYNAKLAR</h2>
<ul style="padding-left:20px; margin-top:10px;">
${c.kaynaklar.map(k => `<li>${k.url ? `<a href="${k.url}">${k.ad}</a>` : k.ad}</li>`).join('')}
</ul>` : ''}

<footer>
Madenler Araştırma Platformu · TKP Kamulaştırma Kampanyası · ${new Date().toLocaleDateString('tr-TR')} · Tüm bilgiler kamuya açık kaynaklardan derlenmiştir.
</footer>
</body>
</html>`;
}

function generateCityReport(city, companies) {
  const toplamOlum = companies.reduce((s, c) =>
    s + (c.iscOlumleri || []).reduce((ss, o) => ss + (o.adet || 1), 0), 0);

  return `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${city.ad} Maden Raporu</title>
<style>
* { box-sizing: border-box; margin:0; padding:0; }
body { font-family: 'Georgia', serif; background: #fafaf8; color: #1a1a1a; max-width: 850px; margin: 0 auto; padding: 40px 32px; font-size: 15px; line-height: 1.85; }
.kapak { text-align: center; border-bottom: 3px solid #1a1a1a; padding-bottom: 32px; margin-bottom: 36px; }
.kapak h1 { font-size: 2.4em; font-weight: 900; }
.kapak .alt { color: #555; margin-top: 8px; }
.istatlar { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 20px 0; }
.istat { background: #f0f0ee; border-radius: 8px; padding: 14px; text-align: center; }
.istat .sayi { font-size: 2em; font-weight: 900; color: #1a4a8a; }
.istat.kirmizi .sayi { color: #c00; }
.istat .etiket { font-size: 0.72em; color: #666; font-family: 'Segoe UI', sans-serif; text-transform: uppercase; margin-top: 4px; }
h2 { font-size: 1.2em; font-weight: 900; border-top: 2px solid #1a1a1a; padding-top: 24px; margin-top: 36px; margin-bottom: 14px; font-family: 'Segoe UI', sans-serif; text-transform: uppercase; }
.sirket-kart { border: 1px solid #ddd; border-radius: 8px; padding: 16px 20px; margin: 12px 0; background: #f9f9f7; }
.sirket-kart h3 { font-size: 1em; font-weight: 700; margin-bottom: 8px; }
.print-btn { position: fixed; top: 20px; right: 20px; background: #1a4a8a; color: white; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-size: 0.9em; font-weight: 700; font-family: 'Segoe UI', sans-serif; }
@media print { .print-btn { display: none; } }
footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 0.8em; color: #888; text-align: center; font-family: 'Segoe UI', sans-serif; }
</style>
</head>
<body>
<button class="print-btn" onclick="window.print()">🖨 Yazdır / PDF</button>
<div class="kapak">
  <h1>📍 ${city.ad} — Maden Raporu</h1>
  <div class="alt">${city.il} · ${city.ozellik || ''}</div>
  <div class="istatlar">
    <div class="istat"><div class="sayi">${companies.length}</div><div class="etiket">Aktif Şirket</div></div>
    <div class="istat kirmizi"><div class="sayi">${toplamOlum || '?'}</div><div class="etiket">Toplam Ölüm</div></div>
    <div class="istat"><div class="sayi">${city.nufus || '?'}</div><div class="etiket">Nüfus</div></div>
  </div>
</div>

<h2>TARİHSEL BAĞLAM</h2>
<p>${city.tarihselBaglam || '—'}</p>

<h2>BÖLGEDEKİ ŞİRKETLER</h2>
${companies.map(c => `
<div class="sirket-kart">
  <h3>${c.ikon || '⛏'} ${c.ad} (${c.holding || ''})</h3>
  <p><strong>Sektör:</strong> ${c.sektor || '—'} · <strong>İşçi:</strong> ${c.iscSayisi || '?'} · <strong>Sendika:</strong> ${c.sendikaDurumu?.varMi || '?'}</p>
  <p>${c.ozet || ''}</p>
</div>`).join('')}

${city.facialAr?.length ? `<h2>FACİALAR VE KAZALAR</h2>
${city.facialAr.map(f => `<div style="border: 2px solid #c00; border-radius: 6px; padding: 14px 18px; margin: 10px 0; background: #fff5f5;">
<strong style="color:#c00;">${f.tarih || ''} — ${f.olumSayisi} ölü · ${f.sirket}</strong><br>
${f.aciklama || ''}
</div>`).join('')}` : ''}

${city.protestolar?.length ? `<h2>PROTESTOLAR VE DİRENİŞLER</h2>
${city.protestolar.map(p => `<div style="border: 1px solid #1a56b0; border-radius: 6px; padding: 14px 18px; margin: 10px 0; background: #f0f5ff;">
<strong>${p.tarih || ''} — ${p.ad}</strong> (${p.sirket})<br>${p.aciklama || ''}
</div>`).join('')}` : ''}

<footer>
Madenler Araştırma Platformu · TKP Kamulaştırma Kampanyası · ${new Date().toLocaleDateString('tr-TR')}
</footer>
</body>
</html>`;
}

// ─── SPA Fallback ─────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🚀 Madenler Araştırma Platformu: http://localhost:${PORT}`);
  console.log(`   API: http://localhost:${PORT}/api/companies`);
  console.log(`   Arama: http://localhost:${PORT}/api/search?q=cengiz\n`);
});

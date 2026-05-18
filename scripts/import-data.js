#!/usr/bin/env node
/**
 * JSON verilerini MongoDB ve Elasticsearch'e aktarır.
 * Çalıştırma: node scripts/import-data.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { Client: ESClient } = require('@elastic/elasticsearch');
const fs = require('fs');
const path = require('path');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://madenler:madenler2026@localhost:27017/madenler?authSource=admin';
const ES_URL = process.env.ELASTICSEARCH_URL || 'http://localhost:9200';
const DATA_DIR = path.join(__dirname, '../data');

// ─── Şemalar ─────────────────────────────────────────────────────────────────
const anySchema = new mongoose.Schema({}, { strict: false, timestamps: true });
const Company = mongoose.model('Company', anySchema, 'companies');
const City = mongoose.model('City', new mongoose.Schema({}, { strict: false, timestamps: true }), 'cities');

function readJsonDir(dir) {
  if (!fs.existsSync(dir)) { console.warn(`Dizin bulunamadı: ${dir}`); return []; }
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .sort()
    .map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); }
      catch (e) { console.error(`Hata (${f}):`, e.message); return null; }
    })
    .filter(Boolean);
}

async function setupESIndex(client, index) {
  try {
    const exists = await client.indices.exists({ index });
    if (exists) await client.indices.delete({ index });
    await client.indices.create({
      index,
      mappings: { dynamic: true, date_detection: false }
    });
    console.log(`✓ ES index oluşturuldu: ${index}`);
  } catch (e) {
    console.warn(`  ⚠ ES index oluşturulamadı (${index}):`, e.message);
  }
}

// ES için veri temizleme — sadece metin alanları koru, iç içe objeleri düzleştir
function sanitizeForES(doc) {
  const out = {};
  const copyFields = ['slug','ad','kisaAd','holding','sektor','bolge','sehir','tip','ozet','ruhsatSayisi','isletmeSayisi','guncellenmeTarihi','il','ozellik','tarihselBaglam'];
  for (const f of copyFields) {
    if (doc[f] !== undefined) out[f] = String(doc[f] ?? '');
  }
  // Nested dizileri JSON string olarak göm
  const arrayFields = ['iscOlumleri','cevreIhlalleri','siyasiBaglantilar','davalar','isgOlaylari','sendikaDurumu','ozellestirilenSahalar','tesisler'];
  for (const f of arrayFields) {
    if (doc[f]) out[f + '_text'] = JSON.stringify(doc[f]);
  }
  if (doc.maliVeriler) out.maliVeriler_text = JSON.stringify(doc.maliVeriler);
  out._type = doc.sirketler ? 'city' : 'company';
  return out;
}

async function main() {
  console.log('\n🚀 Veri aktarımı başlıyor...\n');

  // MongoDB bağlantısı
  await mongoose.connect(MONGO_URI);
  console.log('✓ MongoDB bağlandı');

  // Elasticsearch bağlantısı
  const esClient = new ESClient({ node: ES_URL });
  await esClient.ping();
  console.log('✓ Elasticsearch bağlandı');

  await setupESIndex(esClient, 'companies');
  await setupESIndex(esClient, 'cities');

  // ─── Şirketleri aktar ─────────────────────────────────────────────────────
  const companies = readJsonDir(path.join(DATA_DIR, 'companies'));
  console.log(`\n📦 ${companies.length} şirket aktarılıyor...`);

  let cImported = 0, cSkipped = 0;
  for (const company of companies) {
    if (!company.slug) { console.warn('  ⚠ Slug eksik:', company.ad); cSkipped++; continue; }
    try {
      await Company.findOneAndUpdate(
        { slug: company.slug },
        { $set: company },
        { upsert: true, new: true }
      );
      await esClient.index({ index: 'companies', id: company.slug, document: sanitizeForES(company), refresh: true });
      console.log(`  ✓ ${company.ad} (${company.slug})`);
      cImported++;
    } catch (e) {
      console.error(`  ✗ ${company.slug}:`, e.message);
      cSkipped++;
    }
  }

  // ─── Şehirleri aktar ─────────────────────────────────────────────────────
  const cities = readJsonDir(path.join(DATA_DIR, 'cities'));
  console.log(`\n📍 ${cities.length} şehir aktarılıyor...`);

  let cityImported = 0;
  for (const city of cities) {
    if (!city.slug) { console.warn('  ⚠ Slug eksik:', city.ad); continue; }
    try {
      await City.findOneAndUpdate(
        { slug: city.slug },
        { $set: city },
        { upsert: true, new: true }
      );
      await esClient.index({ index: 'cities', id: city.slug, document: sanitizeForES(city), refresh: true });
      console.log(`  ✓ ${city.ad} (${city.slug})`);
      cityImported++;
    } catch (e) {
      console.error(`  ✗ ${city.slug}:`, e.message);
    }
  }

  console.log(`\n✅ Tamamlandı!`);
  console.log(`   Şirketler: ${cImported} aktarıldı, ${cSkipped} atlandı`);
  console.log(`   Şehirler: ${cityImported} aktarıldı`);
  console.log(`\n   ES: http://localhost:9200/companies/_search`);
  console.log(`   Kibana: http://localhost:5601\n`);

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(e => {
  console.error('Kritik hata:', e);
  process.exit(1);
});

// AI Sandbox konuşma koşucusu — senaryo repliklerini GERÇEK chatbot'a sürer.
// İzolasyon: tenant 'ai-sandbox' posApiUrl=NULL → hiçbir siparis prod'a gitmez.
import * as fs from 'fs';
import { chatbotService } from './src/services/chatbot.service';

const TENANT = 'ai-sandbox';
const SENARYO_YOLU = process.env.SENARYO_YOLU || '/tmp/senaryolar.json';
const CIKTI = process.env.CIKTI || '/tmp/konusmalar.json';
const BATCH = Number(process.env.BATCH || 5);

type Reply = { reply: string; buttons?: Array<{ id: string; title: string }>; order?: unknown };
type Tur = { rol: 'kullanici' | 'bot'; metin: string; butonlar?: string[] };

const btns = (r: Reply) => (r.buttons || []).map((b) => b.title);
const btnHas = (r: Reply, re: RegExp) => btns(r).some((t) => re.test(t));

async function konus(senaryo: any, idx: number): Promise<any> {
  const uid = `sbx-${idx}-${Date.now().toString(36)}`;
  const turlar: Tur[] = [];
  let sonBot: Reply = { reply: '' };

  const gonder = async (metin: string) => {
    turlar.push({ rol: 'kullanici', metin });
    const r: Reply = (await chatbotService.processMessage(TENANT, uid, metin)) as Reply;
    turlar.push({ rol: 'bot', metin: r.reply || '', butonlar: btns(r) });
    sonBot = r;
    return r;
  };

  try {
    // Senaryo repliklerini sırayla sür
    for (const replik of (senaryo.replikler || [])) {
      await gonder(replik);
    }

    // Akışı sonlandır: bot hâlâ onay/teslimat/ödeme bekliyorsa senaryonun tercihine göre tamamla.
    // En çok 8 tamamlama adımı — sonsuz döngü koruması.
    for (let guard = 0; guard < 8; guard++) {
      const b = btns(sonBot);
      if (!b.length) break;

      if (btnHas(sonBot, /Onayla/i)) { await gonder('onayla'); continue; }
      if (btnHas(sonBot, /Gel Al|Paket/i)) {
        await gonder(senaryo.teslimat === 'paket' ? 'paket servis' : 'gel al');
        continue;
      }
      if (btnHas(sonBot, /Online|Nakit|Kart/i)) {
        const secim = senaryo.odeme === 'online' ? 'online kredi kartı'
          : senaryo.odeme === 'kart' ? 'kart' : 'nakit';
        await gonder(secim);
        // Online ödeme sonrası iyzico linki geldiyse ödemeyi test olarak tamamla
        if (senaryo.odeme === 'online') {
          const r: Reply = (await chatbotService.simulatePayment(TENANT, uid, true)) as any;
          if (r?.reply) turlar.push({ rol: 'bot', metin: '[TEST ödeme onayı] ' + r.reply, butonlar: btns(r) });
        }
        break;
      }
      // Bilinmeyen buton grubu — ilk butonu bas
      await gonder(b[0]);
    }
  } catch (e: any) {
    turlar.push({ rol: 'bot', metin: '[RUNNER HATASI] ' + (e?.message || e) });
  }

  return {
    baslik: senaryo.baslik,
    persona: senaryo.persona,
    odeme: senaryo.odeme,
    teslimat: senaryo.teslimat,
    turSayisi: turlar.length,
    turlar,
  };
}

async function main() {
  const senaryolar: any[] = JSON.parse(fs.readFileSync(SENARYO_YOLU, 'utf8'));
  console.log(`${senaryolar.length} senaryo, batch ${BATCH}`);
  const sonuc: any[] = [];
  for (let i = 0; i < senaryolar.length; i += BATCH) {
    const dilim = senaryolar.slice(i, i + BATCH);
    const r = await Promise.all(dilim.map((s, j) => konus(s, i + j)));
    sonuc.push(...r);
    console.log(`  ${Math.min(i + BATCH, senaryolar.length)}/${senaryolar.length}`);
    fs.writeFileSync(CIKTI, JSON.stringify(sonuc, null, 1));
  }
  console.log('BİTTİ →', CIKTI);
}
main().then(() => process.exit(0)).catch((e) => { console.error('FATAL:', e?.message || e); process.exit(1); });

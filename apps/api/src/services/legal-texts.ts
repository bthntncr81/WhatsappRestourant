export const CONSENT_TYPES = {
  TERMS: 'TERMS',
  KVKK: 'KVKK',
  EXPLICIT_CONSENT: 'EXPLICIT_CONSENT',
  DPA: 'DPA',
} as const;

export type ConsentType = (typeof CONSENT_TYPES)[keyof typeof CONSENT_TYPES];

export const LEGAL_VERSION = '1.0';

export const LEGAL_TEXTS: Record<ConsentType, { title: string; content: string }> = {
  TERMS: {
    title: 'Mesafeli Satış Sözleşmesi',
    content: `MESAFELİ SATIŞ SÖZLEŞMESİ

SATICI:
Unvan: Otorder Teknoloji A.Ş.
E-posta: destek@otorder.com

1. KONU
İşbu sözleşme, SATICI tarafından sunulan WhatsApp tabanlı yapay zekâ destekli sipariş yazılımının ALICI'ya lisanslanmasına ilişkindir.

2. HİZMET TANIMI
Sistem, WhatsApp üzerinden gelen mesajları analiz ederek sipariş oluşturur. Yapay zekâ teknolojileri kullanılmaktadır.

3. SORUMLULUK REDDİ
• Sistem bir altyapı hizmetidir, sipariş doğruluğu garanti edilmez.
• Yapay zekâ hatalarından SATICI sorumlu değildir.
• WhatsApp ve üçüncü taraf altyapılardan kaynaklı sorunlardan SATICI sorumlu değildir.

4. KVKK VE VERİ SORUMLULUĞU
ALICI, sistem üzerinden işlenen tüm müşteri verileri bakımından veri sorumlusu olduğunu kabul eder.
SATICI yalnızca veri işleyen konumundadır.

5. ÜCRET VE ÖDEME
Hizmet bedeli seçilen abonelik planına göre belirlenir.
Ödeme tipi: Aylık veya Yıllık.

6. SORUMLULUK SINIRI
SATICI'nın toplam sorumluluğu, ALICI'nın ödediği hizmet bedeli ile sınırlıdır.
Kâr kaybı, müşteri kaybı ve dolaylı zararlar kapsam dışıdır.

7. YÜRÜRLÜK
ALICI, bu sözleşmeyi elektronik ortamda onaylayarak kabul etmiş sayılır.`,
  },

  KVKK: {
    title: 'KVKK Aydınlatma Metni',
    content: `KVKK AYDINLATMA METNİ

Bu metin, 6698 sayılı Kişisel Verilerin Korunması Kanunu kapsamında hazırlanmıştır.

Sistem üzerinden işlenen müşteri verileri bakımından:
• ALICI (işletme) veri sorumlusudur
• SATICI veri işleyen konumundadır

Veriler:
• WhatsApp altyapısı
• Yapay zekâ sistemleri (OpenAI)
• Bulut servisleri (PostgreSQL, Redis)

üzerinden işlenebilir.

ALICI, müşterilerinden açık rıza almakla yükümlüdür.
SATICI, üçüncü taraf sistemlerden kaynaklı veri ihlallerinden sorumlu değildir.

İşlenen kişisel veriler:
• Müşteri telefon numarası ve adı
• Sipariş içerikleri ve adres bilgileri
• WhatsApp mesaj içerikleri (yapay zekâ analizi için)
• Konum verileri (teslimat için)

Verilerin işlenme amacı:
• Sipariş oluşturma ve yönetimi
• Müşteri iletişimi
• Hizmet kalitesinin iyileştirilmesi`,
  },

  EXPLICIT_CONSENT: {
    title: 'Açık Rıza Beyanı',
    content: `AÇIK RIZA BEYANI

İşbu hizmet kapsamında;

• Müşteri verilerinin sistem üzerinden işleneceğini
• Verilerin WhatsApp ve üçüncü taraf servisler aracılığıyla aktarılacağını
• Yapay zekâ sistemleri tarafından analiz edileceğini
• Siparişlerin otomatik sistemler tarafından işlendiğini
• Oluşabilecek hatalardan işletmenin sorumlu olduğunu

bildiğimi ve kabul ettiğimi, bu kapsamda açık rıza verdiğimi beyan ederim.

Açık rızamı her zaman geri çekme hakkım saklıdır. Rızamı geri çekmem halinde hizmetin sona erdirileceğini biliyorum.`,
  },

  DPA: {
    title: 'Veri İşleme Sözleşmesi (DPA)',
    content: `VERİ İŞLEME SÖZLEŞMESİ

1. KONU
Bu sözleşme, veri işleyenin veri sorumlusu adına veri işlemesini düzenler.

2. ROLLER
Veri sorumlusu: İşletme (ALICI)
Veri işleyen: Otorder Teknoloji A.Ş. (SATICI)

Tüm KVKK yükümlülükleri veri sorumlusuna aittir.

3. VERİ İŞLEYEN YÜKÜMLÜLÜKLERİ
• Verileri yalnızca talimatla işler
• Gizliliği sağlar
• Makul güvenlik önlemleri alır (şifreleme, erişim kontrolü)
• Veri ihlali durumunda derhal bildirir

4. VERİ SORUMLUSU YÜKÜMLÜLÜKLERİ
• Müşterilerinden açık rıza almak zorundadır
• KVKK'ya uygun hareket eder
• Veri ihlallerinden sorumludur

5. ALT YÜKLENİCİLER
Veriler;
• WhatsApp (Meta) altyapısı
• OpenAI yapay zekâ servisleri
• Bulut altyapı sağlayıcıları
üzerinden işlenebilir.

6. SORUMLULUK SINIRI
Veri işleyenin toplam sorumluluğu hizmet bedeli ile sınırlıdır.
Dolaylı zararlar kapsam dışıdır.`,
  },
};

export const WHATSAPP_KVKK_MESSAGE = `Siparişinizi oluşturabilmemiz için bazı kişisel verileriniz işlenmektedir.

Devam etmeden önce lütfen aşağıdaki hususları onaylayınız:
• Kişisel verilerinizin sipariş amacıyla işlenmesini
• Mesajlarınızın yapay zekâ ile analiz edilmesini
• Verilerinizin WhatsApp altyapısı ve üçüncü taraf servisler üzerinden işlenmesini

Siparişler otomatik sistemler tarafından işlenmektedir.

Devam etmek için lütfen *ONAYLIYORUM* yazarak cevap veriniz.`;

export const WHATSAPP_KVKK_ACCEPTED = `Teşekkürler! Onayınız kaydedildi. ✅

Artık sipariş verebilirsiniz. Menümüzü görmek için "menü" yazabilir veya doğrudan istediğiniz ürünleri yazabilirsiniz. 🍽️`;

export const WHATSAPP_MARKETING_ASK = `Kampanya, indirim ve duyuru içerikli ticari elektronik iletilerin (WhatsApp) tarafınıza gönderilmesini istiyoruz.

Bu mesajları almak istiyorsanız lütfen *ONAYLIYORUM* yazarak cevap veriniz.
İstemiyorsanız *HAYIR* yazabilirsiniz.`;

export const WHATSAPP_MARKETING_ACCEPTED = `Ticari ileti izniniz kaydedildi. ✅ Kampanya ve fırsatlardan haberdar olacaksınız.`;

export const WHATSAPP_MARKETING_DECLINED = `Anladık, ticari ileti göndermeyeceğiz. İstediğiniz zaman fikrinizi değiştirebilirsiniz.`;

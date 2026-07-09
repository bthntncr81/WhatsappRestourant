import { Component, signal, inject, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { WhatsAppConfigService } from '../../services/whatsapp-config.service';
import { environment } from '../../../environments/environment';

interface GuideSection {
  id: string;
  icon: string;   // emoji
  title: string;
}

@Component({
  selector: 'app-guide',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="guide-page">
      <!-- İçindekiler -->
      <aside class="toc">
        <div class="toc-head">📘 Kullanım Kılavuzu</div>
        <nav>
          @for (s of sections; track s.id) {
            <button
              class="toc-link"
              [class.active]="active() === s.id"
              (click)="go(s.id)"
            >
              <span class="toc-ic">{{ s.icon }}</span>
              <span>{{ s.title }}</span>
            </button>
          }
        </nav>
      </aside>

      <!-- İçerik -->
      <main class="guide-content">

        <!-- GİRİŞ -->
        <section [hidden]="active() !== 'intro'">
          <h1>OtOrder AI'ya Hoş Geldiniz 👋</h1>
          <p class="lead">
            OtOrder AI, müşterilerinizin WhatsApp üzerinden sipariş vermesini sağlayan
            yapay zekâ destekli bir sipariş yönetim sistemidir. Müşteri mesaj yazar, sistem
            siparişi otomatik anlar ve panelinize düşürür.
          </p>

          <div class="flow">
            <div class="flow-box">📱<br>Müşteri WhatsApp'tan yazar</div>
            <div class="flow-arrow">→</div>
            <div class="flow-box">🤖<br>Yapay zekâ siparişi anlar</div>
            <div class="flow-arrow">→</div>
            <div class="flow-box">🖥️<br>Sipariş panele düşer</div>
            <div class="flow-arrow">→</div>
            <div class="flow-box">✅<br>Siz onaylar, hazırlarsınız</div>
          </div>

          <div class="callout info">
            <b>İlk kez mi kullanıyorsunuz?</b> Önce <a (click)="go('whatsapp')">WhatsApp Kurulumu</a>
            adımlarını tamamlayın, ardından <a (click)="go('menu')">Menü</a> oluşturun. Bu ikisi
            tamamlanınca sisteminiz sipariş almaya hazırdır.
          </div>

          <h3>Hızlı Başlangıç — 4 Adım</h3>
          <ol class="big-steps">
            <li><b>WhatsApp'ı bağlayın</b> — Ayarlar &rarr; WhatsApp Entegrasyonu</li>
            <li><b>Menünüzü girin</b> — Menü sayfasından ürünleri ekleyin ve yayınlayın</li>
            <li><b>Şube & teslimat ayarlayın</b> — Şubeler sayfasından konum ve teslimat bölgesi</li>
            <li><b>Test edin</b> — Chatbot sayfasından örnek sipariş verin</li>
          </ol>
        </section>

        <!-- WHATSAPP KURULUMU -->
        <section [hidden]="active() !== 'whatsapp'">
          <h1>📲 WhatsApp Kurulumu (Sıfırdan)</h1>
          <p class="lead">
            Bu bölüm, hiç Meta/Facebook geliştirici hesabınız yokmuş gibi, en baştan
            anlatır. Yaklaşık 20-30 dakika sürer. Her adımı sırayla yapın.
          </p>

          <div class="callout warn">
            ⚠️ Bu işlemler <b>developer.facebook.com</b> ve <b>business.facebook.com</b>
            üzerinde yapılır. İşletmenizin WhatsApp numarasının başka bir WhatsApp
            uygulamasında <b>aktif olmaması</b> gerekir (numara WhatsApp Business API'ye taşınır).
          </div>

          <div class="step">
            <div class="step-no">1</div>
            <div class="step-body">
              <h4>Facebook / Meta hesabı açın</h4>
              <ul>
                <li>Bir Facebook hesabınız yoksa <a href="https://facebook.com" target="_blank" rel="noopener">facebook.com</a>'dan açın (kişisel hesap yeterli).</li>
                <li>Sonra <a href="https://business.facebook.com" target="_blank" rel="noopener">business.facebook.com</a>'a girip <b>"İşletme Hesabı Oluştur"</b> deyin.</li>
                <li>İşletme adı, adınız ve e-postanızı girin.</li>
              </ul>
            </div>
          </div>

          <div class="step">
            <div class="step-no">2</div>
            <div class="step-body">
              <h4>Geliştirici uygulaması oluşturun</h4>
              <ul>
                <li><a href="https://developers.facebook.com" target="_blank" rel="noopener">developers.facebook.com</a>'a girin, sağ üstten <b>"My Apps"</b> &rarr; <b>"Create App"</b>.</li>
                <li>Tür olarak <b>"Other"</b> &rarr; <b>"Business"</b> seçin.</li>
                <li>Uygulama adı verin (örn. <code>Restoran WhatsApp</code>), oluşturun.</li>
                <li>Ürün ekleme ekranında <b>WhatsApp</b> kartında <b>"Set Up"</b>e tıklayın.</li>
              </ul>
              <div class="mock">
                <div class="mock-title">developers.facebook.com</div>
                <div class="mock-row">[ My Apps ▾ ]&nbsp;&nbsp;&nbsp;&nbsp;<span class="hl">Create App →</span></div>
                <div class="mock-row">Use case:  ( ) Authenticate  &nbsp; (•) Other</div>
                <div class="mock-row">App type:  (•) Business</div>
                <div class="mock-row">Add products:  WhatsApp&nbsp;&nbsp;<span class="hl">[ Set Up ]</span></div>
              </div>
            </div>
          </div>

          <div class="step">
            <div class="step-no">3</div>
            <div class="step-body">
              <h4>Phone Number ID ve WABA ID'yi alın</h4>
              <ul>
                <li>Sol menü: <b>WhatsApp &rarr; API Setup</b>.</li>
                <li><b>Phone Number ID</b> değerini kopyalayın → panelde <span class="hl">Ayarlar &rarr; WhatsApp &rarr; Phone Number ID</span> alanına yapıştırın.</li>
                <li><b>WhatsApp Business Account ID (WABA ID)</b> değerini kopyalayın → ilgili alana yapıştırın.</li>
              </ul>
              <div class="callout tip">💡 Test için Meta size geçici bir numara verir. Kendi numaranızı eklemek için <b>"Add phone number"</b> kullanın.</div>
            </div>
          </div>

          <div class="step highlight">
            <div class="step-no">4</div>
            <div class="step-body">
              <h4>Kalıcı Erişim Anahtarı (Access Token) oluşturun — EN ÖNEMLİ ADIM</h4>
              <div class="callout warn">⚠️ API Setup sayfasındaki token <b>24 saatte</b> ölür. Aşağıdaki kalıcı tokeni oluşturmazsanız sistem ertesi gün durur.</div>
              <ul>
                <li><a href="https://business.facebook.com/settings" target="_blank" rel="noopener">business.facebook.com/settings</a> &rarr; <b>Kullanıcılar &rarr; Sistem Kullanıcıları</b>.</li>
                <li><b>"Ekle"</b> → isim verin (örn. <code>otorder-api</code>), rol <b>Admin</b>.</li>
                <li>Kullanıcıya tıklayın → <b>"Varlık Ekle"</b>: WhatsApp uygulamanız ve WABA hesabınız → her ikisine de <b>Tam Kontrol</b>.</li>
                <li><b>"Token Oluştur"</b> → uygulamanızı seçin → şu izinleri ekleyin:
                  <ul>
                    <li><code>whatsapp_business_messaging</code></li>
                    <li><code>whatsapp_business_management</code></li>
                  </ul>
                </li>
                <li>Çıkan tokeni kopyalayın → panelde <span class="hl">Access Token</span> alanına yapıştırın.</li>
              </ul>
              <div class="callout ok">✅ Bu token <b>asla sona ermez</b>. Bir kez oluşturun, yeter.</div>
            </div>
          </div>

          <div class="step">
            <div class="step-no">5</div>
            <div class="step-body">
              <h4>App Secret'i alın</h4>
              <ul>
                <li>developers.facebook.com → uygulamanız → <b>Settings &rarr; Basic</b>.</li>
                <li><b>App Secret</b> satırında <b>"Show"</b> → değeri kopyalayın → panelde <span class="hl">App Secret</span> alanına yapıştırın.</li>
              </ul>
              <div class="callout tip">🔒 App Secret gelen mesajların gerçekten Meta'dan geldiğini doğrular. Kimseyle paylaşmayın.</div>
            </div>
          </div>

          <div class="step">
            <div class="step-no">6</div>
            <div class="step-body">
              <h4>Webhook'u bağlayın (son adım)</h4>

              <!-- İşletmeye özel webhook bilgileri (doğrudan kopyalanabilir) -->
              <div class="webhook-box">
                <div class="wb-label">📋 Sizin Webhook (Callback) URL'niz</div>
                <div class="wb-row">
                  <code class="wb-val">{{ webhookUrl() }}</code>
                  <button class="wb-copy" (click)="copy(webhookUrl(), 'url')">
                    {{ copied() === 'url' ? '✓ Kopyalandı' : 'Kopyala' }}
                  </button>
                </div>

                <div class="wb-label">🔑 Sizin Verify Token'ınız</div>
                @if (verifyToken()) {
                  <div class="wb-row">
                    <code class="wb-val">{{ verifyToken() }}</code>
                    <button class="wb-copy" (click)="copy(verifyToken()!, 'token')">
                      {{ copied() === 'token' ? '✓ Kopyalandı' : 'Kopyala' }}
                    </button>
                  </div>
                } @else {
                  <div class="wb-note">
                    Verify Token, WhatsApp ayarlarını <b>ilk kez kaydettiğinizde</b> otomatik oluşturulur.
                    Önce <a routerLink="/settings">Ayarlar &rarr; WhatsApp Entegrasyonu</a> sayfasından
                    bilgilerinizi kaydedin, ardından buraya dönün — token burada görünecektir.
                  </div>
                }
              </div>

              <ul>
                <li>Yukarıdaki bilgileri (veya Ayarlar sayfasındaki aynı bilgileri) kullanın.</li>
                <li>Meta'da <b>WhatsApp &rarr; Configuration &rarr; Edit</b>:
                  <ul>
                    <li><b>Callback URL</b> ← yukarıdaki <em>Webhook URL</em></li>
                    <li><b>Verify Token</b> ← yukarıdaki <em>Verify Token</em></li>
                  </ul>
                </li>
                <li><b>"Verify and Save"</b>. Sonra <b>messages</b> alanı için <b>Subscribe</b> kutusunu işaretleyin.</li>
              </ul>
              <div class="callout ok">🎉 Bitti! Panelde <b>"Bağlantıyı Test Et"</b> ile doğrulayın. Artık müşteri mesajları panelinize düşer.</div>
            </div>
          </div>
        </section>

        <!-- SİPARİŞ AKIŞI -->
        <section [hidden]="active() !== 'orderflow'">
          <h1>🔄 Sipariş Nasıl Akar?</h1>
          <p class="lead">Bir müşteri WhatsApp'tan yazdığında arka planda olanlar:</p>

          <div class="vflow">
            <div class="vstep"><span class="vnum">1</span><div><b>Müşteri mesaj yazar</b><br><span class="muted">"2 lahmacun 1 ayran istiyorum"</span></div></div>
            <div class="vline">↓</div>
            <div class="vstep"><span class="vnum">2</span><div><b>Yapay zekâ anlar</b><br><span class="muted">Ürünleri menünüzle eşleştirir, miktarı çıkarır, fiyatı hesaplar</span></div></div>
            <div class="vline">↓</div>
            <div class="vstep"><span class="vnum">3</span><div><b>Sipariş özeti & onay</b><br><span class="muted">Müşteriye özet gönderilir, teslimat/ödeme sorulur</span></div></div>
            <div class="vline">↓</div>
            <div class="vstep"><span class="vnum">4</span><div><b>Panele düşer</b><br><span class="muted">Siparişler sayfasında "Onay Bekliyor" olarak görünür + sesli/mutfak fişi</span></div></div>
            <div class="vline">↓</div>
            <div class="vstep"><span class="vnum">5</span><div><b>Siz onaylarsınız</b><br><span class="muted">Onayla → Hazırlanıyor → Hazır → Teslim. Her adımda müşteriye otomatik bildirim gider</span></div></div>
          </div>

          <div class="callout info">
            <b>Yapay zekâ emin olamazsa</b> müşteriye netleştirme sorusu sorar (örn. "Hangi boy?").
            Hiç anlayamazsa konuşmayı bir temsilciye (size) aktarır — <a (click)="go('inbox')">Gelen Kutusu</a>'ndan
            elle yanıtlarsınız.
          </div>
        </section>

        <!-- PANEL -->
        <section [hidden]="active() !== 'dashboard'">
          <h1>📊 Panel (Gösterge)</h1>
          <p class="lead">Giriş yapınca ilk gördüğünüz ekran. İşletmenizin günlük özeti.</p>
          <h3>Ne görürsünüz?</h3>
          <ul class="feat">
            <li>📦 <b>Bugünkü sipariş sayısı</b> ve toplam ciro</li>
            <li>💬 <b>Aktif konuşmalar</b> — o an WhatsApp'ta size yazan müşteriler</li>
            <li>👥 <b>Toplam müşteri</b> sayısı</li>
            <li>📈 <b>Haftalık sipariş grafiği</b> ve durum dağılımı (bekleyen/onaylı/hazır)</li>
          </ul>
          <div class="callout tip">💡 Limit uyarısı: Aylık sipariş/mesaj limitiniz dolmak üzereyse burada uyarı çıkar ve plan yükseltme önerilir.</div>
        </section>

        <!-- CHATBOT -->
        <section [hidden]="active() !== 'chatbot'">
          <h1>🤖 Chatbot (Test)</h1>
          <p class="lead">WhatsApp'a hiç dokunmadan, sipariş akışını panelden test etmenizi sağlar.</p>
          <ol class="big-steps">
            <li>Chatbot sayfasına girin.</li>
            <li>Alttaki kutuya müşteri gibi yazın: <code>bir adet X istiyorum</code></li>
            <li>Botun cevabını görün — gerçek WhatsApp'taki davranışın aynısı.</li>
            <li>Üstteki <b>"Sıfırla"</b> ile konuşmayı baştan başlatın.</li>
          </ol>
          <div class="callout info">Burada verilen siparişler <b>gerçek</b> değildir, test amaçlıdır. Menünüzü değiştirince burada hemen deneyebilirsiniz.</div>
        </section>

        <!-- GELEN KUTUSU -->
        <section [hidden]="active() !== 'inbox'">
          <h1>💬 Gelen Kutusu</h1>
          <p class="lead">Tüm WhatsApp konuşmalarınız tek ekranda. Bot yanıtlıyor; gerektiğinde siz devralırsınız.</p>
          <ul class="feat">
            <li>🗂️ Sol tarafta konuşma listesi (açık / temsilci bekliyor / kapalı)</li>
            <li>💬 Ortada seçili konuşmanın mesajları</li>
            <li>✍️ Altta <b>elle yanıt</b> kutusu — siz yazınca bot o konuşmada susar</li>
            <li>🔒 <b>"Temsilciye Aktar"</b> ile botu durdurup konuşmayı tamamen siz yönetirsiniz</li>
          </ul>
          <div class="callout tip">💡 Bir konuşmayı siz yanıtladığınızda bot otomatik geri çekilir; müşteriye iki ayrı yanıt gitmez.</div>
        </section>

        <!-- SİPARİŞLER -->
        <section [hidden]="active() !== 'orders'">
          <h1>📦 Siparişler</h1>
          <p class="lead">Gelen tüm siparişleri yönetip durumlarını ilerletirsiniz.</p>
          <div class="status-flow">
            <span class="st pending">Onay Bekliyor</span><span class="arr">→</span>
            <span class="st confirmed">Onaylandı</span><span class="arr">→</span>
            <span class="st prep">Hazırlanıyor</span><span class="arr">→</span>
            <span class="st ready">Hazır</span><span class="arr">→</span>
            <span class="st done">Teslim Edildi</span>
          </div>
          <ul class="feat">
            <li>✅ <b>Onayla</b> — sipariş kabul edilir, mutfak fişi yazdırılır, müşteriye bildirim gider</li>
            <li>🖨️ <b>Yeniden Yazdır</b> — fişi tekrar bastırın</li>
            <li>❌ <b>Reddet</b> — siparişi iptal edin (müşteri bilgilendirilir)</li>
            <li>📍 Sipariş detayında müşteri adı, ürünler, adres ve <b>harita konumu</b> bulunur</li>
          </ul>
          <div class="callout warn">⚠️ Her onayladığınız sipariş aylık sipariş kotanızdan düşer. Kota dolunca <a (click)="go('billing')">plan yükseltebilirsiniz</a>.</div>
        </section>

        <!-- MENÜ -->
        <section [hidden]="active() !== 'menu'">
          <h1>🍽️ Menü</h1>
          <p class="lead">Ürünlerinizi buradan girersiniz. Yapay zekânın siparişleri doğru anlaması menünüzün doğru kurulmasına bağlıdır.</p>
          <h3>Adımlar</h3>
          <ol class="big-steps">
            <li><b>Kategori & ürün ekleyin</b> — ad, fiyat, açıklama.</li>
            <li><b>Seçenek grupları</b> tanımlayın — örn. "Boy: Küçük/Orta/Büyük", "İçecek seçimi" (zorunlu/opsiyonel, fiyat farkı).</li>
            <li><b>Eş anlamlılar</b> ekleyin — müşteri "kola" yazınca "Coca-Cola"yı bulsun.</li>
            <li><b>Yayınla</b> — değişiklikler ancak yayınlayınca canlıya geçer.</li>
          </ol>
          <div class="mock">
            <div class="mock-title">Menü &rarr; Ürün</div>
            <div class="mock-row">Ad: <span class="hl">Lahmacun</span> &nbsp; Fiyat: <span class="hl">45₺</span></div>
            <div class="mock-row">Seçenek grubu: Boy ( zorunlu, 1 seç )</div>
            <div class="mock-row">&nbsp;&nbsp;• Normal +0₺ &nbsp; • Büyük +15₺</div>
          </div>
          <div class="callout tip">💡 Menü değiştirince <a (click)="go('chatbot')">Chatbot</a>'tan hemen test edin. Yayınlamayı unutmayın!</div>
        </section>

        <!-- ŞUBELER -->
        <section [hidden]="active() !== 'stores'">
          <h1>🏪 Şubeler</h1>
          <p class="lead">Şube konumu ve teslimat kurallarınızı buradan yönetirsiniz.</p>
          <ul class="feat">
            <li>📍 <b>Şube konumu</b> — adres ve harita noktası (teslimat mesafesi buradan hesaplanır)</li>
            <li>🛵 <b>Teslimat bölgeleri</b> — mesafeye göre minimum tutar ve teslimat ücreti</li>
            <li>🕐 <b>Açık/Kapalı</b> — şubeyi geçici kapatın; kapalıyken bot yeni sipariş almaz</li>
            <li>✅ Müşteri adresi teslimat bölgenizin dışındaysa sistem otomatik uyarır</li>
          </ul>
          <div class="callout info">Planınız birden fazla şubeye izin veriyorsa her şubeyi ayrı yönetebilirsiniz. Şube limitiniz dolarsa yeni şube açarken yükseltme önerilir.</div>
        </section>

        <!-- YAZDIRMA -->
        <section [hidden]="active() !== 'print'">
          <h1>🖨️ Yazdırma</h1>
          <p class="lead">Onaylanan siparişlerin mutfak/kasa fişleri otomatik kuyruğa girer.</p>
          <ul class="feat">
            <li>🧾 Her onaylı sipariş için fiş otomatik oluşturulur</li>
            <li>🖥️ <b>Print Bridge</b> (yazıcı köprüsü) kurulu bilgisayar fişleri otomatik basar</li>
            <li>🔁 Basılamayan fişi <b>yeniden deneyebilir</b> veya iptal edebilirsiniz</li>
          </ul>
          <div class="callout tip">💡 Yazıcınız yoksa bu adımı atlayabilirsiniz; siparişler yine panelde görünür.</div>
        </section>

        <!-- ANKETLER -->
        <section [hidden]="active() !== 'surveys'">
          <h1>📋 Anketler</h1>
          <p class="lead">Teslimat sonrası müşterilere otomatik memnuniyet anketi gider.</p>
          <ul class="feat">
            <li>⭐ Müşteri 1-5 yıldız verir; düşük puanlar <b>şikâyet</b> olarak işaretlenir</li>
            <li>📊 Ortalama puan ve şikâyet istatistikleri bu sayfada</li>
            <li>✅ Şikâyetleri <b>"Çözüldü"</b> olarak işaretleyip takip edebilirsiniz</li>
          </ul>
        </section>

        <!-- MÜŞTERİLER -->
        <section [hidden]="active() !== 'customers'">
          <h1>👥 Müşteriler</h1>
          <p class="lead">WhatsApp'tan sipariş veren tüm müşterileriniz ve davranışları.</p>
          <ul class="feat">
            <li>📇 Müşteri adı, telefon, sipariş sayısı, toplam harcama</li>
            <li>🏷️ Segmentler: <b>Aktif</b>, <b>Uyuyan</b> (uzun süredir sipariş yok), <b>Yeni</b></li>
            <li>❤️ Favori ürünleri ve sipariş geçmişi</li>
            <li>📣 İzin veren müşterilere <a (click)="go('campaigns')">Kampanyalar</a>'dan mesaj gönderebilirsiniz</li>
          </ul>
        </section>

        <!-- KAMPANYALAR -->
        <section [hidden]="active() !== 'campaigns'">
          <h1>📣 Kampanyalar</h1>
          <p class="lead">Eski/uyuyan müşterilere indirim ve duyuru mesajları gönderin (soğuk satış).</p>
          <ol class="big-steps">
            <li>Hedef segment seçin (örn. Uyuyan müşteriler).</li>
            <li>İndirim oranı ve mesaj içeriğini ayarlayın.</li>
            <li>Hemen veya zamanlanmış gönderin.</li>
            <li>Gönderim ve dönüşüm istatistiklerini takip edin.</li>
          </ol>
          <div class="callout warn">⚠️ Yalnızca <b>pazarlama izni veren</b> müşterilere gönderilir. İzinsiz toplu mesaj WhatsApp tarafından numaranızı engelletebilir.</div>
        </section>

        <!-- AYARLAR -->
        <section [hidden]="active() !== 'settings'">
          <h1>⚙️ Ayarlar</h1>
          <p class="lead">İşletme yapılandırmanızın merkezi.</p>
          <ul class="feat">
            <li>📲 <b>WhatsApp Entegrasyonu</b> — bağlantı bilgileri (bkz. <a (click)="go('whatsapp')">WhatsApp Kurulumu</a>)</li>
            <li>🔌 <b>POS Entegrasyonu</b> — RestoMaster/HighFive POS bağlama (menü ve sipariş senkronu)</li>
            <li>🕐 <b>Çalışma saatleri</b> — bot bu saatler dışında sipariş almaz</li>
            <li>🎟️ <b>Gel-al indirimi</b>, <b>sipariş bildirim telefonları</b>, <b>Google Maps anahtarı</b></li>
            <li>💳 <b>iyzico</b> — müşterilerden online ödeme almak için kendi iyzico bilgileriniz</li>
          </ul>
        </section>

        <!-- FATURALANDIRMA -->
        <section [hidden]="active() !== 'billing'">
          <h1>💳 Faturalandırma</h1>
          <p class="lead">Abonelik planınızı ve ödemelerinizi yönetirsiniz.</p>
          <ul class="feat">
            <li>📦 Mevcut planınız (Gümüş / Altın / Platin) ve kullanım durumu</li>
            <li>⬆️ Plan yükseltme — daha çok sipariş/mesaj/şube hakkı için</li>
            <li>🧾 Ödeme geçmişi ve fatura kayıtları</li>
            <li>➕ Ek hizmetler: POS entegrasyonu, ekstra sipariş paketleri</li>
          </ul>
          <div class="callout warn">⚠️ Ödeme yapılmazsa: süre dolunca 2 gün ek süre verilir, sonra hesap askıya alınır ve <b>bot müşterilere yanıt vermeyi durdurur</b>. Yenileyince anında devam eder.</div>
        </section>

        <div class="guide-footer">
          Sorularınız için: <b>superpersonel34&#64;gmail.com</b> · 0505 678 98 81
        </div>
      </main>
    </div>
  `,
  styles: [`
    .guide-page { display: flex; gap: 24px; max-width: 1200px; margin: 0 auto; padding: 24px; align-items: flex-start; }

    /* İçindekiler */
    .toc { position: sticky; top: 24px; width: 240px; flex-shrink: 0; background: var(--color-bg-elevated, #fff); border: 1px solid var(--color-border, #e5e7eb); border-radius: 14px; padding: 16px; }
    .toc-head { font-weight: 700; font-size: 1rem; margin-bottom: 12px; }
    .toc nav { display: flex; flex-direction: column; gap: 2px; }
    .toc-link { display: flex; align-items: center; gap: 9px; text-align: left; padding: 9px 11px; border: 0; background: transparent; border-radius: 9px; cursor: pointer; color: var(--color-text-secondary, #4b5563); font-size: 0.875rem; font-family: inherit; transition: all 0.15s; }
    .toc-link:hover { background: var(--color-bg-secondary, #f3f4f6); color: var(--color-text-primary, #111827); }
    .toc-link.active { background: var(--color-accent-primary, #1B5583); color: #fff; }
    .toc-ic { font-size: 1.05rem; }

    /* İçerik */
    .guide-content { flex: 1; min-width: 0; background: var(--color-bg-elevated, #fff); border: 1px solid var(--color-border, #e5e7eb); border-radius: 14px; padding: 32px 36px; }
    .guide-content h1 { font-size: 1.6rem; margin: 0 0 12px; color: var(--color-text-primary, #111827); }
    .guide-content h3 { font-size: 1.1rem; margin: 26px 0 12px; color: var(--color-text-primary, #111827); }
    .guide-content h4 { margin: 0 0 8px; font-size: 1rem; }
    .lead { font-size: 1.02rem; line-height: 1.6; color: var(--color-text-secondary, #4b5563); margin: 0 0 20px; }
    .guide-content a { color: var(--color-accent-primary, #1B5583); cursor: pointer; text-decoration: underline; }
    .guide-content code { background: var(--color-bg-secondary, #f3f4f6); padding: 1px 6px; border-radius: 5px; font-family: var(--font-mono, monospace); font-size: 0.85em; }
    .guide-content ul, .guide-content ol { line-height: 1.7; padding-left: 22px; }
    .guide-content ul ul { margin-top: 4px; }

    /* Yatay akış */
    .flow { display: flex; align-items: stretch; gap: 8px; flex-wrap: wrap; margin: 20px 0; }
    .flow-box { flex: 1; min-width: 120px; text-align: center; background: var(--color-bg-secondary, #f3f4f6); border: 1px solid var(--color-border, #e5e7eb); border-radius: 12px; padding: 16px 10px; font-size: 0.85rem; line-height: 1.7; }
    .flow-arrow { display: flex; align-items: center; font-size: 1.4rem; color: var(--color-accent-primary, #1B5583); }

    /* Dikey akış */
    .vflow { margin: 18px 0; }
    .vstep { display: flex; align-items: flex-start; gap: 12px; }
    .vnum { flex-shrink: 0; width: 28px; height: 28px; border-radius: 50%; background: var(--color-accent-primary, #1B5583); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 0.85rem; }
    .vline { margin: 4px 0 4px 13px; color: var(--color-text-muted, #9ca3af); font-size: 1.1rem; }
    .muted { color: var(--color-text-muted, #6b7280); font-size: 0.9rem; }

    /* Adım kutuları (WhatsApp) */
    .step { display: flex; gap: 14px; padding: 16px 0; border-top: 1px solid var(--color-border, #e5e7eb); }
    .step.highlight { background: color-mix(in srgb, var(--color-accent-primary, #1B5583) 6%, transparent); border-radius: 12px; padding: 16px; border-top: 0; margin: 8px 0; }
    .step-no { flex-shrink: 0; width: 30px; height: 30px; border-radius: 8px; background: var(--color-accent-primary, #1B5583); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; }
    .step-body { flex: 1; min-width: 0; }

    /* Callout kutuları */
    .callout { border-radius: 10px; padding: 12px 14px; margin: 14px 0; font-size: 0.9rem; line-height: 1.55; border: 1px solid; }
    .callout.info { background: rgba(27,85,131,0.07); border-color: rgba(27,85,131,0.25); }
    .callout.warn { background: rgba(245,158,11,0.09); border-color: rgba(245,158,11,0.3); }
    .callout.ok { background: rgba(16,185,129,0.09); border-color: rgba(16,185,129,0.3); }
    .callout.tip { background: var(--color-bg-secondary, #f3f4f6); border-color: var(--color-border, #e5e7eb); }

    /* Mockup */
    .mock { background: #0f172a; color: #cbd5e1; border-radius: 10px; padding: 14px 16px; margin: 14px 0; font-family: var(--font-mono, monospace); font-size: 0.82rem; line-height: 1.9; }
    .mock-title { color: #64748b; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 8px; }
    .mock .hl { background: #1d4ed8; color: #fff; padding: 1px 7px; border-radius: 5px; }
    .hl { background: color-mix(in srgb, var(--color-accent-primary, #1B5583) 18%, transparent); padding: 1px 6px; border-radius: 5px; font-weight: 600; }

    .big-steps { line-height: 2; }
    .feat { list-style: none; padding-left: 0; line-height: 2.1; }

    /* Webhook kopyalama kutusu */
    .webhook-box { background: var(--color-bg-secondary, #f3f4f6); border: 1px solid var(--color-border, #e5e7eb); border-radius: 12px; padding: 16px; margin: 14px 0; }
    .wb-label { font-size: 0.82rem; font-weight: 600; color: var(--color-text-secondary, #4b5563); margin: 0 0 6px; }
    .wb-label:not(:first-child) { margin-top: 16px; }
    .wb-row { display: flex; gap: 8px; align-items: stretch; }
    .wb-val { flex: 1; min-width: 0; background: var(--color-bg-elevated, #fff); border: 1px solid var(--color-border, #e5e7eb); border-radius: 8px; padding: 9px 12px; font-family: var(--font-mono, monospace); font-size: 0.82rem; word-break: break-all; display: flex; align-items: center; }
    .wb-copy { flex-shrink: 0; background: var(--color-accent-primary, #1B5583); color: #fff; border: 0; border-radius: 8px; padding: 0 16px; font-size: 0.82rem; font-weight: 600; cursor: pointer; white-space: nowrap; font-family: inherit; }
    .wb-copy:hover { background: var(--color-accent-primary-hover, #154269); }
    .wb-note { background: rgba(245,158,11,0.09); border: 1px solid rgba(245,158,11,0.3); border-radius: 8px; padding: 10px 12px; font-size: 0.86rem; line-height: 1.5; }

    /* Sipariş durum akışı */
    .status-flow { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin: 18px 0; }
    .st { padding: 5px 12px; border-radius: 100px; font-size: 0.82rem; font-weight: 600; }
    .st.pending { background: rgba(245,158,11,0.15); color: #b45309; }
    .st.confirmed { background: rgba(27,85,131,0.15); color: #1B5583; }
    .st.prep { background: rgba(139,92,246,0.15); color: #6d28d9; }
    .st.ready { background: rgba(16,185,129,0.15); color: #047857; }
    .st.done { background: rgba(107,114,128,0.15); color: #374151; }
    .arr { color: var(--color-text-muted, #9ca3af); }

    .guide-footer { margin-top: 32px; padding-top: 18px; border-top: 1px solid var(--color-border, #e5e7eb); color: var(--color-text-muted, #6b7280); font-size: 0.85rem; }

    @media (max-width: 820px) {
      .guide-page { flex-direction: column; padding: 12px; }
      .toc { position: static; width: 100%; }
      .toc nav { flex-direction: row; flex-wrap: wrap; }
      .toc-link span:last-child { display: none; }
      .toc-ic { font-size: 1.3rem; }
      .guide-content { padding: 20px 16px; }
    }
  `],
})
export class GuideComponent implements OnInit {
  private auth = inject(AuthService);
  private waConfig = inject(WhatsAppConfigService);

  active = signal('intro');
  copied = signal<string | null>(null);

  // Tenant-specific webhook URL. Built from the tenant id even before the
  // WhatsApp config is saved, so the user can copy it right away. Falls back to
  // the production panel base if the API base is relative ('/api').
  webhookUrl = signal<string>('');
  verifyToken = signal<string | null>(null);

  ngOnInit(): void {
    const tenantId = this.auth.tenant()?.id ?? '';
    const base = environment.apiBaseUrl.startsWith('http')
      ? environment.apiBaseUrl
      : `${window.location.origin}/api`;
    this.webhookUrl.set(`${base}/whatsapp/webhook/${tenantId}`);

    // If the tenant already saved their WhatsApp config, show the real
    // webhook URL + verify token returned by the backend.
    this.waConfig.getConfig().subscribe({
      next: (res) => {
        if (res.success && res.data) {
          if (res.data.webhookUrl) this.webhookUrl.set(res.data.webhookUrl);
          this.verifyToken.set(res.data.webhookVerifyToken || null);
        }
      },
      error: () => { /* not configured yet — keep the constructed URL */ },
    });
  }

  copy(text: string, key: string): void {
    navigator.clipboard?.writeText(text).then(() => {
      this.copied.set(key);
      setTimeout(() => this.copied.set(null), 2000);
    });
  }

  sections: GuideSection[] = [
    { id: 'intro', icon: '🚀', title: 'Başlangıç' },
    { id: 'whatsapp', icon: '📲', title: 'WhatsApp Kurulumu' },
    { id: 'orderflow', icon: '🔄', title: 'Sipariş Akışı' },
    { id: 'dashboard', icon: '📊', title: 'Panel' },
    { id: 'chatbot', icon: '🤖', title: 'Chatbot Test' },
    { id: 'inbox', icon: '💬', title: 'Gelen Kutusu' },
    { id: 'orders', icon: '📦', title: 'Siparişler' },
    { id: 'menu', icon: '🍽️', title: 'Menü' },
    { id: 'stores', icon: '🏪', title: 'Şubeler' },
    { id: 'print', icon: '🖨️', title: 'Yazdırma' },
    { id: 'surveys', icon: '📋', title: 'Anketler' },
    { id: 'customers', icon: '👥', title: 'Müşteriler' },
    { id: 'campaigns', icon: '📣', title: 'Kampanyalar' },
    { id: 'settings', icon: '⚙️', title: 'Ayarlar' },
    { id: 'billing', icon: '💳', title: 'Faturalandırma' },
  ];

  go(id: string): void {
    this.active.set(id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

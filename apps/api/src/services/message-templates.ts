/**
 * Centralized Turkish message templates for WhatsApp bot responses
 */

interface OrderSummaryItem {
  name: string;
  qty: number;
  price: number;
  options?: string[];
  notes?: string | null;
}

export const TEMPLATES = {
  // ==================== GREETING ====================
  greeting:
    'Merhaba! Hosgeldiniz 🍽️\nSiparis vermek icin istediginiz urunleri yazabilirsiniz.\nMenumuzu gormek icin "menu" yazin.',

  // ==================== ORDER ====================
  orderSummary(items: OrderSummaryItem[], total: number, deliveryFee?: number, orderNotes?: string | null): string {
    let msg = 'Siparisiniz:\n\n';
    items.forEach((i) => {
      let line = `  ${i.qty}x ${i.name}`;
      if (i.options && i.options.length > 0) {
        line += ` (${i.options.join(', ')})`;
      }
      line += ` - ${(i.qty * i.price).toFixed(2)} TL`;
      if (i.notes) {
        line += `\n    Not: ${i.notes}`;
      }
      msg += line + '\n';
    });
    msg += `\nAra Toplam: ${total.toFixed(2)} TL`;
    if (deliveryFee != null && deliveryFee > 0) {
      msg += `\nTeslimat Ucreti: ${deliveryFee.toFixed(2)} TL`;
      msg += `\nGenel Toplam: ${(total + deliveryFee).toFixed(2)} TL`;
    }
    if (orderNotes) {
      msg += `\n\nNot: ${orderNotes}`;
    }
    msg += '\n\nOnaylamak icin "evet", degistirmek icin yeni urun yazin, iptal icin "iptal" yazin.';
    return msg;
  },

  orderEmpty: 'Sepetiniz bos. Siparis vermek icin urun adini yazin.',

  orderItemAdded(itemName: string, qty: number): string {
    return `✅ ${qty}x ${itemName} sepete eklendi.`;
  },

  // ==================== LOCATION ====================
  locationRequest:
    '📍 Teslimat icin konumunuzu gonderin.\nAsagidaki butona tiklayarak konum paylasabilirsiniz.',

  locationOutOfService(message: string): string {
    return `❌ ${message}\n\nLutfen farkli bir konum gonderin veya *"iptal"* yazin.`;
  },

  locationConfirmed(storeName: string, deliveryFee: number, distance: number): string {
    return (
      `✅ *${storeName}* subemizden teslimat yapilacak.\n` +
      `📏 Mesafe: ${distance.toFixed(1)} km\n` +
      `🚚 Teslimat ucreti: ${deliveryFee.toFixed(2)} TL`
    );
  },

  locationMinBasketNotMet(minBasket: number, currentTotal: number): string {
    return (
      `⚠️ Minimum sepet tutari ${minBasket.toFixed(2)} TL.\n` +
      `Mevcut sepetiniz: ${currentTotal.toFixed(2)} TL\n\n` +
      `Lutfen daha fazla urun ekleyin veya *"iptal"* yazin.`
    );
  },

  reminderSendLocation:
    '📍 Lutfen konum pininizi gonderin.\nKonum gondermek icin WhatsApp\'ta 📎 > Konum secenegini kullanin.',

  // ==================== ADDRESS COLLECTION ====================
  addressRequest:
    '📝 Lutfen teslimat adresinizi yazin.\n' +
    'Ornek: _Ataturk Mah. Cumhuriyet Cad. No:12 Daire:5_',

  addressConfirmation(address: string): string {
    return (
      `📍 Teslimat adresiniz:\n\n` +
      `*${address}*\n\n` +
      `Bu adres dogru mu?\n` +
      `✅ _"evet"_ - Onayla\n` +
      `✏️ _"hayir"_ - Tekrar yaz`
    );
  },

  addressRetry:
    '📝 Lutfen teslimat adresinizi tekrar yazin.',

  // ==================== PAYMENT ====================
  paymentMethodButtons: {
    body: 'Odeme yontemini secin:',
    buttons: [
      { id: 'pay_cash', title: 'Nakit' },
      { id: 'pay_card', title: 'Kredi Karti' },
    ],
  },

  paymentLinkSent(url: string): string {
    return (
      `💳 Kredi karti ile odeme icin asagidaki linke tiklayiniz:\n\n` +
      `${url}\n\n` +
      `⏰ Link 30 dakika gecerlidir.\n` +
      `Nakit odemeye gecmek icin *"nakit"* yazabilirsiniz.`
    );
  },

  paymentSuccess(orderNumber: number): string {
    return (
      `✅ *Odemeniz basariyla alindi!*\n\n` +
      `📦 Siparis No: #${orderNumber}\n` +
      `⏳ Restoran onayiniz bekleniyor...`
    );
  },

  paymentFailed:
    '❌ Odeme basarisiz oldu.\nTekrar denemek icin *"kart"*, nakit odemek icin *"nakit"* yazin.',

  cashConfirmed(orderNumber: number): string {
    return (
      `✅ *Siparisinia alindi!*\n\n` +
      `📦 Siparis No: #${orderNumber}\n` +
      `💵 Odeme: Kapida nakit\n` +
      `⏳ Restoran onayiniz bekleniyor...`
    );
  },

  reminderPayment(url: string): string {
    return (
      `⏳ Odeme bekleniyor.\n\n` +
      `💳 Odeme linkiniz: ${url}\n\n` +
      `Nakit odemek icin *"nakit"* yazabilirsiniz.`
    );
  },

  pendingConfirmation(orderNumber: number): string {
    return (
      `📦 Siparis No: #${orderNumber}\n` +
      `⏳ Siparisinia restoran tarafindan onay bekliyor.\n` +
      `Onaylaninca size bildirim gonderecegiz.`
    );
  },

  restaurantApproved(orderNumber: number): string {
    return (
      `✅ *Siparisinia onaylandi!*\n\n` +
      `📦 Siparis No: #${orderNumber}\n` +
      `🎉 Siparisinia hazirlaniyor!\n` +
      `⏱️ Tahmini hazirlık suresi: 25-30 dakika`
    );
  },

  // ==================== ORDER STATUS UPDATES ====================
  orderPreparing(orderNumber: number): string {
    return (
      `👨‍🍳 *Siparisinia hazirlaniyor!*\n\n` +
      `📦 Siparis No: #${orderNumber}\n` +
      `⏱️ Tahmini sure: 25-30 dakika`
    );
  },

  orderReady(orderNumber: number): string {
    return (
      `🎉 *Siparisinia hazir!*\n\n` +
      `📦 Siparis No: #${orderNumber}\n` +
      `🚀 Kurye yola cikmak uzere!`
    );
  },

  orderDelivered(orderNumber: number): string {
    return (
      `✅ *Siparisinia teslim edildi!*\n\n` +
      `📦 Siparis No: #${orderNumber}\n` +
      `🍽️ Afiyet olsun!\n` +
      `Tekrar siparis icin urun yazabilirsiniz.`
    );
  },

  orderCancelledNotification(orderNumber: number): string {
    return (
      `❌ *Siparisinia iptal edildi.*\n\n` +
      `📦 Siparis No: #${orderNumber}\n` +
      `Yeni siparis icin urun yazabilirsiniz.`
    );
  },

  // ==================== ORDER ADDITION ====================
  additionPrompt(orderNumber: number): string {
    return `Mevcut siparisinia (#${orderNumber}) var. Ekleme mi yapmak istiyorsunuz, yoksa yeni siparis mi vermek istiyorsunuz?`;
  },

  additionStarted(parentOrderNumber: number): string {
    return (
      `➕ Siparis #${parentOrderNumber}'e ekleme yapiyorsunuz.\n` +
      `Eklemek istediginiz urunleri yazin.`
    );
  },

  newOrderPrompt: 'Yeni siparis icin urunlerinizi yazabilirsiniz.',

  additionNotAllowed(orderNumber: number): string {
    return (
      `❌ Siparis #${orderNumber} teslim edilmis veya iptal edilmis.\n` +
      `Yeni siparis vermek icin urun adini yazin.`
    );
  },

  additionReadyFoodOnly(nonReadyItemNames: string): string {
    return (
      `⚠️ Siparisinia hazir durumunda oldugu icin sadece hazir urunler eklenebilir.\n` +
      `Su urunler eklenemez: *${nonReadyItemNames}*\n\n` +
      `Lutfen sadece hazir urunler secin veya *"iptal"* yazin.`
    );
  },

  additionApproved(orderNumber: number): string {
    return (
      `✅ *Eklemeniz onaylandi!*\n\n` +
      `📦 Siparis #${orderNumber}\n` +
      `Ek urunleriniz hazirlaniyor.`
    );
  },

  additionRejected(orderNumber: number, reason: string): string {
    return (
      `❌ *Eklemeniz reddedildi.*\n\n` +
      `📦 Siparis #${orderNumber}\n` +
      `Neden: *${reason}*\n\n` +
      `Yeni siparis vermek icin urun adini yazabilirsiniz.`
    );
  },

  orderRejected(orderNumber: number, reason: string): string {
    return (
      `❌ *Siparisinia reddedildi.*\n\n` +
      `📦 Siparis No: #${orderNumber}\n` +
      `Neden: *${reason}*\n\n` +
      `Yeni siparis vermek icin urun adini yazabilirsiniz.`
    );
  },

  refundInitiated(orderNumber: number): string {
    return (
      `💳 Siparis #${orderNumber} icin odeme iadesi baslatildi.\n` +
      `Iadeniz 3-5 is gunu icerisinde kartiniza yansiyacaktir.`
    );
  },

  // ==================== SAVED ADDRESSES ====================
  savedAddressListHeader: 'Kayitli adresleriniz:',
  savedAddressListButton: 'Adres Sec',
  newAddressRowTitle: 'Yeni Adres',
  newAddressRowDescription: 'Yeni konum gondererek adres girin',

  askSaveAddress:
    'Bu adresi kaydetmek ister misiniz?\n' +
    '✅ _"evet"_ - Kaydet\n' +
    '❌ _"hayir"_ - Kaydetme',

  askAddressName: 'Bu adrese bir isim verin (ornek: _Ev_, _Is_, _Annemin Evi_):',

  addressSaved(name: string): string {
    return `✅ Adres *"${name}"* olarak kaydedildi.`;
  },

  addressNotSaved: 'Tamam, adres kaydedilmedi.',

  savedAddressInvalid:
    '⚠️ Sectiginiz adres artik hizmet alaninda degil.\nLutfen yeni konum gonderin.',

  // ==================== STORE STATUS ====================
  storeClosed: '⏰ Suanda kapaliyiz. Acildigimizda tekrar siparis verebilirsiniz.',

  // ==================== GENERAL ====================
  orderCancelled: '🚫 Siparisinia iptal edildi.\nYeni siparis icin istediginiz urunleri yazabilirsiniz.',

  orderConfirmedNewOrder:
    'Siparisinia isleniyor! ⏳\nYeni siparis vermek icin urun yazabilirsiniz.',

  clarificationFallback:
    'Anlayamadim. Siparis vermek icin urun adini yazin veya "menu" yazarak menuyu gorun.',

  agentHandoff:
    '👤 Sizi bir temsilciye yonlendiriyorum. Lutfen bekleyin...',

  // ==================== UPSELL ====================
  upsellButtons(price: number): { buttons: Array<{ id: string; title: string }> } {
    return {
      buttons: [
        { id: 'upsell_accept', title: `✅ Ekle ${price.toFixed(0)} TL` },
        { id: 'upsell_reject', title: '❌ Hayir' },
      ],
    };
  },

  // ==================== SATISFACTION SURVEY ====================
  surveyAsk(orderNumber: number): string {
    return (
      `Siparis #${orderNumber} teslim edildi!\n\n` +
      `Hizmetimizi nasil buldunuz? 🤔\n` +
      `Lutfen 1-5 arasi puan verin:`
    );
  },

  surveyButtons: {
    buttons: [
      { id: 'survey_5', title: '⭐⭐⭐⭐⭐' },
      { id: 'survey_3', title: '⭐⭐⭐' },
      { id: 'survey_1', title: '⭐' },
    ],
  },

  surveyAskComment:
    'Geri bildiriminiz icin tesekkurler. Bizi daha iyi yapabilmemiz icin neler yasadiginizi kisa bir mesajla yazar misiniz?',

  surveyThanksGood:
    'Cok tesekkur ederiz! 🙏 Sizi memnun ettigimize sevindik. Yine bekleriz! 😊',

  surveyThanksBad:
    'Geri bildiriminiz icin tesekkurler. 🙏 Sorunuzu en kisa surede degerlendirecegiz. Ozur dileriz!',

  surveyThanksNeutral:
    'Puan icin tesekkurler! 🙏 Daha iyisini yapmak icin calisacagiz.',

  // ==================== REORDER / FAVORITES ====================
  favoritesListHeader(count: number): string {
    return `En cok siparis verdiginiz ${count} urun 👇`;
  },

  favoritesListButton: 'Favorilerim',

  favoritesListHeaderText: 'Favorileriniz',

  noFavoritesYet:
    'Henuz siparis gecmisiniz yok. Siparis verdikten sonra favorileriniz burada gorunecek!',

  // ==================== BROADCAST / CAMPAIGN ====================
  broadcastOptInAsk:
    'Kampanyalarimizdan ve size ozel firsatlardan haberdar olmak ister misiniz? 🎉',

  broadcastOptInButtons: {
    buttons: [
      { id: 'broadcast_yes', title: 'Evet, istiyorum' },
      { id: 'broadcast_no', title: 'Hayir' },
    ],
  },

  broadcastOptInConfirmed:
    'Harika! Size ozel kampanyalar ve firsatlar hakkinda bildirim gonderecegiz. ' +
    'Istediginiz zaman "kampanya istemiyorum" yazarak iptal edebilirsiniz.',

  broadcastOptOutConfirmed:
    'Tamam, kampanya bildirimleri kapatildi. ' +
    'Istediginiz zaman "kampanya" yazarak tekrar acabilirsiniz.',
};

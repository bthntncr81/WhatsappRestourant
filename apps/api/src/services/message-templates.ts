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
    return msg;
  },

  orderConfirmButtons: {
    buttons: [
      { id: 'confirm_order', title: 'Onayla' },
      { id: 'cancel_order', title: 'Iptal' },
    ],
  },

  orderEmpty: 'Sepetiniz bos. Siparis vermek icin urun adini yazin.',

  orderItemAdded(itemName: string, qty: number): string {
    return `✅ ${qty}x ${itemName} sepete eklendi.`;
  },

  seamlessAdditionConfirmed(orderNumber: number, addedItems: string, additionTotal: number, newTotal: number): string {
    return (
      `➕ *${addedItems}* siparisinize (#${orderNumber}) eklendi!\n\n` +
      `Ek tutar: ${additionTotal.toFixed(2)} TL\n` +
      `Yeni toplam: ${newTotal.toFixed(2)} TL`
    );
  },

  seamlessAdditionPaymentNeeded(orderNumber: number, addedItems: string, additionTotal: number, paymentUrl: string, newTotal: number): string {
    return (
      `➕ *${addedItems}* siparisinize (#${orderNumber}) eklendi!\n\n` +
      `Ek tutar: ${additionTotal.toFixed(2)} TL\n` +
      `💳 Ek odeme icin: ${paymentUrl}\n\n` +
      `Yeni toplam: ${newTotal.toFixed(2)} TL`
    );
  },

  // ==================== PAYMENT CHANGE ====================

  paymentChangeLinkSent(orderNumber: number, total: number, url: string): string {
    return (
      `💳 Siparis #${orderNumber} icin online odeme linki:\n\n` +
      `${url}\n\n` +
      `Toplam: ${total.toFixed(2)} TL\n` +
      `⏰ Link 30 dakika gecerlidir.\n` +
      `Vazgecmek icin *"iptal"* yazabilirsiniz.`
    );
  },

  paymentChangeSuccess(orderNumber: number): string {
    return (
      `✅ *Online odemeniz basariyla alindi!*\n\n` +
      `📦 Siparis No: #${orderNumber}\n` +
      `💳 Odeme yontemi guncellendi: Online kredi karti`
    );
  },

  // ==================== INACTIVITY TIMEOUT ====================

  inactivityWarning:
    '⏳ Siparisiniz hala devam ediyor mu?\n\nDevam etmek icin herhangi bir mesaj gonderin.\n1 dakika icerisinde yanit alinmazsa siparisiniz *iptal* edilecektir.',

  inactivityCancelled:
    '⏰ Uzun suredir yanit alinamadigi icin siparisiniz iptal edildi.\n\nYeni siparis icin istediginiz urunleri yazabilirsiniz.',

  inactivityResumed:
    '✅ Siparisiniz devam ediyor. Kaldiginiz yerden devam edebilirsiniz.',

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
      `*${address}*`
    );
  },

  addressConfirmButtons: {
    body: 'Bu adres dogru mu?',
    buttons: [
      { id: 'address_confirm', title: 'Evet, Dogru' },
      { id: 'address_retry', title: 'Hayir, Degistir' },
    ],
  },

  addressRetry:
    '📝 Lutfen teslimat adresinizi tekrar yazin.',

  // ==================== PAYMENT ====================
  paymentMethodButtons: {
    body: 'Odeme yontemini secin:',
    buttons: [
      { id: 'pay_cash', title: 'Nakit (kapida)' },
      { id: 'pay_card_door', title: 'Kart (kapida)' },
      { id: 'pay_card_online', title: 'Online Kredi Karti' },
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
      `✅ *Siparisiniz alindi!*\n\n` +
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
      `⏳ Siparisiniz restoran tarafindan onay bekliyor.\n` +
      `Onaylaninca size bildirim gonderecegiz.`
    );
  },

  restaurantApproved(orderNumber: number): string {
    return (
      `✅ *Siparisiniz onaylandi!*\n\n` +
      `📦 Siparis No: #${orderNumber}\n` +
      `🎉 Siparisiniz hazirlaniyor!\n` +
      `⏱️ Tahmini hazirlık suresi: 25-30 dakika`
    );
  },

  // ==================== ORDER STATUS UPDATES ====================
  orderPreparing(orderNumber: number): string {
    return (
      `👨‍🍳 *Siparisiniz hazirlaniyor!*\n\n` +
      `📦 Siparis No: #${orderNumber}\n` +
      `⏱️ Tahmini sure: 25-30 dakika`
    );
  },

  orderReady(orderNumber: number): string {
    return (
      `🎉 *Siparisiniz hazir!*\n\n` +
      `📦 Siparis No: #${orderNumber}\n` +
      `🚀 Kurye yola cikmak uzere!`
    );
  },

  orderDelivered(orderNumber: number): string {
    return (
      `✅ *Siparisiniz teslim edildi!*\n\n` +
      `📦 Siparis No: #${orderNumber}\n` +
      `🍽️ Afiyet olsun!\n` +
      `Tekrar siparis icin urun yazabilirsiniz.`
    );
  },

  orderCancelledNotification(orderNumber: number): string {
    return (
      `❌ *Siparisiniz iptal edildi.*\n\n` +
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
      `⚠️ Siparisiniz hazir durumunda oldugu icin sadece hazir urunler eklenebilir.\n` +
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
      `❌ *Siparisiniz reddedildi.*\n\n` +
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

  askSaveAddressButtons: {
    body: 'Bu adresi kaydetmek ister misiniz?',
    buttons: [
      { id: 'save_address_yes', title: 'Evet, Kaydet' },
      { id: 'save_address_no', title: 'Hayir' },
    ],
  },

  askAddressNameButtons: {
    body: 'Bu adrese bir isim verin:',
    buttons: [
      { id: 'addr_name_ev', title: 'Ev' },
      { id: 'addr_name_is', title: 'Is' },
      { id: 'addr_name_diger', title: 'Diger' },
    ],
  },

  addressSaved(name: string): string {
    return `✅ Adres *"${name}"* olarak kaydedildi.`;
  },

  addressNotSaved: 'Tamam, adres kaydedilmedi.',

  savedAddressInvalid:
    '⚠️ Sectiginiz adres artik hizmet alaninda degil.\nLutfen yeni konum gonderin.',

  // ==================== STORE STATUS ====================
  storeClosed: '⏰ Suanda kapaliyiz. Acildigimizda tekrar siparis verebilirsiniz.',

  // ==================== GENERAL ====================
  orderCancelled: '🚫 Siparisiniz iptal edildi.\nYeni siparis icin istediginiz urunleri yazabilirsiniz.',

  orderConfirmedNewOrder:
    'Siparisiniz isleniyor! ⏳\nYeni siparis vermek icin urun yazabilirsiniz.',

  clarificationFallback:
    'Anlayamadim. Siparis vermek icin urun adini yazin veya "menu" yazarak menuyu gorun.',

  agentHandoff:
    '👤 Sizi bir temsilciye yonlendiriyorum. Lutfen bekleyin...',

  // ==================== MENU MEDIA ====================
  menuMediaIntro: '📋 Menumuze goz atin:',

  menuMediaFooter: 'Siparis vermek icin istediginiz urunleri yazabilirsiniz.',

  menuNotAvailable:
    'Menu henuz yuklenmemis. Siparis vermek icin urun adini yazabilirsiniz.',

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

/**
 * Centralized Turkish message templates for WhatsApp bot responses
 */

/**
 * Staff flag written FIRST into Order.notes when the customer gave a written
 * address instead of a pin. No commas (the NLU note merger splits on ',').
 */
export const TYPED_ADDRESS_NOTE = 'Konum paylasilmadi - yazili adres - bolge kontrolu yapilmadi';

/**
 * Marker phrase inside the explicit "please type your address" prompts. The
 * flow looks for it in outbound history to know it already asked (survives the
 * inactivity sub-state reset). Prisma `contains` is case-sensitive: keep the
 * exact lowercase spelling inside the templates.
 */
export const ADDRESS_ASK_MARKER = 'kuryemizin sizi bulabilmesi icin';

/**
 * Order.notes without the written-address staff flag. The flag is an
 * instruction for staff; every customer-facing summary must drop it.
 */
export function stripTypedAddressNote(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const rest = notes
    .split(' | ')
    .filter((p) => !p.startsWith(TYPED_ADDRESS_NOTE))
    .join(' | ')
    .trim();
  return rest || null;
}

interface OrderSummaryItem {
  name: string;
  qty: number;
  price: number;
  originalPrice?: number;
  options?: string[];
  notes?: string | null;
}

export const TEMPLATES = {
  // ==================== GREETING ====================
  greeting:
    'Merhaba, hosgeldiniz. Bugun ne yemek istersiniz?',

  // ==================== ORDER ====================
  orderSummary(items: OrderSummaryItem[], total: number, deliveryFee?: number, orderNotes?: string | null): string {
    let msg = 'Siparisiniz:\n\n';
    items.forEach((i) => {
      let line = `  ${i.qty}x ${i.name}`;
      if (i.options && i.options.length > 0) {
        line += ` (${i.options.join(', ')})`;
      }
      if (i.originalPrice && i.originalPrice > i.price) {
        line += ` - ~${(i.qty * i.originalPrice).toFixed(2)} TL~ *${(i.qty * i.price).toFixed(2)} TL*`;
      } else {
        line += ` - ${(i.qty * i.price).toFixed(2)} TL`;
      }
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

  orderEmpty: 'Sepetiniz su an bos. Ne almak istersiniz?',

  orderItemAdded(itemName: string, qty: number): string {
    return `${qty}x ${itemName} sepete eklendi.`;
  },

  seamlessAdditionConfirmed(orderNumber: number, addedItems: string, additionTotal: number, newTotal: number): string {
    return (
      `*${addedItems}* siparisinize (#${orderNumber}) eklendi!\n\n` +
      `Ek tutar: ${additionTotal.toFixed(2)} TL\n` +
      `Yeni toplam: ${newTotal.toFixed(2)} TL`
    );
  },

  seamlessAdditionPaymentNeeded(orderNumber: number, addedItems: string, additionTotal: number, paymentUrl: string, newTotal: number): string {
    return (
      `*${addedItems}* siparisinize (#${orderNumber}) eklendi!\n\n` +
      `Ek tutar: ${additionTotal.toFixed(2)} TL\n` +
      `Ek odeme icin: ${paymentUrl}\n\n` +
      `Yeni toplam: ${newTotal.toFixed(2)} TL`
    );
  },

  // ==================== PAYMENT CHANGE ====================

  paymentChangeLinkSent(orderNumber: number, total: number, url: string): string {
    return (
      `Siparis #${orderNumber} icin online odeme linki:\n\n` +
      `${url}\n\n` +
      `Toplam: ${total.toFixed(2)} TL\n` +
      `Link 30 dakika gecerlidir.\n` +
      `Vazgecmek icin *"iptal"* yazabilirsiniz.`
    );
  },

  paymentChangeSuccess(orderNumber: number): string {
    return (
      `*Online odemeniz basariyla alindi!*\n\n` +
      `Siparis No: #${orderNumber}\n` +
      `Odeme yontemi guncellendi: Online kredi karti`
    );
  },

  // ==================== INACTIVITY TIMEOUT ====================

  inactivityWarning:
    'Siparisiniz hala devam ediyor mu?\n\nDevam etmek icin herhangi bir mesaj gonderin.\n1 dakika icerisinde yanit alinmazsa siparisiniz *iptal* edilecektir.',

  inactivityCancelled:
    'Uzun suredir yanit alinamadigi icin siparisiniz iptal edildi.\n\nYeni siparis icin istediginiz urunleri yazabilirsiniz.',

  inactivityResumed:
    'Siparisiniz devam ediyor. Kaldiginiz yerden devam edebilirsiniz.',

  // ==================== LOCATION ====================
  // The pin is preferred but never mandatory: a customer who does not want to
  // share a location can always continue with a written address.
  locationRequest:
    'Teslimat icin konumunuzu asagidaki butonla paylasin.\n' +
    'Konum paylasmak istemezseniz acik adresinizi de yazabilirsiniz (mahalle, sokak veya site adi, bina/kapi no, kat/daire).',

  /**
   * Out-of-area pin. Built from structured fields (never from geo.service's
   * panel message) and always offers a way to finish the order.
   */
  locationOutOfService(o: { distanceKm: number | null; radiusKm: number | null; pickupDiscountPercent?: number | null }): string {
    const head =
      o.distanceKm != null && o.radiusKm != null
        ? `Konumunuz subemize yaklasik *${o.distanceKm.toFixed(1)} km* uzaklikta, paket servis alanimiz *${o.radiusKm} km*.`
        : 'Gonderdiginiz konum paket servis alanimizin disinda gorunuyor. Konum pini bazen yanlis yere dusebilir.';
    return (
      `${head}\n\nSiparisinizi kaybetmeyelim, sepetiniz aynen duruyor:\n` +
      `- *Gel Al*: hazir olunca subemizden alirsiniz${o.pickupDiscountPercent ? ` (%${o.pickupDiscountPercent} indirimli)` : ''}\n` +
      '- *Baska Konum*: konum yanlis dustuyse yenisini gonderin\n' +
      '- *Adresimi Yazayim*: acik adresinizi yazin, ekibimiz teslimat bolgesini kontrol etsin\n\n' +
      'Vazgecmek isterseniz *iptal* yazabilirsiniz.'
    );
  },

  // Titles must stay <= 20 chars: the provider does not truncate and Meta
  // rejects the whole message (the customer would get nothing).
  locationOutOfServiceButtons: [
    { id: 'oos_pickup', title: "Gel Al'a Gec" },
    { id: 'oos_new_location', title: 'Baska Konum Gonder' },
    { id: 'oos_type_address', title: 'Adresimi Yazayim' },
  ],

  /** Reply to "size cok yakin nasil yani" after an out-of-area pin. */
  outOfAreaComplaint(o: { distanceKm: number | null; radiusKm: number | null; storeName: string | null; storePhone: string | null }): string {
    let msg = 'Haklisiniz olabilir, kusura bakmayin.';
    if (o.distanceKm != null) {
      msg +=
        ` Paylastiginiz konum ${o.storeName ? `*${o.storeName}* subemize` : 'subemize'} ${o.distanceKm.toFixed(1)} km gorunuyor` +
        (o.radiusKm ? `; paket servis alanimiz su an ${o.radiusKm} km.` : '.');
    }
    msg += '\nKonum pini bazen yanlis yere dusebiliyor. Acik adresinizi yazarsaniz ekibimiz kontrol etsin, ya da siparisinizi Gel Al olarak hazirlayalim.';
    if (o.storePhone) {
      msg += `\nDilerseniz bizi ${o.storePhone} numarasindan da arayabilirsiniz.`;
    }
    return msg;
  },

  locationConfirmed(storeName: string, deliveryFee: number, distance: number | null): string {
    return (
      `*${storeName}* subemizden teslimat yapilacak.\n` +
      (distance != null && distance > 0 ? `Mesafe: ${distance.toFixed(1)} km\n` : '') +
      `Teslimat ucreti: ${deliveryFee.toFixed(2)} TL`
    );
  },

  // ---- Written address (no pin) ----
  typedAddressPrompt:
    'Tabii, konum paylasmadan da siparis verebilirsiniz. Acik adresinizi yazar misiniz? ' +
    'Mahalle, sokak veya site adi, bina/kapi no ve kat/daire bilgisi kuryemizin sizi bulabilmesi icin yeterli.',

  typedAddressDetailAsk(partial: string): string {
    return (
      `Adresinizi aldim: *${partial}*\n` +
      'Acik adresinizi tamamlamak icin mahalle, sokak veya site adi, bina/kapi no ve kat/daire bilgisini de yazar misiniz? ' +
      'Bu bilgi kuryemizin sizi bulabilmesi icin gerekli. Isterseniz konumunuzu paylasmaniz da yeterli.'
    );
  },

  typedAddressAccepted(address: string, storeName: string | null, deliveryFee: number | null): string {
    return (
      `Teslimat adresiniz: *${address}*\n` +
      'Konum paylasilmadigi icin adresiniz ekibimiz tarafindan kontrol edilecek.' +
      (storeName ? `\n*${storeName}* subemizden teslimat yapilacak.` : '') +
      (deliveryFee != null && deliveryFee > 0
        ? `\nTeslimat ucreti: ${deliveryFee.toFixed(2)} TL (adres kontrolunden sonra kesinlesir)`
        : '') +
      '\nBlok, daire veya tarif eklemek isterseniz simdi yazabilirsiniz.'
    );
  },

  typedAddressContinueButtons: {
    body: 'Konum paylasmadan devam etmek icin:',
    buttons: [{ id: 'use_typed_address', title: 'Bu adresle devam' }],
  },

  locationRequestWithParked(address: string): string {
    return (
      `Daha once yazdiginiz adres: *${address}*\n` +
      'Konumunuzu paylasirsaniz bolge kontrolunu hemen yapariz. Konum paylasmadan bu adresle de devam edebilirsiniz.'
    );
  },

  deliveryNoteSaved:
    'Teslimat notunuzu aldim. Teslimat icin konumunuzu paylasabilir ya da acik adresinizi yazabilirsiniz.',

  /** A pin that arrived before the order was confirmed; it IS reused at the address step. */
  locationReceivedEarly:
    'Konumunuzu aldim, siparisinizi onayladiktan sonra teslimat adiminda kullanacagim.',

  pinReused: 'Daha once paylastiginiz konumu teslimat icin kullaniyorum.',

  // ---- A product named after the order was confirmed, without clear add wording ----
  midFlowAddAsk(itemName: string): string {
    return `*${itemName}* siparisinize eklensin mi?`;
  },

  midFlowAddButtons: [
    { id: 'mid_add_yes', title: 'Evet, ekle' },
    { id: 'mid_add_no', title: 'Hayir, eklemeyin' },
  ],

  midFlowAddDeclined: 'Tamam, siparisinize bir sey eklemedim.',

  // ---- Payment questions (answered in any phase) ----
  paymentInfo(o: {
    subtotal: number | null;
    isPickup: boolean;
    deliveryFee: number | null;
    feeIsEstimate: boolean;
    onlineEnabled: boolean;
    bankTransferAsked: boolean;
    preConfirm: boolean;
  }): string {
    let msg =
      o.subtotal != null && o.subtotal > 0
        ? `Sepet tutariniz: ${o.subtotal.toFixed(2)} TL`
        : 'Sepetiniz su an bos.';
    if (!o.isPickup && o.deliveryFee != null && o.deliveryFee > 0) {
      msg += `\nPaket servis teslimat ucreti: ${o.deliveryFee.toFixed(2)} TL${o.feeIsEstimate ? ' (adres kontrolunden sonra kesinlesir)' : ''}`;
    }
    msg +=
      `\n\nOdemeyi ${o.isPickup ? 'kasada' : 'kapida'} nakit veya kredi karti ile` +
      (o.onlineEnabled ? ' ya da size gonderecegimiz online odeme linkiyle' : '') +
      ' yapabilirsiniz.';
    if (o.bankTransferAsked) msg += '\nIBAN / havale / EFT ile odeme almiyoruz.';
    if (o.preConfirm) msg += '\nSiparisinizi onayladiginizda odeme yontemini birlikte secelim.';
    return msg;
  },

  paymentInfoConfirmed(orderNumber: number, total: number, paymentMethod: string | null, bankTransferAsked: boolean): string {
    const label =
      paymentMethod === 'CASH' ? 'Nakit' : paymentMethod === 'CREDIT_CARD' ? 'Kredi karti' : null;
    return (
      `Siparis #${orderNumber} tutari: ${total.toFixed(2)} TL` +
      (label ? `\nSectiginiz odeme: ${label}.` : '') +
      (bankTransferAsked ? '\nIBAN / havale / EFT ile odeme almiyoruz.' : '')
    );
  },

  // ---- Undo of a cart change made after the order was confirmed ----
  midFlowUndoHint: 'Yanlis eklendiyse *geri al* yazmaniz yeterli.',

  midFlowUndoDone(cart: string, moreToUndo: boolean): string {
    return (
      `Tamam, son degisiklik geri alindi.\n\nGuncel siparisiniz:\n\n${cart}` +
      (moreToUndo ? '\n\nOndan onceki degisiklik de yanlissa tekrar *geri al* yazin.' : '') +
      '\n\nYerine baska bir sey eklemek isterseniz yazabilirsiniz.'
    );
  },

  midFlowUndoNothing(cart: string): string {
    return (
      `Siparisinizde su an bunlar var:\n\n${cart}\n\n` +
      'Neyi degistirmek istersiniz? Cikarmak istediginiz urunun adini yazabilirsiniz (ornek: _kolayi cikar_).'
    );
  },

  locationMinBasketNotMet(minBasket: number, currentTotal: number): string {
    return (
      `Minimum sepet tutari ${minBasket.toFixed(2)} TL.\n` +
      `Mevcut sepetiniz: ${currentTotal.toFixed(2)} TL\n\n` +
      `Lutfen daha fazla urun ekleyin veya *"iptal"* yazin.`
    );
  },

  reminderSendLocation:
    'Teslimat icin konum pininizi paylasabilir ya da acik adresinizi yazabilirsiniz (mahalle, sokak veya site adi, bina/kapi no, kat/daire).',

  // ==================== ADDRESS COLLECTION ====================
  addressRequest:
    'Lutfen teslimat adresinizi yazin.\n' +
    'Ornek: _Ataturk Mah. Cumhuriyet Cad. No:12 Daire:5_',

  addressConfirmation(address: string): string {
    return (
      `Teslimat adresiniz:\n\n` +
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
    'Lutfen teslimat adresinizi tekrar yazin.',

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
      `Kredi karti ile odeme icin asagidaki linke tiklayiniz:\n\n` +
      `${url}\n\n` +
      `Link 30 dakika gecerlidir.\n` +
      `Nakit odemeye gecmek icin *"nakit"* yazabilirsiniz.`
    );
  },

  paymentSuccess(orderNumber: number): string {
    return (
      `*Odemeniz basariyla alindi!*\n\n` +
      `Siparis No: #${orderNumber}\n` +
      `Restoran onayiniz bekleniyor...`
    );
  },

  paymentFailed:
    'Odeme basarisiz oldu.\nTekrar denemek icin *"kart"*, nakit odemek icin *"nakit"* yazin.',

  cashConfirmed(orderNumber: number): string {
    return (
      `*Siparisiniz alindi!*\n\n` +
      `Siparis No: #${orderNumber}\n` +
      `Odeme: Kapida nakit\n` +
      `Restoran onayiniz bekleniyor...`
    );
  },

  reminderPayment(url: string): string {
    return (
      `Odeme bekleniyor.\n\n` +
      `Odeme linkiniz: ${url}\n\n` +
      `Nakit odemek icin *"nakit"* yazabilirsiniz.`
    );
  },

  pendingConfirmation(orderNumber: number): string {
    return (
      `Siparis No: #${orderNumber}\n` +
      `Siparisiniz restoran tarafindan onay bekliyor.\n` +
      `Onaylaninca size bildirim gonderecegiz.`
    );
  },

  restaurantApproved(orderNumber: number): string {
    return (
      `*Siparisiniz onaylandi!*\n\n` +
      `Siparis No: #${orderNumber}\n` +
      `Siparisiniz hazirlaniyor!\n` +
      `Tahmini hazirlık suresi: 25-30 dakika`
    );
  },

  // ==================== ORDER STATUS UPDATES ====================
  orderPreparing(orderNumber: number): string {
    return (
      `*Siparisiniz hazirlaniyor!*\n\n` +
      `Siparis No: #${orderNumber}\n` +
      `Tahmini sure: 25-30 dakika`
    );
  },

  orderReady(orderNumber: number): string {
    return (
      `*Siparisiniz hazir!*\n\n` +
      `Siparis No: #${orderNumber}\n` +
      `Kurye yola cikmak uzere!`
    );
  },

  orderDelivered(orderNumber: number): string {
    return (
      `*Siparisiniz teslim edildi!*\n\n` +
      `Siparis No: #${orderNumber}\n` +
      `Afiyet olsun!\n` +
      `Tekrar siparis icin urun yazabilirsiniz.`
    );
  },

  orderCancelledNotification(orderNumber: number): string {
    return (
      `*Siparisiniz iptal edildi.*\n\n` +
      `Siparis No: #${orderNumber}\n` +
      `Yeni siparis icin urun yazabilirsiniz.`
    );
  },

  // ==================== ORDER ADDITION ====================
  additionPrompt(orderNumber: number): string {
    return `Mevcut siparisinia (#${orderNumber}) var. Ekleme mi yapmak istiyorsunuz, yoksa yeni siparis mi vermek istiyorsunuz?`;
  },

  additionStarted(parentOrderNumber: number): string {
    return (
      `Siparis #${parentOrderNumber}'e ekleme yapiyorsunuz.\n` +
      `Eklemek istediginiz urunleri yazin.`
    );
  },

  newOrderPrompt: 'Yeni siparisiniz icin buyurun, ne alalim?',

  additionNotAllowed(orderNumber: number): string {
    return (
      `Siparis #${orderNumber} teslim edilmis veya iptal edilmis.\n` +
      `Yeni siparis vermek icin urun adini yazin.`
    );
  },

  additionReadyFoodOnly(nonReadyItemNames: string): string {
    return (
      `Siparisiniz hazir durumunda oldugu icin sadece hazir urunler eklenebilir.\n` +
      `Su urunler eklenemez: *${nonReadyItemNames}*\n\n` +
      `Lutfen sadece hazir urunler secin veya *"iptal"* yazin.`
    );
  },

  additionApproved(orderNumber: number): string {
    return (
      `*Eklemeniz onaylandi!*\n\n` +
      `Siparis #${orderNumber}\n` +
      `Ek urunleriniz hazirlaniyor.`
    );
  },

  additionRejected(orderNumber: number, reason: string): string {
    return (
      `*Eklemeniz reddedildi.*\n\n` +
      `Siparis #${orderNumber}\n` +
      `Neden: *${reason}*\n\n` +
      `Yeni siparis vermek icin urun adini yazabilirsiniz.`
    );
  },

  orderRejected(orderNumber: number, reason: string): string {
    return (
      `*Siparisiniz reddedildi.*\n\n` +
      `Siparis No: #${orderNumber}\n` +
      `Neden: *${reason}*\n\n` +
      `Yeni siparis vermek icin urun adini yazabilirsiniz.`
    );
  },

  refundInitiated(orderNumber: number): string {
    return (
      `Siparis #${orderNumber} icin odeme iadesi baslatildi.\n` +
      `Iadeniz 3-5 is gunu icerisinde kartiniza yansiyacaktir.`
    );
  },

  // ==================== SAVED ADDRESSES ====================
  savedAddressListHeader: 'Kayitli adresleriniz:',
  savedAddressListButton: 'Adres Sec',
  newAddressRowTitle: 'Yeni Adres',
  newAddressRowDescription: 'Konum paylasin veya adres yazin',
  parkedAddressRowTitle: 'Yazdiginiz adres',

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
    return `Adres *"${name}"* olarak kaydedildi.`;
  },

  addressNotSaved: 'Tamam, adres kaydedilmedi.',

  // Only for a saved address that no longer exists; an out-of-area saved
  // address gets the out-of-area options instead.
  savedAddressInvalid:
    'Sectiginiz kayitli adres bulunamadi.\nYeni konum paylasabilir ya da acik adresinizi yazabilirsiniz.',

  savedAddressOutOfArea(name: string): string {
    return `Kayitli adresiniz *${name}* su an teslimat alanimizin disinda gorunuyor.`;
  },

  // ==================== STORE STATUS ====================
  storeClosed: 'Suanda kapaliyiz. Acildigimizda tekrar siparis verebilirsiniz.',

  // ==================== GENERAL ====================
  orderCancelled: 'Siparisiniz iptal edildi.\nYeni siparis icin istediginiz urunleri yazabilirsiniz.',

  orderConfirmedNewOrder:
    'Siparisiniz isleniyor. Baska bir istegininiz olursa buradayim.',

  clarificationFallback:
    'Bunu tam cikaramadim. Neyi merak ediyorsunuz ya da ne almak istersiniz?',

  agentHandoff:
    'Sizi bir temsilciye yonlendiriyorum. Lutfen bekleyin...',

  // ==================== MENU MEDIA ====================
  menuMediaIntro: 'Menumuze goz atin:',

  menuMediaFooter: 'Begendiginiz bir sey var mi?',

  menuNotAvailable:
    'Menu gorseli henuz yuklenmemis ama urunlerimizi size sayabilirim. Ne tur bir sey ariyorsunuz?',

  // ==================== UPSELL ====================
  upsellButtons(price: number): { buttons: Array<{ id: string; title: string }> } {
    return {
      buttons: [
        { id: 'upsell_accept', title: `Ekle ${price.toFixed(0)} TL` },
        { id: 'upsell_reject', title: 'Hayir' },
      ],
    };
  },

  // ==================== SATISFACTION SURVEY ====================
  surveyAsk(orderNumber: number): string {
    return (
      `Siparis #${orderNumber} teslim edildi!\n\n` +
      `Hizmetimizi nasil buldunuz?\n` +
      `Lutfen 1-5 arasi puan verin:`
    );
  },

  surveyButtons: {
    // Titles are plain text (no star emoji). The rating is carried by the id,
    // so the handler is unaffected.
    buttons: [
      { id: 'survey_5', title: '5 - Cok iyi' },
      { id: 'survey_3', title: '3 - Orta' },
      { id: 'survey_1', title: '1 - Kotu' },
    ],
  },

  surveyAskComment:
    'Geri bildiriminiz icin tesekkurler. Bizi daha iyi yapabilmemiz icin neler yasadiginizi kisa bir mesajla yazar misiniz?',

  surveyThanksGood:
    'Cok tesekkur ederiz! Sizi memnun ettigimize sevindik. Yine bekleriz!',

  surveyThanksBad:
    'Geri bildiriminiz icin tesekkurler. Sorunuzu en kisa surede degerlendirecegiz. Ozur dileriz!',

  surveyThanksNeutral:
    'Puan icin tesekkurler! Daha iyisini yapmak icin calisacagiz.',

  // ==================== REORDER / FAVORITES ====================
  favoritesListHeader(count: number): string {
    return `En cok siparis verdiginiz ${count} urun`;
  },

  favoritesListButton: 'Favorilerim',

  favoritesListHeaderText: 'Favorileriniz',

  noFavoritesYet:
    'Henuz siparis gecmisiniz yok. Siparis verdikten sonra favorileriniz burada gorunecek!',

  // ==================== BROADCAST / CAMPAIGN ====================
  broadcastOptInAsk:
    'Kampanyalarimizdan ve size ozel firsatlardan haberdar olmak ister misiniz?',

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

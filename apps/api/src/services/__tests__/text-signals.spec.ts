/**
 * Pure (LLM-free) detectors used by the order flow, checked against the real
 * customer wording from the High Five production transcripts (A 12.09, B 30.08,
 * C 28.08). Run: node scripts/test-api.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyAddressText,
  isAddressConfirmReply,
  isAddressWaitReply,
  isAreaComplaint,
  isExplicitMidFlowEdit,
  isLocationRefusal,
  hasAddressEvidence,
  isOrderDonePhrase,
  isPaymentQuestion,
  isUndoLastChangeIntent,
} from '../nlu/flow-text-signals';
import {
  deriveSpecialRequest,
  detectNegativeConstraint,
  exclusionNamesProduct,
} from '../nlu/intent-analysis.service';

test('classifyAddressText: small-town written addresses are addresses, questions are not', () => {
  const cases: Array<[string, string]> = [
    ['Dilaverler köyü 12', 'landmark'],
    ['Ereğli yolu no 15', 'full'],
    ['Gündoğdu köyü muhtarlık yanı', 'landmark'],
    ['Belediye karşısı 3. ev', 'landmark'],
    ['Plaj yolu Akçakoca Otel karşısı', 'landmark'],
    ['evin arkasında bekliyorum', 'directions'],
    ['kapıya getirin', 'directions'],
    ['Siparişim kaçta gelecek', 'none'],
    ['kurye kaçta gelecek', 'none'],
    ['Size çok yakın nasıl yani', 'none'],
  ];
  for (const [text, kind] of cases) {
    assert.equal(classifyAddressText(text).kind, kind, text);
  }
});

test('word-bounded complaint / undo: place names and pin complaints', () => {
  assert.equal(isAreaComplaint('Osmaniye köyü'), false);
  assert.equal(isAreaComplaint('bir saniye'), false);
  assert.equal(isAreaComplaint('yakında gelir'), false);
  assert.equal(isAreaComplaint('Yanlış yere düştü'), true);
  assert.equal(isUndoLastChangeIntent('Yanlış yere düştü'), null);
  assert.equal(isUndoLastChangeIntent('yanlış yer gösteriyor'), null);
});

test('isExplicitMidFlowEdit: everyday Turkish additions that name a product', () => {
  for (const t of [
    'yanına bir ayran alırım',
    'karışık pizza da alırım',
    'bir büyük boy margarita',
    'yanına patates kızartması da',
    'bir kutu kola alabilir miyim',
  ]) {
    assert.equal(isExplicitMidFlowEdit(t, true), true, t);
  }
  assert.equal(isExplicitMidFlowEdit('kolay gelsin', true), false);
  assert.equal(isExplicitMidFlowEdit('çocuk çıkıp alır', false), false);
});

test('address confirmation / wait replies', () => {
  for (const t of ['tamam doğru', 'adres doğru', 'doğru adres', 'tamam güzel', 'Doğru', 'Tamamdır', 'evet doğru adres bu']) {
    assert.equal(isAddressConfirmReply(t), true, t);
  }
  for (const t of ['tamam ama daire 5', 'doğru değil', 'B blok daire 4', 'Hayalim kent']) {
    assert.equal(isAddressConfirmReply(t), false, t);
  }
  for (const t of ['tamam yazıyorum', 'bir saniye', 'şimdi atıyorum konumu']) {
    assert.equal(isAddressWaitReply(t), true, t);
  }
  assert.equal(isAddressWaitReply('Kepez 25 kat 2'), false);
});

test('"that is all" replies are not special requests', () => {
  for (const t of ['tamam başka bir şey istemiyorum', 'tamam sadece bu kadar', 'evet sadece bunlar']) {
    assert.equal(isOrderDonePhrase(t), true, t);
    assert.equal(deriveSpecialRequest(t, null, []), null, t);
  }
  assert.equal(isOrderDonePhrase('sadece mozerella'), false);
  assert.equal(deriveSpecialRequest('artık istemiyorum', null, []), null);
  assert.equal(deriveSpecialRequest('yok istemiyorum', null, []), null);
  assert.equal(deriveSpecialRequest('evet', null, [], ), null);
});

test('removal vs ingredient exclusion: synonyms and categories name the product', () => {
  assert.equal(deriveSpecialRequest('kolayı istemiyorum', null, ['Coca Cola', 'kola']), null);
  assert.equal(deriveSpecialRequest('tatlıyı istemiyorum', null, ['Sufle'], ['Tatlılar']), null);
  assert.equal(exclusionNamesProduct('kolayı istemiyorum', ['Coca Cola']), true);
  assert.equal(exclusionNamesProduct('içeceği istemiyorum', []), true);
  assert.equal(exclusionNamesProduct('soğan istemiyorum', ['Margarita Pizza', 'Pizzalar']), false);
});
import { isInformationalQuestion } from '../nlu/orchestrator.service';
import { TEMPLATES } from '../message-templates';

test('classifyAddressText: transcript addresses and directions', () => {
  const cases: Array<[string, string]> = [
    ['Hayalim kent e gidecek', 'landmark'],
    ["Hayalim Kent'e gidecek", 'landmark'],
    ['Tezel konaklarındayız', 'landmark'],
    ['Tezel konaklarındayız, Akçakoca', 'landmark'],
    ['Konuma geldiğinizde çocuk çıkıp alacak', 'directions'],
    ['Orhangazi Mah. Gül Sok. No:5 Kat 2 Daire 4', 'full'],
    ['Silahtar Sokak No 4', 'full'],
    ['Yeni mahallesi', 'vague'],
    ['Yanlış oldu', 'none'],
    ['Size çok yakın nasıl yani', 'none'],
    ['2 kola ekle', 'none'],
    ['sipariş ne zaman gelecek', 'none'],
    ['merhaba', 'none'],
  ];
  for (const [text, kind] of cases) {
    assert.equal(classifyAddressText(text).kind, kind, text);
  }
});

test('isExplicitMidFlowEdit: only explicit edits that name a menu item', () => {
  // B / C transcript texts never reach the NLU after the order was confirmed
  assert.equal(isExplicitMidFlowEdit('Hayalim kent e gidecek', false), false);
  assert.equal(isExplicitMidFlowEdit('Yanlış oldu', false), false);
  assert.equal(isExplicitMidFlowEdit('Yanlış oldu', true), false);
  assert.equal(isExplicitMidFlowEdit('Size çok yakın nasıl yani', false), false);
  assert.equal(isExplicitMidFlowEdit('İban ve ödeyeceğim miktarı yazar mısınız', true), false);
  assert.equal(isExplicitMidFlowEdit('İtaliano sitesine gidecek', true), false);
  // legitimate additions / removals still work
  assert.equal(isExplicitMidFlowEdit('bir de kola ekle', true), true);
  assert.equal(isExplicitMidFlowEdit('2 ayran', true), true);
  assert.equal(isExplicitMidFlowEdit('kola', true), true);
  assert.equal(isExplicitMidFlowEdit('kolayı çıkar', true), true);
  assert.equal(isExplicitMidFlowEdit('1 İtaliano Tam daha', true), true);
});

test('isPaymentQuestion: IBAN / amount / method questions, not item prices', () => {
  assert.deepEqual(isPaymentQuestion('İban ve ödeyeceğim miktarı yazar mısınız'), {
    asked: true,
    bankTransfer: true,
    amount: true,
  });
  assert.equal(isPaymentQuestion('kapıda kart geçer mi').asked, true);
  assert.equal(isPaymentQuestion('ne kadar tuttu').asked, true);
  assert.equal(isPaymentQuestion('nakit').asked, false);
  assert.equal(isPaymentQuestion('margherita ne kadar').asked, false);
  assert.equal(isPaymentQuestion('defter').bankTransfer, false);
});

test('location refusal, area complaint, undo intent', () => {
  assert.equal(isLocationRefusal('konum atmak istemiyorum'), true);
  assert.equal(isLocationRefusal('adresimi yazayım'), true);
  assert.equal(isAreaComplaint('Size çok yakın nasıl yani'), true);

  assert.equal(isUndoLastChangeIntent('Yanlış oldu'), 'undo');
  assert.equal(isUndoLastChangeIntent('geri al'), 'undo');
  assert.equal(isUndoLastChangeIntent('onu sil'), 'undo');
  assert.equal(isUndoLastChangeIntent('ben eklemedim'), 'undo');
  assert.equal(isUndoLastChangeIntent('istemiyorum'), 'soft');
  assert.equal(isUndoLastChangeIntent('iptal'), null);
  assert.equal(isUndoLastChangeIntent('konum yanlış'), null);
  assert.equal(isUndoLastChangeIntent('adresi yanlış yazdım'), null);
  assert.equal(isUndoLastChangeIntent('kart yanlış'), null);
});

test('deriveSpecialRequest: transcript A becomes an order note, product/quantity wording does not', () => {
  assert.deepEqual(
    deriveSpecialRequest('Sandviç istiyoruz, sade, içinde sadece mozerella olacak', null, [
      'İtaliano Yarım',
      'İtaliano Tam',
    ]),
    { kind: 'only', note: 'Sadece mozerella, sade' }
  );
  assert.equal(deriveSpecialRequest('sadece 1 kola', null, ['Kola']), null);
  assert.equal(deriveSpecialRequest('sadece kola istiyorum', null, ['Kola']), null);
  assert.equal(deriveSpecialRequest('kola istemiyorum', null, ['Kola']), null);
  assert.deepEqual(deriveSpecialRequest('soğan olmasın', null, []), {
    kind: 'exclude',
    note: 'soğan olmasın',
  });
  assert.deepEqual(deriveSpecialRequest('pizzada soğan istemiyorum', null, ['Margarita Pizza']), {
    kind: 'exclude',
    note: 'soğan istemiyorum',
  });
  assert.equal(deriveSpecialRequest('ekleme yapabilir miyim', null, []), null);
  assert.equal(deriveSpecialRequest('kaçmasın', null, []), null);
  assert.equal(deriveSpecialRequest('sadece nakit ödeyebilirim', null, []), null);
});

test('keep: existing detectors on transcript text', () => {
  assert.equal(
    detectNegativeConstraint('Sandviç istiyoruz, sade, içinde sadece mozerella olacak'),
    true
  );
  assert.equal(isInformationalQuestion('Hayalim kent e gidecek'), false);
  assert.equal(isInformationalQuestion('Size çok yakın nasıl yani'), true);
  assert.equal(isInformationalQuestion('Yanlış oldu'), true);
});

test('WhatsApp limits: out-of-area button titles fit 20 chars, at most 3 buttons', () => {
  const groups = [
    TEMPLATES.locationOutOfServiceButtons,
    TEMPLATES.typedAddressContinueButtons.buttons,
  ];
  for (const buttons of groups) {
    assert.ok(buttons.length <= 3);
    for (const b of buttons) assert.ok(b.title.length <= 20, b.title);
  }
  assert.ok(
    TEMPLATES.locationOutOfService({ distanceKm: 4.2, radiusKm: 3, pickupDiscountPercent: 10 })
      .length <= 1024
  );
  assert.ok(
    !/kabul edemiyoruz/i.test(TEMPLATES.locationOutOfService({ distanceKm: null, radiusKm: null }))
  );
});

// Doğrulama bulguları (14.09): ret/şikâyet kelimesi içeren TAM adres reddediliyor,
// "konum atamıyorum" türü cümleler adres sanılıyordu.
test('hasAddressEvidence / isLocationRefusal: lead-in + address is an address, inability is a refusal', () => {
  const addresses = [
    'Açık adresim: Orhangazi Mah. Gül Sok. No 5',
    'Açık adres Tezel konakları B blok daire 4',
    'Konum yok adres: Tezel konakları B blok daire 4',
    'adres vereyim Gül sokak no 5',
    'Yazılı adres: Kepez 25 kat 2',
    'Camiye yakın Gül sokak no 3',
    'Hastane yakını Yeni mahalle 12',
  ];
  for (const a of addresses) {
    assert.equal(hasAddressEvidence(a), true, `address evidence expected: ${a}`);
    assert.equal(isLocationRefusal(a), false, `must not be a refusal: ${a}`);
  }
  const refusals = [
    'konum atamadım',
    'Olmuyor',
    'konum atmayı bilmiyorum',
    'Ben konumu bulamadım',
    'telefonum konum atmıyor',
    'konum gönderemedim',
    'konum atmak istemiyorum',
    'açık adres yazsam olur mu',
  ];
  for (const r of refusals) {
    assert.equal(hasAddressEvidence(r), false, `no address evidence expected: ${r}`);
    assert.equal(isLocationRefusal(r), true, `refusal expected: ${r}`);
  }
  // Tek başına "yok" / "istemiyorum" başka sorulara da cevap olabilir.
  assert.equal(isLocationRefusal('yok'), false);
  assert.equal(isLocationRefusal('istemiyorum'), false);
});

/**
 * LLM-free text signals for the post-confirm order flow (delivery type,
 * location, address, payment steps).
 *
 * WHY this module exists: in those steps every unmatched text used to be sent
 * to the NLU, which treated an address ("Hayalim kent e gidecek"), a
 * complaint ("Yanlis oldu", "Size cok yakin nasil yani") or a payment question
 * ("IBAN ve odeyecegim miktari yazar misiniz") as an order and silently added
 * a bundle to the cart (High Five, 28.08 / 30.08). These predicates decide,
 * BEFORE any model call, what kind of text the customer sent.
 *
 * Pure and dependency-free on purpose: every rule is unit-tested
 * (apps/api/src/services/__tests__/text-signals.spec.ts).
 */

/** Lowercase + fold Turkish letters to ASCII. For MATCHING only. */
export function foldTr(text: string): string {
  return (text || '')
    .toLowerCase()
    .replace(/̇/g, '') // İ → i̇ → i
    .replace(/ı/g, 'i')
    .replace(/ç/g, 'c')
    .replace(/ğ/g, 'g')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
    .replace(/â/g, 'a')
    .replace(/î/g, 'i')
    .replace(/û/g, 'u');
}

/** Folded word list (punctuation and apostrophes split words: "Kent'e" → kent, e). */
export function words(text: string): string[] {
  return foldTr(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** Folded words joined by single spaces and padded, for bounded phrase checks. */
function padded(text: string): string {
  return ` ${words(text).join(' ')} `;
}

function hasPhrase(text: string, phrases: string[]): boolean {
  const p = padded(text);
  return phrases.some((ph) => p.includes(` ${ph}`));
}

// ==================== ORDER EDIT SIGNALS ====================

// "cocuk cikip alir", "gelip aliriz": the verb 'almak' after these is a pickup/handover, not an order.
const HANDOVER_BEFORE_ALMAK = new Set(['gelip', 'cikip', 'inip', 'kendim', 'kendimiz', 'gelince', 'cocuk', 'biri', 'birisi']);

/** Explicit "add this" wording. Never 'gonder'/'getir': "konum gonderdim" and "adrese getirin" are not additions. */
export function hasAddSignal(raw: string): boolean {
  if (
    hasPhrase(raw, [
      'bir de ',
      'bi de ',
      'de olsun',
      'da olsun',
      'de ekle',
      'da ekle',
      'siparise ekle',
      'bunlara ek',
    ])
  ) {
    return true;
  }
  const ws = words(raw);
  const starts = ['ekle', 'ilave', 'istiyor', 'isterim', 'alayim', 'alalim', 'olsun'];
  const exact = ['ayrica', 'birde', 'bide', 'artir', 'artirin', 'daha'];
  if (ws.some((w) => exact.includes(w) || starts.some((s) => w.startsWith(s)))) return true;
  // "yanina bir ayran alirim", "bir kutu kola alabilir miyim": the everyday
  // way to add something in Turkish. Missing it dropped the product silently.
  const almak = ['alir', 'alabilir', 'alacag', 'alicam', 'aliriz'];
  return ws.some(
    (w, i) => almak.some((s) => w.startsWith(s)) && !(i > 0 && HANDOVER_BEFORE_ALMAK.has(ws[i - 1]))
  );
}

/** Item-removal verbs. Only meaningful together with a menu-name match. */
export function hasItemRemoveSignal(raw: string): boolean {
  return words(raw).some((w) => ['cikar', 'kaldir', 'sil', 'iptal'].some((s) => w.startsWith(s)));
}

/** A quantity ("2 kola", "iki ayran", "3x"). 'bir' is excluded on purpose — too common. */
export function hasQuantityToken(raw: string): boolean {
  const folded = ` ${words(raw).join(' ')} `;
  if (/\s\d{1,2}\s*(x|adet|tane)?\s/.test(folded)) return true;
  const qty = [
    'iki',
    'uc',
    'dort',
    'bes',
    'alti',
    'yedi',
    'sekiz',
    'dokuz',
    'on',
    'tane',
    'adet',
    'yarim',
  ];
  return words(raw).some((w) => qty.includes(w));
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Whole-word containment of a menu item name / synonym in the text, allowing
 * a short Turkish suffix on the last word ("kolayi", "ayranlar").
 */
export function mentionsMenuItemName(names: string[], synonyms: string[], raw: string): boolean {
  const text = padded(raw);
  for (const name of [...names, ...synonyms]) {
    const n = words(name).join(' ');
    if (n.length < 3) continue;
    const re = new RegExp(`\\s${escapeRegex(n)}[a-z]{0,4}\\s`);
    if (re.test(text)) return true;
  }
  return false;
}

// ==================== ADDRESS / DIRECTIONS ====================

export type AddressKind = 'full' | 'landmark' | 'directions' | 'vague' | 'none';

const STREET_EXACT = new Set([
  'mah',
  'mh',
  'mahalle',
  'mahallesi',
  'sok',
  'sk',
  'sokak',
  'sokagi',
  'cad',
  'cd',
  'cadde',
  'caddesi',
  'bulvar',
  'bulvari',
  'blv',
]);
// 5+ letter prefixes only, so "mahmut" / "cadi" never count as street words.
const STREET_PREFIX = ['mahalle', 'sokag', 'sokak', 'cadde', 'bulvar'];
const SITE_STARTS = [
  'site',
  'konak',
  'evler',
  'rezidans',
  'residence',
  'apartman',
  'lojman',
  'kooperatif',
  'villa',
  'plaza',
  'mevki',
];
const DETAIL_EXACT = ['no', 'nu', 'numara', 'kat', 'daire', 'blok', 'apt', 'kapi', 'bina'];
const DESTINATION_WORDS = ['gidecek', 'gelecek', 'teslim', 'adresim', 'adresimiz'];
// Delivery INSTRUCTIONS: a note for the courier, never the address itself.
const DIRECTIONS_PHRASES = [
  'kapiya',
  'kapida bekle',
  'zile bas',
  'zili cal',
  'aramadan',
  'geldiginizde',
  'gelince',
  'geldiginde',
  'cikip alacak',
  'cikip alir',
  'inip alacak',
  'asagi in',
  'onunde',
  'konuma gel',
  'sagdaki',
  'soldaki',
];
// "Belediye karsisi 3. ev", "muhtarlik yani": in a small town this IS the
// address. Only with a named place next to it; "evin arkasinda" stays a note.
const RELATION_WORDS = new Set([
  'karsisi',
  'karsisinda',
  'karsisindaki',
  'arkasi',
  'arkasinda',
  'arkasindaki',
  'yani',
  'yaninda',
  'yanindaki',
  'bitisigi',
  'bitisiginde',
  'civari',
  'civarinda',
  'yakini',
  'yakininda',
]);
const RELATION_STOP = new Set([
  'hemen', 'tam', 'bizim', 'sizin', 'onun', 'bunun', 'sunun', 'evin', 'kapinin', 'kapi', 'su', 'bu', 'o',
  'cok', 'daha', 'bir', 'nasil', 'ne', 'hani', 'iste', 'yok', 'evet', 'hayir', 'ben', 'biz', 'sey',
  'tamam', 'yani', 'size', 'bize', 'ama', 've',
]);
// "Dilaverler koyu 12", "Eregli yolu no 15" (village / road addresses)
const VILLAGE_ROAD = /^(koy|koyu|koyunde|koyune|koyden|koyde|koye|koyumuz|koyumuzde|yolu|yolunda|yoluzeri|yolustu|mevkii|mevkiinde)$/;

function isLocativeWe(w: string): boolean {
  return w.length >= 7 && /(dayiz|deyiz|tayiz|teyiz|dayim|deyim|tayim|teyim)$/.test(w);
}

/**
 * Question words that turn "X gelecek" into a question, not a destination:
 * "siparisim kacta gelecek", "kurye nerede".
 */
function hasTimeOrPlaceQuestion(ws: string[]): boolean {
  const joined = ` ${ws.join(' ')} `;
  return (
    ws.some((w) => w.startsWith('kac') || w === 'nerede' || w === 'nerde' || w === 'neredesiniz' || w === 'nerdesiniz') ||
    [' ne zaman', ' ne kadar', ' hangi saat', ' saat kac'].some((p) => joined.includes(p))
  );
}

/**
 * Classify free text the customer typed where an address is expected.
 *   full       → street + number/detail ("Orhangazi Mah. Gul Sok. No:5")
 *   landmark   → a site / complex / "X'e gidecek" / "X'tayiz"
 *   directions → a delivery note ("konuma gelince cocuk cikip alacak")
 *   vague      → an area without detail ("Yeni mahallesi", "evdeyiz")
 *   none       → anything else ("Yanlis oldu", "2 kola ekle")
 */
export function classifyAddressText(raw: string): { kind: AddressKind; hasDetail: boolean } {
  const ws = words(raw);
  const folded = ws.join(' ');
  const wc = ws.length;
  if (wc === 0) return { kind: 'none', hasDetail: false };

  // "siparisim kacta gelecek" is a question, not a destination.
  const question = hasQuestionSignal(raw) || hasTimeOrPlaceQuestion(ws);
  const street = ws.filter(
    (w) => STREET_EXACT.has(w) || STREET_PREFIX.some((p) => w.startsWith(p))
  ).length;
  const site =
    ws.filter(
      (w) =>
        SITE_STARTS.some((s) => w.startsWith(s)) ||
        w === 'kent' ||
        w.startsWith('kente') ||
        w.startsWith('kentte') ||
        w.startsWith('kenti') ||
        (w.length >= 6 && w.endsWith('kent'))
    ).length +
    // a bare "koyu" / "yolu" is too ambiguous on its own
    (wc >= 2 && !question ? ws.filter((w) => VILLAGE_ROAD.test(w)).length : 0);
  const foldedRaw = foldTr(raw);
  const hasDetail =
    ws.some((w) => DETAIL_EXACT.includes(w)) ||
    /\bno\s*[:.]?\s*\d+/.test(foldedRaw) ||
    /\d+\s*\/\s*\d+/.test(foldedRaw) ||
    /\b(kat|daire|blok)\s*\w{0,2}\d+/.test(foldedRaw);
  const locWe = ws.some(isLocativeWe);
  const dest = ws.some((w) => DESTINATION_WORDS.includes(w));

  if (
    ((street >= 1 && (hasDetail || /\d/.test(folded) || street >= 2)) ||
      (site >= 1 && hasDetail)) &&
    folded.length >= 10
  ) {
    return { kind: 'full', hasDetail };
  }
  if (site >= 1 || (locWe && wc >= 2 && !question) || (dest && wc >= 3 && !question)) {
    return { kind: 'landmark', hasDetail };
  }
  if (DIRECTIONS_PHRASES.some((p) => ` ${folded} `.includes(` ${p}`))) {
    return { kind: 'directions', hasDetail };
  }
  const relIdx = ws.findIndex((w) => RELATION_WORDS.has(w));
  if (relIdx >= 0) {
    // 'yani' is also "I mean" ("nasil yani"): it needs a place name right before it.
    const yaniOk = ws[relIdx] !== 'yani' || (relIdx > 0 && ws[relIdx - 1].length >= 3 && !RELATION_STOP.has(ws[relIdx - 1]));
    // A place name, not a verb: "evin arkasinda bekliyorum" has no named place.
    const verbLike = (w: string) =>
      /(iyor|iyorum|iyoruz|iyorsunuz|yorum|yoruz|acak|ecek|acagim|ecegim|acagiz|ecegiz|abilir|ebilir|iniz|yin|yiniz|sin|sun)$/.test(w) ||
      w.startsWith('bekle');
    const named = ws.some(
      (w, i) =>
        i !== relIdx &&
        !RELATION_WORDS.has(w) &&
        !RELATION_STOP.has(w) &&
        !verbLike(w) &&
        (w.length >= 3 || /^\d+$/.test(w))
    );
    if (yaniOk && !question) return { kind: named ? 'landmark' : 'directions', hasDetail };
  }
  if (street >= 1 || (wc <= 2 && (locWe || dest) && !question)) {
    return { kind: 'vague', hasDetail };
  }
  return { kind: 'none', hasDetail };
}

// ==================== QUESTIONS / COMPLAINTS ====================

/**
 * Does the text carry a question? Deliberately narrow (explicit '?', a
 * standalone mi/mu particle or an unambiguous phrase) — bare "ne"/"kac" would
 * trip ordinary order text like "2 kola kac tane".
 */
export function hasQuestionSignal(raw: string): boolean {
  if (!raw) return false;
  if (raw.includes('?')) return true;
  const ws = words(raw);
  if (ws.includes('mi') || ws.includes('mu')) return true;
  const folded = foldTr(raw);
  const phrases = [
    'nedir',
    'kac para',
    'kac tl',
    'kac lira',
    'ne kadar',
    'icinde ne',
    'neler var',
    'fark ne',
    'farki ne',
    'hangisi',
    'nasil',
    'ne onerir',
    'ne kadar surer',
    'kac dakika',
    'vejetaryen',
    'vejeteryan',
    'glutensiz',
    'helal',
    'acili',
    'var mi',
    'gecer mi',
    'olur mu',
    'oluyor mu',
    'ne zaman',
    'hangi saat',
  ];
  if (phrases.some((p) => folded.includes(p))) return true;
  // "kacta gelir", "kurye nerede": whole words only
  return ws.some((w) => ['kacta', 'kacda', 'nerede', 'nerde', 'neredesiniz', 'nerdesiniz'].includes(w));
}

const BANK_PHRASES = [
  'iban',
  'havale',
  'hesap numara',
  'hesap no',
  'banka hesab',
  'papara',
  'hesaba at',
  'hesaba yatir',
];
const AMOUNT_PHRASES = [
  'odeyecegim miktar',
  'odeyecegim tutar',
  'odenecek tutar',
  'odenecek miktar',
  'ne kadar odeyece',
  'ne kadar odeye',
  'ne kadar odiycem',
  'toplam tutar',
  'toplam ne kadar',
  'toplam kac',
  'tutar ne',
  'tutari ne',
  'tutari yaz',
  'miktari yaz',
  'hesap ne kadar',
  'ne kadar tuttu',
  'kac tuttu',
  'kaca geldi',
  'kac para oldu',
  'kac lira oldu',
];
const METHOD_PHRASES = [
  'nasil odey',
  'nasil odi',
  'nasil odenecek',
  'odeme nasil',
  'odeme secenek',
  'odeme yontem',
  'kart gecer',
  'kart geciyor',
  'kartla odeyebilir',
  'kart ile odeyebilir',
  'pos var',
  'pos cihaz',
  'kapida kart',
  'kapida odeme',
  'yemek karti',
  'multinet',
  'sodexo',
  'setcard',
  'pluxee',
  'ticket restaurant',
  'metropol kart',
  // the former pre-confirm payment list
  'odeme linki',
  'odeme link',
  'link gonder',
  'link atar',
  'link at',
  'nasil odeyecegim',
  'nasil odeyecem',
  'nasil odiycem',
  'online odeme',
  'kartla odeme',
  'kredi karti ile',
];

/**
 * Payment question detector. "margherita ne kadar" stays false (no amount
 * phrase) so item-price questions keep reaching the answer layer.
 */
export function isPaymentQuestion(raw: string): {
  asked: boolean;
  bankTransfer: boolean;
  amount: boolean;
} {
  const folded = ` ${words(raw).join(' ')} `;
  const has = (list: string[]) => list.some((p) => folded.includes(` ${p}`));
  // 'eft' only as a whole word: "defter", "seftali" contain it.
  const bankTransfer = has(BANK_PHRASES) || words(raw).includes('eft');
  const amount = has(AMOUNT_PHRASES);
  const method = has(METHOD_PHRASES);
  return { asked: bankTransfer || amount || method, bankTransfer, amount };
}

/**
 * Complaint about an out-of-area pin. Whole words / word-start phrases only:
 * the raw substring match made "Osmaniye koyu" and "bir saniye" (both contain
 * "niye") a complaint.
 */
export function isAreaComplaint(raw: string): boolean {
  const p = padded(raw);
  const exactWords = [
    'yakin',
    'yakiniz',
    'yakinim',
    'yakinsiniz',
    'neden',
    'niye',
    'nicin',
    'anlamadim',
    'dibinde',
    'dibindeyiz',
  ];
  if (exactWords.some((w) => p.includes(` ${w} `))) return true;
  const phrases = [
    'nasil yani',
    'nasil olur',
    'hizmet vermiyor',
    'gelmiyor musunuz',
    'gelmez misiniz',
    'gelemez misiniz',
    'getiremez misiniz',
    'uzak degil',
    'yan sokak',
    'hemen yan',
    'bolge disi',
    'hizmet alani',
    'olmaz mi',
    'yanlis yer',
    'yanlis dus',
    'yanlis goster',
    'yanlis konum',
    'konum yanlis',
  ];
  return phrases.some((ph) => p.includes(` ${ph}`));
}

// "Konum atamiyorum / bilmiyorum / olmuyor": pin gonderemeyen musterinin kelimeleri.
const LOCATION_INABILITY = new Set([
  'bilmiyorum', 'bilemiyorum', 'bulamadim', 'bulamiyorum', 'beceremedim', 'beceremiyorum',
  'olmuyor', 'olmadi', 'gitmiyor', 'gitmedi', 'atamadim', 'atamiyorum', 'atamam', 'atmiyor',
  'gonderemedim', 'gonderemiyorum', 'gondermiyor', 'paylasamadim', 'paylasamiyorum',
  'yapamadim', 'yapamiyorum', 'acilmiyor', 'calismiyor', 'istemiyorum', 'yok',
]);
// Ret/giris kaliplarinin kendi kelimeleri; geriye kalan metin adresin kendisidir.
const ADDRESS_LEAD_IN = new Set([
  'acik', 'adres', 'adresi', 'adresim', 'adresimi', 'adresimiz', 'yazili', 'yazayim', 'yazsam',
  'yazacagim', 'vereyim', 'ben', 'biz', 'ama', 'abi', 'ya', 'hic', 'telefonum', 'telefon',
]);

/**
 * Metin ret/giris kelimeleri cikarildiktan sonra GERCEK bir adres tasiyor mu?
 * "Acik adresim: Orhangazi Mah. Gul Sok. No 5", "Konum yok adres: Tezel konaklari
 * B blok daire 4", "Camiye yakin Gul sokak no 3" → evet. "konum atmayi bilmiyorum",
 * "Olmuyor" → hayir. Eskiden ret/sikayet kelimesi metnin herhangi bir yerinde
 * gecince tam adres bile reddediliyor, bot "Acik adresinizi yazar misiniz?"
 * sorusunu sonsuza kadar tekrarliyordu (dogrulama bulgusu, 14.09).
 */
export function hasAddressEvidence(raw: string): boolean {
  const rest = words(raw).filter(
    (w) => !w.startsWith('konum') && !LOCATION_INABILITY.has(w) && !ADDRESS_LEAD_IN.has(w)
  );
  if (rest.length === 0) return false;
  const text = rest.join(' ');
  const cls = classifyAddressText(text);
  if (cls.kind === 'full' || cls.kind === 'landmark') return true;
  return /\d/.test(text) && rest.length >= 2;
}

export function isLocationRefusal(raw: string): boolean {
  // Adresin kendisini de iceren metin ret degil, adrestir.
  if (hasAddressEvidence(raw)) return false;
  const ws = words(raw);
  const folded = ` ${ws.join(' ')} `;
  // "konum atmayi bilmiyorum", "Ben konumu bulamadim", "telefonum konum atmiyor"
  if (ws.some((w) => w.startsWith('konum')) && ws.some((w) => LOCATION_INABILITY.has(w))) return true;
  // Tek basina "Olmuyor", "yapamadim" (konum adiminda soylenince). "yok" ve
  // "istemiyorum" tek basina baska sorulara da cevap olabilir, sayilmaz.
  if (
    ws.length > 0 &&
    ws.length <= 2 &&
    ws.every((w) => LOCATION_INABILITY.has(w) || ['hic', 'ya', 'abi', 'ama', 'bir', 'turlu'].includes(w)) &&
    ws.some((w) => LOCATION_INABILITY.has(w) && w !== 'yok' && w !== 'istemiyorum')
  ) {
    return true;
  }
  const phrases = [
    'konum atamiyorum',
    'konum atamam',
    'konum gonderemiyorum',
    'konum paylasamiyorum',
    'konum atmak istemiyorum',
    'konum paylasmak istemiyorum',
    'konum vermek istemiyorum',
    'konum gondermek istemiyorum',
    'konumum yok',
    'konum yok',
    'konum nasil',
    'adres yazsam',
    'adresi yazsam',
    'adres yazayim',
    'adresimi yazayim',
    'adres yazacagim',
    'acik adres',
    'adres vereyim',
    'yazili adres',
  ];
  return phrases.some((p) => folded.includes(` ${p}`));
}

export function isConfusionAboutCart(raw: string): boolean {
  const ws = words(raw);
  if (ws.some((w) => w.startsWith('yanlis') || w === 'hata' || w === 'hatali')) return true;
  const folded = foldTr(raw);
  return ['olmadi', 'ben bunu istemedim', 'eklemedim'].some((p) => folded.includes(p));
}

/**
 * The conservative gate for cart edits after the order was confirmed
 * (delivery / location / address / payment steps). Only an explicit edit
 * that names a menu item may reach the NLU — everything else is handled by
 * the step itself, so a sentence can never silently add a product.
 */
/** "kolay gelsin", "merhaba": "kolay" also matches the menu name "Kola". */
function isGreeting(raw: string): boolean {
  return hasPhrase(raw, ['kolay gelsin', 'merhaba', 'selam', 'iyi gunler', 'iyi aksamlar', 'tesekkur', 'sagol']);
}

/**
 * Menu-word add wording that is only safe next to a menu match: "kola getirin",
 * "yanina patates kizartmasi da", "bir buyuk boy margarita".
 */
function hasMenuBoundAddWording(raw: string): boolean {
  const ws = words(raw);
  if (ws.length === 0) return false;
  if (ws.some((w) => w.startsWith('getir') || w.startsWith('yolla') || w.startsWith('koyun') || w === 'gonderin')) return true;
  if (ws.length <= 6 && (ws[ws.length - 1] === 'da' || ws[ws.length - 1] === 'de')) return true;
  return ws.length <= 5 && (ws[0] === 'bir' || ws[0] === 'bi');
}

export function isExplicitMidFlowEdit(raw: string, menuMatch: boolean): boolean {
  if (isPaymentQuestion(raw).asked) return false;
  if (isLocationRefusal(raw) || isAreaComplaint(raw) || isConfusionAboutCart(raw)) return false;
  if (isGreeting(raw)) return false;
  if (classifyAddressText(raw).kind !== 'none' && !hasAddSignal(raw)) return false;
  if (!menuMatch) return false;
  return (
    hasAddSignal(raw) ||
    hasItemRemoveSignal(raw) ||
    hasQuantityToken(raw) ||
    hasMenuBoundAddWording(raw) ||
    words(raw).length <= 3
  );
}

/**
 * The text names a menu item but is not an explicit edit ("margarita da
 * guzelmis", "buyuk boy margarita var"). After the order was confirmed we ask
 * "X eklensin mi?" instead of silently dropping the product or adding it.
 */
export function isMidFlowItemMention(raw: string, menuMatch: boolean): boolean {
  if (!menuMatch) return false;
  if (isPaymentQuestion(raw).asked || isLocationRefusal(raw) || isAreaComplaint(raw)) return false;
  if (isConfusionAboutCart(raw) || isGreeting(raw) || hasQuestionSignal(raw)) return false;
  return classifyAddressText(raw).kind === 'none';
}

// ==================== WRITTEN-ADDRESS REPLIES ====================

const WAIT_STARTS = [
  'yaziyor', 'yazacag', 'yazica', 'yaziyom', 'atiyor', 'atacag', 'atica', 'atiyom', 'gonderiyor',
  'gondereceg', 'gonderice', 'paylasiyor', 'paylasacag', 'saniye', 'dakika', 'bekle',
];

/** "tamam yaziyorum", "bir saniye", "simdi atiyorum konumu": the address is still coming. */
export function isAddressWaitReply(raw: string): boolean {
  return words(raw).some((w) => WAIT_STARTS.some((s) => w.startsWith(s)));
}

const CONFIRM_POSITIVE = new Set([
  'evet', 'dogru', 'dogrudur', 'tamam', 'tamamdir', 'olur', 'onayla', 'onayliyorum', 'aynen', 'kesinlikle',
  'guzel', 'super', 'harika', 'ok', 'okey', 'tabi', 'tabii', 'mukemmel', 'evt',
]);
const CONFIRM_FILLER = new Set(['adres', 'adresi', 'adresim', 'bu', 'o', 'cok', 'tesekkurler', 'tesekkur', 'ederim', 'sagol', 'sagolun', 'abi', 'hocam', 'efendim', 'ya', 'de', 'da']);

/**
 * "tamam dogru", "adres dogru", "Tamamdir", "evet dogru adres bu": a yes to
 * "Bu adres dogru mu?". Never with a number or an address/negation word, so
 * "tamam ama daire 5" stays a correction.
 */
export function isAddressConfirmReply(raw: string): boolean {
  const ws = words(raw);
  if (ws.length === 0 || ws.length > 5 || /\d/.test(raw)) return false;
  if (ws.some((w) => w === 'degil' || w.startsWith('yanlis') || w === 'hayir' || w === 'ama' || w === 'fakat')) return false;
  if (hasPhrase(raw, ['sorun yok'])) return true;
  return ws.some((w) => CONFIRM_POSITIVE.has(w)) && ws.every((w) => CONFIRM_POSITIVE.has(w) || CONFIRM_FILLER.has(w));
}

/** "dogru degil", "yanlis adres": the customer rejects the address shown. */
export function isAddressRejectReply(raw: string): boolean {
  const ws = words(raw);
  if (ws.length === 0 || ws.length > 4) return false;
  return ws.includes('degil') || ws.some((w) => w.startsWith('yanlis'));
}

const DONE_FILLER = new Set(['tamam', 'evet', 'lutfen', 'tesekkurler', 'tesekkur', 'ederim', 'olur', 'peki', 'abi', 'hocam', 'simdilik', 'o', 'zaman']);
const DONE_PHRASES = new Set([
  'baska bir sey istemiyorum', 'baska sey istemiyorum', 'baska istemiyorum', 'baska bir sey yok', 'baska yok',
  'bu kadar', 'bu kadar yeter', 'bu kadar yeterli', 'sadece bu', 'sadece bu kadar', 'sadece bunlar', 'hepsi bu',
  'hepsi bu kadar', 'bu yeterli', 'yeterli', 'bunlar yeterli', 'bunlar', 'bu kadari yeter', 'baska bir sey almayacagim',
]);

/** "tamam baska bir sey istemiyorum", "sadece bu kadar": the customer is done ordering (show the summary). */
export function isOrderDonePhrase(raw: string): boolean {
  const ws = words(raw);
  let s = 0;
  let e = ws.length;
  while (s < e && DONE_FILLER.has(ws[s])) s++;
  while (e > s && DONE_FILLER.has(ws[e - 1])) e--;
  if (s >= e) return false;
  return DONE_PHRASES.has(ws.slice(s, e).join(' '));
}

// ==================== UNDO ====================

const UNDO_EXCLUDE_EXACT = ['km', 'mah', 'cad', 'pin', 'yer', 'yere', 'yeri', 'yerde', 'yerden'];
const UNDO_EXCLUDE_PREFIX = [
  'konum',
  'adres',
  'bolge',
  'mesafe',
  'sokak',
  'mahalle',
  'cadde',
  'apartman',
  'daire',
  'site',
  'nakit',
  'kart',
  'iban',
  'link',
  'pini',
  // "yanlis yere dustu", "yanlis yer gosteriyor" is about the pin, not the cart
  'gosteri',
  'dustu',
  'dusmus',
  'harita',
  'lokasyon',
];
const UNDO_PHRASES = [
  'geri al',
  'yanlis oldu',
  'yanlis eklen',
  'yanlis ekledi',
  'yanlis anla',
  'onu cikar',
  'onu kaldir',
  'onu sil',
  'bunu cikar',
  'bunu kaldir',
  'bunu sil',
  'sonuncuyu',
  'son ekleneni',
  'ekledigini',
  'eklediginizi',
  'ekleneni',
  'fazladan eklen',
  'ben onu demedim',
  'oyle bir sey demedim',
  'ben bunu istemedim',
];
const UNDO_WORDS = ['istemedim', 'eklemedim', 'eklemeyin', 'eklemediniz', 'demedim', 'hatali'];

/**
 * "Undo the last cart change" intent ("yanlis oldu", "geri al", "onu sil").
 *   'undo' → always an undo request
 *   'soft' → a bare "istemiyorum" / "vazgectim": an undo ONLY right after a
 *            change, otherwise the caller's normal full-cancel path applies
 * Location / address / payment wording ("konum yanlis") is never a cart undo,
 * and a bare "iptal" is always a full cancel (null).
 */
export function isUndoLastChangeIntent(raw: string): 'undo' | 'soft' | null {
  const ws = words(raw);
  if (ws.length === 0 || ws.length > 8) return null;
  if (
    ws.some(
      (w) => UNDO_EXCLUDE_EXACT.includes(w) || UNDO_EXCLUDE_PREFIX.some((p) => w.startsWith(p))
    )
  ) {
    return null;
  }
  const joined = ` ${ws.join(' ')} `;
  if (UNDO_PHRASES.some((p) => joined.includes(` ${p}`))) return 'undo';
  if (ws.some((w) => w.startsWith('yanlis') || UNDO_WORDS.some((u) => w === u || w.startsWith(u))))
    return 'undo';
  if (ws.length <= 3 && ws.some((w) => ['istemiyorum', 'istemem', 'vazgectim'].includes(w)))
    return 'soft';
  return null;
}

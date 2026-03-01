/**
 * Turkish NLP Service
 * Provides Turkish-specific text processing for better menu item matching:
 * - Suffix stripping (stemming)
 * - Slang/abbreviation expansion
 * - Vowel harmony-aware normalization
 */

/**
 * Common Turkish slang/abbreviation → full menu item name mappings
 * These are food-related abbreviations commonly used in WhatsApp messages
 */
const SLANG_MAP: Record<string, string[]> = {
  // Lahmacun variants
  lmc: ['lahmacun'],
  lahmcun: ['lahmacun'],
  lhmcn: ['lahmacun'],
  lahmajun: ['lahmacun'],

  // Döner variants
  donr: ['doner'],
  dnr: ['doner'],
  dönr: ['doner'],

  // Kebap variants
  kebap: ['kebab', 'kebap'],
  kebab: ['kebab', 'kebap'],
  kebp: ['kebab', 'kebap'],

  // Pide variants
  pid: ['pide'],

  // Ayran variants
  ayrn: ['ayran'],

  // Hamburger/Burger variants
  hmbrg: ['hamburger'],
  hmbrgr: ['hamburger'],
  brgr: ['burger'],

  // Pizza variants
  pzza: ['pizza'],
  pizz: ['pizza'],

  // Kola variants
  cola: ['kola'],
  coke: ['kola'],

  // İçecek variants
  icck: ['icecek'],

  // Patates variants
  ptt: ['patates'],
  ptts: ['patates'],

  // Tavuk variants
  tvk: ['tavuk'],

  // Adana variants
  adn: ['adana'],

  // Iskender variants
  iskdr: ['iskender'],
  iskenderun: ['iskender'],

  // Mercimek variants
  mrcmk: ['mercimek'],

  // Pilav variants
  plv: ['pilav'],

  // Corba variants
  crb: ['corba'],
  crba: ['corba'],

  // Salata variants
  slt: ['salata'],
  slata: ['salata'],

  // Common WhatsApp shortcuts
  bi: ['bir'],
  bı: ['bir'],
  ii: ['iki'],
  uc: ['uc'],

  // Size/portion slang
  buyuk: ['buyuk'],
  byk: ['buyuk'],
  kck: ['kucuk'],
  kucuk: ['kucuk'],
  orta: ['orta'],
};

/**
 * Turkish suffix patterns for stemming
 * Ordered from longest to shortest for greedy matching
 */
const TURKISH_SUFFIXES = [
  // Noun case suffixes (with vowel harmony variants)
  'lardan', 'lerden', 'larina', 'lerine',
  'larim', 'lerim', 'larin', 'lerin',
  'lari', 'leri', 'lar', 'ler',
  // Possessive
  'imiz', 'iniz', 'umuz', 'unuz',
  // Case endings
  'dan', 'den', 'tan', 'ten',
  'nin', 'nun', 'nun', 'nun',
  'ina', 'ine', 'una', 'une',
  'da', 'de', 'ta', 'te',
  'yi', 'yu', 'ya', 'ye',
  'ni', 'nu', 'na', 'ne',
  'in', 'un', 'im', 'um',
  // Derivational
  'li', 'lu', 'lu', 'li',
  'siz', 'suz', 'sız', 'süz',
  // Possessive -i, -si, -su etc.
  'si', 'su', 'su', 'si',
];

/**
 * Minimum stem length after suffix removal
 * Prevents over-stemming (e.g. "et" → "e")
 */
const MIN_STEM_LENGTH = 2;

export class TurkishNlpService {
  /**
   * Expand slang/abbreviations in text
   * Returns original text + all expansions as an array
   */
  expandSlang(text: string): string[] {
    const normalized = this.normalize(text);
    const words = normalized.split(/\s+/).filter((w) => w.length > 0);
    const results = new Set<string>();
    results.add(normalized);

    let hasExpansion = false;
    const expandedWords = words.map((word) => {
      const expansions = SLANG_MAP[word];
      if (expansions) {
        hasExpansion = true;
        return expansions;
      }
      return [word];
    });

    if (!hasExpansion) return [normalized];

    // Generate all combinations of expanded words
    const combinations = this.cartesianProduct(expandedWords);
    for (const combo of combinations) {
      results.add(combo.join(' '));
    }

    return Array.from(results);
  }

  /**
   * Stem a Turkish word by removing common suffixes
   * Returns the shortest valid stem
   */
  stem(word: string): string {
    const normalized = this.normalize(word);
    if (normalized.length <= MIN_STEM_LENGTH) return normalized;

    let stemmed = normalized;

    // Try removing suffixes greedily (longest first)
    for (const suffix of TURKISH_SUFFIXES) {
      if (
        stemmed.length > suffix.length + MIN_STEM_LENGTH &&
        stemmed.endsWith(suffix)
      ) {
        stemmed = stemmed.slice(0, -suffix.length);
        break; // Only strip one suffix level to avoid over-stemming
      }
    }

    return stemmed;
  }

  /**
   * Get all stem variants for a word
   * Returns [original, stemmed] (deduplicated)
   */
  getStemVariants(word: string): string[] {
    const normalized = this.normalize(word);
    const stemmed = this.stem(normalized);
    const variants = new Set([normalized, stemmed]);
    return Array.from(variants);
  }

  /**
   * Process user text for menu matching:
   * 1. Expand slang
   * 2. Generate stem variants for each word
   * Returns { expandedTexts, stemmedWords }
   */
  processForMenuMatch(userText: string): {
    expandedTexts: string[];
    stemmedWords: string[];
    originalWords: string[];
  } {
    // Step 1: Expand slang
    const expandedTexts = this.expandSlang(userText);

    // Step 2: Get unique words from all expansions
    const allWords = new Set<string>();
    const stemmedWords = new Set<string>();
    for (const text of expandedTexts) {
      const words = text.split(/\s+/).filter((w) => w.length > 1);
      for (const word of words) {
        allWords.add(word);
        // Get stem variants
        for (const variant of this.getStemVariants(word)) {
          stemmedWords.add(variant);
        }
      }
    }

    return {
      expandedTexts,
      stemmedWords: Array.from(stemmedWords),
      originalWords: Array.from(allWords),
    };
  }

  /**
   * Normalize text: lowercase, remove diacritics, clean whitespace
   * Preserves Turkish-specific characters before diacritic removal
   */
  private normalize(text: string): string {
    return text
      .toLowerCase()
      .replace(/ğ/g, 'g')
      .replace(/ü/g, 'u')
      .replace(/ş/g, 's')
      .replace(/ı/g, 'i')
      .replace(/ö/g, 'o')
      .replace(/ç/g, 'c')
      .replace(/â/g, 'a')
      .replace(/î/g, 'i')
      .replace(/û/g, 'u')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Cartesian product of arrays (for slang expansion combinations)
   * Limited to prevent explosion with many slang words
   */
  private cartesianProduct(arrays: string[][]): string[][] {
    if (arrays.length === 0) return [[]];
    const maxCombinations = 8; // Limit to prevent explosion

    let result: string[][] = [[]];
    for (const arr of arrays) {
      const newResult: string[][] = [];
      for (const existing of result) {
        for (const item of arr) {
          newResult.push([...existing, item]);
          if (newResult.length >= maxCombinations) {
            return newResult;
          }
        }
      }
      result = newResult;
    }
    return result;
  }
}

export const turkishNlpService = new TurkishNlpService();

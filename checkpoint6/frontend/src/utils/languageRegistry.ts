/**
 * Centralized language registry for the translator frontend.
 *
 * Provides a single source of truth for all language-related mappings:
 * - Canonical codes ("ru", "en", "pt-BR")
 * - Display names ("Russian", "English", "Brazilian Portuguese")
 * - Native names ("Русский", "English", "Português do Brasil")
 * - Stellaris localisation tokens ("russian", "english", "braz_por")
 * - Alias resolution (case-insensitive)
 *
 * Mirrors the Python backend registry at
 * ``src/translator_app/languages/registry.py``.
 */

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface LanguageEntry {
  code: string;
  displayName: string;
  nativeName: string;
  stellarisToken: string;
  aliases: string[];
}

/* ------------------------------------------------------------------ */
/*  Master language list                                               */
/* ------------------------------------------------------------------ */

export const LANGUAGES: LanguageEntry[] = [
  {
    code: 'en',
    displayName: 'English',
    nativeName: 'English',
    stellarisToken: 'english',
    aliases: ['en', 'eng', 'english'],
  },
  {
    code: 'ru',
    displayName: 'Russian',
    nativeName: 'Русский',
    stellarisToken: 'russian',
    aliases: ['ru', 'rus', 'russian', 'русский'],
  },
  {
    code: 'fr',
    displayName: 'French',
    nativeName: 'Français',
    stellarisToken: 'french',
    aliases: ['fr', 'fra', 'french', 'français'],
  },
  {
    code: 'de',
    displayName: 'German',
    nativeName: 'Deutsch',
    stellarisToken: 'german',
    aliases: ['de', 'deu', 'german', 'deutsch'],
  },
  {
    code: 'es',
    displayName: 'Spanish',
    nativeName: 'Español',
    stellarisToken: 'spanish',
    aliases: ['es', 'spa', 'spanish', 'español'],
  },
  {
    code: 'pl',
    displayName: 'Polish',
    nativeName: 'Polski',
    stellarisToken: 'polish',
    aliases: ['pl', 'pol', 'polish', 'polski'],
  },
  {
    code: 'ja',
    displayName: 'Japanese',
    nativeName: '日本語',
    stellarisToken: 'japanese',
    aliases: ['ja', 'jpn', 'japanese', '日本語'],
  },
  {
    code: 'ko',
    displayName: 'Korean',
    nativeName: '한국어',
    stellarisToken: 'korean',
    aliases: ['ko', 'kor', 'korean', '한국어'],
  },
  {
    code: 'zh',
    displayName: 'Simplified Chinese',
    nativeName: '简体中文',
    stellarisToken: 'simp_chinese',
    aliases: ['zh', 'zho', 'chinese', 'simp_chinese', '简体中文'],
  },
  {
    code: 'pt-BR',
    displayName: 'Brazilian Portuguese',
    nativeName: 'Português do Brasil',
    stellarisToken: 'braz_por',
    aliases: ['pt-BR', 'pt_br', 'braz_por', 'brazilian', 'português do brasil'],
  },
  {
    code: 'pt',
    displayName: 'Portuguese',
    nativeName: 'Português',
    stellarisToken: 'portuguese',
    aliases: ['pt', 'por', 'portuguese', 'português'],
  },
  {
    code: 'it',
    displayName: 'Italian',
    nativeName: 'Italiano',
    stellarisToken: 'italian',
    aliases: ['it', 'ita', 'italian', 'italiano'],
  },
  {
    code: 'nl',
    displayName: 'Dutch',
    nativeName: 'Nederlands',
    stellarisToken: 'dutch',
    aliases: ['nl', 'nld', 'dutch', 'nederlands'],
  },
  {
    code: 'sv',
    displayName: 'Swedish',
    nativeName: 'Svenska',
    stellarisToken: 'swedish',
    aliases: ['sv', 'swe', 'swedish', 'svenska'],
  },
  {
    code: 'da',
    displayName: 'Danish',
    nativeName: 'Dansk',
    stellarisToken: 'danish',
    aliases: ['da', 'dan', 'danish', 'dansk'],
  },
  {
    code: 'fi',
    displayName: 'Finnish',
    nativeName: 'Suomi',
    stellarisToken: 'finnish',
    aliases: ['fi', 'fin', 'finnish', 'suomi'],
  },
  {
    code: 'no',
    displayName: 'Norwegian',
    nativeName: 'Norsk',
    stellarisToken: 'norwegian',
    aliases: ['no', 'nor', 'norwegian', 'norsk'],
  },
  {
    code: 'cs',
    displayName: 'Czech',
    nativeName: 'Čeština',
    stellarisToken: 'czech',
    aliases: ['cs', 'ces', 'czech', 'čeština'],
  },
  {
    code: 'hu',
    displayName: 'Hungarian',
    nativeName: 'Magyar',
    stellarisToken: 'hungarian',
    aliases: ['hu', 'hun', 'hungarian', 'magyar'],
  },
  {
    code: 'ro',
    displayName: 'Romanian',
    nativeName: 'Română',
    stellarisToken: 'romanian',
    aliases: ['ro', 'ron', 'romanian', 'română'],
  },
  {
    code: 'uk',
    displayName: 'Ukrainian',
    nativeName: 'Українська',
    stellarisToken: 'ukrainian',
    aliases: ['uk', 'ukr', 'ukrainian', 'українська'],
  },
  {
    code: 'el',
    displayName: 'Greek',
    nativeName: 'Ελληνικά',
    stellarisToken: 'greek',
    aliases: ['el', 'ell', 'greek', 'ελληνικά'],
  },
  {
    code: 'tr',
    displayName: 'Turkish',
    nativeName: 'Türkçe',
    stellarisToken: 'turkish',
    aliases: ['tr', 'tur', 'turkish', 'türkçe'],
  },
  {
    code: 'ar',
    displayName: 'Arabic',
    nativeName: 'العربية',
    stellarisToken: 'arabic',
    aliases: ['ar', 'ara', 'arabic', 'العربية'],
  },
  {
    code: 'he',
    displayName: 'Hebrew',
    nativeName: 'עברית',
    stellarisToken: 'hebrew',
    aliases: ['he', 'heb', 'hebrew', 'עברית'],
  },
  {
    code: 'th',
    displayName: 'Thai',
    nativeName: 'ไทย',
    stellarisToken: 'thai',
    aliases: ['th', 'tha', 'thai', 'ไทย'],
  },
  {
    code: 'vi',
    displayName: 'Vietnamese',
    nativeName: 'Tiếng Việt',
    stellarisToken: 'vietnamese',
    aliases: ['vi', 'vie', 'vietnamese', 'tiếng việt'],
  },
  {
    code: 'id',
    displayName: 'Indonesian',
    nativeName: 'Bahasa Indonesia',
    stellarisToken: 'indonesian',
    aliases: ['id', 'ind', 'indonesian', 'bahasa indonesia'],
  },
  {
    code: 'ms',
    displayName: 'Malay',
    nativeName: 'Bahasa Melayu',
    stellarisToken: 'malay',
    aliases: ['ms', 'msa', 'malay', 'bahasa melayu'],
  },
  {
    code: 'hi',
    displayName: 'Hindi',
    nativeName: 'हिन्दी',
    stellarisToken: 'hindi',
    aliases: ['hi', 'hin', 'hindi', 'हिन्दी'],
  },
];

/* ------------------------------------------------------------------ */
/*  Lookup maps (built once at module load)                            */
/* ------------------------------------------------------------------ */

const _codeMap = new Map<string, LanguageEntry>(LANGUAGES.map(e => [e.code, e]));
const _aliasMap = new Map<string, string>();
for (const entry of LANGUAGES) {
  for (const alias of entry.aliases) {
    _aliasMap.set(alias.toLowerCase(), entry.code);
  }
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Look up a LanguageEntry by canonical code.
 */
export function getLanguage(code: string): LanguageEntry | undefined {
  return _codeMap.get(code);
}

/**
 * Resolve any known alias or code to the canonical code.
 *
 * Case-insensitive.  Accepts canonical codes, Stellaris tokens, ISO
 * codes, native names, etc.
 *
 *   resolveCode("ru")             → "ru"
 *   resolveCode("russian")        → "ru"
 *   resolveCode("simp_chinese")   → "zh"
 *   resolveCode("klingon")        → null
 */
export function resolveCode(aliasOrCode: string): string | null {
  return _aliasMap.get(aliasOrCode.toLowerCase()) ?? null;
}

/**
 * Return the human-readable display name for a canonical code.
 *
 * Falls back to the code itself if unknown.
 *
 *   resolveDisplayName("ru")    → "Russian"
 *   resolveDisplayName("en")    → "English"
 *   resolveDisplayName("klingon") → "klingon"
 */
export function resolveDisplayName(code: string): string {
  return getLanguage(code)?.displayName ?? code;
}

/**
 * Resolve a canonical code to its Stellaris l_xxx token.
 *
 *   resolveStellarisToken("ru")     → "russian"
 *   resolveStellarisToken("pt-BR")  → "braz_por"
 *   resolveStellarisToken("klingon") → null
 */
export function resolveStellarisToken(code: string): string | null {
  return getLanguage(code)?.stellarisToken ?? null;
}

/**
 * Resolve a Stellaris localisation token to the canonical code.
 *
 *   resolveCodeFromStellarisToken("russian")  → "ru"
 *   resolveCodeFromStellarisToken("braz_por") → "pt-BR"
 *   resolveCodeFromStellarisToken("unknown")  → null
 */
export function resolveCodeFromStellarisToken(token: string): string | null {
  return resolveCode(token);
}

/**
 * Return options for a <select> dropdown showing "Display Name (code)".
 *
 *   getLanguageSelectOptions()
 *   // → [{ value: "en", label: "English (en)" }, ...]
 */
export function getLanguageSelectOptions(): { value: string; label: string }[] {
  return LANGUAGES.map(e => ({
    value: e.code,
    label: `${e.displayName} (${e.code})`,
  }));
}

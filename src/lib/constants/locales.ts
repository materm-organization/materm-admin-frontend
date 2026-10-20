export const DEFAULT_LOCALE = "la" as const;

export const LOCALE_COOKIE_NAME = "locale";

export const LOCALES = [
  { code: "en", name: "English", flag: "🇬🇧" },
  { code: "la", name: "ລາວ", flag: "🇱🇦" },
] as const;

export type LocaleCode = (typeof LOCALES)[number]["code"];

export function isSupportedLocale(value: string | undefined): value is LocaleCode {
  return !!value && LOCALES.some((l) => l.code === value);
}

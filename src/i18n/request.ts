import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";

import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE_NAME,
  isSupportedLocale,
} from "@/lib/constants/locales";

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE_NAME)?.value;
  const locale = isSupportedLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;

  try {
    const messages = (await import(`../../i18n/${locale}.json`)).default;
    return { locale, messages, timeZone: "Asia/Vientiane" };
  } catch {
    // last-resort fallback if a locale file is missing/broken — hardcoded to
    // "en" (not DEFAULT_LOCALE) so a broken la.json can't fall back to itself.
    const messages = (await import(`../../i18n/en.json`)).default;
    return { locale: "en", messages, timeZone: "Asia/Vientiane" };
  }
});

import { DEFAULT_UI_LOCALE, SUPPORTED_UI_LOCALES } from '../../public/js/i18n/locales.js';
import { createTranslator } from '../../public/js/i18n/translate.js';
import {
  KATEI_UI_LOCALE_COOKIE_NAME,
  getRequestedUiLocaleFromQuery,
  getUiLocaleCookieOptions,
  resolveRequestUiLocale
} from '../i18n/request_ui_locale.js';

export function createAttachUiLocaleMiddleware(config) {
  const uiLocaleCookieOptions = getUiLocaleCookieOptions(config);

  return function attachUiLocale(request, response, next) {
    const queryUiLocale = getRequestedUiLocaleFromQuery(request);
    const uiLocale = resolveRequestUiLocale(request);

    request.uiLocale = uiLocale;
    response.locals.uiLocale = uiLocale;
    response.locals.uiLocaleOptions = {
      supportedLocales: SUPPORTED_UI_LOCALES,
      defaultLocale: DEFAULT_UI_LOCALE,
      cookieName: KATEI_UI_LOCALE_COOKIE_NAME
    };
    response.locals.t = createTranslator(uiLocale);

    if (queryUiLocale) {
      response.cookie(KATEI_UI_LOCALE_COOKIE_NAME, queryUiLocale, uiLocaleCookieOptions);
    }

    next();
  };
}

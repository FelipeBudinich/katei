import {
  DEFAULT_UI_LOCALE,
  parseAcceptLanguage,
  resolveSupportedUiLocale
} from '../../public/js/i18n/locales.js';

export const KATEI_UI_LOCALE_COOKIE_NAME = 'katei_ui_locale';
export const UI_LOCALE_COOKIE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 365;

export function resolveRequestUiLocale(request) {
  const queryUiLocale = getRequestedUiLocaleFromQuery(request);

  if (queryUiLocale) {
    return queryUiLocale;
  }

  const cookieUiLocale = resolveSupportedUiLocale(readSingleValue(request?.cookies?.[KATEI_UI_LOCALE_COOKIE_NAME]));

  if (cookieUiLocale) {
    return cookieUiLocale;
  }

  const acceptedUiLocale = resolveAcceptedUiLocale(readAcceptLanguageHeader(request));

  return acceptedUiLocale ?? DEFAULT_UI_LOCALE;
}

export function getRequestedUiLocaleFromQuery(request) {
  return resolveSupportedUiLocale(readSingleValue(request?.query?.lang));
}

export function getUiLocaleCookieOptions(config) {
  return {
    httpOnly: false,
    sameSite: 'lax',
    secure: config.isProduction,
    path: '/',
    maxAge: UI_LOCALE_COOKIE_MAX_AGE_MS
  };
}

function resolveAcceptedUiLocale(headerValue) {
  const acceptedLocales = parseAcceptLanguage(headerValue);

  for (const locale of acceptedLocales) {
    const supportedUiLocale = resolveSupportedUiLocale(locale);

    if (supportedUiLocale) {
      return supportedUiLocale;
    }
  }

  return null;
}

function readAcceptLanguageHeader(request) {
  if (typeof request?.get === 'function') {
    return request.get('Accept-Language');
  }

  const headerValue = request?.headers?.['accept-language'];
  return readSingleValue(headerValue);
}

function readSingleValue(value) {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : '';
  }

  return typeof value === 'string' ? value : '';
}

import { Router } from 'express';
import { APP_TITLE } from '../../public/js/domain/workspace_read_model.js';
import { setPortfolioSurfaceCookie } from '../auth/last_surface_cookie.js';

export function createPortfolioRouter({ requireSession, requireSuperAdmin, portfolioReadModel, config }) {
  const router = Router();

  router.get('/portfolio', requireSession, requireSuperAdmin, async (request, response, next) => {
    try {
      const portfolio = await portfolioReadModel.loadPortfolioSummary();
      const searchQuery = normalizeOptionalString(request?.query?.q);

      setPortfolioSurfaceCookie(response, config);
      response.render('pages/portfolio', buildPortfolioPageModel({
        viewer: request.viewer,
        t: response.locals.t,
        portfolio,
        searchQuery
      }));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export function buildPortfolioPageModel({ viewer, t, portfolio = createEmptyPortfolioData(), searchQuery = '' }) {
  const normalizedPortfolio = normalizePortfolio(portfolio);
  const normalizedSearchQuery = normalizeOptionalString(searchQuery);
  const filteredBoardDirectory = filterBoardDirectory(normalizedPortfolio.boardDirectory, normalizedSearchQuery);

  return {
    pageTitle: t('pageTitles.portfolio', { appTitle: APP_TITLE }),
    bodyClass: 'app-shell portfolio-shell',
    viewer,
    portfolio: normalizedPortfolio,
    portfolioFilters: {
      searchQuery: normalizedSearchQuery,
      hasSearchQuery: Boolean(normalizedSearchQuery)
    },
    summaryItems: [
      {
        label: t('portfolio.summary.workspacesLabel'),
        value: normalizedPortfolio.totals.workspaces
      },
      {
        label: t('portfolio.summary.boardsLabel'),
        value: normalizedPortfolio.totals.boards
      },
      {
        label: t('portfolio.summary.cardsLabel'),
        value: normalizedPortfolio.totals.cards
      },
      {
        label: t('portfolio.summary.cardsMissingRequiredLocalesLabel'),
        value: normalizedPortfolio.totals.cardsMissingRequiredLocales
      },
      {
        label: t('portfolio.summary.openLocaleRequestCountLabel'),
        value: normalizedPortfolio.totals.openLocaleRequestCount
      },
      {
        label: t('portfolio.summary.awaitingHumanVerificationCountLabel'),
        value: normalizedPortfolio.totals.awaitingHumanVerificationCount
      },
      {
        label: t('portfolio.summary.agentProposalCountLabel'),
        value: normalizedPortfolio.totals.agentProposalCount
      }
    ],
    boardDirectoryEntries: filteredBoardDirectory.map((entry) => createBoardDirectoryEntryViewModel(entry, t)),
    boardDirectoryCount: filteredBoardDirectory.length
  };
}

function createEmptyPortfolioData() {
  return {
    totals: createEmptyPortfolioTotals(),
    workspaces: [],
    boardDirectory: []
  };
}

function normalizePortfolio(portfolio) {
  const workspaces = Array.isArray(portfolio?.workspaces) ? portfolio.workspaces : [];
  const boardDirectory = Array.isArray(portfolio?.boardDirectory) ? portfolio.boardDirectory : [];

  return {
    totals: normalizePortfolioTotals(portfolio?.totals, { workspaces, boardDirectory }),
    workspaces,
    boardDirectory
  };
}

function createBoardDirectoryEntryViewModel(entry, t) {
  const workspaceTitle = normalizeOptionalString(entry?.workspaceTitle) || normalizeOptionalString(entry?.workspaceId);
  const boardTitle = normalizeOptionalString(entry?.boardTitle) || normalizeOptionalString(entry?.boardId);
  const localePolicy = entry?.localePolicy ?? {};
  const localizationSummary = entry?.localizationSummary ?? {};
  const totalCards = Number.isInteger(entry?.cardCounts?.total) ? entry.cardCounts.total : 0;
  const cardsMissingRequiredLocales = normalizeNonNegativeInteger(localizationSummary.cardsMissingRequiredLocales);
  const openLocaleRequestCount = normalizeNonNegativeInteger(localizationSummary.openLocaleRequestCount);
  const awaitingHumanVerificationCount = normalizeNonNegativeInteger(localizationSummary.awaitingHumanVerificationCount);
  const agentProposalCount = normalizeNonNegativeInteger(localizationSummary.agentProposalCount);
  const requiredLocales = joinValues(localePolicy.requiredLocales);
  const supportedLocales = joinValues(localePolicy.supportedLocales);
  const hasIncompleteLocaleCoverage = cardsMissingRequiredLocales > 0;

  return {
    title: boardTitle,
    workspaceTitle,
    boardId: normalizeOptionalString(entry?.boardId),
    openBoardHref: buildBoardHref(entry),
    localeCoverage: {
      statusLabel: hasIncompleteLocaleCoverage
        ? t('portfolio.coverage.incomplete')
        : t('portfolio.coverage.complete'),
      statusModifierClass: hasIncompleteLocaleCoverage
        ? 'portfolio-status-badge--warning'
        : 'portfolio-status-badge--success',
      sourceLocale: normalizeOptionalString(localePolicy.sourceLocale),
      defaultLocale: normalizeOptionalString(localePolicy.defaultLocale),
      supportedLocales,
      requiredLocales
    },
    counts: [
      {
        label: t('portfolio.directory.cardCountLabel'),
        value: t('workspace.cardCount', { count: totalCards })
      },
      {
        label: t('portfolio.directory.cardsMissingRequiredLocalesLabel'),
        value: String(cardsMissingRequiredLocales)
      },
      {
        label: t('portfolio.directory.openLocaleRequestCountLabel'),
        value: String(openLocaleRequestCount)
      },
      {
        label: t('portfolio.directory.awaitingHumanVerificationCountLabel'),
        value: String(awaitingHumanVerificationCount)
      },
      {
        label: t('portfolio.directory.agentProposalCountLabel'),
        value: String(agentProposalCount)
      }
    ],
    metadata: [
      {
        label: t('portfolio.directory.boardIdLabel'),
        value: normalizeOptionalString(entry?.boardId)
      },
      {
        label: t('portfolio.directory.sourceLocaleLabel'),
        value: normalizeOptionalString(localePolicy.sourceLocale)
      },
      {
        label: t('portfolio.directory.defaultLocaleLabel'),
        value: normalizeOptionalString(localePolicy.defaultLocale)
      },
      {
        label: t('portfolio.directory.supportedLocalesLabel'),
        value: joinValues(localePolicy.supportedLocales)
      },
      {
        label: t('portfolio.directory.requiredLocalesLabel'),
        value: requiredLocales
      }
    ].filter((field) => field.value)
  };
}

function createEmptyPortfolioTotals() {
  return {
    workspaces: 0,
    boards: 0,
    cards: 0,
    cardsMissingRequiredLocales: 0,
    openLocaleRequestCount: 0,
    awaitingHumanVerificationCount: 0,
    agentProposalCount: 0
  };
}

function normalizePortfolioTotals(totals, { workspaces = [], boardDirectory = [] } = {}) {
  return {
    workspaces: normalizeNonNegativeInteger(totals?.workspaces, workspaces.length),
    boards: normalizeNonNegativeInteger(totals?.boards, boardDirectory.length),
    cards: normalizeNonNegativeInteger(
      totals?.cards,
      boardDirectory.reduce(
        (sum, entry) => sum + normalizeNonNegativeInteger(entry?.cardCounts?.total),
        0
      )
    ),
    cardsMissingRequiredLocales: normalizeNonNegativeInteger(totals?.cardsMissingRequiredLocales),
    openLocaleRequestCount: normalizeNonNegativeInteger(totals?.openLocaleRequestCount),
    awaitingHumanVerificationCount: normalizeNonNegativeInteger(totals?.awaitingHumanVerificationCount),
    agentProposalCount: normalizeNonNegativeInteger(totals?.agentProposalCount)
  };
}

function filterBoardDirectory(entries, searchQuery) {
  if (!searchQuery) {
    return entries;
  }

  const normalizedSearchQuery = searchQuery.toLowerCase();

  return entries.filter((entry) => getBoardDirectoryEntrySearchValue(entry).includes(normalizedSearchQuery));
}

function getBoardDirectoryEntrySearchValue(entry) {
  return [
    entry?.workspaceTitle,
    entry?.workspaceId,
    entry?.boardTitle,
    entry?.boardId,
    entry?.localePolicy?.sourceLocale,
    entry?.localePolicy?.defaultLocale,
    ...(Array.isArray(entry?.localePolicy?.supportedLocales) ? entry.localePolicy.supportedLocales : []),
    ...(Array.isArray(entry?.localePolicy?.requiredLocales) ? entry.localePolicy.requiredLocales : [])
  ]
    .filter((value) => typeof value === 'string' && value.trim())
    .join(' ')
    .toLowerCase();
}

function buildBoardHref(entry) {
  const workspaceId = normalizeOptionalString(entry?.workspaceId);
  const boardId = normalizeOptionalString(entry?.boardId);
  const searchParams = new URLSearchParams();

  if (workspaceId) {
    searchParams.set('workspaceId', workspaceId);
  }

  if (boardId) {
    searchParams.set('boardId', boardId);
  }

  const queryString = searchParams.toString();

  return queryString ? `/boards?${queryString}` : '/boards';
}

function normalizeNonNegativeInteger(value, fallback = 0) {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function joinValues(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string' && entry.trim()).join(', ') : '';
}

function normalizeOptionalString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

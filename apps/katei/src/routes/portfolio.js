import { Router } from 'express';
import { APP_TITLE } from '../../public/js/domain/workspace_read_model.js';
import { setPortfolioSurfaceCookie } from '../auth/last_surface_cookie.js';

export function createPortfolioRouter({ requireSession, requireSuperAdmin, portfolioReadModel, config }) {
  const router = Router();

  router.get('/portfolio', requireSession, requireSuperAdmin, async (request, response, next) => {
    try {
      const portfolio = await portfolioReadModel.loadPortfolioSummary();

      setPortfolioSurfaceCookie(response, config);
      response.render('pages/portfolio', buildPortfolioPageModel({
        viewer: request.viewer,
        t: response.locals.t,
        portfolio
      }));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export function buildPortfolioPageModel({ viewer, t, portfolio = createEmptyPortfolioData() }) {
  const normalizedPortfolio = normalizePortfolio(portfolio);

  return {
    pageTitle: t('pageTitles.portfolio', { appTitle: APP_TITLE }),
    bodyClass: 'app-shell portfolio-shell',
    viewer,
    portfolio: normalizedPortfolio,
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
    boardDirectoryEntries: normalizedPortfolio.boardDirectory.map((entry) => createBoardDirectoryEntryViewModel(entry, t))
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
  const timestamps = entry?.timestamps ?? {};
  const localizationSummary = entry?.localizationSummary ?? {};
  const aging = entry?.aging ?? {};
  const totalCards = Number.isInteger(entry?.cardCounts?.total) ? entry.cardCounts.total : 0;
  const cardsMissingRequiredLocales = normalizeNonNegativeInteger(localizationSummary.cardsMissingRequiredLocales);
  const openLocaleRequestCount = normalizeNonNegativeInteger(localizationSummary.openLocaleRequestCount);
  const awaitingHumanVerificationCount = normalizeNonNegativeInteger(localizationSummary.awaitingHumanVerificationCount);
  const agentProposalCount = normalizeNonNegativeInteger(localizationSummary.agentProposalCount);

  return {
    title: boardTitle,
    workspaceTitle,
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
        value: joinValues(localePolicy.requiredLocales)
      },
      {
        label: t('portfolio.directory.cardCountLabel'),
        value: t('workspace.cardCount', { count: totalCards })
      },
      {
        label: t('portfolio.directory.cardsMissingRequiredLocalesLabel'),
        value: formatOptionalCount(cardsMissingRequiredLocales)
      },
      {
        label: t('portfolio.directory.openLocaleRequestCountLabel'),
        value: formatOptionalCount(openLocaleRequestCount)
      },
      {
        label: t('portfolio.directory.awaitingHumanVerificationCountLabel'),
        value: formatOptionalCount(awaitingHumanVerificationCount)
      },
      {
        label: t('portfolio.directory.agentProposalCountLabel'),
        value: formatOptionalCount(agentProposalCount)
      },
      {
        label: t('portfolio.directory.boardCreatedAtLabel'),
        value: normalizeOptionalString(timestamps.boardCreatedAt)
      },
      {
        label: t('portfolio.directory.boardUpdatedAtLabel'),
        value: normalizeOptionalString(timestamps.boardUpdatedAt)
      },
      {
        label: t('portfolio.directory.workspaceUpdatedAtLabel'),
        value: normalizeOptionalString(timestamps.workspaceUpdatedAt)
      },
      {
        label: t('portfolio.directory.oldestMissingRequiredLocaleUpdatedAtLabel'),
        value: normalizeOptionalString(aging.oldestMissingRequiredLocaleUpdatedAt)
      },
      {
        label: t('portfolio.directory.oldestOpenLocaleRequestAtLabel'),
        value: normalizeOptionalString(aging.oldestOpenLocaleRequestAt)
      },
      {
        label: t('portfolio.directory.oldestAwaitingHumanVerificationAtLabel'),
        value: normalizeOptionalString(aging.oldestAwaitingHumanVerificationAt)
      },
      {
        label: t('portfolio.directory.oldestAgentProposalAtLabel'),
        value: normalizeOptionalString(aging.oldestAgentProposalAt)
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

function formatOptionalCount(value) {
  return value > 0 ? String(value) : '';
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

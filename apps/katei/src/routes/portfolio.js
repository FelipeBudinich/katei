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
        value: normalizedPortfolio.workspaces.length
      },
      {
        label: t('portfolio.summary.boardsLabel'),
        value: normalizedPortfolio.boardDirectory.length
      }
    ],
    boardDirectoryEntries: normalizedPortfolio.boardDirectory.map((entry) => createBoardDirectoryEntryViewModel(entry, t))
  };
}

function createEmptyPortfolioData() {
  return {
    workspaces: [],
    boardDirectory: []
  };
}

function normalizePortfolio(portfolio) {
  return {
    workspaces: Array.isArray(portfolio?.workspaces) ? portfolio.workspaces : [],
    boardDirectory: Array.isArray(portfolio?.boardDirectory) ? portfolio.boardDirectory : []
  };
}

function createBoardDirectoryEntryViewModel(entry, t) {
  const workspaceTitle = normalizeOptionalString(entry?.workspaceTitle) || normalizeOptionalString(entry?.workspaceId);
  const boardTitle = normalizeOptionalString(entry?.boardTitle) || normalizeOptionalString(entry?.boardId);
  const localePolicy = entry?.localePolicy ?? {};
  const timestamps = entry?.timestamps ?? {};
  const totalCards = Number.isInteger(entry?.cardCounts?.total) ? entry.cardCounts.total : 0;

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
      }
    ].filter((field) => field.value)
  };
}

function joinValues(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string' && entry.trim()).join(', ') : '';
}

function normalizeOptionalString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

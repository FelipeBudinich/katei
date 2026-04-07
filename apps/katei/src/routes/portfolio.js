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
  const filteredBoardDirectory = filterPortfolioEntries(normalizedPortfolio.boardDirectory, normalizedSearchQuery);
  const filteredAwaitingHumanVerificationItems = filterPortfolioEntries(
    normalizedPortfolio.awaitingHumanVerificationItems,
    normalizedSearchQuery
  );
  const filteredAgentProposalItems = filterPortfolioEntries(
    normalizedPortfolio.agentProposalItems,
    normalizedSearchQuery
  );
  const filteredMissingRequiredLocalizationItems = filterPortfolioEntries(
    normalizedPortfolio.missingRequiredLocalizationItems,
    normalizedSearchQuery
  );
  const incompleteCoverageBoards = filteredBoardDirectory.filter(
    (entry) => normalizeNonNegativeInteger(entry?.localizationSummary?.cardsMissingRequiredLocales) > 0
  );
  const agingSections = [
    createAgingSectionViewModel(filteredBoardDirectory, t, {
      heading: t('portfolio.aging.awaitingApproval.heading'),
      description: t('portfolio.aging.awaitingApproval.description'),
      countLabel: t('portfolio.aging.awaitingApproval.countColumnLabel'),
      timestampLabel: t('portfolio.aging.awaitingApproval.timestampColumnLabel'),
      emptyHeading: t('portfolio.aging.awaitingApproval.empty.heading'),
      emptyDescription: t('portfolio.aging.awaitingApproval.empty.description'),
      timestampAccessor: (entry) => entry?.aging?.oldestAwaitingHumanVerificationAt,
      countAccessor: (entry) => entry?.localizationSummary?.awaitingHumanVerificationCount
    }),
    createAgingSectionViewModel(filteredBoardDirectory, t, {
      heading: t('portfolio.aging.openLocaleRequests.heading'),
      description: t('portfolio.aging.openLocaleRequests.description'),
      countLabel: t('portfolio.aging.openLocaleRequests.countColumnLabel'),
      timestampLabel: t('portfolio.aging.openLocaleRequests.timestampColumnLabel'),
      emptyHeading: t('portfolio.aging.openLocaleRequests.empty.heading'),
      emptyDescription: t('portfolio.aging.openLocaleRequests.empty.description'),
      timestampAccessor: (entry) => entry?.aging?.oldestOpenLocaleRequestAt,
      countAccessor: (entry) => entry?.localizationSummary?.openLocaleRequestCount
    }),
    createAgingSectionViewModel(filteredBoardDirectory, t, {
      heading: t('portfolio.aging.missingRequiredLocales.heading'),
      description: t('portfolio.aging.missingRequiredLocales.description'),
      countLabel: t('portfolio.aging.missingRequiredLocales.countColumnLabel'),
      timestampLabel: t('portfolio.aging.missingRequiredLocales.timestampColumnLabel'),
      emptyHeading: t('portfolio.aging.missingRequiredLocales.empty.heading'),
      emptyDescription: t('portfolio.aging.missingRequiredLocales.empty.description'),
      timestampAccessor: (entry) => entry?.aging?.oldestMissingRequiredLocaleUpdatedAt,
      countAccessor: (entry) => entry?.localizationSummary?.cardsMissingRequiredLocales
    })
  ];

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
    boardDirectoryCount: filteredBoardDirectory.length,
    awaitingApprovalEntries: filteredAwaitingHumanVerificationItems.map((entry) => createReviewQueueEntryViewModel(entry, t, {
      stateKey: 'cardViewDialog.reviewState.needs-human-verification',
      timestampLabel: t('portfolio.awaitingApproval.verificationRequestedAtColumnLabel'),
      timestamp: entry?.verificationRequestedAt
    })),
    awaitingApprovalCount: filteredAwaitingHumanVerificationItems.length,
    agentProposalEntries: filteredAgentProposalItems.map((entry) => createReviewQueueEntryViewModel(entry, t, {
      stateKey: 'cardViewDialog.reviewState.ai',
      timestampLabel: t('portfolio.agentProposals.proposedAtColumnLabel'),
      timestamp: entry?.proposedAt
    })),
    agentProposalCount: filteredAgentProposalItems.length,
    missingRequiredLocalizationEntries: filteredMissingRequiredLocalizationItems.map((entry) => createMissingRequiredLocalizationEntryViewModel(entry)),
    missingRequiredLocalizationCount: filteredMissingRequiredLocalizationItems.length,
    incompleteCoverageEntries: incompleteCoverageBoards.map((entry) => createIncompleteCoverageEntryViewModel(entry, t)),
    incompleteCoverageCount: incompleteCoverageBoards.length,
    agingSections
  };
}

function createEmptyPortfolioData() {
  return {
    totals: createEmptyPortfolioTotals(),
    workspaces: [],
    boardDirectory: [],
    awaitingHumanVerificationItems: [],
    agentProposalItems: [],
    missingRequiredLocalizationItems: []
  };
}

function normalizePortfolio(portfolio) {
  const workspaces = Array.isArray(portfolio?.workspaces) ? portfolio.workspaces : [];
  const boardDirectory = Array.isArray(portfolio?.boardDirectory) ? portfolio.boardDirectory : [];
  const awaitingHumanVerificationItems = Array.isArray(portfolio?.awaitingHumanVerificationItems)
    ? portfolio.awaitingHumanVerificationItems
    : [];
  const agentProposalItems = Array.isArray(portfolio?.agentProposalItems) ? portfolio.agentProposalItems : [];
  const missingRequiredLocalizationItems = Array.isArray(portfolio?.missingRequiredLocalizationItems)
    ? portfolio.missingRequiredLocalizationItems
    : [];

  return {
    totals: normalizePortfolioTotals(portfolio?.totals, { workspaces, boardDirectory }),
    workspaces,
    boardDirectory,
    awaitingHumanVerificationItems,
    agentProposalItems,
    missingRequiredLocalizationItems
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
    ]
  };
}

function createReviewQueueEntryViewModel(entry, t, { stateKey, timestampLabel, timestamp }) {
  const workspaceTitle = normalizeOptionalString(entry?.workspaceTitle) || normalizeOptionalString(entry?.workspaceId);
  const boardTitle = normalizeOptionalString(entry?.boardTitle) || normalizeOptionalString(entry?.boardId);
  const cardTitle = normalizeOptionalString(entry?.cardTitle) || normalizeOptionalString(entry?.cardId);
  const localizedTitle = normalizeOptionalString(entry?.localizedTitle);

  return {
    workspaceTitle,
    boardTitle,
    cardTitle,
    localizedTitle: localizedTitle && localizedTitle !== cardTitle ? localizedTitle : '',
    locale: normalizeOptionalString(entry?.locale),
    stateLabel: t(stateKey),
    timestampLabel,
    timestamp: normalizeOptionalString(timestamp),
    openBoardHref: buildBoardHref(entry)
  };
}

function createMissingRequiredLocalizationEntryViewModel(entry) {
  const workspaceTitle = normalizeOptionalString(entry?.workspaceTitle) || normalizeOptionalString(entry?.workspaceId);
  const boardTitle = normalizeOptionalString(entry?.boardTitle) || normalizeOptionalString(entry?.boardId);
  const cardTitle = normalizeOptionalString(entry?.cardTitle) || normalizeOptionalString(entry?.cardId);

  return {
    workspaceTitle,
    boardTitle,
    cardTitle,
    missingLocales: joinValues(entry?.missingLocales),
    cardUpdatedAt: normalizeOptionalString(entry?.cardUpdatedAt),
    openBoardHref: buildBoardHref(entry)
  };
}

function createIncompleteCoverageEntryViewModel(entry, t) {
  const workspaceTitle = normalizeOptionalString(entry?.workspaceTitle) || normalizeOptionalString(entry?.workspaceId);
  const boardTitle = normalizeOptionalString(entry?.boardTitle) || normalizeOptionalString(entry?.boardId);
  const cardsMissingRequiredLocales = normalizeNonNegativeInteger(entry?.localizationSummary?.cardsMissingRequiredLocales);

  return {
    workspaceTitle,
    boardTitle,
    cardsMissingRequiredLocales,
    oldestMissingRequiredLocaleUpdatedAt: normalizeOptionalString(entry?.aging?.oldestMissingRequiredLocaleUpdatedAt),
    statusLabel: cardsMissingRequiredLocales > 0
      ? t('portfolio.coverage.incomplete')
      : t('portfolio.coverage.complete'),
    openBoardHref: buildBoardHref(entry)
  };
}

function createAgingSectionViewModel(entries, t, {
  heading,
  description,
  countLabel,
  timestampLabel,
  emptyHeading,
  emptyDescription,
  timestampAccessor,
  countAccessor
}) {
  const sectionEntries = entries
    .map((entry) => createAgingBoardEntryViewModel(entry, { timestampAccessor, countAccessor }))
    .filter(Boolean)
    .sort((left, right) => (
      normalizeOptionalString(left?.timestamp).localeCompare(normalizeOptionalString(right?.timestamp))
      || normalizeOptionalString(left?.workspaceTitle).localeCompare(normalizeOptionalString(right?.workspaceTitle))
      || normalizeOptionalString(left?.boardTitle).localeCompare(normalizeOptionalString(right?.boardTitle))
    ));

  return {
    heading,
    description,
    countLabel,
    timestampLabel,
    emptyHeading,
    emptyDescription,
    entries: sectionEntries,
    count: sectionEntries.length,
    actionsLabel: t('portfolio.aging.actionsColumnLabel'),
    openBoardAction: t('portfolio.aging.openBoardAction')
  };
}

function createAgingBoardEntryViewModel(entry, { timestampAccessor, countAccessor }) {
  const timestamp = normalizeOptionalString(timestampAccessor(entry));

  if (!timestamp) {
    return null;
  }

  return {
    workspaceTitle: normalizeOptionalString(entry?.workspaceTitle) || normalizeOptionalString(entry?.workspaceId),
    boardTitle: normalizeOptionalString(entry?.boardTitle) || normalizeOptionalString(entry?.boardId),
    count: normalizeNonNegativeInteger(countAccessor(entry)),
    timestamp,
    openBoardHref: buildBoardHref(entry)
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

function filterPortfolioEntries(entries, searchQuery) {
  if (!searchQuery) {
    return entries;
  }

  const normalizedSearchQuery = searchQuery.toLowerCase();

  return entries.filter((entry) => getPortfolioEntrySearchValue(entry).includes(normalizedSearchQuery));
}

function getPortfolioEntrySearchValue(entry) {
  return [
    entry?.workspaceTitle,
    entry?.workspaceId,
    entry?.boardTitle,
    entry?.boardId,
    entry?.cardTitle,
    entry?.cardId,
    entry?.localizedTitle,
    entry?.locale,
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

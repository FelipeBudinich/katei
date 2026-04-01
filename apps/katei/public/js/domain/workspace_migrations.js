import { normalizeBoardCollaboration } from './board_collaboration.js';
import { createDefaultBoardLanguagePolicy, normalizeBoardLanguagePolicy } from './board_language_policy.js';
import { getDefaultBoardStageActionIds, isValidBoardStageActionId } from './board_stage_actions.js';
import { createDefaultBoardStages, createDefaultBoardTemplates } from './board_workflow.js';
import { createCardContentProvenance } from './card_localization.js';
import { normalizeCardLocaleRequests } from './card_localization_requests.js';
import {
  WORKSPACE_ID,
  WORKSPACE_VERSION,
  createWorkspaceAccess,
  createWorkspaceOwnership
} from './workspace_read_model.js';

export const WORKSPACE_MIGRATIONS = Object.freeze([
  Object.freeze({
    version: WORKSPACE_VERSION,
    up: migrateWorkspaceToV6
  })
]);

export function migrateWorkspaceSnapshot(workspace, options = {}) {
  if (!isPlainObject(workspace)) {
    return workspace;
  }

  return normalizeWorkspaceToCurrentSchema(workspace, options);
}

export function migrateWorkspaceToV6(workspace, { now = null, workspaceId = null, ownerSub = null, ownerActor = null } = {}) {
  return normalizeWorkspaceToCurrentSchema(workspace, {
    now,
    version: WORKSPACE_VERSION,
    workspaceId,
    ownerSub,
    ownerActor
  });
}

export function normalizeWorkspaceToCurrentSchema(
  workspace,
  { now = null, version = WORKSPACE_VERSION, workspaceId = null, ownerSub = null, ownerActor = null } = {}
) {
  if (!isPlainObject(workspace)) {
    return workspace;
  }

  const migratedWorkspace = structuredClone(workspace);
  migratedWorkspace.version = version;
  migratedWorkspace.workspaceId = normalizeWorkspaceId(workspaceId ?? migratedWorkspace.workspaceId);
  migratedWorkspace.ownership = migrateWorkspaceOwnership(migratedWorkspace, {
    ownerSub,
    ownerActor
  });
  migratedWorkspace.access = migrateWorkspaceAccess(migratedWorkspace);
  delete migratedWorkspace.owner;
  delete migratedWorkspace.ownerActor;
  delete migratedWorkspace.ownerSub;
  delete migratedWorkspace.accessLevel;
  delete migratedWorkspace.visibility;

  if (isPlainObject(migratedWorkspace.ui)) {
    delete migratedWorkspace.ui.collapsedColumnsByBoard;
  }

  if (!isPlainObject(migratedWorkspace.boards)) {
    return migratedWorkspace;
  }

  const workspaceOwner = migratedWorkspace.ownership.owner;

  for (const [boardId, board] of Object.entries(migratedWorkspace.boards)) {
    migratedWorkspace.boards[boardId] = migrateBoardToSchemaV8(board, {
      now,
      workspaceOwner
    });
  }

  return migratedWorkspace;
}

export function migrateBoardToSchemaV8(board, { now = null, workspaceOwner = null } = {}) {
  if (!isPlainObject(board)) {
    return board;
  }

  const migratedBoard = structuredClone(board);
  const stageOrder = resolveStageOrder(migratedBoard);
  const legacyStageMap = resolveLegacyStageMap(migratedBoard);
  const defaultStagesById = new Map(createDefaultBoardStages().map((stage) => [stage.id, stage]));

  migratedBoard.stageOrder = stageOrder;
  migratedBoard.stages = Object.fromEntries(
    stageOrder.map((stageId) => [
      stageId,
      migrateStageDefinition({
        stageId,
        stageOrder,
        legacyStage: legacyStageMap[stageId],
        defaultStage: defaultStagesById.get(stageId) ?? null
      })
    ])
  );
  migratedBoard.templates = migrateBoardTemplates(migratedBoard.templates);
  migratedBoard.collaboration = migrateBoardCollaboration(migratedBoard, {
    workspaceOwner
  });
  migratedBoard.languagePolicy = migrateBoardLanguagePolicy(migratedBoard.languagePolicy);

  if (isPlainObject(migratedBoard.cards)) {
    for (const [cardId, card] of Object.entries(migratedBoard.cards)) {
      migratedBoard.cards[cardId] = migrateCardToLocalizedContent(card, migratedBoard, { now });
    }
  }

  delete migratedBoard.columnOrder;
  delete migratedBoard.columns;
  delete migratedBoard.memberships;
  delete migratedBoard.invites;

  return migratedBoard;
}

export function migrateWorkspaceToV5(workspace, options = {}) {
  return migrateWorkspaceToV6(workspace, options);
}

export function migrateBoardToSchemaV7(board, options = {}) {
  return migrateBoardToSchemaV8(board, options);
}

export function migrateCardToLocalizedContent(card, board, { now = null } = {}) {
  if (!isPlainObject(card)) {
    return card;
  }

  const migratedCard = structuredClone(card);
  const languagePolicy = normalizeBoardLanguagePolicy(board?.languagePolicy ?? null) ?? createDefaultBoardLanguagePolicy();
  const sourceLocale = languagePolicy.sourceLocale;
  const nextContentByLocale = {};

  if (isPlainObject(migratedCard.contentByLocale)) {
    for (const [rawLocale, rawVariant] of Object.entries(migratedCard.contentByLocale)) {
      const locale = canonicalizeLocale(rawLocale);

      if (!locale || !isPlainObject(rawVariant)) {
        continue;
      }

      nextContentByLocale[locale] = migrateLocalizedContentVariant(rawVariant, {
        fallbackTimestamp: resolveMigrationTimestamp(migratedCard, board, now)
      });
    }
  }

  if (!nextContentByLocale[sourceLocale] && hasLegacyCardContent(migratedCard)) {
    nextContentByLocale[sourceLocale] = {
      title: String(migratedCard.title ?? ''),
      detailsMarkdown: String(migratedCard.detailsMarkdown ?? ''),
      provenance: createCardContentProvenance({
        actor: {
          type: 'system',
          id: 'legacy-migration'
        },
        timestamp: resolveMigrationTimestamp(migratedCard, board, now),
        includesHumanInput: true
      })
    };
  }

  migratedCard.contentByLocale = nextContentByLocale;
  migratedCard.localeRequests = migrateLegacyCardLocaleRequests(migratedCard);
  delete migratedCard.title;
  delete migratedCard.detailsMarkdown;
  delete migratedCard.localizationRequests;

  return migratedCard;
}

export function migrateWorkspaceOwnership(workspace, { ownerSub = null, ownerActor = null } = {}) {
  const nextOwner =
    resolveWorkspaceOwner(workspace, {
      ownerSub,
      ownerActor
    })
    ?? normalizeWorkspaceActor(ownerActor)
    ?? createHumanWorkspaceActor(ownerSub);

  return createWorkspaceOwnership({
    owner: nextOwner
  });
}

export function migrateBoardCollaboration(board, { workspaceOwner = null } = {}) {
  return seedBoardOwnerMembership(normalizeBoardCollaboration(board), {
    ownerActor: workspaceOwner,
    joinedAt: resolveBoardOwnerJoinedAt(board)
  });
}

export function seedBoardOwnerMembership(collaboration, { ownerActor = null, joinedAt = null } = {}) {
  const migratedCollaboration = isPlainObject(collaboration)
    ? {
        memberships: Array.isArray(collaboration.memberships)
          ? collaboration.memberships.map((membership) => structuredClone(membership))
          : [],
        invites: Array.isArray(collaboration.invites) ? collaboration.invites.map((invite) => structuredClone(invite)) : []
      }
    : {
        memberships: [],
        invites: []
      };

  const normalizedOwnerActor = normalizeWorkspaceActor(ownerActor);

  if (shouldReplacePlaceholderMemberships(migratedCollaboration.memberships, normalizedOwnerActor)) {
    migratedCollaboration.memberships = [];
  }

  if (migratedCollaboration.memberships.length > 0) {
    return migratedCollaboration;
  }

  if (!normalizedOwnerActor) {
    return migratedCollaboration;
  }

  migratedCollaboration.memberships.push({
    actor: normalizedOwnerActor,
    role: 'admin',
    ...(joinedAt ? { joinedAt } : {})
  });

  return migratedCollaboration;
}

function migrateLegacyCardLocaleRequests(card) {
  if (isPlainObject(card?.localeRequests)) {
    return normalizeCardLocaleRequests({
      localeRequests: card.localeRequests
    });
  }

  if (isPlainObject(card?.localizationRequests)) {
    return normalizeCardLocaleRequests({
      localeRequests: card.localizationRequests
    });
  }

  return {};
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function resolveStageOrder(board) {
  const rawStageOrder = Array.isArray(board.stageOrder)
    ? board.stageOrder
    : (Array.isArray(board.columnOrder) ? board.columnOrder : []);
  const stageOrder = [];
  const seenStageIds = new Set();

  for (const rawStageId of rawStageOrder) {
    if (typeof rawStageId !== 'string') {
      continue;
    }

    const stageId = rawStageId.trim();

    if (!stageId || seenStageIds.has(stageId)) {
      continue;
    }

    seenStageIds.add(stageId);
    stageOrder.push(stageId);
  }

  return stageOrder.length > 0 ? stageOrder : createDefaultBoardStages().map(({ id }) => id);
}

function resolveLegacyStageMap(board) {
  if (isPlainObject(board.stages)) {
    return board.stages;
  }

  if (isPlainObject(board.columns)) {
    return board.columns;
  }

  return {};
}

function migrateStageDefinition({ stageId, stageOrder, legacyStage, defaultStage }) {
  const normalizedLegacyStage = isPlainObject(legacyStage) ? legacyStage : {};
  const fallbackTransitions = defaultStage?.allowedTransitionStageIds
    ? [...defaultStage.allowedTransitionStageIds]
    : stageOrder.filter((candidateStageId) => candidateStageId !== stageId);

  return {
    id: stageId,
    title:
      typeof normalizedLegacyStage.title === 'string' && normalizedLegacyStage.title.trim()
        ? normalizedLegacyStage.title
        : (defaultStage?.title ?? stageId),
    cardIds: normalizeStringArray(normalizedLegacyStage.cardIds),
    allowedTransitionStageIds: normalizeStringArray(
      normalizedLegacyStage.allowedTransitionStageIds,
      fallbackTransitions
    ).filter((targetStageId) => stageOrder.includes(targetStageId)),
    templateIds: normalizeStringArray(normalizedLegacyStage.templateIds),
    actionIds: Object.prototype.hasOwnProperty.call(normalizedLegacyStage, 'actionIds')
      ? normalizeStringArray(normalizedLegacyStage.actionIds).filter(isValidBoardStageActionId)
      : getDefaultBoardStageActionIds(stageId)
  };
}

function migrateBoardTemplates(templates) {
  if (Array.isArray(templates)) {
    return {
      default: templates.map((template) => structuredClone(template))
    };
  }

  if (isPlainObject(templates) && Array.isArray(templates.default)) {
    return {
      ...structuredClone(templates),
      default: templates.default.map((template) => structuredClone(template))
    };
  }

  return createDefaultBoardTemplates();
}

function migrateBoardLanguagePolicy(policy) {
  const normalizedPolicy = normalizeBoardLanguagePolicy(policy);

  return normalizedPolicy
    ? {
        sourceLocale: normalizedPolicy.sourceLocale,
        defaultLocale: normalizedPolicy.defaultLocale,
        supportedLocales: [...normalizedPolicy.supportedLocales],
        requiredLocales: [...normalizedPolicy.requiredLocales]
      }
    : createDefaultBoardLanguagePolicy();
}

function migrateLocalizedContentVariant(variant, { fallbackTimestamp }) {
  const migratedVariant = isPlainObject(variant) ? structuredClone(variant) : {};

  return {
    ...migratedVariant,
    title: typeof migratedVariant.title === 'string' ? migratedVariant.title : '',
    detailsMarkdown: typeof migratedVariant.detailsMarkdown === 'string' ? migratedVariant.detailsMarkdown : '',
    provenance: normalizeProvenance(migratedVariant.provenance, fallbackTimestamp)
  };
}

function normalizeProvenance(provenance, fallbackTimestamp) {
  if (isPlainObject(provenance)) {
    try {
      return createCardContentProvenance(provenance);
    } catch (error) {
      // Fall through to the deterministic system provenance.
    }
  }

  return createCardContentProvenance({
    actor: {
      type: 'system',
      id: 'legacy-migration'
    },
    timestamp: fallbackTimestamp,
    includesHumanInput: true
  });
}

function hasLegacyCardContent(card) {
  const title = typeof card?.title === 'string' ? card.title.trim() : '';
  const detailsMarkdown = typeof card?.detailsMarkdown === 'string' ? card.detailsMarkdown.trim() : '';

  return title.length > 0 || detailsMarkdown.length > 0;
}

function resolveMigrationTimestamp(card, board, now) {
  return (
    normalizeTimestamp(card?.updatedAt) ??
    normalizeTimestamp(board?.updatedAt) ??
    normalizeTimestamp(now) ??
    '1970-01-01T00:00:00.000Z'
  );
}

function normalizeTimestamp(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  const timestamp = new Date(value);

  if (Number.isNaN(timestamp.getTime())) {
    return null;
  }

  return timestamp.toISOString();
}

function resolveWorkspaceOwner(workspace, { ownerSub = null, ownerActor = null } = {}) {
  const existingOwner =
    normalizeWorkspaceActor(workspace?.ownership?.owner)
    ?? normalizeWorkspaceActor(workspace?.ownership?.actor)
    ?? normalizeWorkspaceActor(workspace?.owner)
    ?? normalizeWorkspaceActor(workspace?.ownerActor);
  const providedOwner =
    normalizeWorkspaceActor(ownerActor)
    ?? createHumanWorkspaceActor(workspace?.ownership?.ownerSub ?? workspace?.ownerSub ?? ownerSub);

  if (providedOwner && isPlaceholderWorkspaceOwner(existingOwner)) {
    return providedOwner;
  }

  return existingOwner ?? providedOwner ?? null;
}

function migrateWorkspaceAccess(workspace) {
  return createWorkspaceAccess({
    kind: normalizeWorkspaceAccessKind(
      workspace?.access?.kind
      ?? workspace?.access?.policy
      ?? workspace?.access?.level
      ?? workspace?.access
      ?? workspace?.accessLevel
      ?? workspace?.visibility
    )
  });
}

function resolveBoardOwnerJoinedAt(board) {
  return normalizeTimestamp(board?.createdAt) ?? normalizeTimestamp(board?.updatedAt) ?? null;
}

function normalizeStringArray(value, fallback = []) {
  const rawValues = Array.isArray(value) ? value : fallback;
  const values = [];
  const seenValues = new Set();

  for (const rawValue of rawValues) {
    if (typeof rawValue !== 'string') {
      continue;
    }

    const normalizedValue = rawValue.trim();

    if (!normalizedValue || seenValues.has(normalizedValue)) {
      continue;
    }

    seenValues.add(normalizedValue);
    values.push(normalizedValue);
  }

  return values;
}

function canonicalizeLocale(value) {
  if (typeof value !== 'string') {
    return null;
  }

  try {
    return Intl.getCanonicalLocales(value.trim().replaceAll('_', '-'))[0] ?? null;
  } catch (error) {
    return null;
  }
}

function normalizeWorkspaceActor(actor) {
  if (!isPlainObject(actor)) {
    return null;
  }

  const type = normalizeOptionalString(actor.type).toLowerCase();
  const id = normalizeOptionalString(actor.id ?? actor.sub);
  const email = normalizeOptionalEmail(actor.email ?? null);
  const displayName = normalizeOptionalString(actor.displayName ?? actor.name ?? null);

  if (!['human', 'agent', 'system'].includes(type) || !id) {
    return null;
  }

  return {
    type,
    id,
    ...(email ? { email } : {}),
    ...(displayName ? { displayName } : {})
  };
}

function createHumanWorkspaceActor(ownerSub) {
  const normalizedOwnerSub = normalizeOptionalString(ownerSub);

  return normalizedOwnerSub
    ? {
        type: 'human',
        id: normalizedOwnerSub
      }
    : null;
}

function isPlaceholderWorkspaceOwner(owner) {
  return owner?.type === 'system';
}

function shouldReplacePlaceholderMemberships(memberships, ownerActor) {
  if (!Array.isArray(memberships) || memberships.length === 0 || ownerActor?.type !== 'human') {
    return false;
  }

  return memberships.every((membership) => membership?.actor?.type === 'system');
}

function normalizeWorkspaceAccessKind(kind) {
  const normalizedKind = normalizeOptionalString(kind).toLowerCase();
  return normalizedKind || null;
}

function normalizeOptionalEmail(value) {
  const normalizedValue = normalizeOptionalString(value).toLowerCase();
  return normalizedValue.includes('@') ? normalizedValue : '';
}

function normalizeOptionalString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeWorkspaceId(workspaceId) {
  return typeof workspaceId === 'string' && workspaceId.trim() ? workspaceId.trim() : WORKSPACE_ID;
}

import { normalizeBoardSchemaInput } from './board_schema.js';
import { canonicalizeBoardRole, normalizeBoardActor } from './board_collaboration.js';
import { PRIORITY_ORDER } from './workspace_read_model.js';
import { validateWorkspaceShape } from './workspace_validation.js';

export const WORKSPACE_COMMAND_TYPES = Object.freeze([
  'board.create',
  'board.update',
  'board.rename',
  'board.delete',
  'board.reset',
  'board.invite.create',
  'board.invite.revoke',
  'board.invite.accept',
  'board.invite.decline',
  'board.member.role.set',
  'board.member.remove',
  'card.create',
  'card.update',
  'card.delete',
  'card.move',
  'ui.activeBoard.set',
  'ui.columnCollapsed.set'
]);

export function isWorkspaceCommandType(type) {
  return WORKSPACE_COMMAND_TYPES.includes(type);
}

export function validateWorkspaceCommand(command) {
  return validateWorkspaceCommandInternal(command).isValid;
}

export function assertValidWorkspaceCommand(command) {
  const validation = validateWorkspaceCommandInternal(command);

  if (!validation.isValid) {
    throw new Error(validation.error);
  }
}

export function validateWorkspaceCommandRequest(request) {
  return validateWorkspaceCommandRequestInternal(request).isValid;
}

export function assertValidWorkspaceCommandRequest(request) {
  const validation = validateWorkspaceCommandRequestInternal(request);

  if (!validation.isValid) {
    throw new Error(validation.error);
  }
}

export function validateWorkspaceCommandResponse(response) {
  return validateWorkspaceCommandResponseInternal(response).isValid;
}

export function assertValidWorkspaceCommandResponse(response) {
  const validation = validateWorkspaceCommandResponseInternal(response);

  if (!validation.isValid) {
    throw new Error(validation.error);
  }
}

function validateWorkspaceCommandInternal(command) {
  if (!isPlainObject(command)) {
    return invalid('Workspace command must be an object.');
  }

  if (!isNonEmptyString(command.clientMutationId)) {
    return invalid('Workspace command clientMutationId is required.');
  }

  if (!isWorkspaceCommandType(command.type)) {
    return invalid(`Invalid workspace command type: ${command.type}`);
  }

  if (!isPlainObject(command.payload)) {
    return invalid('Workspace command payload must be an object.');
  }

  return validatePayload(command.type, command.payload);
}

function validatePayload(type, payload) {
  switch (type) {
    case 'board.create':
      return validateBoardCreatePayload(payload);
    case 'board.update':
      return validateBoardUpdatePayload(payload);
    case 'board.rename':
      return validateBoardScopedTitlePayload(type, payload);
    case 'board.delete':
    case 'board.reset':
    case 'ui.activeBoard.set':
      return requireBoardId(payload, `${type} payload.boardId is required.`);
    case 'board.invite.create':
      return validateBoardInviteCreatePayload(payload);
    case 'board.invite.revoke':
    case 'board.invite.accept':
    case 'board.invite.decline':
      return validateBoardInviteIdentityPayload(type, payload);
    case 'board.member.role.set':
      return validateBoardMemberRoleSetPayload(payload);
    case 'board.member.remove':
      return validateBoardMemberRemovePayload(payload);
    case 'card.create':
      return validateCardCreatePayload(payload);
    case 'card.update':
      return validateCardUpdatePayload(payload);
    case 'card.delete':
      return validateCardIdentityPayload(type, payload);
    case 'card.move':
      return validateCardMovePayload(payload);
    case 'ui.columnCollapsed.set':
      return validateColumnCollapsedPayload(payload);
    default:
      return invalid(`Invalid workspace command type: ${type}`);
  }
}

function validateBoardCreatePayload(payload) {
  const titleValidation = requireNonEmptyString(payload.title, 'board.create payload.title is required.');

  if (!titleValidation.isValid) {
    return titleValidation;
  }

  return validateOptionalBoardSchemaPayload(payload, 'board.create');
}

function validateBoardUpdatePayload(payload) {
  const boardIdValidation = requireBoardId(payload, 'board.update payload.boardId is required.');

  if (!boardIdValidation.isValid) {
    return boardIdValidation;
  }

  const titleValidation = requireNonEmptyString(payload.title, 'board.update payload.title is required.');

  if (!titleValidation.isValid) {
    return titleValidation;
  }

  return validateRequiredBoardSchemaPayload(payload, 'board.update');
}

function validateBoardScopedTitlePayload(type, payload) {
  const boardIdValidation = requireBoardId(payload, `${type} payload.boardId is required.`);

  if (!boardIdValidation.isValid) {
    return boardIdValidation;
  }

  return requireNonEmptyString(payload.title, `${type} payload.title is required.`);
}

function validateBoardInviteCreatePayload(payload) {
  const boardIdValidation = requireBoardId(payload, 'board.invite.create payload.boardId is required.');

  if (!boardIdValidation.isValid) {
    return boardIdValidation;
  }

  const emailValidation = requireInviteEmail(payload?.email, 'board.invite.create payload.email is required.');

  if (!emailValidation.isValid) {
    return emailValidation;
  }

  return requireBoardRole(payload?.role, 'board.invite.create payload.role must be admin, editor, or viewer.');
}

function validateBoardInviteIdentityPayload(type, payload) {
  const boardIdValidation = requireBoardId(payload, `${type} payload.boardId is required.`);

  if (!boardIdValidation.isValid) {
    return boardIdValidation;
  }

  return requireNonEmptyString(payload?.inviteId, `${type} payload.inviteId is required.`);
}

function validateBoardMemberRoleSetPayload(payload) {
  const boardIdValidation = requireBoardId(payload, 'board.member.role.set payload.boardId is required.');

  if (!boardIdValidation.isValid) {
    return boardIdValidation;
  }

  const targetActorValidation = requireTargetActor(
    payload?.targetActor,
    'board.member.role.set payload.targetActor must be a valid actor.'
  );

  if (!targetActorValidation.isValid) {
    return targetActorValidation;
  }

  return requireBoardRole(payload?.role, 'board.member.role.set payload.role must be admin, editor, or viewer.');
}

function validateBoardMemberRemovePayload(payload) {
  const boardIdValidation = requireBoardId(payload, 'board.member.remove payload.boardId is required.');

  if (!boardIdValidation.isValid) {
    return boardIdValidation;
  }

  return requireTargetActor(
    payload?.targetActor,
    'board.member.remove payload.targetActor must be a valid actor.'
  );
}

function validateOptionalBoardSchemaPayload(payload, type) {
  if (!hasBoardSchemaFields(payload)) {
    return valid();
  }

  return validateBoardSchemaPayload(payload, type);
}

function validateRequiredBoardSchemaPayload(payload, type) {
  if (!hasBoardSchemaFields(payload)) {
    return invalid(`${type} payload must include board schema fields.`);
  }

  return validateBoardSchemaPayload(payload, type);
}

function validateBoardSchemaPayload(payload, type) {
  try {
    normalizeBoardSchemaInput({
      languagePolicy: payload.languagePolicy,
      stageDefinitions: payload.stageDefinitions,
      templates: payload.templates
    });
    return valid();
  } catch (error) {
    return invalid(error?.message || `${type} payload schema is invalid.`);
  }
}

function validateCardCreatePayload(payload) {
  const boardIdValidation = requireBoardId(payload, 'card.create payload.boardId is required.');

  if (!boardIdValidation.isValid) {
    return boardIdValidation;
  }

  const titleValidation = requireNonEmptyString(payload.title, 'card.create payload.title is required.');

  if (!titleValidation.isValid) {
    return titleValidation;
  }

  if (payload.detailsMarkdown != null && typeof payload.detailsMarkdown !== 'string') {
    return invalid('card.create payload.detailsMarkdown must be a string when provided.');
  }

  if (payload.priority != null && !isPriority(payload.priority)) {
    return invalid(`card.create payload.priority must be one of: ${PRIORITY_ORDER.join(', ')}`);
  }

  return valid();
}

function validateCardUpdatePayload(payload) {
  const identityValidation = validateCardIdentityPayload('card.update', payload);

  if (!identityValidation.isValid) {
    return identityValidation;
  }

  const hasTitle = Object.prototype.hasOwnProperty.call(payload, 'title');
  const hasDetailsMarkdown = Object.prototype.hasOwnProperty.call(payload, 'detailsMarkdown');
  const hasPriority = Object.prototype.hasOwnProperty.call(payload, 'priority');

  if (!hasTitle && !hasDetailsMarkdown && !hasPriority) {
    return invalid('card.update payload must include at least one supported field.');
  }

  if (hasTitle && !isNonEmptyString(payload.title)) {
    return invalid('card.update payload.title must be a non-empty string when provided.');
  }

  if (hasDetailsMarkdown && typeof payload.detailsMarkdown !== 'string') {
    return invalid('card.update payload.detailsMarkdown must be a string when provided.');
  }

  if (hasPriority && !isPriority(payload.priority)) {
    return invalid(`card.update payload.priority must be one of: ${PRIORITY_ORDER.join(', ')}`);
  }

  return valid();
}

function validateCardIdentityPayload(type, payload) {
  const boardIdValidation = requireBoardId(payload, `${type} payload.boardId is required.`);

  if (!boardIdValidation.isValid) {
    return boardIdValidation;
  }

  return requireNonEmptyString(payload.cardId, `${type} payload.cardId is required.`);
}

function validateCardMovePayload(payload) {
  const identityValidation = validateCardIdentityPayload('card.move', payload);

  if (!identityValidation.isValid) {
    return identityValidation;
  }

  const sourceColumnValidation = requireColumnId(payload.sourceColumnId, 'card.move payload.sourceColumnId is required.');

  if (!sourceColumnValidation.isValid) {
    return sourceColumnValidation;
  }

  return requireColumnId(payload.targetColumnId, 'card.move payload.targetColumnId is required.');
}

function validateColumnCollapsedPayload(payload) {
  const boardIdValidation = requireBoardId(payload, 'ui.columnCollapsed.set payload.boardId is required.');

  if (!boardIdValidation.isValid) {
    return boardIdValidation;
  }

  const columnIdValidation = requireColumnId(
    payload.columnId,
    'ui.columnCollapsed.set payload.columnId is required.'
  );

  if (!columnIdValidation.isValid) {
    return columnIdValidation;
  }

  if (typeof payload.isCollapsed !== 'boolean') {
    return invalid('ui.columnCollapsed.set payload.isCollapsed must be a boolean.');
  }

  return valid();
}

function validateWorkspaceCommandRequestInternal(request) {
  if (!isPlainObject(request)) {
    return invalid('Workspace command request must be an object.');
  }

  const commandValidation = validateWorkspaceCommandInternal(request.command);

  if (!commandValidation.isValid) {
    return commandValidation;
  }

  if (!isNonNegativeInteger(request.expectedRevision)) {
    return invalid('Workspace command request expectedRevision must be a non-negative integer.');
  }

  return valid();
}

function validateWorkspaceCommandResponseInternal(response) {
  if (!isPlainObject(response)) {
    return invalid('Workspace command response must be an object.');
  }

  if (!validateWorkspaceShape(response.workspace)) {
    return invalid('Workspace command response workspace must be a valid workspace snapshot.');
  }

  if (!isPlainObject(response.meta)) {
    return invalid('Workspace command response meta must be an object.');
  }

  if (!isNonNegativeInteger(response.meta.revision)) {
    return invalid('Workspace command response meta.revision must be a non-negative integer.');
  }

  if (response.meta.updatedAt != null && typeof response.meta.updatedAt !== 'string') {
    return invalid('Workspace command response meta.updatedAt must be a string when provided.');
  }

  if (response.meta.lastChangedBy != null && !isPlainObject(response.meta.lastChangedBy)) {
    return invalid('Workspace command response meta.lastChangedBy must be an object when provided.');
  }

  if (response.meta.isPristine != null && typeof response.meta.isPristine !== 'boolean') {
    return invalid('Workspace command response meta.isPristine must be a boolean when provided.');
  }

  if (!isPlainObject(response.result)) {
    return invalid('Workspace command response result must be an object.');
  }

  return valid();
}

function requireBoardId(payload, errorMessage) {
  return requireNonEmptyString(payload?.boardId, errorMessage);
}

function requireBoardRole(value, errorMessage) {
  if (!canonicalizeBoardRole(value)) {
    return invalid(errorMessage);
  }

  return valid();
}

function requireTargetActor(value, errorMessage) {
  if (!normalizeBoardActor(value)) {
    return invalid(errorMessage);
  }

  return valid();
}

function requireInviteEmail(value, errorMessage) {
  if (!isValidEmailLike(value)) {
    return invalid(errorMessage);
  }

  return valid();
}

function hasBoardSchemaFields(payload) {
  return Boolean(
    payload &&
      (
        Object.prototype.hasOwnProperty.call(payload, 'languagePolicy') ||
        Object.prototype.hasOwnProperty.call(payload, 'stageDefinitions') ||
        Object.prototype.hasOwnProperty.call(payload, 'templates')
      )
  );
}

function requireColumnId(value, requiredErrorMessage) {
  return requireNonEmptyString(value, requiredErrorMessage);
}

function requireNonEmptyString(value, errorMessage) {
  if (!isNonEmptyString(value)) {
    return invalid(errorMessage);
  }

  return valid();
}

function isPriority(value) {
  return PRIORITY_ORDER.includes(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function isValidEmailLike(value) {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function valid() {
  return {
    isValid: true,
    error: null
  };
}

function invalid(error) {
  return {
    isValid: false,
    error
  };
}

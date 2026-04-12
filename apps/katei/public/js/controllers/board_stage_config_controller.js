import { Controller } from '../../vendor/stimulus/stimulus.js';
import { getBrowserTranslator } from '../i18n/browser.js';
import { localizeErrorMessage } from '../i18n/errors.js';
import { openDialogWithInitialFocus } from './dialog_initial_focus.js';
import { BOARD_STAGE_PROMPT_RUN_ACTION_ID } from '../domain/board_stage_actions.js';
import { DEFAULT_BOARD_STAGE_REVIEW_APPROVER_ROLE } from '../domain/board_stage_review_policy.js';
import {
  parseStageDefinitions,
  serializeStageReviewPolicies,
  serializeStageDefinitions,
  serializeStagePromptActions,
  validateAndNormalizeStageDefinitionsWithStagePolicies,
  validateAndNormalizeStagePromptActions,
  validateAndNormalizeStageReviewPolicies
} from './board_stage_config_schema.js';
import { closeSheetDialog } from './sheet_dialog.js';

export default class extends Controller {
  static targets = [
    'dialog',
    'definitionsInput',
    'promptActionsInput',
    'promptActionRegion',
    'reviewPoliciesInput',
    'reviewPolicyRegion',
    'error'
  ];

  connect() {
    this.t = getBrowserTranslator();
    this.currentBoard = null;
    this.restoreFocusElement = null;
    this.promptActionDrafts = {};
    this.reviewPolicyDrafts = {};
    this.hideError();
  }

  openFromEvent(event) {
    this.currentBoard = event.detail?.currentBoard ?? null;
    this.restoreFocusElement = event.detail?.triggerElement ?? null;
    this.definitionsInputTarget.value = typeof event.detail?.stageDefinitions === 'string' ? event.detail.stageDefinitions : '';
    this.promptActionsInputTarget.value =
      typeof event.detail?.stagePromptActions === 'string' ? event.detail.stagePromptActions : '';
    this.reviewPoliciesInputTarget.value =
      typeof event.detail?.stageReviewPolicies === 'string' ? event.detail.stageReviewPolicies : '';
    this.promptActionDrafts = this.parseInitialPromptActionDrafts(this.promptActionsInputTarget.value);
    this.reviewPolicyDrafts = this.parseInitialReviewPolicyDrafts(this.reviewPoliciesInputTarget.value);
    this.syncPromptActionRows();
    this.syncReviewPolicyRows();
    this.hideError();

    openDialogWithInitialFocus(this.dialogTarget, this.definitionsInputTarget);
  }

  handleDefinitionsInput() {
    this.syncPromptActionRows();
    this.syncReviewPolicyRows();
    this.hideError();
  }

  handlePromptActionToggle(event) {
    const stageId = normalizeStageId(event.currentTarget?.dataset?.stageId);

    if (!stageId) {
      return;
    }

    this.promptActionDrafts[stageId] = {
      ...this.getPromptActionDraft(stageId),
      enabled: event.currentTarget.checked === true
    };
    this.syncPromptActionRows();
    this.hideError();
  }

  handlePromptActionPromptInput(event) {
    const stageId = normalizeStageId(event.currentTarget?.dataset?.stageId);

    if (!stageId) {
      return;
    }

    this.promptActionDrafts[stageId] = {
      ...this.getPromptActionDraft(stageId),
      prompt: event.currentTarget.value
    };
    this.hideError();
  }

  handlePromptActionTargetStageChange(event) {
    const stageId = normalizeStageId(event.currentTarget?.dataset?.stageId);

    if (!stageId) {
      return;
    }

    this.promptActionDrafts[stageId] = {
      ...this.getPromptActionDraft(stageId),
      targetStageId: event.currentTarget.value
    };
    this.hideError();
  }

  handleReviewPolicyApproverRoleChange(event) {
    const stageId = normalizeStageId(event.currentTarget?.dataset?.stageId);

    if (!stageId) {
      return;
    }

    this.reviewPolicyDrafts[stageId] = {
      ...this.getReviewPolicyDraft(stageId),
      approverRole: normalizeApproverRole(event.currentTarget.value),
      explicit: true
    };
    this.hideError();
  }

  apply(event) {
    event.preventDefault();

    try {
      const parsedStageDefinitions = parseStageDefinitions(this.definitionsInputTarget.value);
      const nextStageDefinitions = this.applyPromptActionTogglesToStageDefinitions(parsedStageDefinitions);
      const stageDefinitions = serializeStageDefinitions(nextStageDefinitions);
      const stagePromptActions = this.buildSerializedPromptActions(nextStageDefinitions);
      const stageReviewPolicies = this.buildSerializedReviewPolicies(nextStageDefinitions);
      const normalizedPromptActions = validateAndNormalizeStagePromptActions(stagePromptActions, nextStageDefinitions);
      const normalizedReviewPolicies = validateAndNormalizeStageReviewPolicies(
        stageReviewPolicies,
        nextStageDefinitions
      );

      validateAndNormalizeStageDefinitionsWithStagePolicies(stageDefinitions, stagePromptActions, stageReviewPolicies, {
        currentBoard: this.currentBoard
      });

      this.promptActionDrafts = {
        ...this.promptActionDrafts,
        ...normalizedPromptActions
      };
      this.reviewPolicyDrafts = mergeNormalizedReviewPolicyDrafts(
        this.reviewPolicyDrafts,
        normalizedReviewPolicies
      );
      this.definitionsInputTarget.value = stageDefinitions;
      this.promptActionsInputTarget.value = serializeStagePromptActions(normalizedPromptActions);
      this.reviewPoliciesInputTarget.value = serializeStageReviewPolicies(normalizedReviewPolicies);
    } catch (error) {
      this.showError(localizeErrorMessage(error, this.t));
      return;
    }

    this.hideError();
    this.closeDialog({ restoreFocus: false });
    window.dispatchEvent(
      new CustomEvent('board-stage-config:apply', {
        detail: {
          stageDefinitions: this.definitionsInputTarget.value,
          stagePromptActions: this.promptActionsInputTarget.value,
          stageReviewPolicies: this.reviewPoliciesInputTarget.value
        }
      })
    );
  }

  close(event) {
    if (event) {
      event.preventDefault();
    }

    this.closeDialog();
  }

  closeDialog({ restoreFocus = true } = {}) {
    closeSheetDialog(this.dialogTarget);

    this.hideError();
    this.currentBoard = null;
    this.promptActionDrafts = {};
    this.reviewPolicyDrafts = {};

    if (restoreFocus && this.restoreFocusElement?.isConnected) {
      this.restoreFocusElement.focus();
    }

    this.restoreFocusElement = null;
  }

  showError(message) {
    if (!this.hasErrorTarget) {
      return;
    }

    this.errorTarget.hidden = false;
    this.errorTarget.textContent = message;
  }

  hideError() {
    if (!this.hasErrorTarget) {
      return;
    }

    this.errorTarget.hidden = true;
    this.errorTarget.textContent = '';
  }

  parseInitialPromptActionDrafts(rawValue) {
    const normalizedValue = String(rawValue ?? '').trim();

    if (!normalizedValue) {
      return {};
    }

    try {
      return JSON.parse(normalizedValue);
    } catch (error) {
      return {};
    }
  }

  parseInitialReviewPolicyDrafts(rawValue) {
    const normalizedValue = String(rawValue ?? '').trim();

    if (!normalizedValue) {
      return {};
    }

    try {
      const parsedValue = JSON.parse(normalizedValue);

      if (!isPlainObject(parsedValue)) {
        return {};
      }

      return Object.fromEntries(
        Object.entries(parsedValue)
          .filter(([stageId, reviewPolicy]) => normalizeStageId(stageId) && isPlainObject(reviewPolicy))
          .map(([stageId, reviewPolicy]) => [
            stageId,
            {
              approverRole: normalizeApproverRole(reviewPolicy.approverRole),
              explicit: true
            }
          ])
      );
    } catch (error) {
      return {};
    }
  }

  getPromptActionDraft(stageId) {
    const currentDraft = this.promptActionDrafts?.[stageId];

    return isPlainObject(currentDraft)
      ? currentDraft
      : {
          enabled: true,
          prompt: '',
          targetStageId: ''
        };
  }

  getReviewPolicyDraft(stageId) {
    const currentDraft = this.reviewPolicyDrafts?.[stageId];

    return {
      approverRole: normalizeApproverRole(currentDraft?.approverRole),
      explicit: currentDraft?.explicit === true
    };
  }

  syncPromptActionRows() {
    if (!this.hasPromptActionRegionTarget) {
      return;
    }

    let stageDefinitions = [];

    try {
      stageDefinitions = parseStageDefinitions(this.definitionsInputTarget.value);
    } catch (error) {
      this.promptActionRegionTarget.innerHTML = '';
      return;
    }

    const stageIds = stageDefinitions.map((stageDefinition) => stageDefinition.id);

    for (const stageDefinition of stageDefinitions) {
      const currentDraft = this.getPromptActionDraft(stageDefinition.id);
      const actionIds = Array.isArray(stageDefinition.actionIds) ? stageDefinition.actionIds : [];
      const hasPromptRunAction = actionIds.includes(BOARD_STAGE_PROMPT_RUN_ACTION_ID);
      const fallbackTargetStageId =
        resolveTargetStageId(currentDraft.targetStageId, stageIds) ?? resolveDefaultTargetStageId(stageIds);

      this.promptActionDrafts[stageDefinition.id] = {
        enabled: hasPromptRunAction ? currentDraft.enabled !== false : false,
        prompt: typeof currentDraft.prompt === 'string' ? currentDraft.prompt : '',
        targetStageId: fallbackTargetStageId ?? ''
      };
    }

    this.promptActionRegionTarget.innerHTML = stageDefinitions
      .map((stageDefinition) => this.renderPromptActionRow(stageDefinition, stageDefinitions))
      .join('');
  }

  syncReviewPolicyRows() {
    if (!this.hasReviewPolicyRegionTarget) {
      return;
    }

    let stageDefinitions = [];

    try {
      stageDefinitions = parseStageDefinitions(this.definitionsInputTarget.value);
    } catch (error) {
      this.reviewPolicyRegionTarget.innerHTML = '';
      return;
    }

    for (const stageDefinition of stageDefinitions) {
      const currentDraft = this.getReviewPolicyDraft(stageDefinition.id);

      this.reviewPolicyDrafts[stageDefinition.id] = {
        approverRole: normalizeApproverRole(currentDraft.approverRole),
        explicit: currentDraft.explicit === true
      };
    }

    this.reviewPolicyRegionTarget.innerHTML = stageDefinitions
      .map((stageDefinition) => this.renderReviewPolicyRow(stageDefinition))
      .join('');
  }

  renderPromptActionRow(stageDefinition, stageDefinitions) {
    const stageId = stageDefinition.id;
    const stageTitle = stageDefinition.title;
    const actionIds = Array.isArray(stageDefinition.actionIds) ? stageDefinition.actionIds : [];
    const hasPromptRunAction = actionIds.includes(BOARD_STAGE_PROMPT_RUN_ACTION_ID);
    const draft = this.getPromptActionDraft(stageId);
    const isEnabled = hasPromptRunAction && draft.enabled !== false;
    const areControlsDisabled = !hasPromptRunAction || !isEnabled;
    const helpKey = !hasPromptRunAction
      ? 'boardStageConfigDialog.promptActionRequiresActionHelp'
      : (isEnabled
          ? 'boardStageConfigDialog.promptActionHelp'
          : 'boardStageConfigDialog.promptActionUncheckedHelp');

    return `
      <section class="paper-panel px-4 py-4 space-y-3" data-stage-id="${escapeHtml(stageId)}">
        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0 space-y-1">
            <p class="field-label text-sm font-semibold">${escapeHtml(stageId)}</p>
            <p class="text-xs leading-5 text-muted">${escapeHtml(stageTitle)}</p>
          </div>
          <label class="flex items-center gap-2 text-sm leading-6 text-strong">
            <input
              type="checkbox"
              data-stage-id="${escapeHtml(stageId)}"
              data-action="change->board-stage-config#handlePromptActionToggle"
              ${hasPromptRunAction ? '' : 'disabled'}
              ${isEnabled ? 'checked' : ''}
            >
            <span>${escapeHtml(this.t('boardStageConfigDialog.promptActionEnableLabel'))}</span>
          </label>
        </div>

        <p class="text-xs leading-5 text-muted">${escapeHtml(this.t(helpKey))}</p>

        <label class="block space-y-2">
          <span class="field-label text-sm font-semibold">${escapeHtml(this.t('boardStageConfigDialog.promptActionTargetStageLabel'))}</span>
          <select
            class="field-control"
            data-stage-id="${escapeHtml(stageId)}"
            data-action="change->board-stage-config#handlePromptActionTargetStageChange"
            ${areControlsDisabled ? 'disabled' : ''}
          >
            ${stageDefinitions.map((targetStageDefinition) => `
              <option
                value="${escapeHtml(targetStageDefinition.id)}"
                ${draft.targetStageId === targetStageDefinition.id ? 'selected' : ''}
              >${escapeHtml(targetStageDefinition.title)} (${escapeHtml(targetStageDefinition.id)})</option>
            `).join('')}
          </select>
        </label>

        <label class="block space-y-2">
          <span class="field-label text-sm font-semibold">${escapeHtml(this.t('boardStageConfigDialog.promptActionPromptLabel'))}</span>
          <textarea
            rows="4"
            class="field-control"
            placeholder="${escapeHtml(this.t('boardStageConfigDialog.promptActionPromptPlaceholder'))}"
            data-stage-id="${escapeHtml(stageId)}"
            data-action="input->board-stage-config#handlePromptActionPromptInput"
            ${areControlsDisabled ? 'disabled' : ''}
          >${escapeHtml(draft.prompt)}</textarea>
        </label>
      </section>
    `;
  }

  renderReviewPolicyRow(stageDefinition) {
    const stageId = stageDefinition.id;
    const stageTitle = stageDefinition.title;
    const actionIds = Array.isArray(stageDefinition.actionIds) ? stageDefinition.actionIds : [];
    const hasReviewAction = actionIds.includes('card.review');
    const draft = this.getReviewPolicyDraft(stageId);
    const helpKey = hasReviewAction
      ? 'boardStageConfigDialog.reviewPolicyHelp'
      : 'boardStageConfigDialog.reviewPolicyRequiresActionHelp';

    return `
      <section class="paper-panel px-4 py-4 space-y-3" data-stage-id="${escapeHtml(stageId)}">
        <div class="min-w-0 space-y-1">
          <p class="field-label text-sm font-semibold">${escapeHtml(stageId)}</p>
          <p class="text-xs leading-5 text-muted">${escapeHtml(stageTitle)}</p>
        </div>

        <p class="text-xs leading-5 text-muted">${escapeHtml(this.t(helpKey))}</p>

        <label class="block space-y-2">
          <span class="field-label text-sm font-semibold">${escapeHtml(this.t('boardStageConfigDialog.reviewPolicyApproverRoleLabel'))}</span>
          <select
            class="field-control"
            data-stage-id="${escapeHtml(stageId)}"
            data-action="change->board-stage-config#handleReviewPolicyApproverRoleChange"
            ${hasReviewAction ? '' : 'disabled'}
          >
            <option
              value="editor"
              ${draft.approverRole === 'editor' ? 'selected' : ''}
            >${escapeHtml(this.t('boardStageConfigDialog.reviewPolicyRoleEditorLabel'))}</option>
            <option
              value="admin"
              ${draft.approverRole === 'admin' ? 'selected' : ''}
            >${escapeHtml(this.t('boardStageConfigDialog.reviewPolicyRoleAdminLabel'))}</option>
          </select>
        </label>
      </section>
    `;
  }

  applyPromptActionTogglesToStageDefinitions(stageDefinitions) {
    return stageDefinitions.map((stageDefinition) => {
      const actionIds = Array.isArray(stageDefinition.actionIds) ? [...stageDefinition.actionIds] : null;
      const promptActionDraft = this.getPromptActionDraft(stageDefinition.id);

      if (
        actionIds?.includes(BOARD_STAGE_PROMPT_RUN_ACTION_ID)
        && promptActionDraft.enabled === false
      ) {
        const nextActionIds = actionIds.filter((actionId) => actionId !== BOARD_STAGE_PROMPT_RUN_ACTION_ID);
        return {
          ...stageDefinition,
          ...(nextActionIds.length > 0 ? { actionIds: nextActionIds } : {})
        };
      }

      return {
        ...stageDefinition,
        ...(actionIds ? { actionIds } : {})
      };
    });
  }

  buildSerializedPromptActions(stageDefinitions) {
    const promptActions = {};
    const validStageIds = stageDefinitions.map((stageDefinition) => stageDefinition.id);

    for (const stageDefinition of stageDefinitions) {
      const actionIds = Array.isArray(stageDefinition.actionIds) ? stageDefinition.actionIds : [];

      if (!actionIds.includes(BOARD_STAGE_PROMPT_RUN_ACTION_ID)) {
        continue;
      }

      const promptActionDraft = this.getPromptActionDraft(stageDefinition.id);

      if (promptActionDraft.enabled === false) {
        continue;
      }

      promptActions[stageDefinition.id] = {
        enabled: true,
        prompt: promptActionDraft.prompt,
        targetStageId:
          resolveTargetStageId(promptActionDraft.targetStageId, validStageIds)
          ?? resolveDefaultTargetStageId(validStageIds)
          ?? ''
      };
    }

    return serializeStagePromptActions(promptActions);
  }

  buildSerializedReviewPolicies(stageDefinitions) {
    const reviewPolicies = {};

    for (const stageDefinition of stageDefinitions) {
      const actionIds = Array.isArray(stageDefinition.actionIds) ? stageDefinition.actionIds : [];

      if (!actionIds.includes('card.review')) {
        continue;
      }

      const reviewPolicyDraft = this.getReviewPolicyDraft(stageDefinition.id);
      const approverRole = normalizeApproverRole(reviewPolicyDraft.approverRole);

      if (!reviewPolicyDraft.explicit && approverRole === DEFAULT_BOARD_STAGE_REVIEW_APPROVER_ROLE) {
        continue;
      }

      reviewPolicies[stageDefinition.id] = {
        approverRole
      };
    }

    return serializeStageReviewPolicies(reviewPolicies);
  }
}

function resolveTargetStageId(targetStageId, validStageIds) {
  const normalizedTargetStageId = normalizeStageId(targetStageId);
  return normalizedTargetStageId && validStageIds.includes(normalizedTargetStageId)
    ? normalizedTargetStageId
    : null;
}

function resolveDefaultTargetStageId(validStageIds) {
  return Array.isArray(validStageIds) && validStageIds.length > 0 ? validStageIds[0] : null;
}

function normalizeStageId(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeApproverRole(value) {
  return value === 'admin' ? 'admin' : DEFAULT_BOARD_STAGE_REVIEW_APPROVER_ROLE;
}

function mergeNormalizedReviewPolicyDrafts(existingDrafts, normalizedReviewPolicies) {
  const nextDrafts = {
    ...(isPlainObject(existingDrafts) ? existingDrafts : {})
  };

  for (const [stageId, reviewPolicy] of Object.entries(normalizedReviewPolicies ?? {})) {
    nextDrafts[stageId] = {
      approverRole: normalizeApproverRole(reviewPolicy?.approverRole),
      explicit: true
    };
  }

  return nextDrafts;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

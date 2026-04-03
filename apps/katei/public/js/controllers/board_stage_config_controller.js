import { Controller } from '../../vendor/stimulus/stimulus.js';
import { getBrowserTranslator } from '../i18n/browser.js';
import { localizeErrorMessage } from '../i18n/errors.js';
import { openDialogWithInitialFocus } from './dialog_initial_focus.js';
import { BOARD_STAGE_PROMPT_RUN_ACTION_ID } from '../domain/board_stage_actions.js';
import {
  parseStageDefinitions,
  serializeStageDefinitions,
  serializeStagePromptActions,
  validateAndNormalizeStageDefinitionsWithPromptActions,
  validateAndNormalizeStagePromptActions
} from './board_stage_config_schema.js';

export default class extends Controller {
  static targets = ['dialog', 'definitionsInput', 'promptActionsInput', 'promptActionRegion', 'error'];

  connect() {
    this.t = getBrowserTranslator();
    this.currentBoard = null;
    this.restoreFocusElement = null;
    this.promptActionDrafts = {};
    this.hideError();
  }

  openFromEvent(event) {
    this.currentBoard = event.detail?.currentBoard ?? null;
    this.restoreFocusElement = event.detail?.triggerElement ?? null;
    this.definitionsInputTarget.value = typeof event.detail?.stageDefinitions === 'string' ? event.detail.stageDefinitions : '';
    this.promptActionsInputTarget.value =
      typeof event.detail?.stagePromptActions === 'string' ? event.detail.stagePromptActions : '';
    this.promptActionDrafts = this.parseInitialPromptActionDrafts(this.promptActionsInputTarget.value);
    this.syncPromptActionRows();
    this.hideError();

    openDialogWithInitialFocus(this.dialogTarget, this.definitionsInputTarget);
  }

  handleDefinitionsInput() {
    this.syncPromptActionRows();
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

  apply(event) {
    event.preventDefault();

    try {
      const parsedStageDefinitions = parseStageDefinitions(this.definitionsInputTarget.value);
      const nextStageDefinitions = this.applyPromptActionTogglesToStageDefinitions(parsedStageDefinitions);
      const stageDefinitions = serializeStageDefinitions(nextStageDefinitions);
      const stagePromptActions = this.buildSerializedPromptActions(nextStageDefinitions);
      const normalizedPromptActions = validateAndNormalizeStagePromptActions(stagePromptActions, nextStageDefinitions);

      validateAndNormalizeStageDefinitionsWithPromptActions(stageDefinitions, stagePromptActions, {
        currentBoard: this.currentBoard
      });

      this.promptActionDrafts = {
        ...this.promptActionDrafts,
        ...normalizedPromptActions
      };
      this.definitionsInputTarget.value = stageDefinitions;
      this.promptActionsInputTarget.value = serializeStagePromptActions(normalizedPromptActions);
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
          stagePromptActions: this.promptActionsInputTarget.value
        }
      })
    );
  }

  backdropClose(event) {
    if (event.target === this.dialogTarget) {
      this.close();
    }
  }

  close(event) {
    if (event) {
      event.preventDefault();
    }

    this.closeDialog();
  }

  closeDialog({ restoreFocus = true } = {}) {
    if (this.dialogTarget.open) {
      this.dialogTarget.close();
    }

    this.hideError();
    this.currentBoard = null;
    this.promptActionDrafts = {};

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

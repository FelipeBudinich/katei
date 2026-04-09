import { Controller } from '../../vendor/stimulus/stimulus.js';
import { getBrowserTranslator } from '../i18n/browser.js';
import {
  getDefaultBoardStageId,
  getStageMoveOptions,
  resolveBoardStageId,
  shouldShowPriorityForStage
} from './stage_ui.js';
import {
  createLocalizedCardEditorUiState,
  resolveCardLocaleSelection
} from './card_editor_locale_view.js';
import { canonicalizeContentLocaleWithLegacyAliases } from '../domain/board_language_policy.js';

const CARD_EDITOR_CODEMIRROR_INPUT_ID = 'card-editor-details-markdown-codemirror-input';

export default class extends Controller {
  static targets = [
    'dialog',
    'form',
    'heading',
    'modeInput',
    'boardIdInput',
    'cardIdInput',
    'sourceStageIdInput',
    'targetStageIdInput',
    'prioritySection',
    'priorityInput',
    'priorityButton',
    'priorityMenu',
    'prioritySelect',
    'priorityOption',
    'titleInput',
    'markdownInput',
    'localeSection',
    'localeSelect',
    'localeSummary',
    'localeFallbackNotice',
    'localeEditSummary',
    'localeReviewState',
    'localeReadOnlyNotice',
    'generateLocaleButton',
    'generateLocaleHelp',
    'discardLocaleButton',
    'requestLocaleButton',
    'clearLocaleRequestButton',
    'verifyLocaleButton',
    'editActions',
    'moveOptionRegion',
    'moveOptionTemplate',
    'submitActions'
  ];

  connect() {
    this.t = getBrowserTranslator();
    this.editor = null;
    this.board = null;
    this.card = null;
    this.mode = 'create';
    this.selectedLocale = null;
    this.isReadOnlyLocaleView = false;
    this.currentActorRole = null;
    this.canEditLocalizedContent = false;
    this.localizedEditorUiState = null;
    this.triggerElement = null;
    this.isGeneratingLocale = false;
    this.pendingGenerateLocale = null;
  }

  disconnect() {
    this.editor?.toTextArea();
    this.editor?.cleanup();
    this.editor = null;
    this.resetDialogState();
  }

  ensureEditor() {
    if (this.editor) {
      return this.editor;
    }

    if (!window.EasyMDE) {
      throw new Error('EasyMDE is unavailable.');
    }

    this.editor = new window.EasyMDE({
      element: this.markdownInputTarget,
      forceSync: true,
      autoRefresh: { delay: 200 },
      autoDownloadFontAwesome: false,
      autosave: { enabled: false },
      status: false,
      spellChecker: false,
      nativeSpellcheck: false,
      toolbar: createMarkdownToolbar(window.EasyMDE, this.t)
    });
    this.ensureEditorInputId(this.editor);

    return this.editor;
  }

  ensureEditorInputId(editor) {
    const inputField = editor?.codemirror?.getInputField?.();

    if (!inputField || inputField.nodeName !== 'TEXTAREA' || inputField.id) {
      return;
    }

    // Give EasyMDE's hidden textarea a stable id for browser autofill audits.
    inputField.id = CARD_EDITOR_CODEMIRROR_INPUT_ID;
  }

  openFromEvent(event) {
    const {
      mode,
      boardId,
      board,
      card,
      stageId,
      columnId,
      requestedLocale,
      locale,
      triggerElement,
      currentActorRole,
      canEditLocalizedContent
    } = event.detail;
    const nextMode = resolveCardDialogMode(mode);
    const isEditMode = nextMode === 'edit';
    const nextStageId =
      resolveBoardStageId(board, { stageId, columnId, cardId: card?.id }) ??
      getDefaultBoardStageId(board);
    const nextCardId = card?.id ?? '';
    const sourceStageId = isEditMode ? nextStageId : '';
    const targetStageId = nextStageId;

    this.formTarget.reset();
    this.board = board ?? null;
    this.card = card ?? null;
    this.mode = nextMode;
    this.currentActorRole = currentActorRole ?? null;
    this.canEditLocalizedContent = Boolean(canEditLocalizedContent);
    this.isReadOnlyLocaleView = nextMode === 'view' || !this.canEditLocalizedContent;
    this.isGeneratingLocale = false;
    this.pendingGenerateLocale = null;
    this.selectedLocale = resolveCardLocaleSelection({
      board,
      preferredLocale: requestedLocale ?? locale,
      uiLocale: this.t.locale
    });
    this.triggerElement = triggerElement ?? this.triggerElement ?? null;
    this.modeInputTarget.value = nextMode;
    this.boardIdInputTarget.value = boardId ?? '';
    this.cardIdInputTarget.value = nextCardId;
    this.sourceStageIdInputTarget.value = sourceStageId;
    this.targetStageIdInputTarget.value = targetStageId;
    this.priorityInputTarget.value = card?.priority ?? 'important';
    this.closePriorityMenu();
    this.ensureEditor().value('');
    this.syncLocalizedCardView();
    this.syncReadOnlyMode();
    this.headingTarget.textContent = this.t(getCardDialogHeadingKey(nextMode));
    this.renderMoveOptions({ board, sourceStageId });
    this.syncPriorityOptions();
    this.syncEditActions({
      isEditMode,
      cardId: nextCardId,
      sourceStageId,
      targetStageId
    });

    if (!this.dialogTarget.open) {
      this.dialogTarget.showModal();
    }

    requestAnimationFrame(() => {
      this.editor?.codemirror?.refresh();

      if (this.isReadOnlyLocaleView && !this.localeSectionTarget.hidden) {
        this.localeSelectTarget.focus();
        return;
      }

      this.titleInputTarget.focus();
    });
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

  closeForAction() {
    this.closeDialog();
  }

  changeLocale(event) {
    event.preventDefault();
    this.selectedLocale =
      canonicalizeContentLocaleWithLegacyAliases(event.currentTarget.value) ??
      this.selectedLocale;
    this.syncLocalizedCardView();
  }

  togglePriorityMenu(event) {
    event.preventDefault();

    if (this.isReadOnlyLocaleView) {
      return;
    }

    if (this.isPriorityMenuOpen()) {
      this.closePriorityMenu();
      return;
    }

    this.openPriorityMenu();
  }

  openPriorityMenu() {
    if (
      !this.hasPriorityButtonTarget ||
      !this.hasPriorityMenuTarget ||
      !this.hasPriorityOptionTarget ||
      this.priorityButtonTarget.disabled === true
    ) {
      return;
    }

    if (this.getPriorityMenuOptions().length < 1) {
      return;
    }

    this.priorityMenuTarget.hidden = false;
    this.priorityButtonTarget.setAttribute('aria-expanded', 'true');
  }

  closePriorityMenu({ restoreFocus = false } = {}) {
    if (this.hasPriorityMenuTarget) {
      this.priorityMenuTarget.hidden = true;
    }

    if (this.hasPriorityButtonTarget) {
      this.priorityButtonTarget.setAttribute('aria-expanded', 'false');

      if (restoreFocus) {
        this.priorityButtonTarget.focus?.();
      }
    }
  }

  handlePriorityTriggerKeydown(event) {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      this.openPriorityMenu();
      this.focusSelectedPriorityMenuOption();
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.openPriorityMenu();
      this.focusSelectedPriorityMenuOption();
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.openPriorityMenu();
      this.focusSelectedPriorityMenuOption();
    }
  }

  handlePriorityMenuKeydown(event) {
    const options = this.getPriorityMenuOptions();

    if (options.length < 1) {
      return;
    }

    const activeIndex = options.findIndex((option) => option === event.target);

    if (event.key === 'Escape') {
      event.preventDefault();
      this.closePriorityMenu({ restoreFocus: true });
      return;
    }

    if (event.key === 'Tab') {
      this.closePriorityMenu();
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.focusPriorityMenuOption(activeIndex >= 0 ? activeIndex + 1 : 0);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.focusPriorityMenuOption(activeIndex >= 0 ? activeIndex - 1 : options.length - 1);
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      this.focusPriorityMenuOption(0);
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      this.focusPriorityMenuOption(options.length - 1);
    }
  }

  handleDialogClick(event) {
    if (!this.isPriorityMenuOpen()) {
      return;
    }

    const target = event?.target ?? null;
    const clickedMenu = this.hasPriorityMenuTarget && this.priorityMenuTarget.contains?.(target);
    const clickedTrigger =
      this.hasPriorityButtonTarget && this.priorityButtonTarget.contains?.(target);

    if (clickedMenu || clickedTrigger) {
      return;
    }

    this.closePriorityMenu();
  }

  changePriorityFromSelect(event) {
    if (this.isReadOnlyLocaleView) {
      return;
    }

    this.setSelectedPriority(event.currentTarget.value);
  }

  selectPriority(event) {
    event.preventDefault();

    if (this.isReadOnlyLocaleView) {
      return;
    }

    const nextPriority = event.currentTarget.dataset.priorityId ?? event.currentTarget.value ?? '';

    this.setSelectedPriority(nextPriority);
    this.closePriorityMenu({ restoreFocus: true });
  }

  selectStage(event) {
    event.preventDefault();

    if (this.isReadOnlyLocaleView) {
      return;
    }

    this.targetStageIdInputTarget.value =
      event.currentTarget.dataset.targetStageId ??
      this.targetStageIdInputTarget.value;
    this.syncEditActions({
      isEditMode: this.modeInputTarget.value === 'edit',
      cardId: this.cardIdInputTarget.value,
      sourceStageId: this.sourceStageIdInputTarget.value,
      targetStageId: this.targetStageIdInputTarget.value
    });
  }

  submit(event) {
    event.preventDefault();

    if (this.isReadOnlyLocaleView) {
      return;
    }

    const formData = new FormData(this.formTarget);

    this.dispatch('save', {
      detail: {
        mode: formData.get('mode'),
        boardId: formData.get('boardId'),
        cardId: formData.get('cardId'),
        locale: this.selectedLocale,
        sourceStageId: formData.get('sourceStageId'),
        targetStageId: formData.get('targetStageId'),
        input: {
          title: formData.get('title'),
          detailsMarkdown: formData.get('detailsMarkdown'),
          priority: formData.get('priority')
        }
      }
    });

    this.closeDialog();
  }

  requestSelectedLocale(event) {
    event.preventDefault();

    if (this.isReadOnlyLocaleView || !this.card || !this.selectedLocale) {
      return;
    }

    this.dispatch('request-locale', {
      detail: {
        mode: this.mode,
        boardId: this.boardIdInputTarget.value,
        cardId: this.cardIdInputTarget.value,
        locale: this.selectedLocale
      }
    });
  }

  clearSelectedLocaleRequest(event) {
    event.preventDefault();

    if (this.isReadOnlyLocaleView || !this.card || !this.selectedLocale) {
      return;
    }

    this.dispatch('clear-locale-request', {
      detail: {
        mode: this.mode,
        boardId: this.boardIdInputTarget.value,
        cardId: this.cardIdInputTarget.value,
        locale: this.selectedLocale
      }
    });
  }

  verifySelectedLocale(event) {
    event.preventDefault();

    if (
      this.isReadOnlyLocaleView ||
      !this.card ||
      !this.selectedLocale ||
      !this.localizedEditorUiState?.canVerifyLocale
    ) {
      return;
    }

    this.dispatch('verify-locale', {
      detail: {
        mode: this.mode,
        boardId: this.boardIdInputTarget.value,
        cardId: this.cardIdInputTarget.value,
        locale: this.selectedLocale
      }
    });
  }

  discardSelectedLocale(event) {
    event.preventDefault();

    if (
      this.isReadOnlyLocaleView ||
      !this.card ||
      !this.selectedLocale ||
      !this.localizedEditorUiState?.showDiscardLocaleButton
    ) {
      return;
    }

    this.dispatch('discard-locale', {
      detail: {
        mode: this.mode,
        boardId: this.boardIdInputTarget.value,
        cardId: this.cardIdInputTarget.value,
        locale: this.selectedLocale,
        triggerElement: event.currentTarget
      }
    });
  }

  generateSelectedLocale(event) {
    event.preventDefault();

    if (
      this.isReadOnlyLocaleView ||
      !this.card ||
      !this.selectedLocale ||
      this.isGeneratingLocale ||
      !this.localizedEditorUiState?.canGenerateLocale
    ) {
      return;
    }

    this.isGeneratingLocale = true;
    this.pendingGenerateLocale = this.selectedLocale;
    this.renderLocaleEditingState(this.localizedEditorUiState);

    this.dispatch('generate-locale', {
      detail: {
        mode: this.mode,
        boardId: this.boardIdInputTarget.value,
        cardId: this.cardIdInputTarget.value,
        locale: this.selectedLocale
      }
    });
  }

  finishLocaleGeneration(event) {
    const detail = event?.detail ?? {};

    if (!this.isGeneratingLocale || !this.pendingGenerateLocale) {
      return;
    }

    if (
      detail.boardId !== this.boardIdInputTarget.value ||
      detail.cardId !== this.cardIdInputTarget.value ||
      detail.locale !== this.pendingGenerateLocale
    ) {
      return;
    }

    this.isGeneratingLocale = false;
    this.pendingGenerateLocale = null;

    if (this.localizedEditorUiState) {
      this.renderLocaleEditingState(this.localizedEditorUiState);
    }
  }

  closeDialog() {
    this.closePriorityMenu();

    if (this.dialogTarget.open) {
      this.dialogTarget.close();
    }

    if (this.triggerElement?.isConnected) {
      this.triggerElement.focus();
    }

    this.resetDialogState();
  }

  syncLocalizedCardView() {
    const localizedView = createLocalizedCardEditorUiState({
      board: this.board,
      card: this.card,
      selectedLocale: this.selectedLocale,
      uiLocale: this.t.locale,
      mode: this.mode,
      currentActorRole: this.currentActorRole,
      canEditLocalizedContent: this.canEditLocalizedContent
    });
    const editableVariant = localizedView.editableVariant ?? localizedView.variant;

    this.localizedEditorUiState = localizedView;
    this.selectedLocale = localizedView.selectedLocale;
    this.titleInputTarget.value = editableVariant?.title ?? '';
    this.ensureEditor().value(editableVariant?.detailsMarkdown ?? '');
    this.renderLocalizedReadSection(localizedView);
  }

  syncReadOnlyMode() {
    const editor = this.ensureEditor();
    this.titleInputTarget.readOnly = this.isReadOnlyLocaleView;
    this.titleInputTarget.required = !this.isReadOnlyLocaleView;
    this.markdownInputTarget.readOnly = this.isReadOnlyLocaleView;
    editor.codemirror?.setOption?.('readOnly', this.isReadOnlyLocaleView);

    if (this.hasSubmitActionsTarget) {
      this.submitActionsTarget.hidden = this.isReadOnlyLocaleView;
    }
  }

  syncPriorityOptions() {
    const selectedPriority = this.priorityInputTarget.value;
    const isDisabled = this.isReadOnlyLocaleView;
    const priorityOptions = this.getPriorityMenuOptions();

    if (this.hasPrioritySelectTarget) {
      this.prioritySelectTarget.value = selectedPriority;
      this.prioritySelectTarget.disabled = isDisabled;
      this.prioritySelectTarget.setAttribute('aria-disabled', String(isDisabled));
    }

    if (this.hasPriorityButtonTarget) {
      this.priorityButtonTarget.disabled = isDisabled;
      this.priorityButtonTarget.setAttribute('aria-disabled', String(isDisabled));
      const selectedOption = priorityOptions.find(
        (option) => option.dataset.priorityId === selectedPriority
      );

      if (selectedOption?.dataset.priorityLabel) {
        this.priorityButtonTarget.title = selectedOption.dataset.priorityLabel;
      }
    }

    if (isDisabled) {
      this.closePriorityMenu();
    }

    priorityOptions.forEach((button, index) => {
      const isCurrentPriority = button.dataset.priorityId === selectedPriority;
      button.disabled = isDisabled;
      button.tabIndex = isCurrentPriority || index === 0 ? 0 : -1;
      button.setAttribute('aria-disabled', String(isDisabled));
      button.setAttribute('aria-checked', String(isCurrentPriority));
    });
  }

  renderMoveOptions({ board, sourceStageId }) {
    const moveOptionButtons = getStageMoveOptions(board, sourceStageId).map(({ id, title }) => {
      const button = this.moveOptionTemplateTarget.content.firstElementChild.cloneNode(true);
      button.dataset.targetStageId = id;
      button.dataset.stageTitle = title;
      button.textContent = title;
      return button;
    });

    this.moveOptionRegionTarget.replaceChildren(...moveOptionButtons);
  }

  syncEditActions({ isEditMode, cardId, sourceStageId, targetStageId }) {
    const shouldShowPrioritySection = shouldShowPriorityForStage(targetStageId);
    const canMutateCard = isEditMode && !this.isReadOnlyLocaleView;

    this.prioritySectionTarget.hidden = !shouldShowPrioritySection;
    this.editActionsTarget.hidden = !canMutateCard;

    if (!shouldShowPrioritySection) {
      this.closePriorityMenu();
    }

    for (const button of this.getMoveOptionButtons()) {
      const buttonTargetStageId = button.dataset.targetStageId;
      const isSelectedStage = buttonTargetStageId === targetStageId;
      const isCurrentStage = buttonTargetStageId === sourceStageId;
      const stageTitle = button.dataset.stageTitle ?? '';
      button.disabled = isSelectedStage;
      button.setAttribute('aria-disabled', String(isSelectedStage));
      button.textContent = isSelectedStage
        ? `${stageTitle} (${this.t(isCurrentStage ? 'cardEditor.moveStateCurrent' : 'cardEditor.moveStateSelected')})`
        : stageTitle;
    }
  }

  renderLocalizedReadSection(localizedView) {
    const shouldShowLocaleSection = Boolean(this.card);
    this.localeSectionTarget.hidden = !shouldShowLocaleSection;

    if (!shouldShowLocaleSection) {
      this.localeSelectTarget.replaceChildren();
      this.localeSummaryTarget.textContent = '';
      this.localeFallbackNoticeTarget.textContent = '';
      this.localeFallbackNoticeTarget.hidden = true;
      this.localeReviewStateTarget.textContent = '';
      this.localeReviewStateTarget.hidden = true;
      this.generateLocaleButtonTarget.hidden = true;
      this.generateLocaleButtonTarget.disabled = true;
      this.generateLocaleButtonTarget.setAttribute('aria-disabled', 'true');
      this.discardLocaleButtonTarget.hidden = true;
      this.verifyLocaleButtonTarget.hidden = true;
      this.generateLocaleHelpTarget.hidden = true;
      this.generateLocaleHelpTarget.textContent = '';
      return;
    }

    this.renderLocaleSelector(localizedView);
    this.renderLocaleSummary(localizedView);
    this.renderFallbackNotice(localizedView.variant, localizedView);
    this.renderLocaleEditingState(localizedView);
  }

  renderLocaleSelector(localizedView) {
    const optionNodes = localizedView.supportedLocales.map((locale) => createLocaleOption(locale));
    this.localeSelectTarget.replaceChildren(...optionNodes);
    this.localeSelectTarget.value = localizedView.selectedLocale ?? '';
  }

  renderLocaleSummary(localizedView) {
    const summaryParts = [];

    if (localizedView.selectedLocale) {
      summaryParts.push(this.t('cardEditor.selectedLocaleValue', { locale: localizedView.selectedLocale }));
    }

    if (localizedView.renderedLocale) {
      summaryParts.push(this.t('cardEditor.renderedLocaleValue', { locale: localizedView.renderedLocale }));
    }

    if (localizedView.isMissingSelectedLocale) {
      summaryParts.push(this.t('cardEditor.selectedLocaleMissing'));
    }

    if (localizedView.noLocalizedContent) {
      summaryParts.push(this.t('cardEditor.noLocalizedContent'));
    }

    summaryParts.push(
      this.t('cardEditor.localizedContentSummary', {
        presentCount: localizedView.presentCount,
        requestedCount: localizedView.requestedCount,
        missingCount: localizedView.missingCount
      })
    );

    this.localeSummaryTarget.textContent = summaryParts.filter(Boolean).join(' · ');
  }

  renderFallbackNotice(variant, localizedView) {
    const shouldShowFallbackNotice =
      Boolean(variant?.locale) &&
      localizedView.isMissingSelectedLocale &&
      localizedView.renderedLocale !== localizedView.selectedLocale;

    this.localeFallbackNoticeTarget.hidden = !shouldShowFallbackNotice;

    if (!shouldShowFallbackNotice) {
      this.localeFallbackNoticeTarget.textContent = '';
      return;
    }

    this.localeFallbackNoticeTarget.textContent = this.t(
      variant?.source === 'legacy'
        ? 'cardEditor.localeFallbackLegacyNotice'
        : 'cardEditor.localeFallbackNotice',
      {
        selectedLocale: localizedView.selectedLocale,
        renderedLocale: localizedView.renderedLocale
      }
    );
  }

  renderLocaleEditingState(localizedView) {
    const localeEditSummaryState = localizedView.localeEditSummaryState;
    const localeReviewState = localizedView.selectedLocaleReviewState;

    this.localeEditSummaryTarget.textContent = localeEditSummaryState
      ? this.t(localeEditSummaryState.key, { locale: localeEditSummaryState.locale })
      : '';
    this.localeReviewStateTarget.hidden = !localizedView.showSelectedLocaleReviewState;
    this.localeReviewStateTarget.textContent = localizedView.showSelectedLocaleReviewState
      ? this.t(`cardEditor.reviewState.${localeReviewState.status}`)
      : '';
    this.localeReadOnlyNoticeTarget.hidden = !localizedView.showReadOnlyNotice;

    if (!this.localeReadOnlyNoticeTarget.hidden) {
      this.localeReadOnlyNoticeTarget.textContent = this.t(
        this.canEditLocalizedContent
          ? 'cardEditor.localeReadOnlyNotice'
          : 'cardEditor.viewerReadOnlyNotice'
      );
    } else {
      this.localeReadOnlyNoticeTarget.textContent = '';
    }

    this.requestLocaleButtonTarget.hidden = !localizedView.showRequestLocaleButton;
    this.clearLocaleRequestButtonTarget.hidden = !localizedView.showClearLocaleRequestButton;
    this.discardLocaleButtonTarget.hidden = !localizedView.showDiscardLocaleButton;
    this.verifyLocaleButtonTarget.hidden = !localizedView.showVerifyLocaleButton;

    const showGenerateLocaleButton = localizedView.showGenerateLocaleButton;
    const isGenerateDisabled = !localizedView.canGenerateLocale || this.isGeneratingLocale;

    this.generateLocaleButtonTarget.hidden = !showGenerateLocaleButton;
    this.generateLocaleButtonTarget.disabled = isGenerateDisabled;
    this.generateLocaleButtonTarget.setAttribute('aria-disabled', String(isGenerateDisabled));
    this.generateLocaleButtonTarget.textContent = this.t(
      this.isGeneratingLocale
        ? 'cardEditor.generatingLocaleButton'
        : 'cardEditor.generateLocaleButton'
    );
    const localeActionHelpKey = localizedView.localeActionHelpKey ?? null;

    this.generateLocaleHelpTarget.hidden = !localeActionHelpKey;
    this.generateLocaleHelpTarget.textContent = localeActionHelpKey
      ? this.t(localeActionHelpKey)
      : '';
  }

  getMoveOptionButtons() {
    return [...this.moveOptionRegionTarget.querySelectorAll('[data-card-editor-target="moveOption"]')];
  }

  isPriorityMenuOpen() {
    return this.hasPriorityMenuTarget && this.priorityMenuTarget.hidden !== true;
  }

  getPriorityMenuOptions() {
    return this.hasPriorityOptionTarget ? this.priorityOptionTargets : [];
  }

  focusPriorityMenuOption(index) {
    const options = this.getPriorityMenuOptions();

    if (options.length < 1) {
      return;
    }

    const boundedIndex = ((index % options.length) + options.length) % options.length;

    options.forEach((option, optionIndex) => {
      option.tabIndex = optionIndex === boundedIndex ? 0 : -1;
    });
    options[boundedIndex]?.focus?.();
  }

  focusSelectedPriorityMenuOption() {
    const options = this.getPriorityMenuOptions();
    const selectedIndex = options.findIndex((option) => option.getAttribute('aria-checked') === 'true');

    this.focusPriorityMenuOption(selectedIndex >= 0 ? selectedIndex : 0);
  }

  setSelectedPriority(priority) {
    if (!priority) {
      return;
    }

    this.priorityInputTarget.value = priority;

    if (this.hasPrioritySelectTarget) {
      this.prioritySelectTarget.value = priority;
    }

    this.syncPriorityOptions();
  }

  resetDialogState() {
    this.board = null;
    this.card = null;
    this.mode = 'create';
    this.selectedLocale = null;
    this.isReadOnlyLocaleView = false;
    this.currentActorRole = null;
    this.canEditLocalizedContent = false;
    this.localizedEditorUiState = null;
    this.triggerElement = null;
    this.isGeneratingLocale = false;
    this.pendingGenerateLocale = null;
  }
}

function createMarkdownToolbar(EasyMDE, t) {
  return [
    createToolbarButton('bold', getToolbarButtonCopy(t, 'bold'), EasyMDE.toggleBold),
    createToolbarButton('italic', getToolbarButtonCopy(t, 'italic'), EasyMDE.toggleItalic),
    createToolbarButton('heading-2', getToolbarButtonCopy(t, 'heading'), EasyMDE.toggleHeading2),
    '|',
    createToolbarButton(
      'unordered-list',
      getToolbarButtonCopy(t, 'bullets'),
      EasyMDE.toggleUnorderedList
    ),
    '|',
    createToolbarButton('code', getToolbarButtonCopy(t, 'code'), EasyMDE.toggleCodeBlock)
  ];
}

function getToolbarButtonCopy(t, key) {
  return {
    text: t(`cardEditor.markdownToolbar.${key}.text`),
    label: t(`cardEditor.markdownToolbar.${key}.label`)
  };
}

function createToolbarButton(name, copy, action, overrides = {}) {
  return {
    name,
    action,
    text: copy.text,
    title: copy.label,
    ...overrides
  };
}

function resolveCardDialogMode(mode) {
  return ['create', 'edit', 'view'].includes(mode) ? mode : 'create';
}

function getCardDialogHeadingKey(mode) {
  if (mode === 'view') {
    return 'cardEditor.viewHeading';
  }

  return mode === 'edit' ? 'cardEditor.editHeading' : 'cardEditor.newHeading';
}

function createLocaleOption(locale) {
  const option = document.createElement('option');
  option.value = locale;
  option.textContent = locale;
  return option;
}

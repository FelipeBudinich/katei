import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceBoard } from '../public/js/domain/workspace_read_model.js';
import {
  getBoardRenderStages,
  getCardRenderState,
  renderBoardState
} from '../public/js/renderers/board_renderer.js';

test('getBoardRenderStages follows board.stageOrder instead of fixed column order', () => {
  const board = createWorkspaceBoard({
    id: 'board_custom',
    title: 'Custom board',
    createdAt: '2026-03-31T10:00:00.000Z',
    updatedAt: '2026-03-31T10:00:00.000Z'
  });

  board.stageOrder = ['review', 'writing', 'published'];
  board.stages = {
    review: {
      id: 'review',
      title: 'Ready for Review',
      cardIds: [],
      allowedTransitionStageIds: ['writing', 'published'],
      templateIds: [],
      actionIds: []
    },
    writing: {
      id: 'writing',
      title: 'Writing',
      cardIds: [],
      allowedTransitionStageIds: ['review', 'published'],
      templateIds: [],
      actionIds: []
    },
    published: {
      id: 'published',
      title: 'Published',
      cardIds: [],
      allowedTransitionStageIds: ['review'],
      templateIds: [],
      actionIds: []
    }
  };

  assert.deepEqual(
    getBoardRenderStages(board).map(({ stageId, stage }) => [stageId, stage.title]),
    [
      ['review', 'Ready for Review'],
      ['writing', 'Writing'],
      ['published', 'Published']
    ]
  );
});

test('getCardRenderState chooses UI-locale content when present', () => {
  const board = createWorkspaceBoard({
    id: 'board_localized',
    title: 'Localized board',
    createdAt: '2026-03-31T10:00:00.000Z',
    updatedAt: '2026-03-31T10:00:00.000Z'
  });
  const card = {
    id: 'card_localized',
    priority: 'important',
    createdAt: '2026-03-31T10:00:00.000Z',
    updatedAt: '2026-03-31T10:30:00.000Z',
    contentByLocale: {
      en: {
        title: 'English title',
        detailsMarkdown: 'English details'
      },
      ja: {
        title: '日本語タイトル',
        detailsMarkdown: '## 日本語本文'
      }
    }
  };

  board.languagePolicy = {
    sourceLocale: 'en',
    defaultLocale: 'en',
    supportedLocales: ['en', 'ja'],
    requiredLocales: ['en']
  };

  const renderState = withMarkdownEnvironment(() => getCardRenderState(board, card, 'ja'));

  assert.deepEqual(renderState, {
    title: '日本語タイトル',
    previewText: '日本語本文'
  });
});

test('getCardRenderState falls back from a regional ui locale to same-language card content', () => {
  const board = createWorkspaceBoard({
    id: 'board_regional_locale',
    title: 'Regional locale board',
    createdAt: '2026-03-31T10:00:00.000Z',
    updatedAt: '2026-03-31T10:00:00.000Z'
  });
  const card = {
    id: 'card_spanish',
    priority: 'important',
    createdAt: '2026-03-31T10:00:00.000Z',
    updatedAt: '2026-03-31T10:30:00.000Z',
    contentByLocale: {
      en: {
        title: 'English title',
        detailsMarkdown: 'English details'
      },
      es: {
        title: 'Titulo en español',
        detailsMarkdown: '## Detalles en español'
      }
    }
  };

  board.languagePolicy = {
    sourceLocale: 'en',
    defaultLocale: 'en',
    supportedLocales: ['en', 'es'],
    requiredLocales: ['en']
  };

  const renderState = withMarkdownEnvironment(() => getCardRenderState(board, card, 'es-CL'));

  assert.deepEqual(renderState, {
    title: 'Titulo en español',
    previewText: 'Detalles en español'
  });
});

test('getCardRenderState renders legacy jp card content for ja ui locale', () => {
  const board = createWorkspaceBoard({
    id: 'board_legacy_jp',
    title: 'Legacy JP board',
    createdAt: '2026-03-31T10:00:00.000Z',
    updatedAt: '2026-03-31T10:00:00.000Z'
  });
  const card = {
    id: 'card_legacy_jp',
    priority: 'important',
    createdAt: '2026-03-31T10:00:00.000Z',
    updatedAt: '2026-03-31T10:30:00.000Z',
    contentByLocale: {
      en: {
        title: 'English title',
        detailsMarkdown: 'English details'
      },
      jp: {
        title: '旧日本語タイトル',
        detailsMarkdown: '## 旧日本語本文'
      }
    }
  };

  board.languagePolicy = {
    sourceLocale: 'en',
    defaultLocale: 'en',
    supportedLocales: ['en', 'jp'],
    requiredLocales: ['en']
  };

  const renderState = withMarkdownEnvironment(() => getCardRenderState(board, card, 'ja'));

  assert.deepEqual(renderState, {
    title: '旧日本語タイトル',
    previewText: '旧日本語本文'
  });
});

test('renderBoardState clears board columns when the actor cannot read the active board', () => {
  const board = createWorkspaceBoard({
    id: 'board_hidden',
    title: 'Hidden board',
    createdAt: '2026-03-31T10:00:00.000Z',
    updatedAt: '2026-03-31T10:00:00.000Z'
  });
  const regions = {
    boardTitle: { textContent: '' },
    desktopColumns: createRegionDouble([Symbol('existing-column')])
  };

  renderBoardState({
    board,
    canReadBoard: false,
    regions,
    templates: {}
  });

  assert.equal(regions.boardTitle.textContent, 'Hidden board');
  assert.equal(regions.desktopColumns.hidden, true);
  assert.deepEqual(regions.desktopColumns.children, []);
});

test('renderBoardState shows stage-local create buttons only for create-enabled editable stages', () => {
  const board = createWorkspaceBoard({
    id: 'board_actions',
    title: 'Action board',
    createdAt: '2026-03-31T10:00:00.000Z',
    updatedAt: '2026-03-31T10:00:00.000Z'
  });
  const regions = {
    boardTitle: { textContent: '' },
    desktopColumns: createRegionDouble()
  };
  const t = Object.assign(
    (key, values = {}) => (key === 'workspace.cardCount' ? String(values.count ?? 0) : key),
    { locale: 'en' }
  );

  renderBoardState({
    board,
    canReadBoard: true,
    canEditBoard: true,
    regions,
    templates: {
      columnTemplate: createColumnTemplateDouble(),
      cardTemplate: createCardTemplateDouble()
    },
    t
  });

  assert.equal(regions.desktopColumns.children[0].createButton.hidden, false);
  assert.equal(regions.desktopColumns.children[0].createButton.disabled, false);
  assert.equal(regions.desktopColumns.children[2].createButton.hidden, true);
  assert.equal(regions.desktopColumns.children[3].createButton.hidden, true);

  renderBoardState({
    board,
    canReadBoard: true,
    canEditBoard: false,
    regions,
    templates: {
      columnTemplate: createColumnTemplateDouble(),
      cardTemplate: createCardTemplateDouble()
    },
    t
  });

  assert.equal(regions.desktopColumns.children[0].createButton.hidden, true);
  assert.equal(regions.desktopColumns.children[0].createButton.disabled, true);
});

test('renderBoardState wires both header toggle buttons for each stage panel', () => {
  const board = createWorkspaceBoard({
    id: 'board_toggle_wiring',
    title: 'Toggle wiring board',
    createdAt: '2026-03-31T10:00:00.000Z',
    updatedAt: '2026-03-31T10:00:00.000Z'
  });
  const regions = {
    boardTitle: { textContent: '' },
    desktopColumns: createRegionDouble()
  };
  const t = Object.assign(
    (key, values = {}) => (key === 'workspace.cardCount' ? String(values.count ?? 0) : key),
    { locale: 'en' }
  );

  renderBoardState({
    board,
    canReadBoard: true,
    canEditBoard: true,
    collapsedColumns: { backlog: true },
    regions,
    templates: {
      columnTemplate: createColumnTemplateDouble(),
      cardTemplate: createCardTemplateDouble()
    },
    t
  });

  const backlogPanel = regions.desktopColumns.children[0];

  assert.equal(backlogPanel.titleToggleElement.dataset.stageId, 'backlog');
  assert.equal(backlogPanel.titleToggleElement.dataset.columnId, 'backlog');
  assert.equal(backlogPanel.titleToggleElement.attributes['aria-expanded'], 'false');
  assert.equal(backlogPanel.titleToggleElement.attributes['aria-controls'], 'column-panel-body-backlog');
  assert.equal(backlogPanel.titleToggleElement.disabled, false);
  assert.equal(backlogPanel.titleToggleElement.attributes['aria-disabled'], 'false');

  assert.equal(backlogPanel.chipToggleElement.dataset.stageId, 'backlog');
  assert.equal(backlogPanel.chipToggleElement.dataset.columnId, 'backlog');
  assert.equal(backlogPanel.chipToggleElement.attributes['aria-expanded'], 'false');
  assert.equal(backlogPanel.chipToggleElement.attributes['aria-controls'], 'column-panel-body-backlog');
  assert.equal(backlogPanel.chipToggleElement.disabled, false);
  assert.equal(backlogPanel.chipToggleElement.attributes['aria-disabled'], 'false');
});

test('renderBoardState does not query a board-card prompt-run button', () => {
  const board = createWorkspaceBoard({
    id: 'board_modal_prompt',
    title: 'Modal prompt board',
    createdAt: '2026-03-31T10:00:00.000Z',
    updatedAt: '2026-03-31T10:00:00.000Z'
  });
  const card = {
    id: 'card_1',
    priority: 'important',
    createdAt: '2026-03-31T10:00:00.000Z',
    updatedAt: '2026-03-31T10:30:00.000Z',
    contentByLocale: {
      en: {
        title: 'English title',
        detailsMarkdown: 'English details'
      }
    }
  };
  const regions = {
    boardTitle: { textContent: '' },
    desktopColumns: createRegionDouble()
  };
  const t = Object.assign(
    (key, values = {}) => (key === 'workspace.cardCount' ? String(values.count ?? 0) : key),
    { locale: 'en' }
  );

  board.stageOrder = ['review'];
  board.stages = {
    review: {
      id: 'review',
      title: 'Ready for Review',
      cardIds: [card.id],
      allowedTransitionStageIds: [],
      templateIds: [],
      actionIds: ['card.prompt.run'],
      promptAction: {
        enabled: true,
        prompt: 'Turn this card into a new implementation task.',
        targetStageId: 'review'
      }
    }
  };
  board.cards = {
    [card.id]: card
  };
  board.languagePolicy = {
    sourceLocale: 'en',
    defaultLocale: 'en',
    supportedLocales: ['en'],
    requiredLocales: ['en']
  };

  withMarkdownEnvironment(() => {
    renderBoardState({
      board,
      canReadBoard: true,
      canEditBoard: true,
      regions,
      templates: {
        columnTemplate: createColumnTemplateDouble(),
        cardTemplate: createInspectableCardTemplateDouble()
      },
      t,
      dateTimeFormatter: {
        format() {
          return 'Apr 1, 2026, 8:00 AM';
        }
      }
    });
  });

  const renderedCard = regions.desktopColumns.children[0].cardsContainer.children[0];

  assert.ok(renderedCard);
  assert.equal(renderedCard.queriedSelectors.includes('[data-card-field="promptRunButton"]'), false);
});

test('renderBoardState does not query a board-card edit button and still wires the toolbar trigger datasets', () => {
  const board = createWorkspaceBoard({
    id: 'board_modal_edit',
    title: 'Modal edit board',
    createdAt: '2026-03-31T10:00:00.000Z',
    updatedAt: '2026-03-31T10:00:00.000Z'
  });
  const card = {
    id: 'card_1',
    priority: 'important',
    createdAt: '2026-03-31T10:00:00.000Z',
    updatedAt: '2026-03-31T10:30:00.000Z',
    contentByLocale: {
      en: {
        title: 'English title',
        detailsMarkdown: 'English details'
      }
    }
  };
  const regions = {
    boardTitle: { textContent: '' },
    desktopColumns: createRegionDouble()
  };
  const t = Object.assign(
    (key, values = {}) => (key === 'workspace.cardCount' ? String(values.count ?? 0) : key),
    { locale: 'en' }
  );

  board.stageOrder = ['review'];
  board.stages = {
    review: {
      id: 'review',
      title: 'Ready for Review',
      cardIds: [card.id],
      allowedTransitionStageIds: [],
      templateIds: [],
      actionIds: []
    }
  };
  board.cards = {
    [card.id]: card
  };
  board.languagePolicy = {
    sourceLocale: 'en',
    defaultLocale: 'en',
    supportedLocales: ['en'],
    requiredLocales: ['en']
  };

  withMarkdownEnvironment(() => {
    renderBoardState({
      board,
      canReadBoard: true,
      canEditBoard: true,
      regions,
      templates: {
        columnTemplate: createColumnTemplateDouble(),
        cardTemplate: createInspectableCardTemplateDouble()
      },
      t,
      dateTimeFormatter: {
        format() {
          return 'Apr 1, 2026, 8:00 AM';
        }
      }
    });
  });

  const renderedCard = regions.desktopColumns.children[0].cardsContainer.children[0];

  assert.ok(renderedCard);
  assert.equal(renderedCard.queriedSelectors.includes('[data-card-field="editButton"]'), false);
  assert.deepEqual(renderedCard.toolbarTrigger.dataset, {
    cardId: card.id,
    stageId: 'review',
    columnId: 'review'
  });
});

test('renderBoardState preserves unchanged stage panel DOM nodes across unrelated updates', () => {
  const board = createWorkspaceBoard({
    id: 'board_identity_stage',
    title: 'Identity board',
    createdAt: '2026-03-31T10:00:00.000Z',
    updatedAt: '2026-03-31T10:00:00.000Z'
  });
  const regions = {
    boardTitle: { textContent: '' },
    desktopColumns: createRegionDouble()
  };
  const t = Object.assign(
    (key, values = {}) => (key === 'workspace.cardCount' ? String(values.count ?? 0) : key),
    { locale: 'en' }
  );

  board.cards.card_backlog = createCardRecord({
    id: 'card_backlog',
    title: 'Backlog card',
    detailsMarkdown: 'Backlog details'
  });
  board.stages.backlog.cardIds = ['card_backlog'];
  board.languagePolicy = {
    sourceLocale: 'en',
    defaultLocale: 'en',
    supportedLocales: ['en'],
    requiredLocales: ['en']
  };

  withMarkdownEnvironment(() => {
    renderBoardState({
      board,
      canReadBoard: true,
      canEditBoard: true,
      regions,
      templates: {
        columnTemplate: createColumnTemplateDouble(),
        cardTemplate: createCardTemplateDouble()
      },
      t,
      dateTimeFormatter: createDateTimeFormatterDouble()
    });

    const backlogPanelBefore = regions.desktopColumns.children[0];
    const initialReplaceChildrenCalls = regions.desktopColumns.replaceChildrenCalls;

    board.title = 'Identity board renamed';

    renderBoardState({
      board,
      canReadBoard: true,
      canEditBoard: true,
      regions,
      templates: {
        columnTemplate: createColumnTemplateDouble(),
        cardTemplate: createCardTemplateDouble()
      },
      t,
      dateTimeFormatter: createDateTimeFormatterDouble()
    });

    assert.equal(regions.desktopColumns.children[0], backlogPanelBefore);
    assert.equal(regions.desktopColumns.replaceChildrenCalls, initialReplaceChildrenCalls);
  });
});

test('renderBoardState preserves unchanged card DOM nodes across unrelated updates', () => {
  const board = createWorkspaceBoard({
    id: 'board_identity_card',
    title: 'Identity board',
    createdAt: '2026-03-31T10:00:00.000Z',
    updatedAt: '2026-03-31T10:00:00.000Z'
  });
  const regions = {
    boardTitle: { textContent: '' },
    desktopColumns: createRegionDouble()
  };
  const t = Object.assign(
    (key, values = {}) => (key === 'workspace.cardCount' ? String(values.count ?? 0) : key),
    { locale: 'en' }
  );

  board.cards.card_backlog = createCardRecord({
    id: 'card_backlog',
    title: 'Backlog card',
    detailsMarkdown: 'Backlog details'
  });
  board.stages.backlog.cardIds = ['card_backlog'];
  board.languagePolicy = {
    sourceLocale: 'en',
    defaultLocale: 'en',
    supportedLocales: ['en'],
    requiredLocales: ['en']
  };

  withMarkdownEnvironment(() => {
    renderBoardState({
      board,
      canReadBoard: true,
      canEditBoard: true,
      regions,
      templates: {
        columnTemplate: createColumnTemplateDouble(),
        cardTemplate: createCardTemplateDouble()
      },
      t,
      dateTimeFormatter: createDateTimeFormatterDouble()
    });

    const backlogCardBefore = regions.desktopColumns.children[0].cardsContainer.children[0];

    board.title = 'Identity board renamed';

    renderBoardState({
      board,
      canReadBoard: true,
      canEditBoard: true,
      regions,
      templates: {
        columnTemplate: createColumnTemplateDouble(),
        cardTemplate: createCardTemplateDouble()
      },
      t,
      dateTimeFormatter: createDateTimeFormatterDouble()
    });

    assert.equal(regions.desktopColumns.children[0].cardsContainer.children[0], backlogCardBefore);
  });
});

test('renderBoardState skips preview recompute for unchanged cards on rerender', () => {
  const board = createWorkspaceBoard({
    id: 'board_preview_cache',
    title: 'Preview board',
    createdAt: '2026-03-31T10:00:00.000Z',
    updatedAt: '2026-03-31T10:00:00.000Z'
  });
  const regions = {
    boardTitle: { textContent: '' },
    desktopColumns: createRegionDouble()
  };
  const t = Object.assign(
    (key, values = {}) => (key === 'workspace.cardCount' ? String(values.count ?? 0) : key),
    { locale: 'en' }
  );
  const tracker = createMarkdownTracker();

  board.cards.card_backlog = createCardRecord({
    id: 'card_backlog',
    title: 'Backlog card',
    detailsMarkdown: 'Backlog details'
  });
  board.stages.backlog.cardIds = ['card_backlog'];
  board.languagePolicy = {
    sourceLocale: 'en',
    defaultLocale: 'en',
    supportedLocales: ['en'],
    requiredLocales: ['en']
  };

  withMarkdownEnvironment(() => {
    renderBoardState({
      board,
      canReadBoard: true,
      canEditBoard: true,
      regions,
      templates: {
        columnTemplate: createColumnTemplateDouble(),
        cardTemplate: createCardTemplateDouble()
      },
      t,
      dateTimeFormatter: createDateTimeFormatterDouble()
    });

    board.title = 'Preview board renamed';

    renderBoardState({
      board,
      canReadBoard: true,
      canEditBoard: true,
      regions,
      templates: {
        columnTemplate: createColumnTemplateDouble(),
        cardTemplate: createCardTemplateDouble()
      },
      t,
      dateTimeFormatter: createDateTimeFormatterDouble()
    });
  }, { tracker });

  assert.equal(tracker.parseCount, 1);
  assert.equal(tracker.sanitizeCount, 1);
  assert.equal(tracker.createElementCount, 1);
});

function withMarkdownEnvironment(action, { tracker = createMarkdownTracker() } = {}) {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;

  globalThis.window = {
    marked: {
      parse(markdown) {
        tracker.parseCount += 1;
        return String(markdown ?? '')
          .replace(/^#{1,6}\s+/gm, '')
          .replace(/\*\*(.*?)\*\*/g, '$1');
      }
    },
    DOMPurify: {
      sanitize(value) {
        tracker.sanitizeCount += 1;
        return String(value ?? '');
      }
    }
  };
  globalThis.document = {
    createElement() {
      tracker.createElementCount += 1;
      let textContent = '';

      return {
        set innerHTML(value) {
          textContent = String(value ?? '').replace(/<[^>]*>/g, ' ');
        },
        get textContent() {
          return textContent;
        }
      };
    }
  };

  try {
    return action();
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  }
}

function createRegionDouble(initialChildren = []) {
  const region = {
    dataset: {},
    hidden: false,
    children: [],
    replaceChildrenCalls: 0,
    appendChild(node) {
      appendChildToContainer(this, node);
    },
    insertBefore(node, referenceNode) {
      insertBeforeInContainer(this, node, referenceNode);
    },
    replaceChildren(...nodes) {
      this.replaceChildrenCalls += 1;
      this.children = [];

      for (const node of nodes) {
        appendChildToContainer(this, node);
      }
    }
  };

  for (const child of initialChildren) {
    appendChildToContainer(region, child);
  }

  return region;
}

function createColumnTemplateDouble() {
  return {
    content: {
      firstElementChild: {
        cloneNode() {
          return createColumnPanelDouble();
        }
      }
    }
  };
}

function createCardTemplateDouble() {
  return {
    content: {
      firstElementChild: {
        cloneNode() {
          return createCardNodeDouble();
        }
      }
    }
  };
}

function createInspectableCardTemplateDouble() {
  return {
    content: {
      firstElementChild: {
        cloneNode() {
          return createInspectableCardNodeDouble();
        }
      }
    }
  };
}

function createInspectableCardNodeDouble() {
  return createCardNodeDouble({ inspectQueries: true });
}

function createCardNodeDouble({ inspectQueries = false } = {}) {
  const queriedSelectors = [];
  const titleElement = { textContent: '' };
  const previewElement = {
    textContent: '',
    hidden: false,
    classList: {
      toggle(className, isHidden) {
        if (className === 'hidden') {
          previewElement.hidden = Boolean(isHidden);
        }
      }
    }
  };
  const metaElement = { textContent: '' };
  const toolbarTrigger = { dataset: {} };
  const cardNode = {
    dataset: {},
    parentNode: null,
    toolbarTrigger,
    queriedSelectors,
    querySelector(selector) {
      if (inspectQueries) {
        queriedSelectors.push(selector);
      }

      switch (selector) {
        case '[data-card-field="title"]':
          return titleElement;
        case '[data-card-field="preview"]':
          return previewElement;
        case '[data-card-field="meta"]':
          return metaElement;
        case '[data-card-field="promptRunButton"]':
          return null;
        default:
          return null;
      }
    },
    querySelectorAll(selector) {
      if (selector === '[data-card-id]') {
        return [toolbarTrigger];
      }

      if (selector === '[data-column-id], [data-stage-id]') {
        return [toolbarTrigger];
      }

      return [];
    },
    remove() {
      removeChildFromContainer(this.parentNode, this);
    }
  };

  return cardNode;
}

function createColumnPanelDouble() {
  const titleElement = { textContent: '' };
  const countElement = { textContent: '' };
  const countChipElement = {
    attributes: {},
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    }
  };
  const titleToggleElement = {
    dataset: {},
    disabled: false,
    attributes: {},
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    }
  };
  const chipToggleElement = {
    dataset: {},
    disabled: false,
    attributes: {},
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    }
  };
  const toggleElements = [titleToggleElement, chipToggleElement];
  const createButton = {
    dataset: {},
    hidden: true,
    disabled: true,
    attributes: {},
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    }
  };
  const bodyElement = {
    id: '',
    hidden: false
  };
  const cardsContainer = createContainerDouble();
  const columnPanel = {
    dataset: {},
    parentNode: null,
    titleToggleElement,
    chipToggleElement,
    toggleElements,
    createButton,
    bodyElement,
    cardsContainer,
    querySelector(selector) {
      switch (selector) {
        case '[data-column-field="title"]':
          return titleElement;
        case '[data-column-field="count"]':
          return countElement;
        case '.count-chip':
          return countChipElement;
        case '[data-column-toggle]':
          return titleToggleElement;
        case '[data-column-create]':
          return createButton;
        case '.column-panel-body':
          return bodyElement;
        case '[data-column-cards]':
          return cardsContainer;
        default:
          return null;
      }
    },
    querySelectorAll(selector) {
      if (selector === '[data-column-toggle]') {
        return toggleElements;
      }

      return [];
    },
    remove() {
      removeChildFromContainer(this.parentNode, this);
    }
  };

  cardsContainer.parentNode = columnPanel;

  return columnPanel;
}

function createContainerDouble() {
  return {
    dataset: {},
    children: [],
    parentNode: null,
    appendChild(node) {
      appendChildToContainer(this, node);
    },
    insertBefore(node, referenceNode) {
      insertBeforeInContainer(this, node, referenceNode);
    }
  };
}

function appendChildToContainer(container, node) {
  if (!container || node == null) {
    return;
  }

  removeChildFromContainer(node?.parentNode ?? null, node);
  container.children.push(node);

  if (node && typeof node === 'object') {
    node.parentNode = container;
  }
}

function insertBeforeInContainer(container, node, referenceNode) {
  if (!container || node == null) {
    return;
  }

  removeChildFromContainer(node?.parentNode ?? null, node);

  const insertionIndex = referenceNode == null ? -1 : container.children.indexOf(referenceNode);

  if (insertionIndex === -1) {
    container.children.push(node);
  } else {
    container.children.splice(insertionIndex, 0, node);
  }

  if (node && typeof node === 'object') {
    node.parentNode = container;
  }
}

function removeChildFromContainer(container, node) {
  if (!container || !Array.isArray(container.children)) {
    return;
  }

  const childIndex = container.children.indexOf(node);

  if (childIndex >= 0) {
    container.children.splice(childIndex, 1);
  }

  if (node && typeof node === 'object') {
    node.parentNode = null;
  }
}

function createCardRecord({ id, title, detailsMarkdown }) {
  return {
    id,
    priority: 'important',
    createdAt: '2026-03-31T10:00:00.000Z',
    updatedAt: '2026-03-31T10:30:00.000Z',
    contentByLocale: {
      en: {
        title,
        detailsMarkdown
      }
    }
  };
}

function createDateTimeFormatterDouble() {
  return {
    format() {
      return 'Apr 1, 2026, 8:00 AM';
    }
  };
}

function createMarkdownTracker() {
  return {
    createElementCount: 0,
    parseCount: 0,
    sanitizeCount: 0
  };
}

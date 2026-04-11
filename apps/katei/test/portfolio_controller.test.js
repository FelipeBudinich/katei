import test from 'node:test';
import assert from 'node:assert/strict';
import { createTranslator } from '../public/js/i18n/translate.js';
import PortfolioController from '../public/js/controllers/portfolio_controller.js';

test('portfolio controller dispatches the shared profile options event with the trigger element', () => {
  withMockDocument(() => {
    const controller = createPortfolioControllerDouble({
      workspaceId: 'workspace_alpha',
      workspaceTitle: 'Studio HQ'
    });
    const triggerElement = createButtonElement();
    const dispatchedEvents = [];

    controller.browserWindow.dispatchEvent = (event) => {
      dispatchedEvents.push(event);
      return true;
    };

    PortfolioController.prototype.openProfileOptions.call(controller, {
      currentTarget: triggerElement
    });

    assert.equal(dispatchedEvents.length, 1);
    assert.equal(dispatchedEvents[0].type, 'workspace:open-profile-options');
    assert.equal(dispatchedEvents[0].detail?.triggerElement, triggerElement);
  });
});

test('portfolio controller opens the workspace title dialog with the current title prefilled', () => {
  withMockDocument(() => {
    const controller = createPortfolioControllerDouble({
      workspaceId: 'workspace_alpha',
      workspaceTitle: 'Studio HQ'
    });
    let prevented = false;

    PortfolioController.prototype.openRenameDialog.call(controller, {
      currentTarget: controller.renameButtons[0],
      preventDefault() {
        prevented = true;
      }
    });

    assert.equal(prevented, true);
    assert.equal(controller.dialogTarget.open, true);
    assert.equal(controller.dialogTarget.showModalCalls, 1);
    assert.equal(controller.headingTarget.textContent, 'Edit workspace title');
    assert.equal(controller.titleInputTarget.value, 'Studio HQ');
    assert.equal(controller.titleInputTarget.focusCalls, 1);
    assert.equal(controller.restoreFocusElement, controller.renameButtons[0]);
  });
});

test('portfolio controller saves an assigned workspace title and updates every visible workspace label', async () => {
  await withMockDocument(async () => {
    const controller = createPortfolioControllerDouble({
      workspaceId: 'workspace_alpha',
      workspaceTitle: '',
      extraWorkspaceLabels: [
        createWorkspaceLabelElement('workspace_beta', 'Partner workspace')
      ]
    });
    const serviceCalls = [];

    controller.service = {
      async setWorkspaceTitle(workspaceId, title) {
        serviceCalls.push({ workspaceId, title });
        return {
          workspaceId,
          workspaceTitle: 'Studio HQ'
        };
      }
    };
    controller.currentWorkspaceId = 'workspace_alpha';
    controller.currentWorkspaceFallbackLabel = 'workspace_alpha';
    controller.restoreFocusElement = controller.renameButtons[0];
    controller.dialogTarget.open = true;
    controller.titleInputTarget.value = 'Studio HQ';

    await PortfolioController.prototype.saveWorkspaceTitle.call(controller, {
      preventDefault() {}
    });

    assert.deepEqual(serviceCalls, [
      {
        workspaceId: 'workspace_alpha',
        title: 'Studio HQ'
      }
    ]);
    assert.deepEqual(
      controller.workspaceLabelElements.map((element) => element.textContent),
      ['Studio HQ', 'Studio HQ', 'Partner workspace']
    );
    assert.equal(controller.renameButtons[0].dataset.workspaceTitle, 'Studio HQ');
    assert.equal(controller.renameButtons[0].textContent, 'Edit title');
    assert.equal(controller.dialogTarget.open, false);
    assert.equal(controller.dialogTarget.closeCalls, 1);
    assert.equal(controller.renameButtons[0].focusCalls, 1);
    assert.equal(controller.announcerTarget.textContent, 'Workspace title saved.');
  });
});

test('portfolio controller cancel closes the dialog, restores focus, and does not keep unsaved draft text', () => {
  withMockDocument(() => {
    const controller = createPortfolioControllerDouble({
      workspaceId: 'workspace_alpha',
      workspaceTitle: 'Studio HQ'
    });

    PortfolioController.prototype.openRenameDialog.call(controller, {
      currentTarget: controller.renameButtons[0],
      preventDefault() {}
    });
    controller.titleInputTarget.value = 'Draft title';

    PortfolioController.prototype.close.call(controller, {
      preventDefault() {}
    });

    assert.equal(controller.dialogTarget.open, false);
    assert.equal(controller.renameButtons[0].focusCalls, 1);

    PortfolioController.prototype.openRenameDialog.call(controller, {
      currentTarget: controller.renameButtons[0],
      preventDefault() {}
    });

    assert.equal(controller.titleInputTarget.value, 'Studio HQ');
  });
});

test('portfolio controller clears a workspace title back to the workspaceId fallback', async () => {
  await withMockDocument(async () => {
    const controller = createPortfolioControllerDouble({
      workspaceId: 'workspace_alpha',
      workspaceTitle: 'Studio HQ'
    });
    const serviceCalls = [];

    controller.service = {
      async setWorkspaceTitle(workspaceId, title) {
        serviceCalls.push({ workspaceId, title });
        return {
          workspaceId,
          workspaceTitle: null
        };
      }
    };
    controller.currentWorkspaceId = 'workspace_alpha';
    controller.currentWorkspaceFallbackLabel = 'workspace_alpha';
    controller.restoreFocusElement = controller.renameButtons[0];
    controller.dialogTarget.open = true;
    controller.titleInputTarget.value = '   ';

    await PortfolioController.prototype.saveWorkspaceTitle.call(controller, {
      preventDefault() {}
    });

    assert.deepEqual(serviceCalls, [
      {
        workspaceId: 'workspace_alpha',
        title: '   '
      }
    ]);
    assert.deepEqual(
      controller.workspaceLabelElements.map((element) => element.textContent),
      ['workspace_alpha', 'workspace_alpha']
    );
    assert.equal(controller.renameButtons[0].dataset.workspaceTitle, '');
    assert.equal(controller.renameButtons[0].textContent, 'Assign title');
  });
});

test('portfolio controller saves a board self-role, updates the current role, and enables open board access', async () => {
  await withMockDocument(async () => {
    const controller = createPortfolioControllerDouble({
      workspaceId: 'workspace_alpha',
      workspaceTitle: 'Studio HQ',
      boardRoleRows: [
        {
          workspaceId: 'workspace_alpha',
          boardId: 'main',
          boardTitle: 'Executive roadmap',
          currentRole: 'none'
        }
      ]
    });
    const serviceCalls = [];
    const roleForm = controller.boardRoleForms[0];
    const roleSelect = roleForm.elements.select;

    controller.service = {
      async setBoardSelfRole(boardId, role, options) {
        serviceCalls.push({ boardId, role, options });
        return {
          boards: {
            main: {
              collaboration: {
                memberships: [
                  {
                    actor: { type: 'human', id: 'sub_123' },
                    role: 'viewer',
                    joinedAt: '2026-04-07T09:00:00.000Z'
                  }
                ]
              }
            }
          }
        };
      }
    };
    roleSelect.value = 'viewer';
    PortfolioController.prototype.handleBoardSelfRoleInput.call(controller, {
      currentTarget: roleForm,
      target: roleSelect
    });

    await PortfolioController.prototype.saveBoardSelfRole.call(controller, {
      currentTarget: roleForm,
      preventDefault() {}
    });

    assert.deepEqual(serviceCalls, [
      {
        boardId: 'main',
        role: 'viewer',
        options: {
          workspaceId: 'workspace_alpha'
        }
      }
    ]);
    assert.equal(roleForm.dataset.currentRole, 'viewer');
    assert.equal(
      roleForm.elements.currentRoleValue.textContent,
      'Current role: Viewer'
    );
    assert.equal(roleSelect.value, 'viewer');
    assert.equal(roleForm.elements.error.hidden, true);
    assert.equal(roleForm.elements.openHint.hidden, true);
    assert.equal(roleForm.elements.openLink.attributes['aria-disabled'], 'false');
    assert.equal(roleForm.elements.openLink.className.includes('portfolio-link-disabled'), false);
    assert.equal(roleForm.elements.saveButton.disabled, false);
    assert.equal(roleForm.elements.saveButton.textContent, 'Save role');
    assert.equal(
      controller.announcerTarget.textContent,
      'Executive roadmap: role saved as Viewer.'
    );
  });
});

test('portfolio controller shows an inline error when a board self-role save fails', async () => {
  await withMockDocument(async () => {
    const controller = createPortfolioControllerDouble({
      workspaceId: 'workspace_alpha',
      workspaceTitle: 'Studio HQ',
      boardRoleRows: [
        {
          workspaceId: 'workspace_alpha',
          boardId: 'main',
          boardTitle: 'Executive roadmap',
          currentRole: 'none'
        }
      ]
    });
    const roleForm = controller.boardRoleForms[0];
    const roleSelect = roleForm.elements.select;

    controller.service = {
      async setBoardSelfRole() {
        throw new Error('Unable to save board role.');
      }
    };
    const originalConsoleError = console.error;

    console.error = () => {};
    roleSelect.value = 'editor';
    PortfolioController.prototype.handleBoardSelfRoleInput.call(controller, {
      currentTarget: roleForm,
      target: roleSelect
    });

    try {
      await PortfolioController.prototype.saveBoardSelfRole.call(controller, {
        currentTarget: roleForm,
        preventDefault() {}
      });
    } finally {
      console.error = originalConsoleError;
    }

    assert.equal(roleForm.dataset.currentRole, 'none');
    assert.equal(roleForm.elements.currentRoleValue.textContent, 'Current role: No board role');
    assert.equal(roleForm.elements.error.hidden, false);
    assert.equal(roleForm.elements.error.textContent, 'Unable to save board role.');
    assert.equal(roleForm.elements.openHint.hidden, false);
    assert.equal(roleForm.elements.openLink.attributes['aria-disabled'], 'true');
    assert.equal(roleForm.elements.saveButton.disabled, false);
    assert.equal(roleForm.elements.saveButton.textContent, 'Save role');
  });
});

function createPortfolioControllerDouble({
  workspaceId,
  workspaceTitle,
  extraWorkspaceLabels = [],
  boardRoleRows = []
}) {
  const controller = Object.create(PortfolioController.prototype);
  const renameButton = createRenameButtonElement(workspaceId, workspaceTitle);
  const workspaceLabelElements = [
    createWorkspaceLabelElement(workspaceId, workspaceTitle || workspaceId),
    createWorkspaceLabelElement(workspaceId, workspaceTitle || workspaceId),
    ...extraWorkspaceLabels
  ];
  const boardRoleForms = boardRoleRows.map((row) => createBoardRoleFormElement(row));

  controller.t = createTranslator('en');
  controller.hasViewerSuperAdminValue = true;
  controller.viewerSuperAdminValue = true;
  controller.hasViewerSubValue = true;
  controller.viewerSubValue = 'sub_123';
  controller.service = null;
  controller.browserWindow = {
    document: globalThis.document,
    fetch: async () => {
      throw new Error('fetch should not be called in this test');
    }
  };
  controller.restoreFocusElement = null;
  controller.currentWorkspaceId = null;
  controller.currentWorkspaceFallbackLabel = null;
  controller.isSubmitting = false;
  controller.renameButtons = [renameButton];
  controller.workspaceLabelElements = workspaceLabelElements;
  controller.boardRoleForms = boardRoleForms;
  Object.defineProperty(controller, 'element', {
    configurable: true,
    value: {
      querySelectorAll(selector) {
        if (selector === '[data-portfolio-workspace-id]') {
          return workspaceLabelElements;
        }

        if (selector === '[data-portfolio-action="rename-workspace-title"]') {
          return [renameButton];
        }

        if (selector === '[data-portfolio-board-role-form]') {
          return boardRoleForms;
        }

        return [];
      }
    }
  });

  controller.dialogTarget = createDialogTarget();
  controller.headingTarget = createTextTarget();
  controller.titleInputTarget = createInputTarget();
  controller.errorTarget = createErrorTarget();
  controller.saveButtonTarget = createButtonElement();
  controller.cancelButtonTarget = createButtonElement();
  controller.closeButtonTarget = createButtonElement();
  controller.announcerTarget = createTextTarget();
  controller.hasDialogTarget = true;
  controller.hasHeadingTarget = true;
  controller.hasTitleInputTarget = true;
  controller.hasErrorTarget = true;
  controller.hasSaveButtonTarget = true;
  controller.hasCancelButtonTarget = true;
  controller.hasCloseButtonTarget = true;
  controller.hasAnnouncerTarget = true;

  PortfolioController.prototype.resetDialogState.call(controller);
  PortfolioController.prototype.syncBoardSelfRoleForms.call(controller);

  return controller;
}

function createDialogTarget() {
  return {
    open: false,
    showModalCalls: 0,
    closeCalls: 0,
    matches(selector) {
      return selector === 'dialog.sheet-dialog';
    },
    showModal() {
      this.open = true;
      this.showModalCalls += 1;
    },
    close() {
      this.open = false;
      this.closeCalls += 1;
    }
  };
}

function createRenameButtonElement(workspaceId, workspaceTitle = '') {
  const button = createButtonElement();

  button.dataset = {
    portfolioAction: 'rename-workspace-title',
    workspaceId,
    workspaceTitle,
    workspaceFallbackLabel: workspaceId
  };
  button.textContent = workspaceTitle ? 'Edit title' : 'Assign title';

  return button;
}

function createWorkspaceLabelElement(workspaceId, textContent = workspaceId) {
  return {
    dataset: {
      portfolioField: 'workspace-label',
      portfolioWorkspaceId: workspaceId,
      portfolioWorkspaceFallbackLabel: workspaceId
    },
    textContent
  };
}

function createBoardRoleFormElement({
  workspaceId,
  boardId,
  boardTitle,
  currentRole = 'none'
}) {
  const normalizedCurrentRole = currentRole === 'none' ? 'none' : currentRole;
  const currentRoleLabel = normalizedCurrentRole === 'none'
    ? 'Current role: No board role'
    : `Current role: ${capitalize(normalizedCurrentRole)}`;
  const select = createSelectElement(normalizedCurrentRole === 'none' ? '' : normalizedCurrentRole);
  const saveButton = createButtonElement();
  const error = createErrorTarget();
  const currentRoleValue = createTextTarget();
  const openHint = {
    hidden: normalizedCurrentRole !== 'none',
    textContent: 'Assign yourself a role to open this board.'
  };
  const openLink = createAnchorElement({
    href: `/boards?workspaceId=${workspaceId}&boardId=${boardId}`,
    disabled: normalizedCurrentRole === 'none'
  });

  currentRoleValue.textContent = currentRoleLabel;
  saveButton.textContent = 'Save role';
  saveButton.disabled = normalizedCurrentRole === 'none';

  const elements = {
    currentRoleValue,
    select,
    saveButton,
    error,
    openHint,
    openLink
  };

  return {
    dataset: {
      portfolioBoardRoleForm: '',
      workspaceId,
      boardId,
      boardTitle,
      currentRole: normalizedCurrentRole,
      submitting: 'false'
    },
    elements,
    querySelector(selector) {
      switch (selector) {
        case '[data-portfolio-field="board-self-role-current-value"]':
          return currentRoleValue;
        case '[data-portfolio-field="board-self-role-select"]':
          return select;
        case '[data-portfolio-field="board-self-role-save"]':
          return saveButton;
        case '[data-portfolio-field="board-self-role-error"]':
          return error;
        case '[data-portfolio-field="board-open-hint"]':
          return openHint;
        case '[data-portfolio-open-board-link]':
          return openLink;
        default:
          return null;
      }
    }
  };
}

function createButtonElement() {
  return {
    dataset: {},
    disabled: false,
    focusCalls: 0,
    isConnected: true,
    textContent: '',
    focus() {
      this.focusCalls += 1;
    }
  };
}

function createSelectElement(value = '') {
  return {
    value,
    disabled: false
  };
}

function createAnchorElement({ href, disabled = false }) {
  return {
    href,
    className: disabled ? 'touch-button-secondary portfolio-link-disabled' : 'touch-button-secondary',
    attributes: {
      href,
      'aria-disabled': disabled ? 'true' : 'false',
      ...(disabled ? { tabindex: '-1' } : {})
    },
    getAttribute(name) {
      return this.attributes[name] ?? null;
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    removeAttribute(name) {
      delete this.attributes[name];
    }
  };
}

function createInputTarget() {
  return {
    value: '',
    disabled: false,
    focusCalls: 0,
    isConnected: true,
    focus() {
      this.focusCalls += 1;
      if (globalThis.document) {
        globalThis.document.activeElement = this;
      }
    }
  };
}

function createTextTarget() {
  return {
    textContent: '',
    dataset: {}
  };
}

function createErrorTarget() {
  return {
    hidden: true,
    textContent: ''
  };
}

async function withMockDocument(callback) {
  const originalDocument = globalThis.document;

  globalThis.document = {
    activeElement: null
  };

  try {
    return await callback();
  } finally {
    globalThis.document = originalDocument;
  }
}

function capitalize(value) {
  return typeof value === 'string' && value.length > 0
    ? `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`
    : value;
}

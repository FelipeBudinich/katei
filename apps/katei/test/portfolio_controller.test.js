import test from 'node:test';
import assert from 'node:assert/strict';
import { createTranslator } from '../public/js/i18n/translate.js';
import PortfolioController from '../public/js/controllers/portfolio_controller.js';

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

function createPortfolioControllerDouble({
  workspaceId,
  workspaceTitle,
  extraWorkspaceLabels = []
}) {
  const controller = Object.create(PortfolioController.prototype);
  const renameButton = createRenameButtonElement(workspaceId, workspaceTitle);
  const workspaceLabelElements = [
    createWorkspaceLabelElement(workspaceId, workspaceTitle || workspaceId),
    createWorkspaceLabelElement(workspaceId, workspaceTitle || workspaceId),
    ...extraWorkspaceLabels
  ];

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

  return controller;
}

function createDialogTarget() {
  return {
    open: false,
    showModalCalls: 0,
    closeCalls: 0,
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
    textContent: ''
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

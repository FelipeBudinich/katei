const SHEET_DIALOG_SELECTOR = 'dialog.sheet-dialog';
const OPEN_SHEET_DIALOG_SELECTOR = `${SHEET_DIALOG_SELECTOR}[open]`;
const SHEET_DIALOG_LOCK_CLASS = 'sheet-dialog-open';
const SHEET_DIALOG_CLOSE_LISTENER_KEY = Symbol('sheet-dialog-close-listener');
const lockStateByDocument = new WeakMap();

export function openSheetDialog(dialog, options = {}) {
  if (!isSheetDialog(dialog)) {
    return false;
  }

  registerSheetDialogCloseListener(dialog);

  if (!dialog.open && typeof dialog.showModal === 'function') {
    dialog.showModal();
  }

  syncSheetDialogScrollLock(resolveEnvironment(dialog, options));
  return true;
}

export function closeSheetDialog(dialog, options = {}) {
  if (!isSheetDialog(dialog)) {
    return false;
  }

  if (dialog.open && typeof dialog.close === 'function') {
    dialog.close();
  }

  syncSheetDialogScrollLock(resolveEnvironment(dialog, options));
  return true;
}

export function syncSheetDialogScrollLock(
  {
    documentRef = globalThis.document,
    windowRef = documentRef?.defaultView ?? globalThis.window
  } = {}
) {
  if (!documentRef?.documentElement || !documentRef?.body) {
    return false;
  }

  const openDialogs = getOpenSheetDialogs(documentRef);

  if (openDialogs.length > 0) {
    applySheetDialogScrollLock(documentRef, windowRef);
    return true;
  }

  releaseSheetDialogScrollLock(documentRef);
  return false;
}

function isSheetDialog(dialog) {
  return Boolean(dialog && typeof dialog.matches === 'function' && dialog.matches(SHEET_DIALOG_SELECTOR));
}

function registerSheetDialogCloseListener(dialog) {
  if (dialog?.[SHEET_DIALOG_CLOSE_LISTENER_KEY] || typeof dialog?.addEventListener !== 'function') {
    return;
  }

  const listener = () => {
    syncSheetDialogScrollLock(resolveEnvironment(dialog));
  };

  dialog.addEventListener('close', listener);
  dialog[SHEET_DIALOG_CLOSE_LISTENER_KEY] = listener;
}

function resolveEnvironment(
  dialog,
  {
    documentRef = dialog?.ownerDocument ?? globalThis.document,
    windowRef = documentRef?.defaultView ?? globalThis.window
  } = {}
) {
  return { documentRef, windowRef };
}

function getOpenSheetDialogs(documentRef) {
  if (typeof documentRef?.querySelectorAll !== 'function') {
    return [];
  }

  return Array.from(documentRef.querySelectorAll(OPEN_SHEET_DIALOG_SELECTOR));
}

function applySheetDialogScrollLock(documentRef, windowRef) {
  const body = documentRef.body;
  const documentElement = documentRef.documentElement;
  let lockState = lockStateByDocument.get(documentRef);

  if (!lockState) {
    lockState = {
      scrollY: getScrollY(windowRef),
      windowRef,
      bodyInlineStyles: captureBodyInlineStyles(body)
    };
    lockStateByDocument.set(documentRef, lockState);

    body.style.position = 'fixed';
    body.style.top = `-${lockState.scrollY}px`;
    body.style.left = '0';
    body.style.right = '0';
    body.style.width = '100%';
    body.style.paddingRight = computeLockedBodyPaddingRight(body, windowRef, documentElement);
  }

  documentElement.classList?.add(SHEET_DIALOG_LOCK_CLASS);
  body.classList?.add(SHEET_DIALOG_LOCK_CLASS);
}

function releaseSheetDialogScrollLock(documentRef) {
  const body = documentRef.body;
  const documentElement = documentRef.documentElement;
  const lockState = lockStateByDocument.get(documentRef);

  documentElement.classList?.remove(SHEET_DIALOG_LOCK_CLASS);
  body.classList?.remove(SHEET_DIALOG_LOCK_CLASS);

  if (!lockState) {
    return;
  }

  restoreBodyInlineStyles(body, lockState.bodyInlineStyles);
  lockStateByDocument.delete(documentRef);

  if (typeof lockState.windowRef?.scrollTo === 'function') {
    lockState.windowRef.scrollTo(0, lockState.scrollY);
  }
}

function captureBodyInlineStyles(body) {
  return {
    position: body.style.position,
    top: body.style.top,
    left: body.style.left,
    right: body.style.right,
    width: body.style.width,
    paddingRight: body.style.paddingRight
  };
}

function restoreBodyInlineStyles(body, bodyInlineStyles = {}) {
  body.style.position = bodyInlineStyles.position ?? '';
  body.style.top = bodyInlineStyles.top ?? '';
  body.style.left = bodyInlineStyles.left ?? '';
  body.style.right = bodyInlineStyles.right ?? '';
  body.style.width = bodyInlineStyles.width ?? '';
  body.style.paddingRight = bodyInlineStyles.paddingRight ?? '';
}

function computeLockedBodyPaddingRight(body, windowRef, documentElement) {
  const scrollbarCompensation = computeScrollbarCompensation(windowRef, documentElement);

  if (scrollbarCompensation <= 0) {
    return '';
  }

  return `${getBodyPaddingRight(body, windowRef) + scrollbarCompensation}px`;
}

function computeScrollbarCompensation(windowRef, documentElement) {
  const innerWidth = Number(windowRef?.innerWidth);
  const clientWidth = Number(documentElement?.clientWidth);

  if (!Number.isFinite(innerWidth) || !Number.isFinite(clientWidth)) {
    return 0;
  }

  return Math.max(innerWidth - clientWidth, 0);
}

function getBodyPaddingRight(body, windowRef) {
  const computedStyle = typeof windowRef?.getComputedStyle === 'function'
    ? windowRef.getComputedStyle(body)
    : null;
  const paddingRightValue = computedStyle?.paddingRight ?? body?.style?.paddingRight ?? '';
  const paddingRight = Number.parseFloat(paddingRightValue);

  return Number.isFinite(paddingRight) ? paddingRight : 0;
}

function getScrollY(windowRef) {
  const scrollY = Number(windowRef?.scrollY ?? windowRef?.pageYOffset ?? 0);

  return Number.isFinite(scrollY) ? scrollY : 0;
}

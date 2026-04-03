const DEFAULT_FOCUS_OPTIONS = Object.freeze({
  preventScroll: true
});

export function openDialogWithInitialFocus(dialog, target, options = {}) {
  if (!dialog?.open && typeof dialog?.showModal === 'function') {
    dialog.showModal();
  }

  focusDialogTarget(dialog, target, options);
}

export function focusDialogTarget(
  dialog,
  target,
  {
    documentRef = globalThis.document,
    queueMicrotaskImpl = globalThis.queueMicrotask,
    setTimeoutImpl = globalThis.setTimeout,
    focusOptions = DEFAULT_FOCUS_OPTIONS
  } = {}
) {
  if (!target || typeof target.focus !== 'function') {
    return;
  }

  if (!isFocusAttemptAllowed(dialog, target)) {
    return;
  }

  if (attemptFocus(target, { documentRef, focusOptions })) {
    return;
  }

  const scheduleTimeoutRetry = () => {
    if (typeof setTimeoutImpl !== 'function') {
      return;
    }

    setTimeoutImpl(() => {
      if (!isFocusAttemptAllowed(dialog, target) || isActiveElement(target, documentRef)) {
        return;
      }

      attemptFocus(target, { documentRef, focusOptions });
    }, 0);
  };

  const runMicrotaskRetry = () => {
    if (!isFocusAttemptAllowed(dialog, target) || isActiveElement(target, documentRef)) {
      return;
    }

    if (!attemptFocus(target, { documentRef, focusOptions })) {
      scheduleTimeoutRetry();
    }
  };

  if (typeof queueMicrotaskImpl === 'function') {
    queueMicrotaskImpl(runMicrotaskRetry);
    return;
  }

  scheduleTimeoutRetry();
}

function attemptFocus(target, { documentRef, focusOptions }) {
  try {
    target.focus(focusOptions);
  } catch (error) {
    target.focus();
  }

  return isActiveElement(target, documentRef);
}

function isFocusAttemptAllowed(dialog, target) {
  return Boolean(dialog?.open) && target?.isConnected !== false;
}

function isActiveElement(target, documentRef) {
  return documentRef?.activeElement === target;
}

export function normalizeCapturedArtifacts({
  consoleEntries = [],
  pageErrors = [],
  failedRequests = [],
  selectorSnapshots = {}
} = {}) {
  return {
    consoleEntries: normalizeEntryArray(consoleEntries),
    pageErrors: normalizeEntryArray(pageErrors),
    failedRequests: normalizeEntryArray(failedRequests),
    selectorSnapshots: normalizeSelectorSnapshotMap(selectorSnapshots)
  };
}

export function normalizeSelectorSnapshotMap(snapshotMap = {}) {
  if (!snapshotMap || typeof snapshotMap !== 'object' || Array.isArray(snapshotMap)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(snapshotMap)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([label, snapshot]) => [label, normalizeSelectorSnapshot(snapshot)])
  );
}

export function createArtifactStamp(now = new Date()) {
  return now.toISOString().replace(/[:.]/g, '-');
}

export function sanitizeArtifactLabel(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'artifact';
}

function normalizeEntryArray(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(entry)
        .filter(([, value]) => value !== undefined)
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    );
  });
}

function normalizeSelectorSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return {
      selector: '',
      count: 0,
      visible: false,
      text: ''
    };
  }

  return {
    selector: typeof snapshot.selector === 'string' ? snapshot.selector : '',
    count: Number.isInteger(snapshot.count) ? snapshot.count : 0,
    visible: Boolean(snapshot.visible),
    text: typeof snapshot.text === 'string' ? snapshot.text : ''
  };
}

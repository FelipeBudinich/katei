export function isAllowedGoogleSub(sub, allowedSubs = new Set()) {
  if (!(allowedSubs instanceof Set) || allowedSubs.size === 0) {
    return true;
  }

  return allowedSubs.has(sub);
}


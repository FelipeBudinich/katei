const BOARD_ROLES = Object.freeze(['admin', 'editor', 'viewer']);
const BOARD_INVITE_STATUSES = Object.freeze(['accepted', 'pending', 'revoked', 'expired']);

export function createBoardCollaboration({ creator = null, joinedAt = null } = {}) {
  const collaboration = {
    memberships: [],
    invites: []
  };
  const actor = normalizeActor(creator);

  if (!actor) {
    return collaboration;
  }

  const membership = {
    actor,
    role: 'admin'
  };
  const normalizedJoinedAt = normalizeOptionalIsoTimestamp(joinedAt);

  if (normalizedJoinedAt) {
    membership.joinedAt = normalizedJoinedAt;
  }

  collaboration.memberships.push(membership);

  return collaboration;
}

export function normalizeBoardCollaboration(board) {
  const memberships = [];
  const invites = [];
  const seenActors = new Set();
  const seenInviteIds = new Set();
  const rawMemberships = readBoardMemberships(board);
  const rawInvites = readBoardInvites(board);

  for (const membership of Array.isArray(rawMemberships) ? rawMemberships : []) {
    const normalizedMembership = normalizeBoardMembership(membership);

    if (!normalizedMembership || seenActors.has(normalizedMembership.actorKey)) {
      continue;
    }

    seenActors.add(normalizedMembership.actorKey);
    memberships.push(stripActorKey(normalizedMembership));
  }

  for (const invite of Array.isArray(rawInvites) ? rawInvites : []) {
    const normalizedInvite = normalizeBoardInvite(invite);

    if (!normalizedInvite || seenInviteIds.has(normalizedInvite.id)) {
      continue;
    }

    seenInviteIds.add(normalizedInvite.id);
    invites.push(normalizedInvite);
  }

  return {
    memberships,
    invites
  };
}

export function canonicalizeBoardRole(role) {
  const normalizedRole = normalizeOptionalString(role).toLowerCase();
  return BOARD_ROLES.includes(normalizedRole) ? normalizedRole : null;
}

export function validateBoardMemberships(board) {
  const memberships = readBoardMemberships(board);

  if (memberships == null) {
    return true;
  }

  if (!Array.isArray(memberships)) {
    return false;
  }

  const seenActors = new Set();

  for (const membership of memberships) {
    const normalizedMembership = normalizeBoardMembership(membership);

    if (!normalizedMembership || seenActors.has(normalizedMembership.actorKey)) {
      return false;
    }

    seenActors.add(normalizedMembership.actorKey);
  }

  return true;
}

export function validateBoardInvites(board) {
  const invites = readBoardInvites(board);

  if (invites == null) {
    return true;
  }

  if (!Array.isArray(invites)) {
    return false;
  }

  const seenInviteIds = new Set();

  for (const invite of invites) {
    const normalizedInvite = normalizeBoardInvite(invite);

    if (!normalizedInvite || seenInviteIds.has(normalizedInvite.id)) {
      return false;
    }

    seenInviteIds.add(normalizedInvite.id);
  }

  return true;
}

export function listPendingBoardInvites(board) {
  const invites = readBoardInvites(board);

  if (!Array.isArray(invites)) {
    return [];
  }

  return invites
    .map((invite) => normalizeBoardInvite(invite))
    .filter((invite) => invite?.status === 'pending')
    .map((invite) => structuredClone(invite));
}

function normalizeBoardMembership(membership) {
  if (!isPlainObject(membership)) {
    return null;
  }

  const actor = normalizeActor(membership.actor);
  const role = canonicalizeBoardRole(membership.role);
  const invitedBy = membership.invitedBy == null ? null : normalizeActor(membership.invitedBy);

  if (!actor || !role || (membership.invitedBy != null && !invitedBy)) {
    return null;
  }

  const joinedAt = normalizeOptionalIsoTimestamp(membership.joinedAt);

  if (membership.joinedAt != null && !joinedAt) {
    return null;
  }

  return {
    actor,
    role,
    ...(joinedAt ? { joinedAt } : {}),
    ...(invitedBy ? { invitedBy } : {}),
    actorKey: createActorKey(actor)
  };
}

function normalizeBoardInvite(invite) {
  if (!isPlainObject(invite)) {
    return null;
  }

  const id = normalizeOptionalString(invite.id);
  const role = canonicalizeBoardRole(invite.role);
  const status = canonicalizeBoardInviteStatus(invite.status);
  const targetActor = normalizeActor(invite.actor ?? invite.invitee ?? null);
  const targetEmail = normalizeEmail(invite.email ?? invite.inviteeEmail ?? null);
  const invitedBy = invite.invitedBy == null ? null : normalizeActor(invite.invitedBy);

  if (!id || !role || !status || (!targetActor && !targetEmail) || (invite.invitedBy != null && !invitedBy)) {
    return null;
  }

  if (invite.invitedAt != null && !isIsoTimestamp(invite.invitedAt)) {
    return null;
  }

  if (invite.respondedAt != null && !isIsoTimestamp(invite.respondedAt)) {
    return null;
  }

  if (invite.expiresAt != null && !isIsoTimestamp(invite.expiresAt)) {
    return null;
  }

  return {
    id,
    role,
    status,
    ...(targetActor ? { actor: targetActor } : {}),
    ...(targetEmail ? { email: targetEmail } : {}),
    ...(invitedBy ? { invitedBy } : {}),
    ...(invite.invitedAt != null ? { invitedAt: new Date(invite.invitedAt).toISOString() } : {}),
    ...(invite.respondedAt != null ? { respondedAt: new Date(invite.respondedAt).toISOString() } : {}),
    ...(invite.expiresAt != null ? { expiresAt: new Date(invite.expiresAt).toISOString() } : {})
  };
}

function canonicalizeBoardInviteStatus(status) {
  const normalizedStatus = normalizeOptionalString(status).toLowerCase();
  return BOARD_INVITE_STATUSES.includes(normalizedStatus) ? normalizedStatus : null;
}

function normalizeActor(actor) {
  if (!isPlainObject(actor)) {
    return null;
  }

  const type = normalizeOptionalString(actor.type).toLowerCase();
  const id = normalizeOptionalString(actor.id);
  const email = normalizeEmail(actor.email ?? null);
  const displayName = normalizeOptionalString(actor.displayName ?? actor.name ?? null);

  if (!['human', 'agent', 'system'].includes(type) || !id) {
    return null;
  }

  return {
    type,
    id,
    ...(email ? { email } : {}),
    ...(displayName ? { displayName } : {})
  };
}

function createActorKey(actor) {
  return `${actor.type}:${actor.id}`;
}

function readBoardMemberships(board) {
  if (Array.isArray(board?.collaboration?.memberships)) {
    return board.collaboration.memberships;
  }

  if (board?.collaboration?.memberships != null) {
    return board.collaboration.memberships;
  }

  if (Array.isArray(board?.memberships)) {
    return board.memberships;
  }

  if (board?.memberships != null) {
    return board.memberships;
  }

  return null;
}

function readBoardInvites(board) {
  if (Array.isArray(board?.collaboration?.invites)) {
    return board.collaboration.invites;
  }

  if (board?.collaboration?.invites != null) {
    return board.collaboration.invites;
  }

  if (Array.isArray(board?.invites)) {
    return board.invites;
  }

  if (board?.invites != null) {
    return board.invites;
  }

  return null;
}

function normalizeEmail(value) {
  const normalizedValue = normalizeOptionalString(value).toLowerCase();
  return normalizedValue.includes('@') ? normalizedValue : null;
}

function isIsoTimestamp(value) {
  return typeof value === 'string' && !Number.isNaN(new Date(value).getTime());
}

function normalizeOptionalIsoTimestamp(value) {
  return isIsoTimestamp(value) ? new Date(value).toISOString() : null;
}

function normalizeOptionalString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function stripActorKey(membership) {
  const normalizedMembership = {
    ...membership
  };

  delete normalizedMembership.actorKey;

  return normalizedMembership;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

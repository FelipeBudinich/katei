export function createBoardLifecycleTitles(config, { now = new Date() } = {}) {
  const titlePrefix = String(config?.titlePrefix ?? '').trim() || 'Codex Board Smoke';
  const editedTitleSuffix = String(config?.editedTitleSuffix ?? '').trim() || 'Edited';
  const uniqueSuffix = now.toISOString().replace(/\D/g, '').slice(0, 14);
  const createdTitle = `${titlePrefix} ${uniqueSuffix}`.trim();

  return {
    createdTitle,
    editedTitle: appendTitleSuffix(createdTitle, editedTitleSuffix)
  };
}

export function buildEditedStageDefinitions(stageDefinitions, titleSuffix = 'Edited') {
  const normalizedSuffix = String(titleSuffix ?? '').trim() || 'Edited';
  const normalizedStageDefinitions = Array.isArray(stageDefinitions) ? stageDefinitions : [];

  if (normalizedStageDefinitions.length === 0) {
    throw new Error('Stage definitions are required to build an edited board schema.');
  }

  return normalizedStageDefinitions.map((line, index) => {
    if (index !== 0) {
      return String(line);
    }

    const segments = String(line)
      .split('|')
      .map((segment) => segment.trim());

    if (segments.length < 2) {
      throw new Error('Stage definitions must use "stage-id | Title" formatting.');
    }

    segments[1] = appendTitleSuffix(segments[1], normalizedSuffix);
    return segments.join(' | ');
  });
}

export function summarizeWorkspaceBoards(workspace) {
  const normalizedWorkspace = workspace && typeof workspace === 'object' ? workspace : {};
  const boardOrder = Array.isArray(normalizedWorkspace.boardOrder) ? [...normalizedWorkspace.boardOrder] : [];
  const boards = boardOrder
    .map((boardId) => {
      const board = normalizedWorkspace.boards?.[boardId];

      if (!board || typeof board !== 'object') {
        return null;
      }

      return {
        id: typeof board.id === 'string' ? board.id : boardId,
        title: typeof board.title === 'string' ? board.title : '',
        stageOrder: Array.isArray(board.stageOrder) ? [...board.stageOrder] : [],
        stageTitles: Array.isArray(board.stageOrder)
          ? board.stageOrder.map((stageId) => ({
              id: stageId,
              title: typeof board.stages?.[stageId]?.title === 'string' ? board.stages[stageId].title : ''
            }))
          : []
      };
    })
    .filter(Boolean);

  return {
    workspaceId: typeof normalizedWorkspace.workspaceId === 'string' ? normalizedWorkspace.workspaceId : null,
    activeBoardId:
      typeof normalizedWorkspace.ui?.activeBoardId === 'string'
        ? normalizedWorkspace.ui.activeBoardId
        : null,
    boardOrder,
    boards
  };
}

export function findBoardByTitle(workspace, boardTitle) {
  const normalizedBoardTitle = String(boardTitle ?? '').trim();

  if (!normalizedBoardTitle) {
    return null;
  }

  const boardSummary = summarizeWorkspaceBoards(workspace);
  return boardSummary.boards.find((board) => board.title === normalizedBoardTitle) ?? null;
}

function appendTitleSuffix(title, suffix) {
  const normalizedTitle = String(title ?? '').trim();
  const normalizedSuffix = String(suffix ?? '').trim();

  if (!normalizedSuffix) {
    return normalizedTitle;
  }

  return `${normalizedTitle} ${normalizedSuffix}`.trim();
}

import { getStageMoveOptions } from './stage_ui.js';

export function getActionableStageMoveOptions(board, currentStageId) {
  return getStageMoveOptions(board, currentStageId, { includeCurrentStage: false });
}

export function createStageSelectOption(stageId, title) {
  const option = document.createElement('option');
  option.value = stageId;
  option.textContent = title;
  return option;
}

export function createStatusMenuOptionFromTemplate(templateTarget, { stageId, title } = {}) {
  const button = templateTarget.content.firstElementChild.cloneNode(true);
  button.dataset.targetStageId = stageId;
  button.dataset.stageTitle = title;
  button.value = stageId;
  button.textContent = title;
  return button;
}

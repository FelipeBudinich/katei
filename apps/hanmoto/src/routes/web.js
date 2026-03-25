import { Router } from 'express';
import {
  APP_TITLE,
  COLUMN_DEFINITIONS,
  PRIORITY_DEFINITIONS,
  createEmptyBoard
} from '../../public/js/domain/board.js';

const router = Router();

export function buildBoardPageModel() {
  return {
    board: createEmptyBoard(),
    columnDefinitions: COLUMN_DEFINITIONS,
    priorityDefinitions: PRIORITY_DEFINITIONS,
    pageTitle: APP_TITLE
  };
}

export function renderBoardPage(request, response) {
  response.render('pages/board', buildBoardPageModel());
}

export function renderHealth(request, response) {
  response.json({ ok: true });
}

router.get('/', renderBoardPage);

router.get('/health', renderHealth);

export default router;

import { Router } from 'express';
import { APP_TITLE } from '../../public/js/domain/workspace_read_model.js';
import { setPortfolioSurfaceCookie } from '../auth/last_surface_cookie.js';

export function createPortfolioRouter({ requireSession, requireSuperAdmin, config }) {
  const router = Router();

  router.get('/portfolio', requireSession, requireSuperAdmin, (request, response) => {
    setPortfolioSurfaceCookie(response, config);
    response.render('pages/portfolio', buildPortfolioPageModel({
      viewer: request.viewer,
      t: response.locals.t
    }));
  });

  return router;
}

export function buildPortfolioPageModel({ viewer, t }) {
  const portfolio = createEmptyPortfolioData();

  return {
    pageTitle: t('pageTitles.portfolio', { appTitle: APP_TITLE }),
    bodyClass: 'app-shell portfolio-shell',
    viewer,
    portfolio,
    summaryItems: [
      {
        label: t('portfolio.summary.workspacesLabel'),
        value: portfolio.workspaces.length
      },
      {
        label: t('portfolio.summary.boardsLabel'),
        value: portfolio.boardDirectory.length
      }
    ]
  };
}

function createEmptyPortfolioData() {
  return {
    workspaces: [],
    boardDirectory: []
  };
}

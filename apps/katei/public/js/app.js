import { Application } from '../vendor/stimulus/stimulus.js';
import WorkspaceController from '/js/controllers/workspace_controller.js';
import BoardOptionsController from '/js/controllers/board_options_controller.js';
import ProfileOptionsController from '/js/controllers/profile_options_controller.js';
import BoardCollaboratorsController from '/js/controllers/board_collaborators_controller.js';
import BoardEditorController from '/js/controllers/board_editor_controller.js';
import BoardStageConfigController from '/js/controllers/board_stage_config_controller.js';
import CardEditorController from '/js/controllers/card_editor_controller.js';
import LandingController from '/js/controllers/landing_controller.js';
import SessionController from '/js/controllers/session_controller.js';
import UiLocalePickerController from '/js/controllers/ui_locale_picker_controller.js';
import PortfolioController from '/js/controllers/portfolio_controller.js';

const application = Application.start();

application.register('workspace', WorkspaceController);
application.register('board-options', BoardOptionsController);
application.register('profile-options', ProfileOptionsController);
application.register('board-collaborators', BoardCollaboratorsController);
application.register('board-editor', BoardEditorController);
application.register('board-stage-config', BoardStageConfigController);
application.register('card-editor', CardEditorController);
application.register('landing', LandingController);
application.register('session', SessionController);
application.register('ui-locale-picker', UiLocalePickerController);
application.register('portfolio', PortfolioController);

window.Stimulus = application;

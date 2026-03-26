import { Application } from '/vendor/stimulus/stimulus.js';
import WorkspaceController from '/js/controllers/workspace_controller.js';
import BoardOptionsController from '/js/controllers/board_options_controller.js';
import BoardEditorController from '/js/controllers/board_editor_controller.js';
import CardEditorController from '/js/controllers/card_editor_controller.js';

const application = Application.start();

application.register('workspace', WorkspaceController);
application.register('board-options', BoardOptionsController);
application.register('board-editor', BoardEditorController);
application.register('card-editor', CardEditorController);

window.Stimulus = application;

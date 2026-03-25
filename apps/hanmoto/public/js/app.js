import { Application } from '/vendor/stimulus/stimulus.js';
import BoardController from '/js/controllers/board_controller.js';
import CardEditorController from '/js/controllers/card_editor_controller.js';

const application = Application.start();

application.register('board', BoardController);
application.register('card-editor', CardEditorController);

window.Stimulus = application;

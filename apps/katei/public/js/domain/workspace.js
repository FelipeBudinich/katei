// Compatibility barrel during the 6b migration. Shared read-model helpers live in
// dedicated modules, while legacy browser mutators remain available for the current
// snapshot-based flow until later steps move runtime mutations server-side.

export * from './workspace_read_model.js';
export * from './workspace_selectors.js';
export * from './workspace_validation.js';
export * from './workspace_mutations.js';
export * from './board_workflow.js';
export * from './board_language_policy.js';
export * from './board_stage_actions.js';
export * from './board_collaboration.js';
export * from './board_ai_localization.js';
export * from './board_permissions.js';
export * from './card_localization.js';
export * from './card_localization_requests.js';
export * from './localized_content_guard.js';
export * from './workspace_migrations.js';

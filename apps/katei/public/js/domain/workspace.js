// Compatibility barrel during the 6b migration. Shared read-model helpers live in
// dedicated modules, while legacy browser mutators remain available for the current
// snapshot-based flow until later steps move runtime mutations server-side.

export * from './workspace_read_model.js';
export * from './workspace_selectors.js';
export * from './workspace_validation.js';
export * from './workspace_mutations.js';

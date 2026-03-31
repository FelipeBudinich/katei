import { assertValidWorkspaceCommand } from '../../public/js/domain/workspace_commands.js';

export function applyWorkspaceCommand({ workspace, command, actor, now } = {}) {
  assertValidWorkspaceCommand(command);
  void workspace;
  void actor;
  void now;

  throw new Error('applyWorkspaceCommand is not implemented yet.');
}

export function createWorkspaceCommandEngine(dependencies = {}) {
  return {
    apply(commandContext) {
      void dependencies;
      return applyWorkspaceCommand(commandContext);
    }
  };
}

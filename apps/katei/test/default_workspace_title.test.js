import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getNextDefaultWorkspaceTitle,
  resolveWorkspaceCreationTitle
} from '../src/workspaces/default_workspace_title.js';

test('getNextDefaultWorkspaceTitle starts at 1 for a blank unnamed workspace', () => {
  assert.equal(
    getNextDefaultWorkspaceTitle({
      displayName: 'Felipe Budinich',
      existingWorkspaceTitles: []
    }),
    'Felipe Budinich 1'
  );
});

test('getNextDefaultWorkspaceTitle increments to the next highest matching suffix', () => {
  assert.equal(
    getNextDefaultWorkspaceTitle({
      displayName: 'Felipe Budinich',
      existingWorkspaceTitles: [
        'Felipe Budinich 1',
        'Felipe Budinich 2',
        'Felipe Budinich 7'
      ]
    }),
    'Felipe Budinich 8'
  );
});

test('getNextDefaultWorkspaceTitle ignores non-matching titles', () => {
  assert.equal(
    getNextDefaultWorkspaceTitle({
      displayName: 'Felipe Budinich',
      existingWorkspaceTitles: [
        'Felipe Budinich',
        'Felipe Budinich Alpha',
        'Felipe Budinich Roadmap',
        'Felipe Budinich 3',
        'Felipe Budinich 03'
      ]
    }),
    'Felipe Budinich 4'
  );
});

test('getNextDefaultWorkspaceTitle falls back to email and then Workspace', () => {
  assert.equal(
    getNextDefaultWorkspaceTitle({
      email: 'user@example.com',
      existingWorkspaceTitles: ['user@example.com 1']
    }),
    'user@example.com 2'
  );

  assert.equal(
    getNextDefaultWorkspaceTitle({
      existingWorkspaceTitles: ['Workspace 1']
    }),
    'Workspace 2'
  );
});

test('resolveWorkspaceCreationTitle preserves explicit titles and trims whitespace', () => {
  assert.equal(
    resolveWorkspaceCreationTitle({
      requestedTitle: '  Studio HQ  ',
      displayName: 'Felipe Budinich',
      existingWorkspaceTitles: ['Felipe Budinich 1']
    }),
    'Studio HQ'
  );
});

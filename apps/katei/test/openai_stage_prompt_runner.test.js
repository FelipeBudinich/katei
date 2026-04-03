import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createOpenAiStagePromptRunner,
  OpenAiStagePromptRunnerError
} from '../src/ai/openai_stage_prompt_runner.js';

test('OpenAI stage prompt runner sends a strict-compatible schema and returns structured output', async () => {
  const fetchCalls = [];
  const runner = createOpenAiStagePromptRunner({
    model: 'gpt-5.4-mini',
    fetchImpl: async (url, options = {}) => {
      fetchCalls.push({
        url,
        options: structuredClone(options)
      });

      return createJsonResponse({
        output_text: JSON.stringify({
          title: 'Generated implementation task',
          detailsMarkdown: 'Ship the implementation details.',
          priority: null
        })
      });
    }
  });

  const result = await runner.runStagePrompt({
    apiKey: 'sk-stage-prompt-test',
    board: {
      title: '過程 - Roadmap',
      stages: {
        doing: {
          id: 'doing',
          title: 'Doing'
        },
        done: {
          id: 'done',
          title: 'Done'
        }
      }
    },
    card: {
      id: 'card_1',
      priority: 'important',
      contentByLocale: {
        en: {
          title: 'v10 — Portfolio control plane',
          detailsMarkdown: 'Finish the control plane planning.',
          provenance: {
            actor: {
              type: 'human',
              id: 'viewer_123'
            },
            timestamp: '2026-04-03T16:00:00.000Z',
            includesHumanInput: true
          }
        }
      }
    },
    sourceLocale: 'en',
    stageId: 'doing',
    promptAction: {
      enabled: true,
      prompt: 'Turn this into a request for change that has a definition of done.',
      targetStageId: 'done'
    }
  });

  assert.deepEqual(result, {
    provider: 'openai',
    actor: {
      type: 'agent',
      id: 'openai-stage-prompt-runner'
    },
    sourceLocale: 'en',
    sourceStageId: 'doing',
    targetStageId: 'done',
    title: 'Generated implementation task',
    detailsMarkdown: 'Ship the implementation details.',
    model: 'gpt-5.4-mini'
  });
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, 'https://api.openai.com/v1/responses');
  assert.equal(fetchCalls[0].options.method, 'POST');
  assert.equal(fetchCalls[0].options.headers.Authorization, 'Bearer sk-stage-prompt-test');

  const requestBody = JSON.parse(fetchCalls[0].options.body);

  assert.equal(requestBody.text.format.type, 'json_schema');
  assert.deepEqual(requestBody.text.format.schema.required, ['title', 'detailsMarkdown', 'priority']);
  assert.deepEqual(requestBody.text.format.schema.properties.priority.anyOf, [
    {
      type: 'string',
      enum: ['urgent', 'important', 'normal']
    },
    {
      type: 'null'
    }
  ]);
  assert.match(
    requestBody.input[1].content,
    /Turn this into a request for change that has a definition of done\./
  );
  assert.match(requestBody.input[1].content, /v10 — Portfolio control plane/);
});

test('OpenAI stage prompt runner fails cleanly when source locale content is missing', async () => {
  let fetchCallCount = 0;
  const runner = createOpenAiStagePromptRunner({
    fetchImpl: async () => {
      fetchCallCount += 1;
      return createJsonResponse({});
    }
  });

  await assert.rejects(
    () => runner.runStagePrompt({
      apiKey: 'sk-stage-prompt-test',
      board: {
        title: 'Roadmap',
        stages: {
          doing: {
            id: 'doing',
            title: 'Doing'
          },
          done: {
            id: 'done',
            title: 'Done'
          }
        }
      },
      card: {
        id: 'card_1',
        contentByLocale: {}
      },
      sourceLocale: 'en',
      stageId: 'doing',
      promptAction: {
        enabled: true,
        prompt: 'Turn this into a request for change that has a definition of done.',
        targetStageId: 'done'
      }
    }),
    (error) => {
      assert.equal(error instanceof OpenAiStagePromptRunnerError, true);
      assert.equal(error.code, 'SOURCE_LOCALE_MISSING');
      assert.equal(error.status, 400);
      return true;
    }
  );

  assert.equal(fetchCallCount, 0);
});

function createJsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return structuredClone(body);
    }
  };
}

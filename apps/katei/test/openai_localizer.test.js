import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createOpenAiLocalizer,
  OpenAiLocalizerError
} from '../src/ai/openai_localizer.js';

test('OpenAI localizer sends target locale and card content in the prompt and returns structured output', async () => {
  const fetchCalls = [];
  const localizer = createOpenAiLocalizer({
    model: 'gpt-5.4-mini',
    fetchImpl: async (url, options = {}) => {
      fetchCalls.push({
        url,
        options: structuredClone(options)
      });

      return createJsonResponse({
        output_text: JSON.stringify({
          title: '日本語タイトル',
          detailsMarkdown: '日本語本文'
        })
      });
    }
  });

  const result = await localizer.generateLocalization({
    apiKey: 'sk-localizer-test',
    board: {
      title: 'Editorial board',
      languagePolicy: {
        sourceLocale: 'en',
        defaultLocale: 'en',
        supportedLocales: ['en', 'ja'],
        requiredLocales: ['en']
      }
    },
    card: {
      id: 'card_1',
      priority: 'urgent',
      contentByLocale: {
        en: {
          title: 'Ship launch checklist',
          detailsMarkdown: '- Confirm launch window\n- Notify collaborators',
          provenance: {
            actor: { type: 'human', id: 'viewer_123' },
            timestamp: '2026-04-02T10:00:00.000Z',
            includesHumanInput: true
          }
        }
      }
    },
    sourceLocale: 'en',
    targetLocale: 'ja'
  });

  assert.deepEqual(result, {
    provider: 'openai',
    actor: {
      type: 'agent',
      id: 'openai-localizer'
    },
    sourceLocale: 'en',
    targetLocale: 'ja',
    title: '日本語タイトル',
    detailsMarkdown: '日本語本文',
    model: 'gpt-5.4-mini'
  });
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, 'https://api.openai.com/v1/responses');
  assert.equal(fetchCalls[0].options.method, 'POST');
  assert.equal(fetchCalls[0].options.headers.Authorization, 'Bearer sk-localizer-test');
  const requestBody = JSON.parse(fetchCalls[0].options.body);

  assert.equal(requestBody.model, 'gpt-5.4-mini');
  assert.equal(requestBody.text.format.type, 'json_schema');
  assert.match(requestBody.input[1].content, /Target locale: ja/);
  assert.match(requestBody.input[1].content, /Ship launch checklist/);
  assert.match(requestBody.input[1].content, /Notify collaborators/);
});

test('OpenAI localizer fails cleanly when source locale content is missing', async () => {
  let fetchCallCount = 0;
  const localizer = createOpenAiLocalizer({
    fetchImpl: async () => {
      fetchCallCount += 1;
      return createJsonResponse({});
    }
  });

  await assert.rejects(
    () => localizer.generateLocalization({
      apiKey: 'sk-localizer-test',
      board: {
        title: 'Editorial board',
        languagePolicy: {
          sourceLocale: 'en',
          defaultLocale: 'en',
          supportedLocales: ['en', 'ja'],
          requiredLocales: ['en']
        }
      },
      card: {
        id: 'card_1',
        contentByLocale: {}
      },
      sourceLocale: 'en',
      targetLocale: 'ja'
    }),
    (error) => {
      assert.equal(error instanceof OpenAiLocalizerError, true);
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

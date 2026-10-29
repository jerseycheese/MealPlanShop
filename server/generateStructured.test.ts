import * as assert from 'node:assert/strict';
import type { GoogleGenAI } from '@google/genai';
import { generateStructured } from './generateStructured';

// A fake client that records the request and answers with canned text or a
// thrown error. No SDK network call, no key lookup.
function fakeClient(answer: { text?: string; error?: unknown }) {
  const calls: Array<Record<string, unknown>> = [];
  const ai = {
    models: {
      generateContent: async (params: Record<string, unknown>) => {
        calls.push(params);
        if (answer.error) throw answer.error;
        return { text: answer.text };
      },
    },
  } as unknown as Pick<GoogleGenAI, 'models'>;
  return { ai, calls };
}

export async function run(): Promise<void> {
  const schema = { type: 'object', properties: { ok: { type: 'boolean' } } };

  // JSON mode, schema, timeout, and system prompt reach the SDK; images go
  // ahead of the prompt text, which is what the circular scan relies on.
  const withImage = fakeClient({ text: '{"ok":true}' });
  const parsed = await generateStructured(
    {
      systemPrompt: 'sys',
      prompt: 'read this',
      images: [{ mimeType: 'image/png', data: 'AAAA' }],
      schema,
      timeoutMs: 1234,
    },
    withImage.ai
  );
  assert.deepEqual(parsed, { ok: true });
  const sent = withImage.calls[0] as {
    contents: unknown[];
    config: Record<string, unknown>;
  };
  assert.deepEqual(sent.contents, [
    { inlineData: { mimeType: 'image/png', data: 'AAAA' } },
    { text: 'read this' },
  ]);
  assert.equal(sent.config.systemInstruction, 'sys');
  assert.equal(sent.config.responseMimeType, 'application/json');
  assert.equal(sent.config.responseJsonSchema, schema);
  assert.deepEqual(sent.config.httpOptions, { timeout: 1234 });

  // No system prompt means no systemInstruction key at all (the categorize
  // call never sent one).
  const plain = fakeClient({ text: '{}' });
  await generateStructured({ prompt: 'p', schema, timeoutMs: 1 }, plain.ai);
  const plainConfig = (plain.calls[0] as { config: object }).config;
  assert.ok(!('systemInstruction' in plainConfig));

  // An empty response parses to {} so callers' shape checks see no fields.
  const empty = fakeClient({});
  assert.deepEqual(
    await generateStructured({ prompt: 'p', schema, timeoutMs: 1 }, empty.ai),
    {}
  );

  // A bad-key SDK error comes back readable and tagged 400.
  const apiErr = Object.assign(
    new Error(
      JSON.stringify({
        error: {
          code: 400,
          message: 'API key not valid. Please pass a valid API key.',
          status: 'INVALID_ARGUMENT',
        },
      })
    ),
    { status: 400 }
  );
  const failing = fakeClient({ error: apiErr });
  await assert.rejects(
    generateStructured({ prompt: 'p', schema, timeoutMs: 1 }, failing.ai),
    (err: Error & { statusCode?: number }) =>
      /Settings/.test(err.message) && err.statusCode === 400
  );
}

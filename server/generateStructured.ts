import { GoogleGenAI } from '@google/genai';
import { GEMINI_MODEL } from '../scripts/env';
import { requireGeminiKey } from './secrets';
import { toReadableGeminiError } from './geminiErrors';

export interface StructuredImage {
  mimeType: string;
  data: string; // base64
}

export interface StructuredRequest {
  systemPrompt?: string;
  prompt: string;
  images?: StructuredImage[];
  schema: object;
  timeoutMs: number;
}

// The one place the app asks a model for JSON matching a schema. Every LLM call
// site goes through here, so changing provider means changing this file only.
// Returns the parsed JSON unchecked (callers own their shape checks), or {} when
// the model sends no text. SDK errors come back mapped by toReadableGeminiError.
export async function generateStructured(
  req: StructuredRequest,
  ai: Pick<GoogleGenAI, 'models'> = new GoogleGenAI({
    apiKey: requireGeminiKey(),
  })
): Promise<unknown> {
  const images = (req.images ?? []).map((inlineData) => ({ inlineData }));
  const response = await ai.models
    .generateContent({
      model: GEMINI_MODEL,
      contents: images.length
        ? [...images, { text: req.prompt }]
        : [{ text: req.prompt }],
      config: {
        ...(req.systemPrompt ? { systemInstruction: req.systemPrompt } : {}),
        responseMimeType: 'application/json',
        responseJsonSchema: req.schema,
        httpOptions: { timeout: req.timeoutMs },
      },
    })
    .catch((err: unknown) => {
      throw toReadableGeminiError(err, GEMINI_MODEL);
    });
  return JSON.parse(response.text ?? '{}');
}

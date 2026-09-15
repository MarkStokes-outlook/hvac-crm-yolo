import Anthropic from '@anthropic-ai/sdk';

export const AI_MODEL = process.env.FROSTLINE_AI_MODEL ?? 'claude-opus-5';
export const AI_EFFORT = (process.env.FROSTLINE_AI_EFFORT ?? 'medium') as 'low' | 'medium' | 'high' | 'xhigh' | 'max';
/** Server-side refusal fallback (routes a declined request to Anthropic's recommended fallback model). */
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

let client: Anthropic | null = null;

/** True when the SDK can find credentials (API key or auth token). */
export function aiConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export function anthropic(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

export class AiUnavailableError extends Error {
  constructor() {
    super('AI assistant is not configured. Set ANTHROPIC_API_KEY in app/.env and restart the server.');
  }
}

export function describeAiError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return 'The Anthropic API key was rejected. Check ANTHROPIC_API_KEY.';
  if (err instanceof Anthropic.RateLimitError) return 'The AI service is rate limiting requests — try again in a moment.';
  if (err instanceof Anthropic.BadRequestError) return `The AI request was rejected: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return 'Could not reach the AI service (network error).';
  if (err instanceof Anthropic.APIError) return `AI service error (${err.status}): ${err.message}`;
  if (err instanceof Error) return err.message;
  return 'Unknown AI error';
}

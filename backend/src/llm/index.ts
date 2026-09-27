/** LLM provider module: swappable model-call interface + GeminiProvider (Task 4). */
export type { LlmProvider, Summary } from './provider.ts';
export { LlmError } from './provider.ts';
export { GeminiProvider, type GeminiProviderOptions } from './gemini.ts';

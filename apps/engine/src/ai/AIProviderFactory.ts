/**
 * AI Provider Factory - Creates AI providers based on configuration
 */

import { AIProvider } from "@agentqa/types";
import { OllamaProvider } from "./AIProvider";

export const DEFAULT_OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
export const DEFAULT_OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen3:1.7b";
export const DEFAULT_OLLAMA_TIMEOUT = parseInt(process.env.OLLAMA_TIMEOUT || "60000");

export class AIProviderFactory {
  static create(baseUrl: string = DEFAULT_OLLAMA_BASE_URL, model: string = DEFAULT_OLLAMA_MODEL, timeout: number = DEFAULT_OLLAMA_TIMEOUT): AIProvider {
    return new OllamaProvider(baseUrl, model, timeout);
  }

  static createFromEnv(): AIProvider {
    return this.create(DEFAULT_OLLAMA_BASE_URL, DEFAULT_OLLAMA_MODEL);
  }
}

/**
 * AI Provider Factory - Creates AI providers based on configuration
 */

import { AIProvider } from "@agentqa/types";
import { OllamaProvider } from "./AIProvider";

export class AIProviderFactory {
  static create(baseUrl: string, model: string): AIProvider {
    // For now, only Ollama is implemented
    // Future: OpenAI-compatible providers can be added here
    return new OllamaProvider(baseUrl, model);
  }

  static createFromEnv(): AIProvider {
    const baseUrl = process.env.OLLAMA_BASE_URL || "http://ollama:11434";
    const model = process.env.OLLAMA_MODEL || "qwen2.5-coder:7b";
    return this.create(baseUrl, model);
  }
}
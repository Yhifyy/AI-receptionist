import OpenAI from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import { logger } from '../../shared/logger.js';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export interface LLMResponse {
  text: string;
  toolCalls?: ToolCall[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface LLMOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ChatCompletionTool[];
  systemPrompt?: string;
}

export class OpenAIService {
  private defaultModel = 'gpt-4o';
  private fallbackModel = 'gpt-4o-mini';

  async chat(
    messages: ChatCompletionMessageParam[],
    options: LLMOptions = {}
  ): Promise<LLMResponse> {
    const {
      model = this.defaultModel,
      temperature = 0.7,
      maxTokens = 300,
      tools,
      systemPrompt,
    } = options;

    const allMessages: ChatCompletionMessageParam[] = [];

    if (systemPrompt) {
      allMessages.push({ role: 'system', content: systemPrompt });
    }

    allMessages.push(...messages);

    try {
      const startTime = Date.now();

      const completion = await openai.chat.completions.create({
        model,
        messages: allMessages,
        temperature,
        max_tokens: maxTokens,
        tools: tools && tools.length > 0 ? tools : undefined,
        tool_choice: tools && tools.length > 0 ? 'auto' : undefined,
      });

      const latency = Date.now() - startTime;
      logger.debug({ model, latency, tokens: completion.usage?.total_tokens }, 'LLM response');

      const message = completion.choices[0]?.message;
      const toolCalls = message?.tool_calls?.map(tc => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments),
      }));

      return {
        text: message?.content || '',
        toolCalls,
        usage: completion.usage ? {
          promptTokens: completion.usage.prompt_tokens,
          completionTokens: completion.usage.completion_tokens,
          totalTokens: completion.usage.total_tokens,
        } : undefined,
        finishReason: completion.choices[0]?.finish_reason || 'unknown',
      };
    } catch (error: any) {
      // Fallback to cheaper model on rate limit or error
      if (error.status === 429 || error.status === 500) {
        logger.warn({ error: error.message }, 'Falling back to mini model');
        return this.chat(messages, { ...options, model: this.fallbackModel });
      }
      throw error;
    }
  }

  async streamChat(
    messages: ChatCompletionMessageParam[],
    onChunk: (chunk: string) => void,
    options: LLMOptions = {}
  ): Promise<LLMResponse> {
    const {
      model = this.defaultModel,
      temperature = 0.7,
      maxTokens = 300,
      systemPrompt,
    } = options;

    const allMessages: ChatCompletionMessageParam[] = [];

    if (systemPrompt) {
      allMessages.push({ role: 'system', content: systemPrompt });
    }

    allMessages.push(...messages);

    const stream = await openai.chat.completions.create({
      model,
      messages: allMessages,
      temperature,
      max_tokens: maxTokens,
      stream: true,
    });

    let fullText = '';
    let finishReason = 'unknown';

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        fullText += content;
        onChunk(content);
      }
      if (chunk.choices[0]?.finish_reason) {
        finishReason = chunk.choices[0].finish_reason;
      }
    }

    return {
      text: fullText,
      finishReason,
    };
  }

  async classifyIntent(
    transcript: string,
    availableIntents: string[]
  ): Promise<{ intent: string; confidence: number; entities: Record<string, any> }> {
    const systemPrompt = `You are an intent classifier for a voice AI system. Classify the user's utterance into one of the available intents and extract any relevant entities.

Available intents:
${availableIntents.map(i => `- ${i}`).join('\n')}

Respond in JSON format:
{
  "intent": "intent_name",
  "confidence": 0.0-1.0,
  "entities": {
    "entity_name": "value"
  }
}

Common entities to extract:
- date: Dates mentioned (normalize to YYYY-MM-DD)
- time: Times mentioned (normalize to HH:MM 24-hour format)
- party_size: Number of people
- name: Person's name
- phone: Phone number
- item: Menu item or product name
- special_request: Any special requests`;

    const response = await this.chat(
      [{ role: 'user', content: transcript }],
      { systemPrompt, temperature: 0.3, maxTokens: 200 }
    );

    try {
      const parsed = JSON.parse(response.text);
      return {
        intent: parsed.intent || 'general_inquiry',
        confidence: parsed.confidence || 0.5,
        entities: parsed.entities || {},
      };
    } catch {
      return {
        intent: 'general_inquiry',
        confidence: 0.3,
        entities: {},
      };
    }
  }

  async analyzeSentiment(text: string): Promise<{
    score: number;
    label: 'positive' | 'neutral' | 'negative';
    confidence: number;
  }> {
    const response = await this.chat(
      [{ role: 'user', content: text }],
      {
        systemPrompt: `Analyze the sentiment of the following text. Respond with JSON only:
{
  "score": -1.0 to 1.0 (negative to positive),
  "label": "positive" | "neutral" | "negative",
  "confidence": 0.0 to 1.0
}`,
        temperature: 0.3,
        maxTokens: 50,
      }
    );

    try {
      return JSON.parse(response.text);
    } catch {
      return { score: 0, label: 'neutral', confidence: 0.5 };
    }
  }

  async generateSummary(transcript: Array<{ role: string; content: string }>): Promise<string> {
    const conversationText = transcript
      .map(t => `${t.role === 'user' ? 'Caller' : 'AI'}: ${t.content}`)
      .join('\n');

    const response = await this.chat(
      [{ role: 'user', content: `Summarize this phone conversation in 2-3 sentences:\n\n${conversationText}` }],
      { temperature: 0.5, maxTokens: 100 }
    );

    return response.text;
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
    });

    return response.data[0].embedding;
  }
}

export const openaiService = new OpenAIService();

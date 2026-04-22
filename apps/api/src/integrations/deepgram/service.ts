import WebSocket from 'ws';
import { logger } from '../../shared/logger.js';

interface DeepgramConfig {
  onTranscript: (transcript: string, isFinal: boolean) => Promise<void>;
  onError: (error: Error) => void;
}

export class DeepgramService {
  private ws: WebSocket | null = null;
  private keepAliveInterval: NodeJS.Timeout | null = null;

  async connect(config: DeepgramConfig): Promise<WebSocket> {
    const apiKey = process.env.DEEPGRAM_API_KEY;
    if (!apiKey) {
      throw new Error('DEEPGRAM_API_KEY not configured');
    }

    // Deepgram streaming endpoint with optimized settings for phone calls
    const url = new URL('wss://api.deepgram.com/v1/listen');
    
    // Configuration for low-latency phone transcription
    const params = {
      encoding: 'mulaw',
      sample_rate: '8000',
      channels: '1',
      model: 'nova-2-phonecall', // Optimized for phone audio
      language: 'en-US',
      punctuate: 'true',
      interim_results: 'true',
      endpointing: '300', // 300ms silence for utterance detection
      utterance_end_ms: '1000',
      vad_events: 'true',
      smart_format: 'true',
    };

    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.append(key, value);
    });

    this.ws = new WebSocket(url.toString(), {
      headers: {
        Authorization: `Token ${apiKey}`,
      },
    });

    return new Promise((resolve, reject) => {
      if (!this.ws) {
        reject(new Error('WebSocket not initialized'));
        return;
      }

      this.ws.on('open', () => {
        logger.info('Deepgram connection established');
        
        // Start keep-alive
        this.keepAliveInterval = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'KeepAlive' }));
          }
        }, 10000);

        resolve(this.ws!);
      });

      this.ws.on('message', async (data: Buffer) => {
        try {
          const response = JSON.parse(data.toString());

          if (response.type === 'Results') {
            const transcript = response.channel?.alternatives?.[0]?.transcript;
            const isFinal = response.is_final || false;

            if (transcript && transcript.trim()) {
              await config.onTranscript(transcript.trim(), isFinal);
            }
          } else if (response.type === 'UtteranceEnd') {
            logger.debug('Utterance end detected');
          } else if (response.type === 'SpeechStarted') {
            logger.debug('Speech started');
          }
        } catch (error) {
          logger.error({ error }, 'Error parsing Deepgram response');
        }
      });

      this.ws.on('error', (error) => {
        logger.error({ error }, 'Deepgram WebSocket error');
        config.onError(error as Error);
        reject(error);
      });

      this.ws.on('close', (code, reason) => {
        logger.info({ code, reason: reason.toString() }, 'Deepgram connection closed');
        this.cleanup();
      });
    });
  }

  send(audio: Buffer): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(audio);
    }
  }

  disconnect(): void {
    if (this.ws) {
      // Send close frame
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'CloseStream' }));
      }
      this.ws.close();
    }
    this.cleanup();
  }

  private cleanup(): void {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
    this.ws = null;
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

// Batch transcription for recordings
export async function transcribeRecording(audioUrl: string): Promise<{
  transcript: string;
  words: Array<{ word: string; start: number; end: number; confidence: number }>;
  duration: number;
}> {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    throw new Error('DEEPGRAM_API_KEY not configured');
  }

  const response = await fetch('https://api.deepgram.com/v1/listen', {
    method: 'POST',
    headers: {
      Authorization: `Token ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: audioUrl,
      model: 'nova-2-phonecall',
      language: 'en-US',
      punctuate: true,
      smart_format: true,
      diarize: true,
      utterances: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`Deepgram API error: ${response.statusText}`);
  }

  const result = (await response.json()) as {
    results?: { channels?: { alternatives?: { transcript?: string; words?: unknown[] }[] }[] };
    metadata?: { duration?: number };
  };
  const channel = result.results?.channels?.[0];
  const alternative = channel?.alternatives?.[0];

  const words =
    (alternative?.words || []) as Array<{
      word: string;
      start: number;
      end: number;
      confidence: number;
    }>;

  return {
    transcript: alternative?.transcript || '',
    words,
    duration: result.metadata?.duration || 0,
  };
}

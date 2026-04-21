import { logger } from '../../shared/logger.js';

interface VoiceSettings {
  stability: number;
  similarity_boost: number;
  style?: number;
  use_speaker_boost?: boolean;
}

export class ElevenLabsService {
  private apiKey: string;
  private voiceId: string;
  private baseUrl = 'https://api.elevenlabs.io/v1';

  constructor(voiceId: string) {
    this.apiKey = process.env.ELEVENLABS_API_KEY || '';
    this.voiceId = voiceId || process.env.ELEVENLABS_VOICE_ID || '';
  }

  async synthesize(text: string, settings?: Partial<VoiceSettings>): Promise<Buffer[]> {
    if (!this.apiKey) {
      throw new Error('ELEVENLABS_API_KEY not configured');
    }

    if (!this.voiceId) {
      throw new Error('Voice ID not configured');
    }

    const voiceSettings: VoiceSettings = {
      stability: settings?.stability ?? 0.5,
      similarity_boost: settings?.similarity_boost ?? 0.75,
      style: settings?.style ?? 0.5,
      use_speaker_boost: true,
    };

    try {
      const response = await fetch(
        `${this.baseUrl}/text-to-speech/${this.voiceId}/stream`,
        {
          method: 'POST',
          headers: {
            'Accept': 'audio/mpeg',
            'Content-Type': 'application/json',
            'xi-api-key': this.apiKey,
          },
          body: JSON.stringify({
            text,
            model_id: 'eleven_turbo_v2', // Lowest latency model
            voice_settings: voiceSettings,
            output_format: 'ulaw_8000', // Twilio-compatible format
          }),
        }
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`ElevenLabs API error: ${response.status} - ${error}`);
      }

      // Read streaming response into chunks
      const chunks: Buffer[] = [];
      const reader = response.body?.getReader();
      
      if (!reader) {
        throw new Error('No response body');
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(Buffer.from(value));
      }

      logger.debug({ 
        textLength: text.length, 
        chunks: chunks.length 
      }, 'Audio synthesized');

      return chunks;

    } catch (error) {
      logger.error({ error, text: text.substring(0, 50) }, 'TTS synthesis failed');
      throw error;
    }
  }

  async synthesizeStream(
    text: string, 
    onChunk: (chunk: Buffer) => void,
    settings?: Partial<VoiceSettings>
  ): Promise<void> {
    if (!this.apiKey || !this.voiceId) {
      throw new Error('ElevenLabs not configured');
    }

    const voiceSettings: VoiceSettings = {
      stability: settings?.stability ?? 0.5,
      similarity_boost: settings?.similarity_boost ?? 0.75,
      style: settings?.style ?? 0.5,
      use_speaker_boost: true,
    };

    const response = await fetch(
      `${this.baseUrl}/text-to-speech/${this.voiceId}/stream`,
      {
        method: 'POST',
        headers: {
          'Accept': 'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key': this.apiKey,
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_turbo_v2',
          voice_settings: voiceSettings,
          output_format: 'ulaw_8000',
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`ElevenLabs API error: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      onChunk(Buffer.from(value));
    }
  }

  async getVoices(): Promise<Voice[]> {
    const response = await fetch(`${this.baseUrl}/voices`, {
      headers: {
        'xi-api-key': this.apiKey,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch voices: ${response.status}`);
    }

    const data = await response.json();
    return data.voices;
  }

  async cloneVoice(name: string, files: Buffer[], description?: string): Promise<Voice> {
    const formData = new FormData();
    formData.append('name', name);
    if (description) {
      formData.append('description', description);
    }
    
    files.forEach((file, index) => {
      formData.append('files', new Blob([file]), `sample_${index}.mp3`);
    });

    const response = await fetch(`${this.baseUrl}/voices/add`, {
      method: 'POST',
      headers: {
        'xi-api-key': this.apiKey,
      },
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Failed to clone voice: ${response.status}`);
    }

    return response.json();
  }
}

interface Voice {
  voice_id: string;
  name: string;
  category: string;
  description?: string;
  labels?: Record<string, string>;
  preview_url?: string;
}

// Pre-built voices optimized for phone calls
export const RECOMMENDED_VOICES = {
  professional_female: '21m00Tcm4TlvDq8ikWAM', // Rachel
  professional_male: 'ErXwobaYiN019PkySvjV', // Antoni
  friendly_female: 'EXAVITQu4vr4xnSDxMaL', // Bella
  friendly_male: 'VR6AewLTigWG4xSOukaG', // Arnold
  calm_female: 'MF3mGyEYCl7XYWbV9V6O', // Elli
  energetic_male: 'TX3LPaxmHKxFdv7VOQHJ', // Liam
};

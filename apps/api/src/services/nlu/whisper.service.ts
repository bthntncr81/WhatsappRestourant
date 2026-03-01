import OpenAI from 'openai';
import { getConfig } from '@whatres/config';
import { createLogger } from '../../logger';
import { whatsappConfigService } from '../whatsapp-config.service';

const logger = createLogger();

export class WhisperService {
  private client: OpenAI | null = null;
  private config = getConfig();

  constructor() {
    if (this.config.openai.apiKey) {
      this.client = new OpenAI({ apiKey: this.config.openai.apiKey });
    }
  }

  isAvailable(): boolean {
    return this.client !== null;
  }

  /**
   * Transcribe a WhatsApp voice message
   * 1. Downloads the audio from Meta Cloud API using the media ID
   * 2. Sends it to OpenAI Whisper for transcription
   * 3. Returns the transcribed text
   */
  async transcribeVoiceMessage(
    tenantId: string,
    voiceId: string
  ): Promise<string | null> {
    if (!this.client) {
      logger.warn('OpenAI not configured, cannot transcribe voice');
      return null;
    }

    const startTime = Date.now();

    try {
      // 1. Get tenant's WhatsApp config for access token
      const waConfig = await whatsappConfigService.getDecryptedConfig(tenantId);
      if (!waConfig) {
        logger.warn({ tenantId }, 'No WhatsApp config for voice transcription');
        return null;
      }

      // 2. Get media URL from Meta Cloud API
      const apiVersion = process.env.WHATSAPP_API_VERSION || 'v21.0';
      const mediaInfoUrl = `https://graph.facebook.com/${apiVersion}/${voiceId}`;
      const mediaInfoRes = await fetch(mediaInfoUrl, {
        headers: { Authorization: `Bearer ${waConfig.accessToken}` },
      });

      if (!mediaInfoRes.ok) {
        logger.error(
          { tenantId, voiceId, status: mediaInfoRes.status },
          'Failed to get media info from Meta'
        );
        return null;
      }

      const mediaInfo = (await mediaInfoRes.json()) as { url?: string };
      if (!mediaInfo.url) {
        logger.error({ tenantId, voiceId }, 'No URL in media info');
        return null;
      }

      // 3. Download the audio file
      const audioRes = await fetch(mediaInfo.url, {
        headers: { Authorization: `Bearer ${waConfig.accessToken}` },
      });

      if (!audioRes.ok) {
        logger.error(
          { tenantId, voiceId, status: audioRes.status },
          'Failed to download voice media'
        );
        return null;
      }

      const audioBuffer = Buffer.from(await audioRes.arrayBuffer());

      // 4. Send to Whisper API
      const audioFile = new File([audioBuffer], 'voice.ogg', {
        type: 'audio/ogg',
      });

      const transcription = await this.client.audio.transcriptions.create({
        model: 'whisper-1',
        file: audioFile,
        language: 'tr', // Turkish
      });

      const text = transcription.text?.trim();

      logger.info(
        {
          tenantId,
          voiceId,
          transcribedLength: text?.length || 0,
          durationMs: Date.now() - startTime,
        },
        'Voice message transcribed'
      );

      return text || null;
    } catch (error) {
      logger.error({ error, tenantId, voiceId }, 'Voice transcription failed');
      return null;
    }
  }
}

export const whisperService = new WhisperService();

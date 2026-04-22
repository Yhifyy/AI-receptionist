import twilio from 'twilio';
import { logger } from '../../shared/logger.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export class TwilioService {
  private client: twilio.Twilio;

  constructor() {
    this.client = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
  }

  generateStreamTwiML(streamUrl: string, tenantId: string): string {
    const response = new VoiceResponse();

    // Start with a brief pause
    response.pause({ length: 1 });

    // Connect to media stream for bidirectional audio
    const connect = response.connect();
    connect.stream({
      url: streamUrl,
      statusCallback: `${process.env.API_URL}/api/calls/status`,
    });

    // Enable call recording
    if (process.env.ENABLE_RECORDING !== 'false') {
      response.record({
        recordingStatusCallback: `${process.env.API_URL}/api/calls/recording`,
        recordingStatusCallbackEvent: ['completed'],
        transcribe: false,
      });
    }

    return response.toString();
  }

  generateErrorTwiML(message: string): string {
    const response = new VoiceResponse();
    response.say({ voice: 'Polly.Joanna' }, message);
    response.hangup();
    return response.toString();
  }

  generateTransferTwiML(tenantId: string): string {
    const response = new VoiceResponse();
    response.say(
      { voice: 'Polly.Joanna' },
      "I apologize, but I need to connect you with a team member. Please hold."
    );
    
    // In production, this would dial a configured number
    response.dial({
      callerId: process.env.TWILIO_PHONE_NUMBER,
      timeout: 30,
    });
    
    response.say(
      { voice: 'Polly.Joanna' },
      "I'm sorry, no one is available right now. Please call back during business hours."
    );
    response.hangup();
    
    return response.toString();
  }

  generateHoldTwiML(): string {
    const response = new VoiceResponse();
    response.say(
      { voice: 'Polly.Joanna' },
      "Please hold while I transfer your call."
    );
    response.play({ loop: 10 }, 'https://api.twilio.com/cowbell.mp3');
    return response.toString();
  }

  async initiateCall(from: string, to: string, tenantId: string): Promise<any> {
    try {
      const call = await this.client.calls.create({
        url: `${process.env.API_URL}/api/calls/incoming`,
        to,
        from,
        statusCallback: `${process.env.API_URL}/api/calls/status`,
        statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
        statusCallbackMethod: 'POST',
      });

      logger.info({ callSid: call.sid, to }, 'Outbound call initiated');
      return call;
    } catch (error) {
      logger.error({ error, to }, 'Failed to initiate call');
      throw error;
    }
  }

  async getCallInfo(callSid: string): Promise<any> {
    try {
      return await this.client.calls(callSid).fetch();
    } catch (error) {
      logger.error({ error, callSid }, 'Failed to fetch call info');
      throw error;
    }
  }

  async updateCall(callSid: string, twiml: string): Promise<any> {
    try {
      return await this.client.calls(callSid).update({
        twiml,
      });
    } catch (error) {
      logger.error({ error, callSid }, 'Failed to update call');
      throw error;
    }
  }

  async endCall(callSid: string): Promise<void> {
    try {
      await this.client.calls(callSid).update({
        status: 'completed',
      });
      logger.info({ callSid }, 'Call ended');
    } catch (error) {
      logger.error({ error, callSid }, 'Failed to end call');
      throw error;
    }
  }

  async purchasePhoneNumber(areaCode?: string): Promise<any> {
    try {
      const availableNumbers = await this.client.availablePhoneNumbers('US')
        .local.list({
          areaCode: areaCode ? parseInt(areaCode) : undefined,
          voiceEnabled: true,
          limit: 1,
        });

      if (availableNumbers.length === 0) {
        throw new Error('No available phone numbers found');
      }

      const purchased = await this.client.incomingPhoneNumbers.create({
        phoneNumber: availableNumbers[0].phoneNumber,
        voiceUrl: `${process.env.API_URL}/api/calls/incoming`,
        voiceMethod: 'POST',
        statusCallback: `${process.env.API_URL}/api/calls/status`,
        statusCallbackMethod: 'POST',
      });

      logger.info({ 
        phoneNumber: purchased.phoneNumber, 
        sid: purchased.sid 
      }, 'Phone number purchased');

      return {
        phoneNumber: purchased.phoneNumber,
        sid: purchased.sid,
      };
    } catch (error) {
      logger.error({ error }, 'Failed to purchase phone number');
      throw error;
    }
  }

  async configurePhoneNumber(phoneSid: string, webhookUrl: string): Promise<void> {
    try {
      await this.client.incomingPhoneNumbers(phoneSid).update({
        voiceUrl: webhookUrl,
        voiceMethod: 'POST',
      });
      logger.info({ phoneSid }, 'Phone number configured');
    } catch (error) {
      logger.error({ error, phoneSid }, 'Failed to configure phone number');
      throw error;
    }
  }

  validateWebhookSignature(
    signature: string,
    url: string,
    params: Record<string, string>
  ): boolean {
    return twilio.validateRequest(
      process.env.TWILIO_AUTH_TOKEN || '',
      signature,
      url,
      params
    );
  }
}

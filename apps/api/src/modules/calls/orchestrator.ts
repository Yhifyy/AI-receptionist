import type { WebSocket } from 'ws';
import type { Redis } from 'ioredis';
import { v4 as uuid } from 'uuid';
import { prisma, type ActionType } from '@voicedesk/database';
import type { 
  CallSession, 
  ConversationContext, 
  TranscriptEntry,
  ConversationState,
  IncomingCallEvent 
} from '@voicedesk/shared-types';
import { TwilioService } from '../../integrations/twilio/service.js';
import { DeepgramService } from '../../integrations/deepgram/service.js';
import { ElevenLabsService } from '../../integrations/elevenlabs/service.js';
import { ConversationEngine } from '../conversation/engine.js';
import { CallSessionCache } from '../../shared/redis.js';
import { logger } from '../../shared/logger.js';

function mapToolNameToCallActionType(toolName: string): ActionType | null {
  switch (toolName) {
    case 'create_booking':
      return 'BOOKING_CREATED';
    case 'modify_booking':
      return 'BOOKING_MODIFIED';
    case 'cancel_booking':
      return 'BOOKING_CANCELLED';
    case 'get_menu_info':
      return 'MENU_INQUIRY';
    case 'transfer_to_human':
      return 'TRANSFER_REQUESTED';
    default:
      return null;
  }
}

export class CallOrchestrator {
  private redis: Redis;
  private twilioService: TwilioService;
  private sessionCache: CallSessionCache;
  private activeCalls: Map<string, ActiveCall> = new Map();

  constructor(redis: Redis, twilioService: TwilioService) {
    this.redis = redis;
    this.twilioService = twilioService;
    this.sessionCache = new CallSessionCache(redis);
  }

  async handleIncomingCall(event: Record<string, any>): Promise<string> {
    const { CallSid, From, To, AccountSid } = event;

    logger.info({ callSid: CallSid, from: From, to: To }, 'Processing incoming call');

    // Find tenant by phone number
    const tenant = await prisma.tenant.findFirst({
      where: { twilioNumber: To },
    });

    if (!tenant) {
      logger.warn({ to: To }, 'No tenant found for phone number');
      return this.twilioService.generateErrorTwiML('Sorry, this number is not configured.');
    }

    // Check if tenant is active and has minutes
    if (!tenant.isActive) {
      return this.twilioService.generateErrorTwiML('This service is temporarily unavailable.');
    }

    if (tenant.minutesUsed >= tenant.minutesIncluded) {
      logger.warn({ tenantId: tenant.id }, 'Tenant has exceeded minutes');
      return this.twilioService.generateTransferTwiML(tenant.id);
    }

    // Look up or create customer
    let customer = await prisma.customer.findFirst({
      where: { tenantId: tenant.id, phone: From },
    });

    if (!customer) {
      customer = await prisma.customer.create({
        data: {
          tenantId: tenant.id,
          phone: From,
        },
      });
    }

    // Create call record
    const call = await prisma.call.create({
      data: {
        tenantId: tenant.id,
        customerId: customer.id,
        twilioCallSid: CallSid,
        direction: 'INBOUND',
        status: 'RINGING',
        fromNumber: From,
        toNumber: To,
      },
    });

    // Initialize call session
    const session = await this.initializeSession(tenant, customer, call);
    await this.sessionCache.setCallSession(CallSid, session);

    // Generate TwiML to connect to media stream
    // API_URL must be the public ngrok URL for Twilio to reach us
    const apiUrl = process.env.API_URL || `http://localhost:${process.env.API_PORT || '3001'}`;
    const wsUrl = apiUrl.replace('https://', 'wss://').replace('http://', 'ws://');
    const streamUrl = `${wsUrl}/api/calls/stream/${CallSid}`;
    
    logger.info({ streamUrl }, 'Generated WebSocket stream URL for Twilio');
    
    return this.twilioService.generateStreamTwiML(streamUrl, tenant.id);
  }

  async handleMediaStream(ws: WebSocket, callSid: string): Promise<void> {
    logger.info({ callSid }, 'Media stream connected');

    const session = await this.sessionCache.getCallSession(callSid);
    if (!session) {
      logger.error({ callSid }, 'No session found for call');
      ws.close();
      return;
    }

    // Load tenant config
    const tenant = await prisma.tenant.findUnique({
      where: { id: session.tenantId },
    });

    if (!tenant) {
      logger.error({ tenantId: session.tenantId }, 'Tenant not found');
      ws.close();
      return;
    }

    // Initialize services
    const deepgram = new DeepgramService();
    const elevenlabs = new ElevenLabsService(
      tenant.voiceId || process.env.ELEVENLABS_VOICE_ID || ''
    );
    const conversationEngine = new ConversationEngine(tenant);

    // Create active call handler
    const activeCall: ActiveCall = {
      callSid,
      session,
      ws,
      deepgram,
      elevenlabs,
      conversationEngine,
      streamSid: null,
      greetingSent: false,
      isProcessing: false,
      audioBuffer: [],
      lastActivityAt: Date.now(),
    };

    this.activeCalls.set(callSid, activeCall);

    // Set up Deepgram transcription
    const dgConnection = await deepgram.connect({
      onTranscript: async (transcript, isFinal) => {
        await this.handleTranscript(activeCall, transcript, isFinal);
      },
      onError: (error) => {
        logger.error({ error, callSid }, 'Deepgram error');
      },
    });

    // Handle WebSocket messages from Twilio
    ws.on('message', async (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        await this.handleTwilioMessage(activeCall, message, dgConnection);
      } catch (error) {
        logger.error({ error, callSid }, 'Error processing Twilio message');
      }
    });

    ws.on('close', async () => {
      logger.info({ callSid }, 'Media stream disconnected');
      await this.cleanupCall(activeCall);
    });

    ws.on('error', (error) => {
      logger.error({ error, callSid }, 'WebSocket error');
    });

    // Greeting is sent from Twilio `start` once streamSid exists (see handleTwilioMessage)
  }

  private async handleTwilioMessage(
    activeCall: ActiveCall, 
    message: any,
    dgConnection: any
  ): Promise<void> {
    switch (message.event) {
      case 'connected':
        logger.info({ callSid: activeCall.callSid }, 'Twilio stream connected');
        break;

      case 'start':
        activeCall.streamSid = message.start.streamSid;
        logger.info({ 
          callSid: activeCall.callSid, 
          streamSid: activeCall.streamSid 
        }, 'Twilio stream started');
        if (!activeCall.greetingSent) {
          activeCall.greetingSent = true;
          await this.sendGreeting(activeCall);
        }
        break;

      case 'media':
        // Forward audio to Deepgram
        const audio = Buffer.from(message.media.payload, 'base64');
        dgConnection.send(audio);
        activeCall.lastActivityAt = Date.now();
        break;

      case 'stop':
        logger.info({ callSid: activeCall.callSid }, 'Twilio stream stopped');
        break;
    }
  }

  private async handleTranscript(
    activeCall: ActiveCall,
    transcript: string,
    isFinal: boolean
  ): Promise<void> {
    if (!transcript.trim()) return;

    logger.debug({ 
      callSid: activeCall.callSid, 
      transcript, 
      isFinal 
    }, 'Transcript received');

    // Add to session transcript
    const entry: TranscriptEntry = {
      role: 'user',
      content: transcript,
      timestamp: Date.now(),
      isFinal,
    };

    activeCall.session.context.transcript.push(entry);
    await this.sessionCache.setCallSession(activeCall.callSid, activeCall.session);

    // Only process final transcripts
    if (!isFinal) return;

    // Prevent overlapping processing
    if (activeCall.isProcessing) {
      logger.debug({ callSid: activeCall.callSid }, 'Already processing, queuing');
      return;
    }

    activeCall.isProcessing = true;

    try {
      // Generate AI response
      const response = await activeCall.conversationEngine.process(
        activeCall.session.context,
        transcript
      );

      // Add response to transcript
      const responseEntry: TranscriptEntry = {
        role: 'assistant',
        content: response.text,
        timestamp: Date.now(),
        isFinal: true,
      };
      activeCall.session.context.transcript.push(responseEntry);

      // Update state if changed
      if (response.newState) {
        activeCall.session.context.currentState = response.newState;
      }

      // Handle any actions
      if (response.actions && response.actions.length > 0) {
        await this.handleActions(activeCall, response.actions);
      }

      // Send audio response
      await this.sendAudioResponse(activeCall, response.text);

      // Update session
      await this.sessionCache.setCallSession(activeCall.callSid, activeCall.session);

    } catch (error) {
      logger.error({ error, callSid: activeCall.callSid }, 'Error processing transcript');
      await this.sendAudioResponse(
        activeCall, 
        "I apologize, I'm having some trouble. Let me connect you with someone who can help."
      );
    } finally {
      activeCall.isProcessing = false;
    }
  }

  private async sendGreeting(activeCall: ActiveCall): Promise<void> {
    const { customer } = activeCall.session.context;
    const tenant = await prisma.tenant.findUnique({
      where: { id: activeCall.session.tenantId },
    });

    let greeting: string;

    if (customer && customer.name && (customer.callCount ?? 0) > 0) {
      greeting = `Welcome back${customer.name ? ', ' + customer.name : ''}! How can I help you today?`;
    } else {
      greeting = `Thank you for calling ${tenant?.name || 'us'}! How can I help you today?`;
    }

    activeCall.session.context.currentState = 'intent_detection' as ConversationState;

    const entry: TranscriptEntry = {
      role: 'assistant',
      content: greeting,
      timestamp: Date.now(),
      isFinal: true,
    };
    activeCall.session.context.transcript.push(entry);

    await this.sendAudioResponse(activeCall, greeting);
    await this.sessionCache.setCallSession(activeCall.callSid, activeCall.session);
  }

  private async sendAudioResponse(activeCall: ActiveCall, text: string): Promise<void> {
    if (!activeCall.streamSid || !activeCall.ws) return;

    try {
      // Generate audio using ElevenLabs
      const audioChunks = await activeCall.elevenlabs.synthesize(text);

      // Send audio chunks to Twilio
      for (const chunk of audioChunks) {
        const message = {
          event: 'media',
          streamSid: activeCall.streamSid,
          media: {
            payload: chunk.toString('base64'),
          },
        };

        if (activeCall.ws.readyState === 1) { // WebSocket.OPEN
          activeCall.ws.send(JSON.stringify(message));
        }
      }

      // Send mark to indicate end of speech
      const markMessage = {
        event: 'mark',
        streamSid: activeCall.streamSid,
        mark: { name: `response-${Date.now()}` },
      };
      
      if (activeCall.ws.readyState === 1) {
        activeCall.ws.send(JSON.stringify(markMessage));
      }

    } catch (error) {
      logger.error({ error, callSid: activeCall.callSid }, 'Error sending audio response');
    }
  }

  private async handleActions(activeCall: ActiveCall, actions: any[]): Promise<void> {
    for (const action of actions) {
      try {
        logger.info({ callSid: activeCall.callSid, action }, 'Executing action');

        const actionType = mapToolNameToCallActionType(action.type);
        if (actionType) {
          await prisma.callAction.create({
            data: {
              callId: activeCall.session.id,
              type: actionType,
              data: action.data || {},
            },
          });
        }

        switch (action.type) {
          // Persisted in ConversationEngine via ActionExecutor.createBooking
          case 'create_booking':
            break;

          case 'transfer_to_human':
            await this.executeTransferAction(activeCall, action.data);
            break;

          case 'check_availability':
            break;
        }
      } catch (error) {
        logger.error({ error, action }, 'Error executing action');
      }
    }
  }

  private async executeTransferAction(activeCall: ActiveCall, data: any): Promise<void> {
    activeCall.session.context.currentState = 'human_handoff' as ConversationState;

    // Update call record
    await prisma.call.update({
      where: { twilioCallSid: activeCall.callSid },
      data: { wasTransferred: true },
    });

    // In production, this would initiate actual transfer
    logger.info({ 
      callSid: activeCall.callSid, 
      reason: data.reason 
    }, 'Transfer requested');
  }

  async handleStatusCallback(event: Record<string, any>): Promise<void> {
    const { CallSid, CallStatus, CallDuration } = event;

    logger.info({ callSid: CallSid, status: CallStatus }, 'Call status update');

    const statusMap: Record<string, string> = {
      'queued': 'RINGING',
      'ringing': 'RINGING',
      'in-progress': 'IN_PROGRESS',
      'completed': 'COMPLETED',
      'busy': 'BUSY',
      'failed': 'FAILED',
      'no-answer': 'NO_ANSWER',
    };

    const updateData: any = {
      status: statusMap[CallStatus] || 'COMPLETED',
    };

    if (CallStatus === 'completed' || CallStatus === 'failed') {
      updateData.endedAt = new Date();
      if (CallDuration) {
        updateData.duration = parseInt(CallDuration);
      }

      // Get session for summary
      const session = await this.sessionCache.getCallSession(CallSid);
      if (session) {
        // Update usage
        await prisma.tenant.update({
          where: { id: session.tenantId },
          data: {
            minutesUsed: {
              increment: Math.ceil((parseInt(CallDuration) || 0) / 60),
            },
          },
        });

        // Store transcript
        updateData.transcript = session.context.transcript;

        // Clean up session
        await this.sessionCache.deleteCallSession(CallSid);
      }
    } else if (CallStatus === 'in-progress') {
      updateData.answeredAt = new Date();
    }

    await prisma.call.updateMany({
      where: { twilioCallSid: CallSid },
      data: updateData,
    });
  }

  async handleRecordingCallback(event: Record<string, any>): Promise<void> {
    const { CallSid, RecordingSid, RecordingUrl, RecordingDuration } = event;

    await prisma.call.updateMany({
      where: { twilioCallSid: CallSid },
      data: {
        twilioRecordingSid: RecordingSid,
        recordingUrl: RecordingUrl,
        recordingDuration: parseInt(RecordingDuration) || null,
      },
    });

    logger.info({ callSid: CallSid, recordingSid: RecordingSid }, 'Recording saved');
  }

  private async initializeSession(
    tenant: any,
    customer: any,
    call: any
  ): Promise<CallSession> {
    // Get previous calls for context
    const previousCalls = await prisma.call.findMany({
      where: { customerId: customer.id },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        createdAt: true,
        summary: true,
        outcome: true,
        sentiment: true,
      },
    });

    const context: ConversationContext = {
      tenantId: tenant.id,
      callId: call.id,
      businessName: tenant.name,
      industry: tenant.industry,
      customer: {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        isVip: customer.isVip,
        preferences: customer.preferences || {},
        previousCalls: previousCalls.map(c => ({
          id: c.id,
          date: c.createdAt.toISOString(),
          summary: c.summary || '',
          outcome: c.outcome || '',
          sentiment: c.sentiment || 0,
        })),
        lifetimeValue: Number(customer.lifetimeValue),
      },
      transcript: [],
      currentState: 'greeting' as ConversationState,
      detectedIntents: [],
      pendingActions: [],
      config: {
        businessName: tenant.name,
        industry: tenant.industry,
        timezone: tenant.timezone,
        operatingHours: tenant.operatingHours as any,
        voiceConfig: {
          voiceId: tenant.voiceId || '',
          stability: 0.5,
          similarityBoost: 0.75,
        },
        features: {
          enableUpselling: true,
          enableMemory: true,
          enableABTesting: tenant.plan !== 'STARTER',
          enableSentimentAnalysis: true,
          enableCallRecording: true,
          maxCallDuration: 1800, // 30 minutes
        },
        integrations: {
          n8n: {
            webhookUrl: process.env.N8N_WEBHOOK_URL || '',
            enabled: !!process.env.N8N_WEBHOOK_URL,
          },
        },
        restaurantConfig: tenant.config as any,
      },
    };

    return {
      id: call.id,
      tenantId: tenant.id,
      callSid: call.twilioCallSid,
      status: 'initializing',
      context,
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
    };
  }

  private async cleanupCall(activeCall: ActiveCall): Promise<void> {
    // Close Deepgram connection
    activeCall.deepgram.disconnect();

    // Remove from active calls
    this.activeCalls.delete(activeCall.callSid);

    logger.info({ callSid: activeCall.callSid }, 'Call cleaned up');
  }
}

interface ActiveCall {
  callSid: string;
  session: CallSession;
  ws: WebSocket;
  deepgram: DeepgramService;
  elevenlabs: ElevenLabsService;
  conversationEngine: ConversationEngine;
  streamSid: string | null;
  greetingSent: boolean;
  isProcessing: boolean;
  audioBuffer: Buffer[];
  lastActivityAt: number;
}

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '@voicedesk/database';
import { NotFoundError, UnauthorizedError } from '../../shared/errors.js';
import { CallOrchestrator } from './orchestrator.js';
import { TwilioService } from '../../integrations/twilio/service.js';

export async function registerCallRoutes(fastify: FastifyInstance) {
  const twilioService = new TwilioService();
  const callOrchestrator = new CallOrchestrator(fastify.redis, twilioService);

  // Auth middleware for API routes
  const authMiddleware = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      throw new UnauthorizedError('Invalid or expired token');
    }
  };

  // Get calls list
  fastify.get('/', {
    preHandler: [authMiddleware],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { tenantId } = request.user as any;
    const { page = '1', limit = '20', status, outcome, startDate, endDate } = request.query as any;

    const where: any = { tenantId };

    if (status) {
      where.status = status;
    }

    if (outcome) {
      where.outcome = outcome;
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [calls, total] = await Promise.all([
      prisma.call.findMany({
        where,
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
        include: {
          customer: {
            select: { id: true, name: true, phone: true, isVip: true },
          },
        },
      }),
      prisma.call.count({ where }),
    ]);

    return {
      success: true,
      data: calls,
      meta: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    };
  });

  // Get single call with details
  fastify.get('/:callId', {
    preHandler: [authMiddleware],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { tenantId } = request.user as any;
    const { callId } = request.params as any;

    const call = await prisma.call.findFirst({
      where: { id: callId, tenantId },
      include: {
        customer: true,
        actions: {
          orderBy: { timestamp: 'asc' },
        },
      },
    });

    if (!call) {
      throw new NotFoundError('Call', callId);
    }

    return {
      success: true,
      data: call,
    };
  });

  // Get call transcript
  fastify.get('/:callId/transcript', {
    preHandler: [authMiddleware],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { tenantId } = request.user as any;
    const { callId } = request.params as any;

    const call = await prisma.call.findFirst({
      where: { id: callId, tenantId },
      select: { transcript: true, summary: true },
    });

    if (!call) {
      throw new NotFoundError('Call', callId);
    }

    return {
      success: true,
      data: {
        transcript: call.transcript,
        summary: call.summary,
      },
    };
  });

  // WebSocket endpoint for real-time call audio (Twilio Media Streams)
  fastify.get('/stream/:callSid', { websocket: true }, async (connection, request) => {
    const { callSid } = request.params as any;

    fastify.log.info({ callSid }, 'WebSocket connection for call stream');

    const socket =
      connection && typeof connection === 'object' && 'socket' in connection
        ? (connection as { socket: import('ws').WebSocket }).socket
        : (connection as import('ws').WebSocket);

    await callOrchestrator.handleMediaStream(socket, callSid);
  });

  // Twilio incoming call webhook
  fastify.post('/incoming', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as any;
    
    fastify.log.info({ callSid: body.CallSid, from: body.From }, 'Incoming call');

    const twiml = await callOrchestrator.handleIncomingCall(body);

    reply.type('text/xml');
    return twiml;
  });

  // Twilio call status callback
  fastify.post('/status', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as any;
    
    fastify.log.info({ 
      callSid: body.CallSid, 
      status: body.CallStatus,
      duration: body.CallDuration,
    }, 'Call status update');

    await callOrchestrator.handleStatusCallback(body);

    return { success: true };
  });

  // Twilio recording callback
  fastify.post('/recording', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as any;
    
    fastify.log.info({ 
      callSid: body.CallSid, 
      recordingSid: body.RecordingSid,
    }, 'Recording available');

    await callOrchestrator.handleRecordingCallback(body);

    return { success: true };
  });

  // Test call initiation (for development)
  fastify.post('/test', {
    preHandler: [authMiddleware],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { tenantId } = request.user as any;
    const { to } = request.body as any;

    if (process.env.NODE_ENV === 'production') {
      return reply.status(403).send({ error: 'Test calls disabled in production' });
    }

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant?.twilioNumber) {
      return reply.status(400).send({ error: 'No phone number configured' });
    }

    const call = await twilioService.initiateCall(tenant.twilioNumber, to, tenantId);

    return {
      success: true,
      data: { callSid: call.sid },
    };
  });
}

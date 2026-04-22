import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '@voicedesk/database';
import { logger } from '../../shared/logger.js';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2023-10-16',
});

export async function registerWebhookRoutes(fastify: FastifyInstance) {
  // Stripe webhook (raw body for signature verification — set by a content-type parser or proxy)
  fastify.post(
    '/stripe',
    {
      config: { rawBody: true },
    } as any,
    async (request: FastifyRequest, reply: FastifyReply) => {
    const sig = request.headers['stripe-signature'] as string;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
      logger.error('Stripe webhook secret not configured');
      return reply.status(500).send({ error: 'Webhook not configured' });
    }

    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(
        (request as any).rawBody,
        sig,
        webhookSecret
      );
    } catch (err: any) {
      logger.error({ err }, 'Stripe webhook signature verification failed');
      return reply.status(400).send({ error: `Webhook Error: ${err.message}` });
    }

    logger.info({ type: event.type }, 'Stripe webhook received');

    try {
      switch (event.type) {
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
          await handleSubscriptionChange(event.data.object as Stripe.Subscription);
          break;

        case 'customer.subscription.deleted':
          await handleSubscriptionCancelled(event.data.object as Stripe.Subscription);
          break;

        case 'invoice.paid':
          await handleInvoicePaid(event.data.object as Stripe.Invoice);
          break;

        case 'invoice.payment_failed':
          await handlePaymentFailed(event.data.object as Stripe.Invoice);
          break;

        default:
          logger.info({ type: event.type }, 'Unhandled Stripe event type');
      }
    } catch (err) {
      logger.error({ err, type: event.type }, 'Error processing Stripe webhook');
      return reply.status(500).send({ error: 'Webhook processing failed' });
    }

    return { received: true };
    }
  );

  // n8n webhook endpoint
  fastify.post('/n8n/:tenantId/:action', async (request: FastifyRequest, reply: FastifyReply) => {
    const { tenantId, action } = request.params as any;
    const body = request.body as any;

    logger.info({ tenantId, action }, 'n8n webhook received');

    // Verify tenant exists
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant) {
      return reply.status(404).send({ error: 'Tenant not found' });
    }

    try {
      switch (action) {
        case 'booking-confirmed':
          await handleBookingConfirmed(tenantId, body);
          break;

        case 'booking-cancelled':
          await handleBookingCancelled(tenantId, body);
          break;

        case 'reminder-sent':
          await handleReminderSent(tenantId, body);
          break;

        default:
          logger.warn({ action }, 'Unknown n8n webhook action');
      }
    } catch (err) {
      logger.error({ err, action }, 'Error processing n8n webhook');
      return reply.status(500).send({ error: 'Webhook processing failed' });
    }

    return { success: true };
  });

  // Generic tenant webhook endpoint
  fastify.post('/tenant/:webhookId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { webhookId } = request.params as any;
    const body = request.body as any;

    const webhook = await prisma.webhook.findUnique({
      where: { id: webhookId },
    });

    if (!webhook || !webhook.isActive) {
      return reply.status(404).send({ error: 'Webhook not found' });
    }

    // Verify signature if secret is set
    const signature = request.headers['x-webhook-signature'] as string;
    if (webhook.secret && signature) {
      const crypto = await import('crypto');
      const expectedSig = crypto
        .createHmac('sha256', webhook.secret)
        .update(JSON.stringify(body))
        .digest('hex');

      if (signature !== expectedSig) {
        return reply.status(401).send({ error: 'Invalid signature' });
      }
    }

    // Update last triggered
    await prisma.webhook.update({
      where: { id: webhookId },
      data: { lastTriggeredAt: new Date() },
    });

    logger.info({ webhookId, tenantId: webhook.tenantId }, 'Tenant webhook received');

    return { success: true };
  });
}

async function handleSubscriptionChange(subscription: Stripe.Subscription) {
  const customerId = subscription.customer as string;

  const tenant = await prisma.tenant.findFirst({
    where: { stripeCustomerId: customerId },
  });

  if (!tenant) {
    logger.warn({ customerId }, 'No tenant found for Stripe customer');
    return;
  }

  // Map price to plan
  const priceId = subscription.items.data[0]?.price.id;
  const planMap: Record<string, 'STARTER' | 'GROWTH' | 'PRO' | 'ENTERPRISE'> = {
    [process.env.STRIPE_PRICE_STARTER || '']: 'STARTER',
    [process.env.STRIPE_PRICE_GROWTH || '']: 'GROWTH',
    [process.env.STRIPE_PRICE_PRO || '']: 'PRO',
  };

  const plan = planMap[priceId] || 'STARTER';
  const minutesMap = { STARTER: 500, GROWTH: 2000, PRO: 5000, ENTERPRISE: 99999 };

  await prisma.tenant.update({
    where: { id: tenant.id },
    data: {
      plan,
      minutesIncluded: minutesMap[plan],
      isActive: subscription.status === 'active',
    },
  });

  logger.info({ tenantId: tenant.id, plan }, 'Tenant plan updated');
}

async function handleSubscriptionCancelled(subscription: Stripe.Subscription) {
  const customerId = subscription.customer as string;

  await prisma.tenant.updateMany({
    where: { stripeCustomerId: customerId },
    data: {
      plan: 'STARTER',
      minutesIncluded: 500,
    },
  });

  logger.info({ customerId }, 'Subscription cancelled, reverted to Starter');
}

async function handleInvoicePaid(invoice: Stripe.Invoice) {
  const customerId = invoice.customer as string;

  const tenant = await prisma.tenant.findFirst({
    where: { stripeCustomerId: customerId },
  });

  if (!tenant) return;

  // Reset monthly usage
  await prisma.tenant.update({
    where: { id: tenant.id },
    data: { minutesUsed: 0 },
  });

  logger.info({ tenantId: tenant.id }, 'Invoice paid, usage reset');
}

async function handlePaymentFailed(invoice: Stripe.Invoice) {
  const customerId = invoice.customer as string;

  const tenant = await prisma.tenant.findFirst({
    where: { stripeCustomerId: customerId },
  });

  if (!tenant) return;

  // TODO: Send notification to tenant
  logger.warn({ tenantId: tenant.id }, 'Payment failed');
}

async function handleBookingConfirmed(tenantId: string, data: any) {
  const { bookingId, externalId } = data;

  await prisma.booking.update({
    where: { id: bookingId },
    data: {
      status: 'confirmed',
      confirmedAt: new Date(),
      externalId,
    },
  });
}

async function handleBookingCancelled(tenantId: string, data: any) {
  const { bookingId, reason } = data;

  await prisma.booking.update({
    where: { id: bookingId },
    data: {
      status: 'cancelled',
      cancelledAt: new Date(),
    },
  });
}

async function handleReminderSent(tenantId: string, data: any) {
  const { bookingId, reminderType } = data;

  const updateData: any = {};
  if (reminderType === '24h') {
    updateData.reminder24hSent = true;
  } else if (reminderType === '2h') {
    updateData.reminder2hSent = true;
  }

  await prisma.booking.update({
    where: { id: bookingId },
    data: updateData,
  });
}

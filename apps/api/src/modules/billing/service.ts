import Stripe from 'stripe';
import { prisma } from '@voicedesk/database';
import { logger } from '../../shared/logger.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2023-10-16',
});

export const PLANS = {
  STARTER: {
    name: 'Starter',
    price: 99,
    minutes: 500,
    features: ['Basic AI receptionist', '1 phone number', 'Email support'],
    stripePriceId: process.env.STRIPE_PRICE_STARTER,
  },
  GROWTH: {
    name: 'Growth',
    price: 299,
    minutes: 2000,
    features: ['Custom voice', 'Integrations', 'Analytics dashboard', 'Priority support'],
    stripePriceId: process.env.STRIPE_PRICE_GROWTH,
  },
  PRO: {
    name: 'Pro',
    price: 599,
    minutes: 5000,
    features: ['Multiple numbers', 'A/B testing', 'API access', 'White-label option', 'Dedicated support'],
    stripePriceId: process.env.STRIPE_PRICE_PRO,
  },
  ENTERPRISE: {
    name: 'Enterprise',
    price: null,
    minutes: -1,
    features: ['Unlimited minutes', 'Custom integrations', 'SLA', 'Dedicated account manager'],
    stripePriceId: null,
  },
};

export class BillingService {
  async createCustomer(tenantId: string, email: string, name: string): Promise<string> {
    const customer = await stripe.customers.create({
      email,
      name,
      metadata: {
        tenantId,
      },
    });

    await prisma.tenant.update({
      where: { id: tenantId },
      data: { stripeCustomerId: customer.id },
    });

    logger.info({ tenantId, customerId: customer.id }, 'Stripe customer created');

    return customer.id;
  }

  async createSubscription(
    tenantId: string,
    plan: keyof typeof PLANS,
    paymentMethodId?: string
  ): Promise<{ subscriptionId: string; clientSecret?: string }> {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant) {
      throw new Error('Tenant not found');
    }

    let customerId = tenant.stripeCustomerId;
    if (!customerId) {
      const user = await prisma.user.findFirst({
        where: { tenantId, role: 'OWNER' },
      });
      customerId = await this.createCustomer(tenantId, user?.email || '', tenant.name);
    }

    const planConfig = PLANS[plan];
    if (!planConfig.stripePriceId) {
      throw new Error('Invalid plan or enterprise plan requires custom setup');
    }

    // Attach payment method if provided
    if (paymentMethodId) {
      await stripe.paymentMethods.attach(paymentMethodId, {
        customer: customerId,
      });
      await stripe.customers.update(customerId, {
        invoice_settings: {
          default_payment_method: paymentMethodId,
        },
      });
    }

    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: planConfig.stripePriceId }],
      payment_behavior: 'default_incomplete',
      payment_settings: {
        save_default_payment_method: 'on_subscription',
      },
      expand: ['latest_invoice.payment_intent'],
      metadata: {
        tenantId,
        plan,
      },
    });

    const invoice = subscription.latest_invoice as Stripe.Invoice;
    const paymentIntent = invoice?.payment_intent as Stripe.PaymentIntent;

    logger.info({ tenantId, subscriptionId: subscription.id, plan }, 'Subscription created');

    return {
      subscriptionId: subscription.id,
      clientSecret: paymentIntent?.client_secret || undefined,
    };
  }

  async cancelSubscription(tenantId: string): Promise<void> {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant?.stripeCustomerId) {
      throw new Error('No billing account found');
    }

    const subscriptions = await stripe.subscriptions.list({
      customer: tenant.stripeCustomerId,
      status: 'active',
    });

    for (const subscription of subscriptions.data) {
      await stripe.subscriptions.cancel(subscription.id);
    }

    await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        plan: 'STARTER',
        minutesIncluded: 500,
      },
    });

    logger.info({ tenantId }, 'Subscription cancelled');
  }

  async changePlan(tenantId: string, newPlan: keyof typeof PLANS): Promise<void> {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant?.stripeCustomerId) {
      throw new Error('No billing account found');
    }

    const planConfig = PLANS[newPlan];
    if (!planConfig.stripePriceId) {
      throw new Error('Invalid plan');
    }

    const subscriptions = await stripe.subscriptions.list({
      customer: tenant.stripeCustomerId,
      status: 'active',
    });

    if (subscriptions.data.length === 0) {
      throw new Error('No active subscription found');
    }

    const subscription = subscriptions.data[0];

    await stripe.subscriptions.update(subscription.id, {
      items: [
        {
          id: subscription.items.data[0].id,
          price: planConfig.stripePriceId,
        },
      ],
      proration_behavior: 'create_prorations',
    });

    await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        plan: newPlan,
        minutesIncluded: planConfig.minutes,
      },
    });

    logger.info({ tenantId, newPlan }, 'Plan changed');
  }

  async recordUsage(tenantId: string, minutes: number): Promise<void> {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant) return;

    // Update local usage
    await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        minutesUsed: { increment: minutes },
      },
    });

    // Record overage with Stripe if applicable
    if (tenant.minutesUsed + minutes > tenant.minutesIncluded && tenant.stripeCustomerId) {
      const overageMinutes = Math.max(0, (tenant.minutesUsed + minutes) - tenant.minutesIncluded);
      
      await stripe.subscriptionItems.createUsageRecord(
        await this.getMeteredSubscriptionItemId(tenant.stripeCustomerId),
        {
          quantity: overageMinutes,
          timestamp: Math.floor(Date.now() / 1000),
          action: 'set',
        }
      );
    }
  }

  private async getMeteredSubscriptionItemId(customerId: string): Promise<string> {
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: 'active',
    });

    const meteredItem = subscriptions.data[0]?.items.data.find(
      item => item.price.recurring?.usage_type === 'metered'
    );

    if (!meteredItem) {
      throw new Error('No metered subscription item found');
    }

    return meteredItem.id;
  }

  async getInvoices(tenantId: string): Promise<any[]> {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant?.stripeCustomerId) {
      return [];
    }

    const invoices = await stripe.invoices.list({
      customer: tenant.stripeCustomerId,
      limit: 12,
    });

    return invoices.data.map(invoice => ({
      id: invoice.id,
      number: invoice.number,
      amount: invoice.amount_due / 100,
      status: invoice.status,
      date: new Date(invoice.created * 1000).toISOString(),
      pdfUrl: invoice.invoice_pdf,
    }));
  }

  async createPortalSession(tenantId: string): Promise<string> {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant?.stripeCustomerId) {
      throw new Error('No billing account found');
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: tenant.stripeCustomerId,
      return_url: `${process.env.DASHBOARD_URL}/dashboard/settings/billing`,
    });

    return session.url;
  }

  async getPaymentMethods(tenantId: string): Promise<any[]> {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant?.stripeCustomerId) {
      return [];
    }

    const paymentMethods = await stripe.paymentMethods.list({
      customer: tenant.stripeCustomerId,
      type: 'card',
    });

    return paymentMethods.data.map(pm => ({
      id: pm.id,
      brand: pm.card?.brand,
      last4: pm.card?.last4,
      expMonth: pm.card?.exp_month,
      expYear: pm.card?.exp_year,
      isDefault: false,
    }));
  }
}

export const billingService = new BillingService();

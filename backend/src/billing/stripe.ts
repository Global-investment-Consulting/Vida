import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_TEST || '', { apiVersion: '2024-06-20' });

export async function createTestCheckout(sessionData: any) {
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    mode: 'subscription',
    line_items: [{ price: process.env.STRIPE_TEST_PRICE_ID!, quantity: 1 }],
    success_url: `${process.env.FRONTEND_URL}/success`,
    cancel_url: `${process.env.FRONTEND_URL}/cancel`,
    metadata: sessionData
  });
  return session.url;
}

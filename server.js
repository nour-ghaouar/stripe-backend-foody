import express from "express";
import cors from "cors";
import Stripe from "stripe";

const app = express();
app.use(cors());
app.use(express.json());

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// helper: convert amount to Stripe smallest unit
// If you use TND: smallest unit is 3 decimals (millimes) => total * 1000
// If EUR/USD: cents => total * 100
function toSmallestUnit(total, currency) {
  const n = Number(total);
  if (!Number.isFinite(n)) return 0;

  const c = (currency || "tnd").toLowerCase();
  const factor = (c === "tnd") ? 1000 : 100;
  return Math.round(n * factor);
}

// POST /create-checkout-session
app.post("/create-checkout-session", async (req, res) => {
  try {
    const { orderId, total, currency, successUrl, cancelUrl } = req.body;

    if (!orderId || !successUrl || !cancelUrl) {
      return res.status(400).json({ error: "Missing orderId/successUrl/cancelUrl" });
    }

    const cur = (currency || "tnd").toLowerCase();
    const amount = toSmallestUnit(total, cur);
    if (amount <= 0) return res.status(400).json({ error: "Invalid total" });

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: cur,
            product_data: { name: `Order ${orderId}` },
            unit_amount: amount
          },
          quantity: 1
        }
      ],
      metadata: { orderId },
      success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}&orderId=${encodeURIComponent(orderId)}`,
      cancel_url: `${cancelUrl}?orderId=${encodeURIComponent(orderId)}`
    });

    res.json({ checkoutUrl: session.url, sessionId: session.id });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// GET /verify-session?session_id=...
app.get("/verify-session", async (req, res) => {
  try {
    const { session_id } = req.query;
    if (!session_id) return res.status(400).json({ error: "Missing session_id" });

    const session = await stripe.checkout.sessions.retrieve(session_id);

    res.json({
      payment_status: session.payment_status, // "paid" / "unpaid"
      status: session.status,                 // "complete" etc.
      orderId: session.metadata?.orderId || null
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/", (req, res) => res.send("OK"));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("Stripe backend running on", port));
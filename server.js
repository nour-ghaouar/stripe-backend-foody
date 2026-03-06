import express from "express";
import cors from "cors";
import Stripe from "stripe";

const app = express();

// IMPORTANT: autoriser FlutterFlow Web
app.use(cors({ origin: true }));
app.use(express.json());

if (!process.env.STRIPE_SECRET_KEY) {
  console.error("❌ STRIPE_SECRET_KEY missing in env");
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Convert "30", 30, "30.5", "30DT" -> number
function parseTotal(total) {
  if (total === null || total === undefined) return NaN;
  if (typeof total === "number") return total;
  const s = String(total).replace(",", ".").replace(/[^\d.]/g, ""); // remove DT etc
  return Number(s);
}

function toSmallestUnit(total, currency) {
  const n = parseTotal(total);
  if (!Number.isFinite(n)) return NaN;

  const cur = (currency || "eur").toLowerCase();
  // Stripe supports EUR/USD easily. TND depends on your Stripe account setup.
  const factor = (cur === "tnd") ? 1000 : 100;
  return Math.round(n * factor);
}

// POST /create-checkout-session
app.post("/create-checkout-session", async (req, res) => {
  try {
    const { orderId, total, currency, successUrl, cancelUrl } = req.body;

    if (!orderId || !successUrl || !cancelUrl) {
      return res.status(400).json({ error: "Missing orderId/successUrl/cancelUrl" });
    }

    const cur = (currency || "eur").toLowerCase();

    const amount = toSmallestUnit(total, cur);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({
        error: "Invalid total",
        receivedTotal: total,
        parsedAmount: amount
      });
    }

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
      success_url: `${successUrl}?sessionId={CHECKOUT_SESSION_ID}&orderId=${encodeURIComponent(orderId)}`,
      cancel_url: `${cancelUrl}?orderId=${encodeURIComponent(orderId)}`
    });

    return res.json({
      checkoutUrl: session.url,
      sessionId: session.id
    });
  } catch (e) {
    console.error("❌ create-checkout-session error:", e);
    return res.status(400).json({ error: e.message });
  }
});

// GET /verify-session?session_id=...
app.get("/verify-session", async (req, res) => {
  try {
    const { sessionId } = req.query;
    if (!sessionId) return res.status(400).json({ error: "Missing sessionId" });

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    return res.json({
      payment_status: session.payment_status, // paid/unpaid
      status: session.status,                // complete/open
      orderId: session.metadata?.orderId || null
    });
  } catch (e) {
    console.error("❌ verify-session error:", e);
    return res.status(400).json({ error: e.message });
  }
});

app.get("/", (req, res) => res.send("OK"));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("✅ Stripe backend running on", port));

import express from "express";
import cors from "cors";
import Stripe from "stripe";

const app = express();

/**
 * ✅ CORS: autorise FlutterFlow / navigateur
 * (tu peux mettre origin: "https://ton-domaine" plus tard si tu veux sécuriser)
 */
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.options("*", cors());

// ✅ JSON body
app.use(express.json({ limit: "1mb" }));

/**
 * ✅ Vérif env Stripe
 */
const secret = process.env.STRIPE_SECRET_KEY;
if (!secret) {
  console.error("❌ STRIPE_SECRET_KEY is missing in environment variables");
}

const stripe = new Stripe(secret || "sk_test_missing", {
  apiVersion: "2024-06-20",
});

/**
 * helper: convert amount to smallest unit
 * - TND: millimes => *1000
 * - EUR/USD: cents => *100
 */
function toSmallestUnit(total, currency) {
  const n = Number(total);
  if (!Number.isFinite(n)) return 0;

  const c = (currency || "tnd").toLowerCase();
  const factor = c === "tnd" ? 1000 : 100;
  return Math.round(n * factor);
}

/**
 * ✅ Routes "instant" pour éviter "Application loading"
 */
app.get("/", (req, res) => res.status(200).send("OK"));
app.get("/health", (req, res) => res.status(200).json({ ok: true }));

/**
 * ✅ POST /create-checkout-session
 * Body attendu (FlutterFlow):
 * {
 *   "orderId": "...",
 *   "total": 230.2,
 *   "currency": "tnd",
 *   "successUrl": "https://.../success",
 *   "cancelUrl": "https://.../cancel"
 * }
 */
app.post("/create-checkout-session", async (req, res) => {
  try {
    const { orderId, total, currency, successUrl, cancelUrl } = req.body || {};

    if (!secret) {
      return res.status(500).json({ error: "Server misconfigured: STRIPE_SECRET_KEY missing" });
    }

    if (!orderId || !successUrl || !cancelUrl) {
      return res.status(400).json({ error: "Missing orderId/successUrl/cancelUrl" });
    }

    const cur = (currency || "tnd").toLowerCase();
    const amount = toSmallestUnit(total, cur);
    if (amount <= 0) {
      return res.status(400).json({ error: "Invalid total" });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: cur,
            product_data: { name: `Order ${orderId}` },
            unit_amount: amount,
          },
          quantity: 1,
        },
      ],
      metadata: { orderId },

      // On ajoute session_id et orderId dans l’URL
      success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}&orderId=${encodeURIComponent(
        orderId
      )}`,
      cancel_url: `${cancelUrl}?orderId=${encodeURIComponent(orderId)}`,
    });

    return res.json({
      checkoutUrl: session.url,
      sessionId: session.id,
    });
  } catch (e) {
    return res.status(400).json({ error: e?.message || "Stripe error" });
  }
});

/**
 * ✅ GET /verify-session?session_id=...
 * renvoie payment_status + orderId
 */
app.get("/verify-session", async (req, res) => {
  try {
    const session_id = req.query?.session_id;

    if (!secret) {
      return res.status(500).json({ error: "Server misconfigured: STRIPE_SECRET_KEY missing" });
    }

    if (!session_id) {
      return res.status(400).json({ error: "Missing session_id" });
    }

    const session = await stripe.checkout.sessions.retrieve(session_id);

    return res.json({
      payment_status: session.payment_status, // paid / unpaid
      status: session.status, // complete / open
      orderId: session.metadata?.orderId || null,
    });
  } catch (e) {
    return res.status(400).json({ error: e?.message || "Verify error" });
  }
});

// ✅ Render: écouter sur 0.0.0.0
const port = process.env.PORT || 3000;
app.listen(port, "0.0.0.0", () => {
  console.log(`✅ Stripe backend running on http://0.0.0.0:${port}`);
});

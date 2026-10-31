import express from "express";
import "dotenv/config";

import paymentRoutes from "./routes/payment.routes.js";

const app = express();

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({
    status: "healthy",
    service: "recourse-paypal",
  });
});

app.use("/api/payments", paymentRoutes);

const PORT = Number(process.env.PORT) || 5000;

app.get("/paypal/return", (req, res) => {
  res.send(`
    <h2>PayPal approval completed</h2>
    <p>Return to Postman and exchange your setupTokenId.</p>
    <p>You can now continue the Recourse payment test.</p>
  `);
});

app.get("/paypal/cancel", (_req, res) => {
  res.send("Buyer cancelled the PayPal approval.");
});

app.listen(PORT, () => {
  console.log(`Recourse running on http://localhost:${PORT}`);
});

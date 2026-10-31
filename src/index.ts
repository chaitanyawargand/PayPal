
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

app.listen(PORT, () => {
  console.log(`Recourse running on http://localhost:${PORT}`);
});

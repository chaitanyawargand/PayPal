
import { Router } from "express";

import {
  createSetupToken,
  createPaymentToken,
  chargeBuyer,
  verifyOrder,
} from "../services/paypal.service.js";

const router = Router();

// Step 1: Generate buyer approval URL
router.post("/setup", async (_req, res) => {
  try {
    const result = await createSetupToken();

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    res.status(500).json({
      error: String(error),
    });
  }
});

// Step 2A: Exchange approved setup token
router.post("/vault", async (req, res) => {
  try {
    const { setupTokenId } = req.body;

    if (!setupTokenId) {
      res.status(400).json({
        error: "setupTokenId is required",
      });
      return;
    }

    const result = await createPaymentToken(setupTokenId);

    res.json({
      success: true,
      vaultId: result.id,
      customer: result.customer,
    });
  } catch (error) {
    res.status(500).json({
      error: String(error),
    });
  }
});

// Step 2B: Charge saved buyer
router.post("/charge", async (req, res) => {
  try {
    const { vaultId, receiptId, amount } = req.body;

    if (!vaultId || !receiptId) {
      res.status(400).json({
        error: "vaultId and receiptId are required",
      });
      return;
    }

    const result = await chargeBuyer(
      vaultId,
      receiptId,
      amount ?? "10.00"
    );

    res.json({
      success: true,
      order: result,
    });
  } catch (error) {
    res.status(500).json({
      error: String(error),
    });
  }
});

// Step 3: Verify transaction
router.get("/verify/:orderId", async (req, res) => {
  try {
    const result = await verifyOrder(req.params.orderId);

    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: String(error),
    });
  }
});

export default router;

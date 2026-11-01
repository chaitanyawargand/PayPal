# Spike B — MCP (PayPal Agent Toolkit)

**Mode:** OFFICIAL  
**App Name:** Recourse-Merchant  
**Merchant App Client ID (prefix):** AZRxc...  
**Stack:** Node.js + TypeScript (ESM) + `@paypal/agent-toolkit@1.11.0`  

---

## 1. Discovered Tool Names
Discovered 47 tools from `@paypal/agent-toolkit` (using `ALL_TOOLS_ENABLED`):

```
create_invoice, create_recurring_series, activate_recurring_series, get_recurring_series, cancel_recurring_series, delete_recurring_series, list_invoices, get_invoice, send_invoice, send_invoice_reminder, cancel_sent_invoice, delete_invoice, setup_invoice_auto_reminders, update_invoice_auto_reminder, search_invoicing, update_invoicing, cancel_invoice_auto_reminder, generate_invoice_qr_code, generate_invoice_number, record_payment_for_invoice, record_refund_for_invoice, create_conditional_rules_for_invoice, create_product, list_products, update_product, show_product_details, create_subscription_plan, list_subscription_plans, show_subscription_plan_details, create_subscription, show_subscription_details, cancel_subscription, update_subscription, create_shipment_tracking, get_shipment_tracking, update_shipment_tracking, create_order, get_order, pay_order, list_disputes, get_dispute, accept_dispute_claim, list_transactions, update_plan, create_refund, get_refund, get_merchant_insights
```

Key Agent Tool Buttons used in Recourse:
- `create_order` — Initiates an order
- `get_order` — Verifies state, amount, and status
- `pay_order` — Captures payment for authorized order

---

## 2. Checklist
- [x] Official PayPal MCP ran with our app
- [x] I saw the real tool names: `create_order, get_order, pay_order, ...` (47 tools total)
- [ ] I created an order through MCP and got order ID: `[PASTE_ORDER_ID_HERE]`
- [ ] My Guard blocked a $10 call before PayPal saw it

Blocker if failed: None (OFFICIAL mode working)

---

## 3. Evidence

### A. MCP Order Creation (`src/spikes/spike_mcp.ts`)
```
Order ID: [Run npx tsx src/spikes/spike_mcp.ts and paste here]
Status: CREATED
```

### B. Guard Interception Output (`src/spikes/test_guard.ts`)
```
[Paste output of test_guard.ts showing status: "BLOCKED", paypal_contacted: false]
```


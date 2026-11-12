// Recourse Control Center — Linear One-Page Judge Flow Client
// Senior Software Engineering Standards: Deterministic state machine, double-click protection, strict integer cents.

(function () {
  "use strict";

  // --- Utility Functions ---
  function escapeHtml(str) {
    if (typeof str !== "string") return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatCents(cents) {
    if (typeof cents !== "number" || !Number.isFinite(cents) || !Number.isInteger(cents) || cents < 0) return "Unavailable";
    return `$${(cents / 100).toFixed(2)}`;
  }

  function parseDollarToCents(val) {
    if (typeof val === "number") {
      if (!Number.isFinite(val) || val <= 0) return null;
      return Math.round(val * 100);
    }
    if (typeof val === "string") {
      const cleaned = val.replace(/[$,]/g, "").trim();
      if (!cleaned) return null;
      const num = parseFloat(cleaned);
      if (!Number.isFinite(num) || num <= 0) return null;
      return Math.round(num * 100);
    }
    return null;
  }

  function mapReasonCodeToPlainEnglish(code) {
    const map = {
      AI_JUDGE_BLOCK: "This merchant listing includes a prohibited recurring subscription and hidden drip fees.",
      AI_JUDGE_STEP_UP: "The listing contains unverified seller or final-sale terms that require explicit human approval.",
      AI_JUDGE_UNAVAILABLE: "AI Safety Review was unavailable; tightened to human review as a safety fail-safe.",
      TOTAL_MISMATCH: "The store's signed total did not match the computed total of its line items.",
      BLOCKED_CATEGORY: "This purchase includes a prohibited category (such as a gift card or auto-renewing subscription).",
      PROHIBITED_SUBSCRIPTION: "This purchase includes a prohibited auto-renewing subscription.",
      SUBSCRIPTION_DETECTED: "This purchase includes a prohibited auto-renewing subscription.",
      PROHIBITED_CATEGORY: "The item belongs to a prohibited category (e.g. gift cards or subscriptions).",
      BUDGET_EXCEEDED: "The total exceeds the signed budget limit.",
      CAP_EXCEEDED: "The total exceeds the signed per-order cap.",
      PAYEE_NOT_ALLOWED: "The merchant is not the payee authorized in the contract.",
      MERCHANT_MISMATCH: "The merchant does not match the authorized payee in the spending contract.",
      UNVERIFIED_SELLER: "The seller is unverified and requires human review.",
      ADVERSE_TERMS: "The store added hidden fees or unfavorable terms (drip pricing).",
      FINAL_SALE: "The listing is final sale with no returns allowed.",
      QUOTE_EXPIRED: "The store's signed quote has expired.",
      QUOTE_ID_MISMATCH: "The quote ID did not match the merchant record.",
      INVALID_SIGNATURE: "The store's cryptographic signature could not be verified.",
      TAMPER_REJECT: "The quote was rejected as tampered; signed total did not match line items.",
    };
    return map[code] || `Payment check failed with rule code: ${code}`;
  }

  // --- Explicit State Object ---
  const state = {
    generation: 0,
    runId: null,
    afterSeq: 0,
    latestRun: null,
    candidates: [],
    agentPickId: null,
    selectedCandidateId: null,
    selectedOnServerId: null,
    currentStep: 1, // 1: Shop, 2: Agent's Pick, 3: Review Contract, 4: Payment Decision
    busy: false,
    lastDecision: null,
    receiptId: null,
    evidenceResult: null,
    pollTimer: null,
    systemStatus: null,
  };

  // --- DOM Elements ---
  const el = {
    // Header Statuses
    novamartDot: document.getElementById("novamart-dot"),
    novamartStatus: document.getElementById("novamart-status"),
    dealdemonDot: document.getElementById("dealdemon-dot"),
    dealdemonStatus: document.getElementById("dealdemon-status"),
    peermarketDot: document.getElementById("peermarket-dot"),
    peermarketStatus: document.getElementById("peermarket-status"),
    gatewayDot: document.getElementById("gateway-dot"),
    gatewayStatus: document.getElementById("gateway-status"),
    judgeDot: document.getElementById("judge-dot"),
    judgeStatus: document.getElementById("judge-status"),
    demoJudgeLabel: document.getElementById("demo-judge-status-label"),
    btnToggleJudge: document.getElementById("btn-toggle-judge"),
    storeOfflineBanner: document.getElementById("store-offline-banner"),
    offlineStoreName: document.getElementById("offline-store-name"),

    // Step Nav
    stepNav1: document.getElementById("step-nav-1"),
    stepNav2: document.getElementById("step-nav-2"),
    stepNav3: document.getElementById("step-nav-3"),
    stepNav4: document.getElementById("step-nav-4"),

    // Sections
    sectionShop: document.getElementById("section-shop"),
    sectionCandidates: document.getElementById("section-candidates"),
    sectionContract: document.getElementById("section-contract"),
    sectionDecision: document.getElementById("section-decision"),

    // Section 1: Shop
    promptInput: document.getElementById("prompt-input"),
    btnAskAgent: document.getElementById("btn-ask-agent"),
    shopStatusText: document.getElementById("shop-status-text"),
    promptChips: document.querySelectorAll(".prompt-chip"),

    // Section 2: Candidates
    noCandidatesBox: document.getElementById("no-candidates-box"),
    noCandidatesMsg: document.getElementById("no-candidates-msg"),
    candidatesContainer: document.getElementById("candidates-container"),

    // Section 3: Review Contract
    contractStatusBadge: document.getElementById("contract-status-badge"),
    contractProductName: document.getElementById("contract-product-name"),
    contractMerchantName: document.getElementById("contract-merchant-name"),
    contractQuantity: document.getElementById("contract-quantity"),
    contractExpectedTotal: document.getElementById("contract-expected-total"),
    contractAllowedPayee: document.getElementById("contract-allowed-payee"),
    inputBudgetDollars: document.getElementById("input-budget-dollars"),
    budgetCentsLabel: document.getElementById("budget-cents-label"),
    inputCapDollars: document.getElementById("input-cap-dollars"),
    capCentsLabel: document.getElementById("cap-cents-label"),
    checkNoSubs: document.getElementById("check-no-subs"),
    checkNoCards: document.getElementById("check-no-cards"),
    capWarning: document.getElementById("cap-warning"),
    btnSignSubmit: document.getElementById("btn-sign-submit"),
    signSubmittingSpinner: document.getElementById("sign-submitting-spinner"),

    // Section 4: Payment Decision
    decisionBanner: document.getElementById("decision-banner"),

    // Secondary Panels
    timelineRunId: document.getElementById("timeline-run-id"),
    timelineCount: document.getElementById("timeline-count"),
    timelineList: document.getElementById("timeline-events-list"),
    rawJsonViewer: document.getElementById("raw-json-viewer"),
    attackForm: document.getElementById("attack-form"),
    attackStore: document.getElementById("attack-store"),
    attackSku: document.getElementById("attack-sku"),
    attackPlacement: document.getElementById("attack-placement"),
    attackInstruction: document.getElementById("attack-instruction"),
    btnPlantAttack: document.getElementById("btn-plant-attack"),
    attackStatusMsg: document.getElementById("attack-status-msg"),
  };

  // --- API Client ---
  async function apiGet(endpoint) {
    const res = await fetch(endpoint);
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || `HTTP ${res.status}: ${res.statusText}`);
    }
    return res.json();
  }

  async function apiPost(endpoint, data) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || `HTTP ${res.status}: ${res.statusText}`);
    }
    return res.json();
  }

  // --- Step Indicator Navigation UI ---
  function updateStepIndicator(step) {
    state.currentStep = step;
    const items = [el.stepNav1, el.stepNav2, el.stepNav3, el.stepNav4];
    items.forEach((item, idx) => {
      const num = idx + 1;
      item.classList.remove("active", "completed");
      if (num === step) {
        item.classList.add("active");
      } else if (num < step) {
        item.classList.add("completed");
      }
    });
  }

  function scrollToSection(sectionEl) {
    if (!sectionEl) return;
    sectionEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // --- System Status Polling ---
  async function refreshSystemStatus() {
    try {
      const status = await apiGet("/api/status");
      state.systemStatus = status;

      // Update gateway
      if (status.gateway === "READY") {
        el.gatewayDot.className = "status-dot green";
        el.gatewayStatus.textContent = "READY";
      } else {
        el.gatewayDot.className = "status-dot red";
        el.gatewayStatus.textContent = status.gateway;
      }

      // Update AI judge
      const isJudgeConn = status.aiJudge === "CONNECTED";
      el.judgeDot.className = isJudgeConn ? "status-dot green" : "status-dot red";
      el.judgeStatus.textContent = status.aiJudge;
      el.demoJudgeLabel.className = `badge-status ${isJudgeConn ? "green" : "red"}`;
      el.demoJudgeLabel.textContent = status.aiJudge;
      el.btnToggleJudge.textContent = isJudgeConn
        ? "Toggle to Disconnected / Unavailable"
        : "Toggle to Connected";

      // Check stores
      let anyOffline = false;
      const offlineNames = [];
      const storeMap = {
        novamart: { dot: el.novamartDot, label: el.novamartStatus },
        dealdemon: { dot: el.dealdemonDot, label: el.dealdemonStatus },
        peermarket: { dot: el.peermarketDot, label: el.peermarketStatus },
      };

      for (const s of status.stores) {
        const item = storeMap[s.id];
        if (item) {
          const isOnline = s.online !== false;
          item.dot.className = isOnline ? "status-dot green" : "status-dot red";
          item.label.textContent = isOnline ? "ONLINE" : "OFFLINE";
          if (!isOnline) {
            anyOffline = true;
            offlineNames.push(s.name);
          }
        }
      }

      if (anyOffline) {
        el.storeOfflineBanner.classList.remove("hidden");
        el.offlineStoreName.textContent = `${offlineNames.join(", ")} is offline.`;
        el.btnAskAgent.disabled = true;
      } else {
        el.storeOfflineBanner.classList.add("hidden");
        if (!state.busy) el.btnAskAgent.disabled = false;
      }
    } catch {
      // Backend temporarily unreachable
    }
  }

  // --- Step 1: Start Discovery ---
  async function startDiscoveryFlow() {
    if (state.busy) return;
    const prompt = el.promptInput.value.trim();
    if (!prompt) return;

    // Increment generation to cancel and isolate from any previous runs
    state.generation++;
    const currentGen = state.generation;

    // Clear previous state completely
    stopEventPolling();
    state.runId = null;
    state.afterSeq = 0;
    state.latestRun = null;
    state.candidates = [];
    state.agentPickId = null;
    state.selectedCandidateId = null;
    state.selectedOnServerId = null;
    state.lastDecision = null;
    state.receiptId = null;
    state.evidenceResult = null;
    state.busy = true;

    // Reset UI
    updateStepIndicator(1);
    el.btnAskAgent.disabled = true;
    el.shopStatusText.classList.remove("hidden");
    el.sectionCandidates.classList.add("hidden");
    el.sectionContract.classList.add("hidden");
    el.sectionDecision.classList.add("hidden");
    el.noCandidatesBox.classList.add("hidden");
    el.candidatesContainer.innerHTML = "";
    el.decisionBanner.innerHTML = "";
    el.timelineList.innerHTML = `<div class="empty-state">Searching storefronts…</div>`;
    el.timelineCount.textContent = "0";
    el.timelineRunId.textContent = "initializing…";
    el.rawJsonViewer.textContent = "{}";

    try {
      const data = await apiPost("/api/discovery/start", { prompt });
      if (state.generation !== currentGen) return; // Late response from cancelled run

      // Handle banana or no candidates found
      if (data.status === "NO_CANDIDATES" || !data.candidates || data.candidates.length === 0) {
        el.sectionCandidates.classList.remove("hidden");
        el.noCandidatesBox.classList.remove("hidden");
        el.noCandidatesMsg.textContent = data.message || "No matching candidates found for that prompt.";
        updateStepIndicator(2);
        scrollToSection(el.sectionCandidates);
        return;
      }

      state.runId = data.run.id;
      state.latestRun = data.run;
      state.candidates = data.candidates;
      el.timelineRunId.textContent = state.runId;
      el.rawJsonViewer.textContent = JSON.stringify(data, null, 2);

      // Auto-select agent pick (Rank #1)
      state.agentPickId = data.candidates[0].id;
      state.selectedCandidateId = state.agentPickId;

      // Render candidates
      renderCandidates();
      el.sectionCandidates.classList.remove("hidden");
      updateStepIndicator(2);

      // Immediately render Section 3 (Review Contract) from top candidate
      updateContractSection();
      el.sectionContract.classList.remove("hidden");

      // Start live polling of events
      startEventPolling();

      // Scroll to candidates
      scrollToSection(el.sectionCandidates);
    } catch (err) {
      if (state.generation !== currentGen) return;
      el.sectionCandidates.classList.remove("hidden");
      el.noCandidatesBox.classList.remove("hidden");
      el.noCandidatesMsg.textContent = err.message || "Discovery failed.";
      updateStepIndicator(2);
    } finally {
      if (state.generation === currentGen) {
        state.busy = false;
        el.btnAskAgent.disabled = false;
        el.shopStatusText.classList.add("hidden");
      }
    }
  }

  // --- Step 2: Render Candidates ---
  function renderCandidates() {
    el.candidatesContainer.innerHTML = "";

    state.candidates.forEach((cand, idx) => {
      const isAgentPick = cand.id === state.agentPickId;
      const isSelected = cand.id === state.selectedCandidateId;

      const card = document.createElement("div");
      card.className = `candidate-card ${isAgentPick ? "agent-pick" : ""} ${isSelected ? "selected" : ""}`;
      card.dataset.candidateId = cand.id;

      // Badges
      let tagsHtml = "";
      if (cand.seller && cand.seller.verified) {
        tagsHtml += `<span class="tag-verified">✓ Verified Seller</span>`;
      } else {
        tagsHtml += `<span class="tag-risk">⚠️ Unverified Seller</span>`;
      }

      if (cand.terms) {
        if (cand.terms.finalSale) tagsHtml += `<span class="tag-warning">Final Sale (No Returns)</span>`;
        if (cand.terms.subscription) tagsHtml += `<span class="tag-risk">Recurring Subscription</span>`;
        if (cand.terms.dripPricing) tagsHtml += `<span class="tag-risk">Drip Pricing / Extra Fees</span>`;
      }

      card.innerHTML = `
        <div class="candidate-card-header">
          <div>
            ${isAgentPick ? `<span class="pick-badge">⭐ Agent's pick — Rank #1</span>` : `<span class="pick-badge" style="background:#475569;">Alternative — Rank #${idx + 1}</span>`}
            <div class="candidate-store-name" style="margin-top: 4px;">Store: <strong>${escapeHtml(cand.merchantDisplayName || cand.merchantId)}</strong></div>
          </div>
          <div style="font-size: 11px; color: var(--text-muted);">SKU: ${escapeHtml(cand.sku)}</div>
        </div>

        <div class="candidate-product-title">${escapeHtml(cand.productName)}</div>

        <div class="candidate-price-row">
          <div class="candidate-allin-price">${formatCents(cand.quoteTotalCents ?? cand.advertisedTotalCents)}</div>
          <div class="candidate-unit-price">All-in total with tax &amp; shipping</div>
        </div>

        <div class="candidate-tags">${tagsHtml}</div>

        <div class="candidate-actions">
          <div style="font-size: 12px; color: var(--text-muted);">
            ${isSelected ? `<strong style="color:#10b981;">✓ Selected for Spending Contract</strong>` : `Candidate ID: <code style="font-size:10px;">${escapeHtml(cand.id)}</code>`}
          </div>
          ${!isSelected ? `<button type="button" class="btn-use-instead" data-candidate-id="${escapeHtml(cand.id)}">Use this instead</button>` : ""}
        </div>
      `;

      el.candidatesContainer.appendChild(card);
    });

    // Attach click events for "Use this instead"
    const buttons = el.candidatesContainer.querySelectorAll(".btn-use-instead");
    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const candidateId = btn.dataset.candidateId;
        selectCandidateOverride(candidateId);
      });
    });
  }

  // --- Candidate Override Selection ---
  function selectCandidateOverride(candidateId) {
    if (state.selectedCandidateId === candidateId) return;
    state.selectedCandidateId = candidateId;

    // Invalidate prior decision and evidence
    state.lastDecision = null;
    state.receiptId = null;
    state.evidenceResult = null;
    el.sectionDecision.classList.add("hidden");
    el.decisionBanner.innerHTML = "";

    // Re-render candidates to update selection badge
    renderCandidates();

    // Rebuild contract section from newly selected candidate
    updateContractSection();
    updateStepIndicator(3);
    scrollToSection(el.sectionContract);
  }

  // --- Step 3: Update Contract Section ---
  function updateContractSection() {
    const candidate = state.candidates.find((c) => c.id === state.selectedCandidateId);
    if (!candidate) return;

    el.contractProductName.textContent = candidate.productName;
    el.contractMerchantName.textContent = candidate.merchantDisplayName || candidate.merchantId;
    el.contractQuantity.textContent = candidate.quantity || 1;
    const expectedCents = candidate.quoteTotalCents ?? candidate.advertisedTotalCents;
    el.contractExpectedTotal.textContent = formatCents(expectedCents);
    el.contractAllowedPayee.textContent = candidate.merchantDisplayName || candidate.merchantId;

    // Check cap warning
    checkCapWarning(expectedCents);
  }

  function checkCapWarning(expectedCents) {
    const capDollars = parseFloat(el.inputCapDollars.value) || 0;
    const capCents = Math.round(capDollars * 100);
    el.capCentsLabel.textContent = `= ${capCents.toLocaleString()} cents`;

    const budgetDollars = parseFloat(el.inputBudgetDollars.value) || 0;
    const budgetCents = Math.round(budgetDollars * 100);
    el.budgetCentsLabel.textContent = `= ${budgetCents.toLocaleString()} cents`;

    if (expectedCents && capCents > 0 && expectedCents > capCents) {
      el.capWarning.classList.remove("hidden");
    } else {
      el.capWarning.classList.add("hidden");
    }
  }

  // --- Step 3: Sign & Submit for Payment Check ---
  async function signAndSubmitFlow() {
    if (state.busy) return;
    if (!state.runId || !state.selectedCandidateId) return;

    const budgetDollars = parseFloat(el.inputBudgetDollars.value);
    const capDollars = parseFloat(el.inputCapDollars.value);
    if (isNaN(budgetDollars) || budgetDollars <= 0 || isNaN(capDollars) || capDollars <= 0) {
      alert("Please enter valid positive dollar amounts for budget and per-order cap.");
      return;
    }

    const maxBudgetCents = Math.round(budgetDollars * 100);
    const perOrderCapCents = Math.round(capDollars * 100);

    // Double-click protection
    state.busy = true;
    el.btnSignSubmit.disabled = true;
    el.signSubmittingSpinner.classList.remove("hidden");

    try {
      // 1. Ensure selection on server if not done yet
      if (state.selectedOnServerId !== state.selectedCandidateId) {
        await apiPost(`/api/run/${encodeURIComponent(state.runId)}/select`, {
          candidateId: state.selectedCandidateId,
        });
        state.selectedOnServerId = state.selectedCandidateId;
      }

      // 2. Submit signed contract and quote to gateway
      const result = await apiPost(`/api/run/${encodeURIComponent(state.runId)}/sign-and-submit`, {
        candidateId: state.selectedCandidateId,
        limits: {
          maxBudgetCents,
          perOrderCapCents,
          noSubscriptions: el.checkNoSubs.checked,
          noGiftCards: el.checkNoCards.checked,
        },
      });

      state.latestRun = result.run;
      el.rawJsonViewer.textContent = JSON.stringify(result, null, 2);

      // Render Section 4 Decision
      renderDecision(result.run.decision);
      el.sectionDecision.classList.remove("hidden");
      updateStepIndicator(4);
      scrollToSection(el.sectionDecision);
    } catch (err) {
      alert(`Submission failed: ${err.message}`);
    } finally {
      state.busy = false;
      el.btnSignSubmit.disabled = false;
      el.signSubmittingSpinner.classList.add("hidden");
    }
  }

  // --- Step 4: Render Decision Banner ---
  function renderDecision(decision) {
    if (!decision) return;
    state.lastDecision = decision;

    const candidate = state.candidates.find((c) => c.id === state.selectedCandidateId) || state.candidates[0];
    const merchantName = candidate ? (candidate.merchantDisplayName || candidate.merchantId) : "Merchant";
    const outcome = decision.outcome;

    if (outcome === "ALLOW") {
      state.receiptId = decision.receiptId;
      el.decisionBanner.className = "decision-banner allow";
      el.decisionBanner.innerHTML = `
        <div class="verdict-headline">
          <span>✓</span>
          <span>APPROVED — ${formatCents(decision.computedTotalCents)} captured</span>
        </div>
        <div class="verdict-body">
          The payment strictly complies with all terms of the signed Intent Contract. Mock PSP executed the transaction for the exact verified store quote.
        </div>
        <div class="verdict-meta-grid">
          <div><span class="field-label">Merchant</span><br><strong>${escapeHtml(merchantName)}</strong></div>
          <div><span class="field-label">Captured Amount</span><br><strong style="color:#10b981;">${formatCents(decision.computedTotalCents)}</strong></div>
          <div><span class="field-label">Receipt ID</span><br><code style="font-size:11px;">${escapeHtml(decision.receiptId || "rcpt_mock_001")}</code></div>
          <div><span class="field-label">Engine Verdict</span><br><strong>ALLOW</strong></div>
        </div>
        <div class="verdict-actions-row">
          <button type="button" id="btn-verify-evidence" class="btn-primary">Verify Evidence</button>
          <span style="font-size:12px; color:var(--text-muted);">Independent cryptographic audit of public key and hash chain</span>
        </div>
        <div id="evidence-display-area" class="hidden"></div>
      `;

      // Wire Verify Evidence button
      const btnVerify = document.getElementById("btn-verify-evidence");
      if (btnVerify) {
        btnVerify.addEventListener("click", verifyEvidenceFlow);
      }
    } else if (outcome === "STEP_UP") {
      const isApproved = Boolean(decision.receiptId || (state.latestRun && state.latestRun.status === "COMPLETED"));
      if (isApproved) {
        state.receiptId = decision.receiptId;
        el.decisionBanner.className = "decision-banner allow";
        el.decisionBanner.innerHTML = `
          <div class="verdict-headline">
            <span>✓</span>
            <span>APPROVED — ${formatCents(decision.computedTotalCents ?? candidate.quoteTotalCents)} captured</span>
          </div>
          <div class="verdict-body">
            Step-up review exception was approved by human. Mock PSP executed the transaction for the exact verified store quote.
          </div>
          <div class="verdict-meta-grid">
            <div><span class="field-label">Merchant</span><br><strong>${escapeHtml(merchantName)}</strong></div>
            <div><span class="field-label">Captured Amount</span><br><strong style="color:#10b981;">${formatCents(decision.computedTotalCents ?? candidate.quoteTotalCents)}</strong></div>
            <div><span class="field-label">Receipt ID</span><br><code style="font-size:11px;">${escapeHtml(decision.receiptId || "rcpt_mock_001")}</code></div>
            <div><span class="field-label">Status</span><br><strong>COMPLETED (APPROVED)</strong></div>
          </div>
          <div class="verdict-actions-row">
            <button type="button" id="btn-verify-evidence" class="btn-primary">Verify Evidence</button>
            <span style="font-size:12px; color:var(--text-muted);">Independent cryptographic audit of public key and hash chain</span>
          </div>
          <div id="evidence-display-area" class="hidden"></div>
        `;
        const btnVerify = document.getElementById("btn-verify-evidence");
        if (btnVerify) {
          btnVerify.addEventListener("click", verifyEvidenceFlow);
        }
      } else {
        el.decisionBanner.className = "decision-banner stepup";
        const reasons = (decision.reasonCodes || []).map(mapReasonCodeToPlainEnglish).join(" ");
        el.decisionBanner.innerHTML = `
          <div class="verdict-headline">
            <span>⚠️</span>
            <span>HUMAN REVIEW NEEDED — $0 captured so far</span>
          </div>
          <div class="verdict-body">
            ${escapeHtml(reasons || "The purchase contains risky terms (such as an unverified seller or final-sale terms) that require explicit human approval.")}
          </div>
          <div class="verdict-meta-grid">
            <div><span class="field-label">Merchant</span><br><strong>${escapeHtml(merchantName)}</strong></div>
            <div><span class="field-label">Pending Total</span><br><strong>${formatCents(decision.computedTotalCents ?? candidate.quoteTotalCents)}</strong></div>
            <div><span class="field-label">Captured So Far</span><br><strong style="color:#f59e0b;">$0.00</strong></div>
            <div><span class="field-label">Status</span><br><strong>STEP_UP_REQUIRED</strong></div>
          </div>
          <div class="verdict-actions-row">
            <button type="button" id="btn-stepup-approve" class="btn-primary">Approve &amp; Pay</button>
            <button type="button" id="btn-stepup-reject" class="btn-danger">Reject — Do Not Pay</button>
          </div>
        `;

        // Wire STEP_UP buttons
        document.getElementById("btn-stepup-approve").addEventListener("click", () => decideStepUpFlow("APPROVE"));
        document.getElementById("btn-stepup-reject").addEventListener("click", () => decideStepUpFlow("REJECT"));
      }
    } else if (outcome === "BLOCK") {
      el.decisionBanner.className = "decision-banner block";
      const reasons = (decision.reasonCodes || []).map(mapReasonCodeToPlainEnglish).join(" ");
      el.decisionBanner.innerHTML = `
        <div class="verdict-headline">
          <span>🛑</span>
          <span>BLOCKED — $0 captured</span>
        </div>
        <div class="verdict-body">
          ${escapeHtml(reasons || "The purchase violated policy terms specified in your signed Intent Contract. No money was moved.")}
        </div>
        <div class="verdict-meta-grid">
          <div><span class="field-label">Merchant</span><br><strong>${escapeHtml(merchantName)}</strong></div>
          <div><span class="field-label">Captured Amount</span><br><strong style="color:#ef4444;">$0.00</strong></div>
          <div><span class="field-label">PSP Action</span><br><strong>PAYMENT NOT ATTEMPTED</strong></div>
          <div><span class="field-label">Reason Code</span><br><code style="font-size:11px;">${escapeHtml((decision.reasonCodes || []).join(", ") || "POLICY_VIOLATION")}</code></div>
        </div>
        <div class="verdict-actions-row">
          <button type="button" id="btn-try-another" class="btn-secondary">Try Another Candidate</button>
          <span style="font-size:12px; color:var(--text-muted);">Select a safe candidate (like NovaMart) to continue</span>
        </div>
      `;

      document.getElementById("btn-try-another").addEventListener("click", () => {
        scrollToSection(el.sectionCandidates);
      });
    } else {
      // TAMPER_REJECT
      el.decisionBanner.className = "decision-banner tamper";
      el.decisionBanner.innerHTML = `
        <div class="verdict-headline">
          <span>🛡️</span>
          <span>INTEGRITY CHECK FAILED — $0 captured</span>
        </div>
        <div class="verdict-body">
          Upstream cryptographic verification failed. The merchant quote signature or total did not match the store's issued quote.
        </div>
        <div class="verdict-meta-grid">
          <div><span class="field-label">Merchant</span><br><strong>${escapeHtml(merchantName)}</strong></div>
          <div><span class="field-label">Captured Amount</span><br><strong style="color:#a855f7;">$0.00</strong></div>
          <div><span class="field-label">Integrity Status</span><br><strong>TAMPER_REJECTED</strong></div>
        </div>
      `;
    }
  }

  // --- Step-Up Decision Flow (Approve or Reject) ---
  async function decideStepUpFlow(decision) {
    if (state.busy || !state.runId) return;
    state.busy = true;

    const btnApprove = document.getElementById("btn-stepup-approve");
    const btnReject = document.getElementById("btn-stepup-reject");
    if (btnApprove) btnApprove.disabled = true;
    if (btnReject) btnReject.disabled = true;

    try {
      const res = await apiPost(`/api/run/${encodeURIComponent(state.runId)}/step-up`, { decision });
      state.latestRun = res.run;
      el.rawJsonViewer.textContent = JSON.stringify(res, null, 2);

      if (decision === "APPROVE") {
        renderDecision(res.run.decision);
      } else {
        // Human rejected
        el.decisionBanner.className = "decision-banner block";
        el.decisionBanner.innerHTML = `
          <div class="verdict-headline">
            <span>🛑</span>
            <span>REJECTED — $0.00 captured</span>
          </div>
          <div class="verdict-body">
            You rejected the step-up payment request. The transaction was aborted and $0 was captured.
          </div>
          <div class="verdict-meta-grid">
            <div><span class="field-label">Final Captured Amount</span><br><strong style="color:#ef4444;">$0.00</strong></div>
            <div><span class="field-label">Status</span><br><strong>ABORTED_BY_USER</strong></div>
          </div>
        `;
      }
    } catch (err) {
      alert(`Decision failed: ${err.message}`);
    } finally {
      state.busy = false;
    }
  }

  // --- Evidence Verification Flow ---
  async function verifyEvidenceFlow() {
    if (!state.receiptId) return;
    const area = document.getElementById("evidence-display-area");
    if (!area) return;

    area.classList.remove("hidden");
    area.innerHTML = `Verifying cryptographic signature and receipt hash chain…`;

    try {
      const result = await apiPost("/api/evidence/verify", { receiptId: state.receiptId });
      state.evidenceResult = result;

      if (result.valid) {
        area.className = "evidence-result-box";
        area.innerHTML = `
          <strong>✓ EVIDENCE VALID</strong><br>
          • Ed25519 Signature Check: <strong>PASSED</strong><br>
          • Cryptographic Hash Chain: <strong>PASSED</strong><br>
          • Receipts in Chain: <strong>VERIFIED</strong>
        `;
      } else {
        area.className = "evidence-result-box";
        area.style.borderColor = "#ef4444";
        area.style.color = "#fca5a5";
        area.innerHTML = `
          <strong>⚠️ EVIDENCE VERIFICATION FAILED</strong><br>
          Failures: ${escapeHtml((result.failures || []).join(", "))}
        `;
      }
    } catch (err) {
      area.className = "evidence-result-box";
      area.style.borderColor = "#ef4444";
      area.style.color = "#fca5a5";
      area.innerHTML = `Verification error: ${escapeHtml(err.message)}`;
    }
  }

  // --- Polling Events with afterSeq ---
  function startEventPolling() {
    stopEventPolling();
    pollEvents();
    state.pollTimer = setInterval(pollEvents, 1200);
  }

  function stopEventPolling() {
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  }

  async function pollEvents() {
    if (!state.runId) return;
    try {
      const res = await apiGet(`/api/run/${encodeURIComponent(state.runId)}/events?afterSeq=${state.afterSeq}`);
      if (!res.events || res.events.length === 0) return;

      if (state.afterSeq === 0) {
        el.timelineList.innerHTML = "";
      }

      res.events.forEach((ev) => {
        state.afterSeq = Math.max(state.afterSeq, ev.seq);
        const item = document.createElement("div");
        item.className = "timeline-item";
        item.innerHTML = `
          <div>
            <span class="timeline-actor-tag">${escapeHtml(ev.actor || "SYS")}</span>
            <strong>${escapeHtml(ev.type || "EVENT")}</strong>: ${escapeHtml(ev.message || "")}
          </div>
          <span style="font-size:10px; color:var(--text-muted);">${new Date(ev.ts).toLocaleTimeString()}</span>
        `;
        el.timelineList.appendChild(item);
      });

      el.timelineCount.textContent = state.afterSeq.toString();

      // Check if run reached a terminal state
      if (state.latestRun) {
        const s = state.latestRun.status;
        if (s === "COMPLETED" || s === "FAILED" || s === "STEP_UP_REQUIRED") {
          // Stop polling once run is in final or waiting state
          if (s === "COMPLETED" || s === "FAILED") {
            stopEventPolling();
          }
        }
      }
    } catch {
      // Ignore polling errors
    }
  }

  // --- Attack Lab ---
  async function plantAttackFlow() {
    const storeId = el.attackStore.value;
    const productSku = el.attackSku.value.trim();
    const placement = el.attackPlacement.value;
    const instruction = el.attackInstruction.value.trim();

    if (!productSku || !instruction) {
      alert("SKU and instruction are required.");
      return;
    }

    try {
      const res = await apiPost("/api/attack/plant", {
        storeId,
        productSku,
        placement,
        instruction,
      });
      el.attackStatusMsg.classList.remove("hidden");
      el.attackStatusMsg.textContent = res.message || "Attack registered successfully!";
      setTimeout(() => el.attackStatusMsg.classList.add("hidden"), 5000);
    } catch (err) {
      alert(`Attack registration failed: ${err.message}`);
    }
  }

  // --- Judge Toggle ---
  async function toggleJudgeFlow() {
    const current = state.systemStatus ? state.systemStatus.aiJudge : "CONNECTED";
    const next = current === "CONNECTED" ? "UNAVAILABLE" : "CONNECTED";
    try {
      await apiPost("/api/status/judge", { status: next });
      await refreshSystemStatus();
    } catch (err) {
      alert(`Toggle failed: ${err.message}`);
    }
  }

  // --- Initialize Event Listeners ---
  function init() {
    // 1. Section 1 Shop Actions
    el.btnAskAgent.addEventListener("click", startDiscoveryFlow);
    el.promptInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        startDiscoveryFlow();
      }
    });

    // Preset chips
    el.promptChips.forEach((chip) => {
      chip.addEventListener("click", () => {
        el.promptInput.value = chip.dataset.prompt;
      });
    });

    // 2. Section 3 Contract Actions
    el.btnSignSubmit.addEventListener("click", signAndSubmitFlow);
    el.inputCapDollars.addEventListener("input", () => {
      const cand = state.candidates.find((c) => c.id === state.selectedCandidateId);
      checkCapWarning(cand ? (cand.quoteTotalCents ?? cand.advertisedTotalCents) : 0);
    });
    el.inputBudgetDollars.addEventListener("input", () => {
      const cand = state.candidates.find((c) => c.id === state.selectedCandidateId);
      checkCapWarning(cand ? (cand.quoteTotalCents ?? cand.advertisedTotalCents) : 0);
    });

    // 3. Attack Lab & Demo Controls
    el.btnPlantAttack.addEventListener("click", plantAttackFlow);
    el.btnToggleJudge.addEventListener("click", toggleJudgeFlow);

    // Initial system status check & interval
    refreshSystemStatus();
    setInterval(refreshSystemStatus, 3000);
  }

  // Run on DOM ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

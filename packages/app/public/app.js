// Recourse Control Center Client Logic
// Pre-Payment Firewall for Autonomous AI Shopping Agents
// Senior Software Engineering Standards: Strict text escaping, robust polling with afterSeq, server-side contract signing.

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
    if (typeof cents !== "number" || isNaN(cents)) return "$0.00";
    return `$${(cents / 100).toFixed(2)}`;
  }

  // --- Application State ---
  const state = {
    currentView: "home",
    systemStatus: null,
    currentRun: null,
    candidates: [],
    selectedCandidateId: null,
    events: [],
    lastSeq: 0,
    pollTimer: null,
    activeAttack: null,
    hiddenTextRevealed: false,
    lastReceiptId: "rcpt_demo_sa_001",
  };

  // --- DOM Elements ---
  const views = {
    home: document.getElementById("view-home"),
    contract: document.getElementById("view-contract"),
    run: document.getElementById("view-run"),
    attack: document.getElementById("view-attack"),
    evidence: document.getElementById("view-evidence"),
  };

  const navButtons = document.querySelectorAll(".nav-tab-btn");

  // Status elements
  const gatewayStatusDot = document.getElementById("gateway-status-dot");
  const gatewayStatusLabel = document.getElementById("gateway-status-label");
  const judgeStatusDot = document.getElementById("judge-status-dot");
  const judgeStatusLabel = document.getElementById("judge-status-label");
  const toggleJudgeBtn = document.getElementById("toggle-judge-btn");
  const paymentModeLabel = document.getElementById("payment-mode-label");
  const judgeWarningBanner = document.getElementById("judge-warning-banner");

  // Home view elements
  const promptInput = document.getElementById("prompt-input");
  const btnDraftContract = document.getElementById("btn-draft-contract");

  // Contract view elements
  const ctWhat = document.getElementById("ct-what");
  const ctMaxDollars = document.getElementById("ct-max-dollars");
  const ctCentsPreview = document.getElementById("ct-cents-preview");
  const ctMaxQty = document.getElementById("ct-max-qty");
  const ctNoSubs = document.getElementById("ct-no-subs");
  const ctNoGiftCards = document.getElementById("ct-no-giftcards");
  const ctUnverified = document.getElementById("ct-unverified");
  const ctExpiry = document.getElementById("ct-expiry");
  const btnSignContract = document.getElementById("btn-sign-contract");
  const btnLaunchRun = document.getElementById("btn-launch-run");
  const contractStatusTag = document.getElementById("contract-status-tag");

  // Run view elements
  const timelineRunBadge = document.getElementById("timeline-run-badge");
  const timelineList = document.getElementById("timeline-list");
  const browserCurrentUrl = document.getElementById("browser-current-url");
  const browserProductTitle = document.getElementById("browser-product-title");
  const browserAdvPrice = document.getElementById("browser-adv-price");
  const browserMerchantName = document.getElementById("browser-merchant-name");
  const browserPageText = document.getElementById("browser-page-text");
  const browserHiddenInjection = document.getElementById("browser-hidden-injection");
  const browserHiddenTextContent = document.getElementById("browser-hidden-text-content");
  const btnToggleHiddenText = document.getElementById("btn-toggle-hidden-text");
  const browserStoreIndicator = document.getElementById("browser-store-indicator");

  // Candidates & Inline Signing
  const candidatesContainer = document.getElementById("candidates-container");
  const inlineSignPanel = document.getElementById("inline-sign-panel");
  const signCandTitle = document.getElementById("sign-cand-title");
  const signCandMerchant = document.getElementById("sign-cand-merchant");
  const signCandTotal = document.getElementById("sign-cand-total");
  const signMaxDollars = document.getElementById("sign-max-dollars");
  const btnInlineSign = document.getElementById("btn-inline-sign");

  // Payment result
  const paymentResultBox = document.getElementById("payment-result-box");
  const paymentResultAmount = document.getElementById("payment-result-amount");
  const paymentResultDetails = document.getElementById("payment-result-details");
  const btnViewEvidenceFromRun = document.getElementById("btn-view-evidence-from-run");

  // Step-up modal
  const stepupIntervenePanel = document.getElementById("stepup-intervene-panel");
  const stepupProdTitle = document.getElementById("stepup-prod-title");
  const stepupSellerName = document.getElementById("stepup-seller-name");
  const stepupQuotedPrice = document.getElementById("stepup-quoted-price");
  const stepupReasonsList = document.getElementById("stepup-reasons-list");
  const btnStepupApprove = document.getElementById("btn-stepup-approve");
  const btnStepupReject = document.getElementById("btn-stepup-reject");

  // Contract summary pane elements
  const contractBadgeHash = document.getElementById("contract-badge-hash");
  const budgetMeterText = document.getElementById("budget-meter-text");
  const budgetMeterFill = document.getElementById("budget-meter-fill");
  const summaryMaxPrice = document.getElementById("summary-max-price");
  const summaryMaxQty = document.getElementById("summary-max-qty");
  const summarySubscriptions = document.getElementById("summary-subscriptions");
  const summaryGiftcards = document.getElementById("summary-giftcards");
  const summaryUnverified = document.getElementById("summary-unverified");
  const summaryExpiry = document.getElementById("summary-expiry");

  // Attack lab elements
  const attackForm = document.getElementById("attack-form");
  const attackStore = document.getElementById("attack-store");
  const attackProduct = document.getElementById("attack-product");
  const attackPlacement = document.getElementById("attack-placement");
  const attackInstruction = document.getElementById("attack-instruction");
  const btnPlantAttack = document.getElementById("btn-plant-attack");

  // Evidence elements
  const btnVerifyCrypto = document.getElementById("btn-verify-crypto");
  const cryptoStatusBadge = document.getElementById("crypto-status-badge");
  const evReceiptId = document.getElementById("ev-receipt-id");
  const evPaymentId = document.getElementById("ev-payment-id");
  const evContractId = document.getElementById("ev-contract-id");
  const evMerchantId = document.getElementById("ev-merchant-id");
  const evVerdict = document.getElementById("ev-verdict");
  const evMoneyMoved = document.getElementById("ev-money-moved");
  const evSigStatus = document.getElementById("ev-sig-status");
  const evChainStatus = document.getElementById("ev-chain-status");

  // --- API Client ---
  async function apiGet(endpoint) {
    const res = await fetch(endpoint);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return res.json();
  }

  async function apiPost(endpoint, data) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}: ${res.statusText}`);
    }
    return res.json();
  }

  // --- View Navigation ---
  function switchView(viewName) {
    if (!views[viewName]) return;
    state.currentView = viewName;

    Object.keys(views).forEach((v) => {
      views[v].classList.toggle("active", v === viewName);
    });

    navButtons.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.view === viewName);
    });

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  navButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      switchView(btn.dataset.view);
    });
  });

  // --- System Status ---
  async function refreshStatus() {
    try {
      const status = await apiGet("/api/status");
      state.systemStatus = status;

      gatewayStatusLabel.textContent = status.gateway;
      paymentModeLabel.textContent = status.paymentMode;

      const isJudgeConnected = status.aiJudge === "CONNECTED";
      judgeStatusLabel.textContent = status.aiJudge;
      judgeStatusDot.className = isJudgeConnected ? "status-dot green" : "status-dot amber";

      if (judgeWarningBanner) {
        judgeWarningBanner.style.display = isJudgeConnected ? "none" : "block";
      }
    } catch (err) {
      console.warn("Failed to refresh status:", err);
      gatewayStatusDot.className = "status-dot red";
      gatewayStatusLabel.textContent = "OFFLINE";
    }
  }

  if (toggleJudgeBtn) {
    toggleJudgeBtn.addEventListener("click", async () => {
      const current = state.systemStatus?.aiJudge || "CONNECTED";
      const next = current === "CONNECTED" ? "UNAVAILABLE" : "CONNECTED";
      try {
        const updated = await apiPost("/api/status/judge", { status: next });
        state.systemStatus = updated;
        refreshStatus();
      } catch (err) {
        alert("Could not toggle judge: " + err.message);
      }
    });
  }

  // --- Quick Prompt Chips ---
  document.querySelectorAll(".prompt-chips-row .preset-chip-btn").forEach((chip) => {
    chip.addEventListener("click", () => {
      const p = chip.getAttribute("data-prompt");
      if (p) promptInput.value = p;
    });
  });

  // --- Start Discovery (Core Phase 7 Agent Flow) ---
  async function startAgentDiscovery(promptText) {
    stopPolling();
    state.events = [];
    state.lastSeq = 0;
    state.selectedCandidateId = null;

    timelineList.innerHTML = `<div style="color: var(--text-muted); font-size: 13px; text-align: center; padding: 20px;">Agent initiating search across stores...</div>`;
    candidatesContainer.innerHTML = `<div style="color: var(--text-muted); font-size: 13px; text-align: center; padding: 20px;">Searching NovaMart, DealDemon, and PeerMarket...</div>`;
    paymentResultBox.style.display = "none";
    if (inlineSignPanel) inlineSignPanel.style.display = "none";
    if (stepupIntervenePanel) stepupIntervenePanel.style.display = "none";

    switchView("run");

    try {
      const res = await apiPost("/api/discovery/start", { prompt: promptText });
      if (!res.candidates || res.candidates.length === 0) {
        throw new Error("No candidates were returned by the storefronts.");
      }
      state.currentRun = res.run;
      state.candidates = res.candidates;

      renderRunState(res.run, res.candidates);
      startPolling(res.run.id);
    } catch (err) {
      state.currentRun = null;
      state.candidates = [];
      state.selectedCandidateId = null;
      if (inlineSignPanel) inlineSignPanel.style.display = "none";
      if (stepupIntervenePanel) stepupIntervenePanel.style.display = "none";
      candidatesContainer.innerHTML = `
        <div style="background: rgba(239, 68, 68, 0.1); border: 1px solid #ef4444; border-radius: var(--radius-md); padding: 20px; text-align: center; color: #fca5a5;">
          <strong>Discovery Error:</strong> ${escapeHtml(err.message)}
          <div style="font-size: 12px; color: var(--text-muted); margin-top: 8px;">
            Please ensure search terms match store catalog categories (e.g. headphones, jacket, shoes, backpack) and live stores are reachable on ports 8801, 8802, 8803.
          </div>
        </div>
      `;
      timelineList.innerHTML = `<div style="color: #ef4444; font-size: 13px; text-align: center; padding: 20px;">Discovery halted: ${escapeHtml(err.message)}</div>`;
    }
  }

  if (btnDraftContract) {
    btnDraftContract.addEventListener("click", async () => {
      const promptText = promptInput.value.trim();
      if (!promptText) return;
      btnDraftContract.disabled = true;
      btnDraftContract.textContent = "Agent Searching Stores...";
      try {
        await startAgentDiscovery(promptText);
      } finally {
        btnDraftContract.disabled = false;
        btnDraftContract.textContent = "Start Agent Discovery & Shopping ➔";
      }
    });
  }

  // --- Polling Events using afterSeq ---
  function startPolling(runId) {
    stopPolling();
    pollEvents(runId);
    state.pollTimer = setInterval(() => pollEvents(runId), 1000);
  }

  function stopPolling() {
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  }

  async function pollEvents(runId) {
    try {
      const res = await apiGet(`/api/run/${encodeURIComponent(runId)}/events?afterSeq=${state.lastSeq}`);
      if (res.events && res.events.length > 0) {
        res.events.forEach((ev) => {
          state.events.push(ev);
          state.lastSeq = Math.max(state.lastSeq, ev.seq);
        });
        renderTimeline(state.events);
      }

      // Check for run state updates
      const runRes = await apiGet(`/api/run/${encodeURIComponent(runId)}`);
      if (runRes && runRes.run) {
        state.currentRun = runRes.run;
        state.candidates = runRes.candidates;
        renderRunState(runRes.run, runRes.candidates);

        if (runRes.run.status === "COMPLETED") {
          stopPolling();
        }
      }
    } catch (err) {
      console.warn("Polling error:", err);
    }
  }

  // --- Candidate Selection ---
  async function selectCandidate(candidateId) {
    if (!state.currentRun) {
      alert("No active run. Please start discovery first.");
      return;
    }
    if (state.currentRun.status !== "AWAITING_SELECTION") {
      alert(`Candidate selection is only allowed when awaiting selection (current status: ${state.currentRun.status}).`);
      return;
    }
    try {
      const res = await apiPost(`/api/run/${encodeURIComponent(state.currentRun.id)}/select`, { candidateId });
      state.currentRun = res.run;
      state.candidates = res.candidates;
      state.selectedCandidateId = candidateId;

      renderRunState(res.run, res.candidates);
      pollEvents(state.currentRun.id);
    } catch (err) {
      alert("Failed to select candidate: " + err.message);
    }
  }

  // --- Host Bridge: Compile and Sign Spending Contract ---
  async function signAndSubmitContract(limits) {
    if (!state.currentRun || !state.currentRun.selectedCandidateId) {
      alert("No candidate selected. Please select a candidate before signing.");
      return;
    }
    if (state.currentRun.status !== "AWAITING_SIGNATURE") {
      alert(`Cannot sign contract: run is in state '${state.currentRun.status}', awaiting selection.`);
      return;
    }
    if (btnInlineSign) {
      btnInlineSign.disabled = true;
      btnInlineSign.textContent = "Compiling & Signing with Ed25519...";
    }

    try {
      const res = await apiPost(`/api/run/${encodeURIComponent(state.currentRun.id)}/sign`, { limits });
      state.currentRun = res.run;
      state.candidates = res.candidates;

      if (res.contract) {
        updateContractSummary(res.contract);
      }

      renderRunState(res.run, res.candidates);
      pollEvents(state.currentRun.id);
    } catch (err) {
      alert("Contract execution failed: " + err.message);
    } finally {
      if (btnInlineSign) {
        btnInlineSign.disabled = false;
        btnInlineSign.textContent = "✍ Sign Contract & Authorize Gateway Execution ➔";
      }
    }
  }

  if (btnInlineSign) {
    btnInlineSign.addEventListener("click", () => {
      const dollars = parseFloat(signMaxDollars.value) || 70;
      const cents = Math.round(dollars * 100);
      signAndSubmitContract({
        maxBudgetCents: cents,
        perOrderCapCents: cents,
        noSubscriptions: true,
        noGiftCards: true,
        unverifiedSellerRule: "ASK_ME",
        expiryMinutes: 15,
      });
    });
  }

  // Also hook up View 2 contract form
  if (btnSignContract) {
    btnSignContract.addEventListener("click", () => {
      if (!state.currentRun || !state.currentRun.selectedCandidateId) {
        alert("Please start discovery and select a candidate first.");
        switchView("run");
        return;
      }
      const dollars = parseFloat(ctMaxDollars.value) || 70;
      const cents = Math.round(dollars * 100);
      signAndSubmitContract({
        maxBudgetCents: cents,
        perOrderCapCents: cents,
        noSubscriptions: ctNoSubs.checked,
        noGiftCards: ctNoGiftCards.checked,
        unverifiedSellerRule: ctUnverified.value,
        expiryMinutes: parseInt(ctExpiry.value, 10) || 15,
      });
      switchView("run");
    });
  }

  // --- STEP_UP Decision Handling ---
  async function handleStepUpDecision(decision) {
    if (!state.currentRun) return;
    btnStepupApprove.disabled = true;
    btnStepupReject.disabled = true;

    try {
      const res = await apiPost(`/api/run/${encodeURIComponent(state.currentRun.id)}/step-up`, { decision });
      state.currentRun = res.run;
      state.candidates = res.candidates;
      renderRunState(res.run, res.candidates);
      pollEvents(state.currentRun.id);
    } catch (err) {
      alert("Step-up resolution failed: " + err.message);
    } finally {
      btnStepupApprove.disabled = false;
      btnStepupReject.disabled = false;
    }
  }

  if (btnStepupApprove) {
    btnStepupApprove.addEventListener("click", () => handleStepUpDecision("APPROVE"));
  }
  if (btnStepupReject) {
    btnStepupReject.addEventListener("click", () => handleStepUpDecision("REJECT"));
  }

  // --- Rendering UI State ---
  function renderRunState(run, candidates) {
    if (!run) return;

    timelineRunBadge.textContent = run.status;
    timelineRunBadge.className = `brand-badge ${run.status === "COMPLETED" ? "green" : ""}`;

    // Browser Pane (active or selected candidate)
    const selectedCand = candidates.find((c) => c.id === run.selectedCandidateId) || candidates[0];
    if (selectedCand) {
      renderBrowserPane(selectedCand);
      updateBudgetMeter(selectedCand.quoteTotalCents, 7000);
    }

    // Inline Sign Panel
    if (run.status === "AWAITING_SIGNATURE" && selectedCand) {
      inlineSignPanel.style.display = "block";
      signCandTitle.textContent = selectedCand.productName;
      signCandMerchant.textContent = selectedCand.merchantDisplayName;
      signCandTotal.textContent = formatCents(selectedCand.quoteTotalCents);
    } else {
      inlineSignPanel.style.display = "none";
    }

    // Step-Up Panel
    if (run.status === "PAUSED_STEP_UP" && selectedCand) {
      stepupIntervenePanel.style.display = "block";
      stepupProdTitle.textContent = selectedCand.productName;
      stepupSellerName.textContent = `${selectedCand.merchantDisplayName} (Seller: ${selectedCand.seller.name})`;
      stepupQuotedPrice.textContent = formatCents(selectedCand.quoteTotalCents);
      stepupReasonsList.textContent = selectedCand.terms.finalSale
        ? "PeerMarket Final Sale Listing (Tightened by AI Safety Review)"
        : "Unverified Seller Policy Exception";
    } else {
      stepupIntervenePanel.style.display = "none";
    }

    // Payment Result Box
    if (run.decision) {
      paymentResultBox.style.display = "block";
      if (run.decision.outcome === "ALLOW") {
        const captured = run.decision.computedTotalCents ?? selectedCand?.quoteTotalCents ?? 0;
        paymentResultAmount.textContent = `${formatCents(captured)} CAPTURED`;
        paymentResultAmount.style.color = "#10b981";
        paymentResultDetails.textContent = `Store: ${selectedCand?.merchantDisplayName || "Store"} | Mode: Mock PSP | PSP Status: COMPLETED`;
        if (run.decision.receiptId) {
          state.lastReceiptId = run.decision.receiptId;
          updateEvidencePane(run.decision.receiptId, selectedCand, captured);
        }
      } else {
        paymentResultAmount.textContent = "$0.00 CAPTURED";
        paymentResultAmount.style.color = "#ef4444";
        const reasons = run.decision.reasonCodes?.join(", ") || "Safety or contract rule triggered";
        paymentResultDetails.textContent = `Verdict: ${run.decision.outcome} | Reasons: ${reasons} | Money Moved: $0.00`;
      }
    } else {
      paymentResultBox.style.display = "none";
    }

    // Render candidate cards
    renderCandidateCards(candidates, run);
  }

  function renderBrowserPane(cand) {
    browserCurrentUrl.textContent = `https://${cand.merchantId}.internal/products/${cand.sku.toLowerCase()}`;
    browserProductTitle.textContent = cand.productName;
    browserAdvPrice.textContent = formatCents(cand.advertisedTotalCents);
    browserMerchantName.textContent = cand.merchantDisplayName;
    browserStoreIndicator.textContent = `Browsing: ${cand.merchantDisplayName}`;

    // Untrusted page text is rendered via textContent for strict XSS prevention!
    browserPageText.textContent = `Product SKU: ${cand.sku} | Seller: ${cand.seller.name} (${cand.seller.verified ? "Verified" : "Unverified"})\nWarranty: ${cand.terms.warranty} | Returns: ${cand.terms.returnPolicy}`;

    if (cand.hiddenContent && cand.hiddenContent.length > 0) {
      browserHiddenTextContent.textContent = cand.hiddenContent.join("\n");
      browserHiddenInjection.classList.toggle("revealed", state.hiddenTextRevealed);
    } else {
      browserHiddenInjection.classList.remove("revealed");
      browserHiddenTextContent.textContent = "";
    }
  }

  if (btnToggleHiddenText) {
    btnToggleHiddenText.addEventListener("click", () => {
      state.hiddenTextRevealed = !state.hiddenTextRevealed;
      btnToggleHiddenText.textContent = state.hiddenTextRevealed ? "🙈 Hide Hidden Text" : "👁️ Reveal Hidden Text";
      if (browserHiddenInjection) {
        browserHiddenInjection.classList.toggle("revealed", state.hiddenTextRevealed);
      }
    });
  }

  function renderTimeline(events) {
    if (!events || events.length === 0) {
      timelineList.innerHTML = `<div style="color: var(--text-muted); font-size: 13px; text-align: center; padding: 20px;">No events yet.</div>`;
      return;
    }

    timelineList.innerHTML = "";
    events.forEach((ev) => {
      const item = document.createElement("div");
      item.className = "timeline-item";

      const actorClass = (ev.actor || "AGENT").toLowerCase().replace(/[^a-z]/g, "");
      const avatarLabel = ev.actor ? ev.actor.slice(0, 2).toUpperCase() : "AG";

      item.innerHTML = `
        <div class="actor-avatar ${actorClass}">${escapeHtml(avatarLabel)}</div>
        <div class="timeline-content">
          <div class="timeline-meta">
            <span><strong>${escapeHtml(ev.actor)}</strong> <span style="font-size: 11px; color: var(--text-muted);">#${ev.seq}</span></span>
            <span>${escapeHtml(ev.ts ? new Date(ev.ts).toLocaleTimeString() : "")}</span>
          </div>
          <div class="timeline-title">${escapeHtml(ev.type)}</div>
          <div style="font-size: 12px; color: var(--text-secondary); margin-top: 2px;">${escapeHtml(ev.message)}</div>
        </div>
      `;
      timelineList.appendChild(item);
    });
  }

  function renderCandidateCards(candidates, run) {
    candidatesContainer.innerHTML = "";
    if (!candidates || candidates.length === 0) {
      candidatesContainer.innerHTML = `<div style="color: var(--text-muted); font-size: 13px; text-align: center; padding: 20px;">No candidates discovered yet.</div>`;
      return;
    }

    candidates.forEach((cand, idx) => {
      const card = document.createElement("div");
      const isSelected = cand.id === run.selectedCandidateId;
      const statusClass = cand.status.toLowerCase();
      card.className = `candidate-card-wrapper ${statusClass} ${isSelected ? "selected-card" : ""}`;

      let verdictBannerHtml = "";
      if (cand.status === "ALLOWED") {
        verdictBannerHtml = `
          <div class="verdict-banner allow">
            <div style="font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em;">Firewall Verdict: ALLOWED</div>
            <div class="giant-captured-amount" style="color: #10b981;">${formatCents(cand.quoteTotalCents)} CAPTURED</div>
            <div class="next-action-note" style="color: #34d399;">Order verified under spending contract. Valid receipt issued to signed ledger.</div>
          </div>
        `;
      } else if (cand.status === "BLOCKED" || cand.status === "TAMPER_REJECTED") {
        verdictBannerHtml = `
          <div class="verdict-banner block">
            <div style="font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em;">Firewall Verdict: ${escapeHtml(cand.status)}</div>
            <div class="giant-captured-amount" style="color: #ef4444;">$0.00 CAPTURED</div>
            <div class="next-action-note">Deterministic gateway rejected quote. Funds protected. Agent can try next candidate.</div>
          </div>
        `;
      } else if (cand.status === "STEP_UP") {
        verdictBannerHtml = `
          <div class="verdict-banner stepup">
            <div style="font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em;">Firewall Verdict: STEP_UP REQUIRED</div>
            <div class="giant-captured-amount" style="color: #f59e0b;">$0.00 CAPTURED</div>
            <div class="next-action-note" style="color: #fef08a;">Execution paused. Waiting for human approval.</div>
          </div>
        `;
      }

      // Action button
      let selectButtonHtml = "";
      if (run.status === "AWAITING_SELECTION" || cand.status === "PROPOSED") {
        selectButtonHtml = `
          <div style="margin-top: 14px;">
            <button type="button" class="btn-primary btn-select-cand" data-cand-id="${escapeHtml(cand.id)}" style="width: 100%; justify-content: center;">
              👉 Select Candidate for Purchase ➔
            </button>
          </div>
        `;
      }

      // Hidden content warnings
      let hiddenContentHtml = "";
      if (cand.hiddenContent && cand.hiddenContent.length > 0) {
        hiddenContentHtml = `
          <div style="margin-top: 10px; background: rgba(239, 68, 68, 0.1); border: 1px solid #ef4444; border-radius: var(--radius-sm); padding: 8px; font-size: 12px;">
            <strong style="color: #ef4444;">⚠️ Off-Screen Text Discovered:</strong>
            <div style="margin-top: 4px; font-family: var(--font-mono); color: #fca5a5;">${escapeHtml(cand.hiddenContent.join("\n"))}</div>
          </div>
        `;
      }

      card.innerHTML = `
        <div class="candidate-card-header">
          <span class="candidate-number">#${idx + 1} — ${escapeHtml(cand.merchantDisplayName)}</span>
          <span class="brand-badge ${cand.status === 'ALLOWED' ? 'green' : cand.status === 'BLOCKED' ? 'red' : ''}">${escapeHtml(cand.status)}</span>
        </div>
        <div class="candidate-card-body">
          <h4 style="font-size: 15px; font-weight: 700; margin-bottom: 8px;">${escapeHtml(cand.productName)} (SKU: ${escapeHtml(cand.sku)})</h4>

          <div class="price-comparison-box">
            <div>
              <div style="font-size: 11px; color: var(--text-muted); text-transform: uppercase;">Advertised Price</div>
              <div class="price-box-val" style="color: #94a3b8;">${formatCents(cand.advertisedTotalCents)}</div>
            </div>
            <div class="price-arrow">➔</div>
            <div>
              <div style="font-size: 11px; color: var(--text-muted); text-transform: uppercase;">Signed Quote Total</div>
              <div class="price-box-val" style="color: ${cand.status === 'BLOCKED' ? '#ef4444' : '#10b981'};">
                ${formatCents(cand.quoteTotalCents)}
              </div>
            </div>
          </div>

          <div style="font-size: 12px; color: var(--text-secondary); margin: 8px 0;">
            <div>Seller: <strong>${escapeHtml(cand.seller.name)}</strong> (${cand.seller.verified ? '✓ Verified' : '⚠️ Unverified'})</div>
            <div>Returns: <strong>${escapeHtml(cand.terms.returnPolicy)}</strong> ${cand.terms.finalSale ? '<span style="color: #ef4444;">(Final Sale)</span>' : ''}</div>
            <div>Subscription: <strong>${cand.terms.subscription ? '<span style="color: #ef4444;">YES</span>' : '<span style="color: #10b981;">None</span>'}</strong> | Gift Card: <strong>${cand.terms.giftCardIncluded ? '<span style="color: #ef4444;">YES</span>' : '<span style="color: #10b981;">None</span>'}</strong></div>
          </div>

          ${hiddenContentHtml}
          ${verdictBannerHtml}
          ${selectButtonHtml}
        </div>
      `;

      const selectBtn = card.querySelector(".btn-select-cand");
      if (selectBtn) {
        selectBtn.addEventListener("click", () => {
          selectCandidate(cand.id);
        });
      }

      candidatesContainer.appendChild(card);
    });
  }

  function updateBudgetMeter(quotedCents, maxCents) {
    budgetMeterText.textContent = `${formatCents(quotedCents)} / ${formatCents(maxCents)}`;
    const pct = maxCents > 0 ? (quotedCents / maxCents) * 100 : 0;
    const clampedWidth = Math.min(pct, 100);

    budgetMeterFill.style.width = `${clampedWidth}%`;
    if (pct > 100) {
      budgetMeterFill.className = "meter-fill red";
      budgetMeterText.innerHTML = `${formatCents(quotedCents)} / ${formatCents(maxCents)} <strong style="color: #ef4444;">(${Math.round(pct)}% OVER)</strong>`;
    } else {
      budgetMeterFill.className = "meter-fill green";
    }
  }

  function updateContractSummary(contract) {
    if (!contract) return;
    contractBadgeHash.textContent = contract.hash ? `${contract.hash.slice(0, 10)}...` : "SIGNED";
    summaryMaxPrice.textContent = formatCents(contract.budget_max_cents ?? 7000);
    summaryMaxQty.textContent = "1 item";
    summarySubscriptions.textContent = "PROHIBITED";
    summaryGiftcards.textContent = "PROHIBITED";
    summaryUnverified.textContent = "PAUSE (STEP_UP)";
    summaryExpiry.textContent = "15 mins";
  }

  function updateEvidencePane(receiptId, cand, amountCents) {
    if (evReceiptId) evReceiptId.textContent = receiptId;
    if (evPaymentId) evPaymentId.textContent = `pay_${receiptId}`;
    if (evContractId) evContractId.textContent = state.currentRun?.signedIntentId || "contract_intent";
    if (evMerchantId) evMerchantId.textContent = cand?.merchantId || "novamart";
    if (evVerdict) evVerdict.textContent = "ALLOW";
    if (evMoneyMoved) evMoneyMoved.textContent = `${formatCents(amountCents)} (${amountCents}¢)`;
  }

  // --- Attack Lab Submission ---
  if (attackForm) {
    attackForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const attack = {
        storeId: attackStore.value,
        productSku: attackProduct.value,
        placement: attackPlacement.value,
        instruction: attackInstruction.value.trim(),
      };

      if (!attack.instruction) {
        alert("Please enter a malicious instruction.");
        return;
      }

      btnPlantAttack.disabled = true;
      btnPlantAttack.textContent = "Planting Attack...";
      try {
        const result = await apiPost("/api/attack/plant", attack);
        state.activeAttack = attack;
        alert(`✓ ${result.message}\n\nStarting agent discovery now.`);
        await startAgentDiscovery(`Find ${attackProduct.options[attackProduct.selectedIndex].text} under $70`);
      } catch (err) {
        alert("Planting attack failed: " + err.message);
      } finally {
        btnPlantAttack.disabled = false;
        btnPlantAttack.textContent = "⚡ Plant Attack & Run Agent";
      }
    });
  }

  // Preset Attack Payloads
  document.querySelectorAll("#attack-form .preset-chip-btn").forEach((chip) => {
    chip.addEventListener("click", () => {
      const att = chip.getAttribute("data-attack");
      if (att && attackInstruction) attackInstruction.value = att;
    });
  });

  // --- Evidence Verification ---
  if (btnVerifyCrypto) {
    btnVerifyCrypto.addEventListener("click", async () => {
      btnVerifyCrypto.disabled = true;
      btnVerifyCrypto.textContent = "Verifying Signatures...";
      try {
        const result = await apiPost("/api/evidence/verify", { receiptId: state.lastReceiptId });
        if (result.valid) {
          cryptoStatusBadge.innerHTML = `
            <span class="crypto-valid-badge">
              ✓ VALID CRYPTOGRAPHIC PROOF: Hash Chain &amp; Ed25519 Signatures Intact
            </span>
          `;
          evSigStatus.textContent = "VERIFIED (Valid Ed25519 signature)";
          evSigStatus.style.color = "#10b981";
          evChainStatus.textContent = "VERIFIED (Merkle Hash Chain intact)";
          evChainStatus.style.color = "#10b981";
        } else {
          cryptoStatusBadge.innerHTML = `
            <span class="crypto-invalid-badge">
              ✗ INVALID: Evidence verification failed (${escapeHtml(result.failures?.join(", "))})
            </span>
          `;
          evSigStatus.textContent = "FAILED";
          evSigStatus.style.color = "#ef4444";
        }
      } catch (err) {
        alert("Verification request failed: " + err.message);
      } finally {
        btnVerifyCrypto.disabled = false;
        btnVerifyCrypto.textContent = "🛡️ Verify Cryptographic Chain";
      }
    });
  }

  if (btnViewEvidenceFromRun) {
    btnViewEvidenceFromRun.addEventListener("click", () => {
      switchView("evidence");
    });
  }

  // --- Quick Demo Walkthroughs (Under 90 Seconds) ---
  const demoBlockBtn = document.getElementById("quick-demo-block");
  if (demoBlockBtn) {
    demoBlockBtn.addEventListener("click", async () => {
      promptInput.value = "Cheapest wireless headphones max $70 all-in, no subscriptions or gift cards";
      await startAgentDiscovery(promptInput.value);
    });
  }

  const demoStepupBtn = document.getElementById("quick-demo-stepup");
  if (demoStepupBtn) {
    demoStepupBtn.addEventListener("click", async () => {
      promptInput.value = "Find headphones on PeerMarket, max $70";
      await startAgentDiscovery(promptInput.value);
    });
  }

  const demoAttackBtn = document.getElementById("quick-demo-attack");
  if (demoAttackBtn) {
    demoAttackBtn.addEventListener("click", () => {
      switchView("attack");
    });
  }

  const demoEvidenceBtn = document.getElementById("quick-demo-evidence");
  if (demoEvidenceBtn) {
    demoEvidenceBtn.addEventListener("click", () => {
      switchView("evidence");
    });
  }

  // --- Initial Setup ---
  refreshStatus();
  setInterval(refreshStatus, 10000);
})();

// Recourse Control Center Client Logic
// Written with senior software engineering standards: strict text escaping, robust error handling, responsive UI state.

(function () {
  "use strict";

  // --- Helper Functions ---
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
    contractDraft: null,
    signedContract: null,
    currentRun: null,
    activeAttack: null,
    hiddenTextRevealed: false,
    pollInterval: null,
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

  // Candidate elements
  const candidatesContainer = document.getElementById("candidates-container");
  const paymentResultBox = document.getElementById("payment-result-box");
  const paymentResultAmount = document.getElementById("payment-result-amount");
  const paymentResultDetails = document.getElementById("payment-result-details");
  const btnViewEvidenceFromRun = document.getElementById("btn-view-evidence-from-run");

  // Step-up elements
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

  // --- Home View Actions ---
  document.querySelectorAll(".prompt-chips-row .preset-chip-btn").forEach((chip) => {
    chip.addEventListener("click", () => {
      const p = chip.getAttribute("data-prompt");
      if (p) promptInput.value = p;
    });
  });

  btnDraftContract.addEventListener("click", async () => {
    const promptText = promptInput.value.trim();
    if (!promptText) return;

    btnDraftContract.disabled = true;
    btnDraftContract.textContent = "Drafting...";

    try {
      const draft = await apiPost("/api/contract/draft", { prompt: promptText });
      state.contractDraft = draft;
      populateContractForm(draft);
      switchView("contract");
    } catch (err) {
      alert("Error drafting contract: " + err.message);
    } finally {
      btnDraftContract.disabled = false;
      btnDraftContract.textContent = "Draft Spending Contract ➔";
    }
  });

  // --- Contract View Actions ---
  function populateContractForm(draft) {
    ctWhat.value = draft.whatToBuy;
    ctMaxDollars.value = (draft.maxTotalCents / 100).toFixed(2);
    ctCentsPreview.textContent = draft.maxTotalCents.toString();
    ctMaxQty.value = draft.maxQuantity;
    ctNoSubs.checked = draft.noSubscriptions;
    ctNoGiftCards.checked = draft.noGiftCards;
    ctUnverified.value = draft.unverifiedSellerRule;
    ctExpiry.value = draft.expiryMinutes.toString();

    contractStatusTag.textContent = "Status: Unsigned Draft";
    contractStatusTag.style.color = "var(--text-muted)";
    btnLaunchRun.style.display = "none";
    btnSignContract.style.display = "inline-flex";
  }

  ctMaxDollars.addEventListener("input", () => {
    const dollars = parseFloat(ctMaxDollars.value) || 0;
    const cents = Math.round(dollars * 100);
    ctCentsPreview.textContent = cents.toString();
  });

  btnSignContract.addEventListener("click", async () => {
    const dollars = parseFloat(ctMaxDollars.value) || 70;
    const cents = Math.round(dollars * 100);

    const draft = {
      id: state.contractDraft?.id || `ct_draft_${Date.now()}`,
      whatToBuy: ctWhat.value.trim(),
      maxTotalCents: cents,
      maxQuantity: parseInt(ctMaxQty.value, 10) || 1,
      noSubscriptions: ctNoSubs.checked,
      noGiftCards: ctNoGiftCards.checked,
      unverifiedSellerRule: ctUnverified.value,
      expiryMinutes: parseInt(ctExpiry.value, 10) || 15,
    };

    btnSignContract.disabled = true;
    btnSignContract.textContent = "Signing with Ed25519...";

    try {
      const signed = await apiPost("/api/contract/sign", { draft });
      state.signedContract = signed;

      contractStatusTag.innerHTML = `✓ Signed: <strong style="color: #34d399; font-family: var(--font-mono);">${signed.contractHash}</strong>`;
      btnSignContract.style.display = "none";
      btnLaunchRun.style.display = "inline-flex";

      // Update right-hand pane summary
      updateContractSummary(signed);
    } catch (err) {
      alert("Signing failed: " + err.message);
      btnSignContract.disabled = false;
      btnSignContract.textContent = "✍ Approve & Sign Contract";
    }
  });

  btnLaunchRun.addEventListener("click", async () => {
    if (!state.signedContract) return;

    btnLaunchRun.disabled = true;
    btnLaunchRun.textContent = "Launching...";

    try {
      const promptText = ctWhat.value.trim();
      const run = await apiPost("/api/run/start", {
        prompt: promptText,
        contract: state.signedContract,
      });
      state.currentRun = run;
      renderRunState(run);
      switchView("run");
    } catch (err) {
      alert("Run launch failed: " + err.message);
    } finally {
      btnLaunchRun.disabled = false;
      btnLaunchRun.textContent = "🚀 Launch Agent Run ➔";
    }
  });

  // --- Right Pane Contract Summary ---
  function updateContractSummary(contract) {
    if (!contract) return;
    contractBadgeHash.textContent = contract.contractHash || "SIGNED";
    summaryMaxPrice.textContent = formatCents(contract.maxTotalCents);
    summaryMaxQty.textContent = `${contract.maxQuantity} item${contract.maxQuantity > 1 ? "s" : ""}`;
    summarySubscriptions.textContent = contract.noSubscriptions ? "PROHIBITED" : "ALLOWED";
    summarySubscriptions.style.color = contract.noSubscriptions ? "#34d399" : "#f87171";
    summaryGiftcards.textContent = contract.noGiftCards ? "PROHIBITED" : "ALLOWED";
    summaryGiftcards.style.color = contract.noGiftCards ? "#34d399" : "#f87171";
    summaryUnverified.textContent = contract.unverifiedSellerRule === "ASK_ME" ? "PAUSE (STEP_UP)" : "BLOCK";
    summaryExpiry.textContent = `${contract.expiryMinutes} mins`;
  }

  // --- Live Run Dashboard Rendering ---
  function renderRunState(run) {
    if (!run) return;

    timelineRunBadge.textContent = run.status;
    timelineRunBadge.className = `brand-badge ${run.status === "COMPLETED" ? "green" : ""}`;

    // 1. Render Timeline
    renderTimeline(run.events);

    // 2. Render Active Candidate in Browser Pane
    const activeCand = run.candidates.find((c) => c.candidateId === run.activeCandidateId) || run.candidates[0];
    if (activeCand) {
      renderBrowserPane(activeCand);
      updateBudgetMeter(activeCand.quotedTotalCents, run.contract.maxTotalCents);
    }

    // 3. Render Candidate Rejection & Approval Cards
    renderCandidateCards(run.candidates, run.contract);

    // 4. Handle STEP_UP Intervention Modal
    if (run.status === "PAUSED_STEP_UP" && run.stepUpPrompt) {
      stepupIntervenePanel.style.display = "block";
      stepupProdTitle.textContent = run.stepUpPrompt.productTitle;
      stepupSellerName.textContent = run.stepUpPrompt.merchantName;
      stepupQuotedPrice.textContent = formatCents(run.stepUpPrompt.amountCents);
      stepupReasonsList.textContent = run.stepUpPrompt.reasons.join(", ");
    } else {
      stepupIntervenePanel.style.display = "none";
    }

    // 5. Payment Result
    if (run.paymentResult) {
      paymentResultBox.style.display = "block";
      if (run.paymentResult.status === "CAPTURED") {
        paymentResultAmount.textContent = `${formatCents(run.paymentResult.amountCents)} CAPTURED`;
        paymentResultAmount.style.color = "#10b981";
      } else {
        paymentResultAmount.textContent = "$0.00 CAPTURED";
        paymentResultAmount.style.color = "#ef4444";
      }
      paymentResultDetails.textContent = `Store: ${run.paymentResult.storeName} | Mode: ${run.paymentResult.mode}${
        run.paymentResult.transactionId ? ` | Transaction: ${run.paymentResult.transactionId}` : ""
      }`;
    } else {
      paymentResultBox.style.display = "none";
    }
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
            <span><strong>${escapeHtml(ev.actor)}</strong></span>
            <span>${escapeHtml(ev.timestamp)}</span>
          </div>
          <div class="timeline-title">${escapeHtml(ev.title)}</div>
          ${
            ev.detail || ev.url
              ? `<button class="timeline-detail-toggle">Details ▾</button>
                 <div class="timeline-detail-box">
                   ${ev.url ? `URL: ${escapeHtml(ev.url)}<br>` : ""}
                   ${ev.detail ? escapeHtml(ev.detail) : ""}
                 </div>`
              : ""
          }
        </div>
      `;

      const toggleBtn = item.querySelector(".timeline-detail-toggle");
      if (toggleBtn) {
        toggleBtn.addEventListener("click", () => {
          const box = item.querySelector(".timeline-detail-box");
          box.classList.toggle("open");
          toggleBtn.textContent = box.classList.contains("open") ? "Details ▴" : "Details ▾";
        });
      }

      timelineList.appendChild(item);
    });
  }

  function renderBrowserPane(cand) {
    browserCurrentUrl.textContent = cand.product.url;
    browserProductTitle.textContent = cand.product.title;
    browserAdvPrice.textContent = formatCents(cand.advertisedTotalCents);
    browserMerchantName.textContent = cand.merchant.name;
    browserStoreIndicator.textContent = `Browsing: ${cand.merchant.name}`;

    // Untrusted page text is rendered via textContent for strict XSS prevention!
    browserPageText.textContent = cand.untrustedPageText || "Product specifications and checkout details...";

    if (cand.hiddenInjectionText) {
      browserHiddenTextContent.textContent = cand.hiddenInjectionText;
      browserHiddenInjection.classList.toggle("revealed", state.hiddenTextRevealed);
    } else {
      browserHiddenInjection.classList.remove("revealed");
      browserHiddenTextContent.textContent = "";
    }
  }

  btnToggleHiddenText.addEventListener("click", () => {
    state.hiddenTextRevealed = !state.hiddenTextRevealed;
    btnToggleHiddenText.textContent = state.hiddenTextRevealed ? "🙈 Hide Hidden Text" : "👁️ Reveal Hidden Text";
    if (browserHiddenInjection) {
      browserHiddenInjection.classList.toggle("revealed", state.hiddenTextRevealed);
    }
  });

  function updateBudgetMeter(quotedCents, maxCents) {
    budgetMeterText.textContent = `${formatCents(quotedCents)} / ${formatCents(maxCents)}`;
    const pct = maxCents > 0 ? (quotedCents / maxCents) * 100 : 0;
    const clampedWidth = Math.min(pct, 100);

    budgetMeterFill.style.width = `${clampedWidth}%`;
    if (pct > 100) {
      budgetMeterFill.className = "meter-fill red";
      budgetMeterText.innerHTML = `${formatCents(quotedCents)} / ${formatCents(maxCents)} <strong style="color: #ef4444;">(${Math.round(pct)}% OVER BUDGET)</strong>`;
    } else {
      budgetMeterFill.className = "meter-fill green";
    }
  }

  function renderCandidateCards(candidates, contract) {
    candidatesContainer.innerHTML = "";

    candidates.forEach((cand, idx) => {
      const card = document.createElement("div");
      card.className = `candidate-card-wrapper ${cand.decision.toLowerCase()}`;

      // Line items rows
      let lineItemsHtml = "";
      cand.lineItems.forEach((li) => {
        const isSuspicious = li.kind === "gift_card" || li.kind === "subscription";
        lineItemsHtml += `
          <tr ${isSuspicious ? 'style="color: #f87171; font-weight: 600;"' : ""}>
            <td>${escapeHtml(li.label)} ${isSuspicious ? `(${escapeHtml(li.kind.toUpperCase())})` : ""}</td>
            <td class="amount">${formatCents(li.amountCents)}</td>
          </tr>
        `;
      });

      // Checks list
      let checksHtml = "";
      cand.checks.forEach((chk) => {
        const statusClass = chk.status.toLowerCase();
        checksHtml += `
          <div class="check-item">
            <span class="check-status-badge ${statusClass}">${escapeHtml(chk.status)}</span>
            <span>${escapeHtml(chk.message)}</span>
          </div>
        `;
      });

      // AI Safety Review findings
      let judgeHtml = "";
      if (cand.judge && cand.judge.findings.length > 0) {
        let findingsList = "";
        cand.judge.findings.forEach((f) => {
          findingsList += `
            <div style="margin-top: 6px;">
              <div style="font-size: 12px; color: #fca5a5;">⚠️ <strong>${escapeHtml(f.severity)}:</strong> ${escapeHtml(f.message)}</div>
              ${
                f.snippet
                  ? `<div class="judge-snippet-quote">Quoted offending text: "${escapeHtml(f.snippet)}"</div>`
                  : ""
              }
            </div>
          `;
        });

        judgeHtml = `
          <div class="judge-review-panel">
            <div class="judge-panel-title">
              <span>AI Safety Review (Gemini Evaluator)</span>
              <span>Status: ${escapeHtml(cand.judge.status)}</span>
            </div>
            ${findingsList}
          </div>
        `;
      }

      // Verdict Banner
      let verdictBannerHtml = "";
      if (cand.decision === "BLOCK") {
        verdictBannerHtml = `
          <div class="verdict-banner block">
            <div style="font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em;">Firewall Verdict: BLOCKED</div>
            <div class="giant-captured-amount" style="color: #ef4444;">$0.00 CAPTURED</div>
            <div class="next-action-note">Deterministic gateway rejected quote. Agent notified ➔ Trying next candidate.</div>
          </div>
        `;
      } else if (cand.decision === "ALLOW") {
        verdictBannerHtml = `
          <div class="verdict-banner allow">
            <div style="font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em;">Firewall Verdict: ALLOWED</div>
            <div class="giant-captured-amount" style="color: #10b981;">${formatCents(cand.capturedCents)} CAPTURED</div>
            <div class="next-action-note" style="color: #34d399;">Order verified under spending contract. Valid receipt issued.</div>
          </div>
        `;
      } else {
        verdictBannerHtml = `
          <div class="verdict-banner stepup">
            <div style="font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em;">Firewall Verdict: STEP_UP REQUIRED</div>
            <div class="giant-captured-amount" style="color: #f59e0b;">$0.00 CAPTURED</div>
            <div class="next-action-note" style="color: #fef08a;">Execution paused. Waiting for human approval.</div>
          </div>
        `;
      }

      card.innerHTML = `
        <div class="candidate-card-header">
          <span class="candidate-number">Candidate #${idx + 1} — ${escapeHtml(cand.merchant.name)}</span>
          <span style="font-size: 12px; color: var(--text-muted);">${escapeHtml(cand.selectionReason)}</span>
        </div>
        <div class="candidate-card-body">
          <h4 style="font-size: 15px; font-weight: 700; margin-bottom: 12px;">${escapeHtml(cand.product.title)}</h4>

          <!-- Price comparison side-by-side -->
          <div class="price-comparison-box">
            <div>
              <div style="font-size: 11px; color: var(--text-muted); text-transform: uppercase;">Advertised Price</div>
              <div class="price-box-val" style="color: #94a3b8;">${formatCents(cand.advertisedTotalCents)}</div>
            </div>
            <div class="price-arrow">➔</div>
            <div>
              <div style="font-size: 11px; color: var(--text-muted); text-transform: uppercase;">Signed Checkout Quote</div>
              <div class="price-box-val" style="color: ${cand.decision === "BLOCK" ? "#ef4444" : "#10b981"};">
                ${formatCents(cand.quotedTotalCents)}
              </div>
            </div>
          </div>

          <!-- Line items -->
          <table class="line-items-table">
            <thead>
              <tr><th>Item Description</th><th style="text-align: right;">Amount</th></tr>
            </thead>
            <tbody>
              ${lineItemsHtml}
            </tbody>
          </table>

          <!-- Checks list -->
          <div class="checks-list">
            ${checksHtml}
          </div>

          <!-- AI Judge panel -->
          ${judgeHtml}

          <!-- Verdict banner -->
          ${verdictBannerHtml}
        </div>
      `;

      candidatesContainer.appendChild(card);
    });
  }

  // --- STEP_UP Decision Actions ---
  btnStepupApprove.addEventListener("click", () => handleStepUpDecision(true));
  btnStepupReject.addEventListener("click", () => handleStepUpDecision(false));

  async function handleStepUpDecision(approved) {
    if (!state.currentRun || !state.currentRun.stepUpPrompt) return;

    btnStepupApprove.disabled = true;
    btnStepupReject.disabled = true;
    const origApproveText = btnStepupApprove.textContent;
    const origRejectText = btnStepupReject.textContent;

    if (approved) {
      btnStepupApprove.textContent = "Approving...";
    } else {
      btnStepupReject.textContent = "Rejecting...";
    }

    try {
      const runId = state.currentRun.runId;
      const candidateId = state.currentRun.stepUpPrompt.candidateId;
      const updatedRun = await apiPost(`/api/run/${runId}/step-up`, { candidateId, approved });

      state.currentRun = updatedRun;
      renderRunState(updatedRun);
    } catch (err) {
      alert("Step-up resolution failed: " + err.message);
    } finally {
      btnStepupApprove.disabled = false;
      btnStepupReject.disabled = false;
      btnStepupApprove.textContent = origApproveText;
      btnStepupReject.textContent = origRejectText;
    }
  }

  // --- Attack Lab Form Submission ---
  attackForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const attack = {
      storeId: attackStore.value,
      productSku: attackProduct.value,
      placement: attackPlacement.value,
      instruction: attackInstruction.value.trim(),
    };

    if (!attack.instruction) {
      alert("Please enter a malicious instruction to plant.");
      return;
    }

    btnPlantAttack.disabled = true;
    btnPlantAttack.textContent = "Planting Attack...";

    try {
      const result = await apiPost("/api/attack/plant", attack);
      state.activeAttack = attack;

      // Automatically draft and sign contract for prompt
      const prompt = `Find ${attackProduct.options[attackProduct.selectedIndex].text}, max $70, no gift cards or subscriptions.`;
      const draft = await apiPost("/api/contract/draft", { prompt });
      const signed = await apiPost("/api/contract/sign", { draft });
      state.signedContract = signed;
      updateContractSummary(signed);

      // Launch run
      const run = await apiPost("/api/run/start", { prompt, contract: signed });
      state.currentRun = run;

      alert(`✓ ${result.message}\n\nSwitching to Live Run view to observe defenses in action.`);
      renderRunState(run);
      switchView("run");
    } catch (err) {
      alert("Planting attack failed: " + err.message);
    } finally {
      btnPlantAttack.disabled = false;
      btnPlantAttack.textContent = "⚡ Plant Attack & Run Agent";
    }
  });

  // Preset Attack Payloads
  document.querySelectorAll("#attack-form .preset-chip-btn").forEach((chip) => {
    chip.addEventListener("click", () => {
      const att = chip.getAttribute("data-attack");
      if (att) attackInstruction.value = att;
    });
  });

  // --- Evidence Verification ---
  btnVerifyCrypto.addEventListener("click", async () => {
    btnVerifyCrypto.disabled = true;
    btnVerifyCrypto.textContent = "Verifying Signatures...";

    try {
      const result = await apiPost("/api/evidence/verify", { receiptId: "rcpt_demo_sa_001" });
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

  btnViewEvidenceFromRun.addEventListener("click", () => {
    switchView("evidence");
  });

  // --- Quick Demo Walkthroughs (Under 90 Seconds) ---
  document.getElementById("quick-demo-block").addEventListener("click", async () => {
    promptInput.value = "Cheapest wireless headphones, max $70 all-in, no subscriptions or gift cards, ask me about unverified sellers.";
    const draft = await apiPost("/api/contract/draft", { prompt: promptInput.value });
    const signed = await apiPost("/api/contract/sign", { draft });
    state.signedContract = signed;
    updateContractSummary(signed);
    const run = await apiPost("/api/run/start", { prompt: promptInput.value, contract: signed });
    state.currentRun = run;
    renderRunState(run);
    switchView("run");
  });

  document.getElementById("quick-demo-stepup").addEventListener("click", async () => {
    const prompt = "Find open box headphones on PeerMarket, max $70, ask about unverified sellers.";
    const draft = await apiPost("/api/contract/draft", { prompt });
    const signed = await apiPost("/api/contract/sign", { draft });
    state.signedContract = signed;
    updateContractSummary(signed);
    const run = await apiPost("/api/run/start", { prompt, contract: signed });
    state.currentRun = run;
    renderRunState(run);
    switchView("run");
  });

  document.getElementById("quick-demo-attack").addEventListener("click", () => {
    switchView("attack");
  });

  document.getElementById("quick-demo-evidence").addEventListener("click", () => {
    switchView("evidence");
  });

  // --- Initial Setup ---
  refreshStatus();
  setInterval(refreshStatus, 10000);
})();


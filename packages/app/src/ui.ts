export function renderRecourseUiHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Recourse - Mock Demo</title>
<style>
  :root {
    color-scheme: dark;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: #07111f;
    color: #eef6ff;
  }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; background: radial-gradient(circle at top left, #12365f 0, #07111f 42rem); }
  .banner {
    background: #facc15;
    color: #111827;
    text-align: center;
    font-weight: 900;
    letter-spacing: 0.08em;
    padding: 0.8rem 1rem;
  }
  main { width: min(1120px, calc(100% - 2rem)); margin: 0 auto; padding: 2rem 0 3rem; }
  .hero { display: flex; justify-content: space-between; gap: 1rem; align-items: flex-start; flex-wrap: wrap; }
  h1 { font-size: clamp(2.4rem, 7vw, 5rem); line-height: 0.95; margin: 0; }
  .subtitle { color: #bdd7f2; font-size: 1.15rem; max-width: 44rem; }
  .card {
    background: rgba(8, 25, 47, 0.88);
    border: 1px solid rgba(147, 197, 253, 0.28);
    border-radius: 1.25rem;
    padding: 1.25rem;
    box-shadow: 0 24px 70px rgba(0, 0, 0, 0.32);
    margin-top: 1.25rem;
  }
  .status-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; }
  .metric { background: rgba(15, 43, 76, 0.8); border-radius: 1rem; padding: 1rem; }
  .metric span { display: block; color: #93c5fd; font-size: 0.78rem; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; }
  .metric strong { display: block; font-size: 1.35rem; margin-top: 0.35rem; overflow-wrap: anywhere; }
  button {
    background: #38bdf8;
    color: #082f49;
    border: 0;
    border-radius: 999px;
    padding: 0.75rem 1.1rem;
    font-weight: 900;
    cursor: pointer;
  }
  button:hover { background: #7dd3fc; }
  pre {
    background: #020617;
    border: 1px solid rgba(147, 197, 253, 0.22);
    border-radius: 0.9rem;
    padding: 1rem;
    overflow: auto;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; }
  .mini-card { background: rgba(15, 43, 76, 0.72); border-radius: 1rem; padding: 1rem; }
  .error { color: #fca5a5; min-height: 1.25rem; }
  .muted { color: #a9c6e8; }
</style>
</head>
<body>
  <div class="banner">MOCK/SANDBOX - NO REAL MONEY</div>
  <main>
    <section class="hero">
      <div>
        <h1>Recourse</h1>
        <p class="subtitle">A pre-payment firewall that checks agent payments against a signed Intent Contract before any money moves.</p>
      </div>
      <button id="refresh-status" type="button">Refresh status</button>
    </section>

    <section class="card" aria-labelledby="status-heading">
      <h2 id="status-heading">Live app status</h2>
      <div class="status-grid">
        <div class="metric"><span>Mode</span><strong id="status-mode">Loading...</strong></div>
        <div class="metric"><span>PSP</span><strong id="status-psp">Loading...</strong></div>
        <div class="metric"><span>Judge</span><strong id="status-judge">Loading...</strong></div>
        <div class="metric"><span>Receipts</span><strong id="status-receipt-count">Loading...</strong></div>
        <div class="metric"><span>Chain verified</span><strong id="status-chain-verified">Loading...</strong></div>
        <div class="metric"><span>Real money</span><strong id="status-real-money">Loading...</strong></div>
      </div>
      <p id="status-error" class="error" role="alert"></p>
      <p class="muted">Last updated: <span id="status-updated">never</span></p>
      <details>
        <summary>Signing public key</summary>
        <pre id="signing-public-key">Loading...</pre>
      </details>
    </section>

    <section class="card" aria-labelledby="demo-heading">
      <h2 id="demo-heading">Demo path</h2>
      <div class="cards">
        <div class="mini-card"><h3>1. ALLOW</h3><p>Valid JK-101 payment captures exactly the computed total.</p></div>
        <div class="mini-card"><h3>2. BLOCK</h3><p>Merchant tampering moves $0 and still creates a signed receipt.</p></div>
        <div class="mini-card"><h3>3. Evidence</h3><p>Signed receipts verify independently against the public key.</p></div>
      </div>
      <p id="demo-placeholder" class="muted">Interactive payment actions are added in the next 6F step.</p>
    </section>
  </main>

<script>
  function setText(id, value) {
    document.getElementById(id).textContent = String(value);
  }

  async function loadStatus() {
    var errorEl = document.getElementById("status-error");
    errorEl.textContent = "";
    try {
      var res = await fetch("/v1/app/status", { headers: { "accept": "application/json" } });
      if (!res.ok) throw new Error("HTTP " + res.status);
      var status = await res.json();
      setText("status-mode", status.mode || "UNKNOWN");
      setText("status-psp", (status.psp || "UNKNOWN") + " / tier " + (status.psp_tier || "?"));
      setText("status-judge", status.judge || "UNKNOWN");
      setText("status-receipt-count", status.receipt_count);
      setText("status-chain-verified", status.chain_verified ? "YES" : "NO");
      setText("status-real-money", status.real_money ? "YES" : "NO");
      setText("signing-public-key", status.signing_public_key_pem || "Unavailable");
      setText("status-updated", new Date().toLocaleTimeString());
    } catch (error) {
      errorEl.textContent = "Status unavailable: " + (error && error.message ? error.message : error);
      setText("status-judge", "UNREACHABLE");
    }
  }

  document.getElementById("refresh-status").addEventListener("click", loadStatus);
  loadStatus();
</script>
</body>
</html>`;
}

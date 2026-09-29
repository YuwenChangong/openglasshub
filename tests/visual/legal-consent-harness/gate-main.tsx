import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import "../../../src/styles/community.css";
import "./harness.css";
import { LEGAL_CONSENT_PAGE_GATE_STATES } from "../legal-consent-page-gate-state-matrix.mjs";

function App() {
  const [id, setId] = useState(LEGAL_CONSENT_PAGE_GATE_STATES[0].id);
  return <main className="legal-harness">
    <nav aria-label="Former consent states">{LEGAL_CONSENT_PAGE_GATE_STATES.map((state) => <button key={state.id} onClick={() => setId(state.id)}>{state.id}</button>)}</nav>
    <section className="legal-harness__surface" data-scenario={id}>
      <main className="community-shell"><section className="auth-card"><h1>社区内容</h1><p>社区内容已显示。</p></section></main>
    </section>
    <output />
  </main>;
}
createRoot(document.getElementById("root")!).render(<App />);

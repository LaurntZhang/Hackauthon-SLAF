/*
 * ManAgent — page mobile de validation (carte HITL hors de la tour de contrôle).
 * En simulation, elle dialogue avec dashboard.html via BroadcastChannel (même navigateur, même origine).
 * Avec l'API, la décision signée partira vers POST /approvals/{thread_id}.
 */
(function () {
  'use strict';
  const MA = window.ManAgent;
  const icon = MA.icon;
  const body = document.getElementById('mobile-body');
  const linkState = document.getElementById('link-state');
  const channel = 'BroadcastChannel' in window ? new BroadcastChannel('managent-hitl') : null;

  let card = null;
  let currentThread = null;
  let pendingResult = null;
  let heard = false;

  document.querySelectorAll('[data-icon]').forEach((el) => {
    el.innerHTML = icon(el.dataset.icon);
  });

  function idle(text) {
    card = null;
    currentThread = null;
    body.innerHTML = `<div class="phone-idle">${icon('phone')}<p><strong>Aucune décision en attente.</strong></p><p>${text}</p></div>`;
  }

  function isCard(value) {
    return (
      value && typeof value === 'object' && typeof value.thread_id === 'string' && typeof value.intent_hash === 'string' &&
      value.intent && typeof value.intent === 'object' && Array.isArray(value.verdicts)
    );
  }

  function show(message) {
    if (card && currentThread === message.card.thread_id) return;
    const threadId = message.card.thread_id;
    currentThread = threadId;
    card = MA.HitlCard.mount(body, message.card, {
      onDecide: (decision) =>
        new Promise((resolve) => {
          pendingResult = { thread: threadId, resolve };
          channel.postMessage({ type: 'decision', thread_id: threadId, decision });
          window.setTimeout(() => {
            if (pendingResult && pendingResult.thread === threadId) {
              pendingResult = null;
              resolve({ ok: false, error: 'Pas de réponse de la tour de contrôle.' });
            }
          }, 4000);
        }),
      onReport: () => channel.postMessage({ type: 'report', thread_id: threadId }),
      getRecord: () => message.record || null,
    });
    document.getElementById('mobile-status').textContent = `Nouvelle décision à valider : ${message.card.correlation_id}.`;
    const activated = navigator.userActivation ? navigator.userActivation.hasBeenActive : false;
    if (navigator.vibrate && activated) navigator.vibrate(120);
  }

  function demoCard() {
    const intent = {
      intent_id: 'INT-DEMO', correlation_id: 'TX-DEMO', proposer_id: 'proposer', asset: 'EUROTECH', asset_type: 'equity',
      side: 'buy', amount: '85000.00', currency: 'EUR', counterparty: 'Apex Capital Partners',
      rationale: 'Résultats supérieurs au consensus : renforcement de la ligne EuroTech.', confidence: 0.71,
      data_sources: ['news-resultats-eurotech'],
    };
    const { asset, asset_type, side, amount, currency, counterparty } = intent;
    return {
      thread_id: 'thr-TX-DEMO',
      correlation_id: 'TX-DEMO',
      intent,
      asset_label: 'EuroTech SA',
      intent_hash: MA.crypto.sha256Hex(MA.crypto.canonical({ asset, asset_type, side, amount, currency, counterparty })),
      reasons: ['POL-005', 'QRM-001'],
      requested_at: new Date().toISOString(),
      verdicts: [
        { judge_id: 'risk_judge', vote: 'veto', confidence: 0.86, rule_ids: ['RJ-SECT'], justification: 'Exposition au secteur Technologie portée à 18,9 % (alerte 18,0 %, limite 20,0 %) : trop concentrée pour un profil prudent.' },
        { judge_id: 'compliance_judge', vote: 'approve', confidence: 0.93, rule_ids: ['CJ-KYC', 'CJ-UNIV'], justification: "Contrepartie Apex Capital Partners en liste blanche KYC (revue du 30/09/2026) ; actif dans l'univers du mandat." },
      ],
    };
  }

  function noTower() {
    linkState.textContent = 'hors ligne';
    body.innerHTML = `
      <div class="phone-idle">
        ${icon('info')}
        <p><strong>Aucune tour de contrôle détectée.</strong></p>
        <p>Ouvrez dashboard.html dans un autre onglet du même navigateur. Si les pages sont ouvertes en file://,
        servez le dossier en local (par exemple <span class="mono">python -m http.server</span>) pour qu'elles partagent la même origine.</p>
        <button type="button" class="btn btn-ghost btn-lg" id="demo-btn">${icon('play')}Voir un exemple de carte</button>
      </div>`;
    document.getElementById('demo-btn').addEventListener('click', () => {
      card = MA.HitlCard.mount(body, demoCard(), { demo: true, onDecide: async () => ({ ok: true }), getRecord: () => null });
    });
  }

  if (new URLSearchParams(window.location.search).get('mode') === 'live') {
    let liveCard = null;
    const poll = async () => {
      try {
        const response = await fetch('/approvals');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const pending = await response.json();
        linkState.textContent = 'connecté';
        const next = pending[0];
        if (!next) {
          if (!card || !card.decided) idle("La tour de contrôle est connectée. La carte apparaîtra dès qu'une opération sera escaladée.");
        } else if (!liveCard || liveCard.thread_id !== next.thread_id) {
          const mountedCard = MA.HitlCard.mount(body, next, {
            live: true,
            onDecide: async (decision) => {
              const result = await fetch(`/approvals/${encodeURIComponent(next.thread_id)}/demo`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: decision.action, pin: decision.pin }),
              });
              if (!result.ok) {
                const error = await result.json().catch(() => ({}));
                return { ok: false, error: error.detail || `HTTP ${result.status}` };
              }
              return { ok: true };
            },
            onReport: async () => {
              window.open(`/decisions/${encodeURIComponent(next.correlation_id)}`, '_blank', 'noopener');
            },
            getRecord: () => null,
          });
          liveCard = next;
          card = mountedCard;
        }
      } catch (error) {
        linkState.textContent = 'reconnexion…';
        console.warn('[ManAgent] API HITL indisponible', error);
      } finally {
        window.setTimeout(poll, 1500);
      }
    };
    idle('Connexion à la tour de contrôle…');
    poll();
    return;
  }

  if (!channel) {
    noTower();
    return;
  }

  // Seuls ces messages viennent de la tour de contrôle ; hello, decision et report viennent d'autres téléphones.
  const TOWER_MESSAGES = new Set(['pending', 'idle', 'resolved', 'decision-result']);

  channel.onmessage = ({ data }) => {
    if (!data || typeof data !== 'object' || !TOWER_MESSAGES.has(data.type)) return;
    heard = true;
    linkState.textContent = 'connecté';
    if (data.type === 'pending' && isCard(data.card)) {
      show(data);
    } else if (data.type === 'idle') {
      if (!card || card.decided) idle("La tour de contrôle est connectée. La carte apparaîtra dès qu'une opération sera escaladée.");
    } else if (data.type === 'decision-result' && pendingResult && data.thread_id === pendingResult.thread) {
      pendingResult.resolve({ ok: Boolean(data.ok), error: data.error });
      pendingResult = null;
    } else if (data.type === 'resolved' && card && data.thread_id === currentThread && !card.decided) {
      // Notre propre décision est en vol : on attend decision-result plutôt que d'afficher « déjà prise ».
      if (pendingResult && pendingResult.thread === data.thread_id) return;
      card.resolvedElsewhere(data.status);
    }
  };

  idle('Connexion à la tour de contrôle…');
  channel.postMessage({ type: 'hello' });
  window.setTimeout(() => {
    if (!heard) noTower();
  }, 1500);
})();

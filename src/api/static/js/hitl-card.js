/*
 * ManAgent — carte d'approbation HITL (Approuver / Rejeter / Demander un rapport).
 * Partagée par le téléphone simulé de la tour de contrôle et par approval.html.
 * Le code PIN simule la biométrie ; la décision est signée en HMAC et liée au hash de l'intention.
 */
(function (root) {
  'use strict';
  const MA = (root.ManAgent = root.ManAgent || {});
  const C = MA.config;
  const fmt = MA.fmt;
  const esc = MA.esc;
  const icon = MA.icon;

  const VOTE_LABELS = { approve: 'Approuve', veto: 'Veto', abstain: 'Abstention' };
  let instance = 0;

  /**
   * Monte une carte d'approbation dans un conteneur.
   * @param {HTMLElement} container Conteneur cible.
   * @param {object} card Carte émise par l'événement hitl.requested.
   * @param {{onDecide: Function, onReport?: Function, getRecord?: Function, demo?: boolean}} options
   */
  function mount(container, card, options) {
    const uid = `hitl-${++instance}`;
    const intent = card.intent;
    const amount = fmt.eur(intent.amount);
    const state = { view: 'review', action: null, error: null, result: null, record: null, busy: false };

    function header() {
      return `
        <p class="hitl-eyebrow">${icon('shield')} Validation requise · AI Act art. 14</p>
        <h2 class="hitl-title" id="${uid}-title" tabindex="-1">${esc(fmt.side(intent.side))} de ${esc(amount)}</h2>
        <p class="hitl-asset">${esc(card.asset_label || fmt.assetLabel(intent.asset))} · ${esc(C.ASSET_TYPE_LABELS[intent.asset_type] || intent.asset_type)}</p>
        <p class="hitl-meta">${esc(intent.counterparty)} · <span class="mono">${esc(card.thread_id)}</span> · ${esc(card.requested_at ? fmt.time(card.requested_at) : '—')}</p>`;
    }

    function reviewView() {
      const reasons = (card.reasons || [])
        .map((r) => `<li><span class="rule-chip mono">${esc(r)}</span><span>${esc(fmt.rule(r))}</span></li>`)
        .join('');
      const votes = (card.verdicts || [])
        .map(
          (v) => `
          <li class="vote vote--${esc(v.vote)}">
            <p class="vote-head"><strong>${esc(fmt.actor(v.judge_id))}</strong><span class="badge badge--${esc(v.vote)}">${esc(VOTE_LABELS[v.vote] || v.vote)}</span></p>
            <p class="vote-text">${esc(v.justification)}</p>
          </li>`,
        )
        .join('');
      return `
        <div class="hitl" role="group" aria-labelledby="${uid}-title">
          ${header()}
          ${options.demo ? '<p class="hitl-demo">Mode exemple : aucune décision n\'est transmise.</p>' : ''}
          <section class="hitl-section" aria-labelledby="${uid}-why">
            <h3 id="${uid}-why">Pourquoi vous êtes sollicité</h3>
            <ul class="hitl-reasons">${reasons}</ul>
          </section>
          <section class="hitl-section" aria-labelledby="${uid}-votes">
            <h3 id="${uid}-votes">Votes des juges</h3>
            <ul class="hitl-votes">${votes}</ul>
          </section>
          <section class="hitl-section" aria-labelledby="${uid}-prop">
            <h3 id="${uid}-prop">Proposition du Proposer</h3>
            <p class="hitl-text">${esc(intent.rationale)} <span class="muted">Confiance ${esc(fmt.dec(intent.confidence))}.</span></p>
          </section>
          <div class="hitl-actions">
            <button type="button" class="btn btn-primary btn-lg" data-act="approve">${icon('check')}Approuver</button>
            <button type="button" class="btn btn-danger-outline btn-lg" data-act="reject">${icon('x')}Rejeter</button>
            <button type="button" class="btn btn-ghost btn-lg" data-act="report">${icon('file')}Demander un rapport</button>
          </div>
        </div>`;
    }

    function pinView() {
      const approve = state.action === 'approve';
      const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9']
        .map((k) => `<button type="button" class="key" data-key="${k}">${k}</button>`)
        .join('');
      return `
        <form class="hitl hitl--pin" id="${uid}-form" novalidate aria-labelledby="${uid}-pin-title">
          <button type="button" class="btn-link" data-act="back">${icon('chevron', 'flip')}Retour</button>
          <h2 class="hitl-title" id="${uid}-pin-title" tabindex="-1">${approve ? 'Approuver' : 'Rejeter'} ${esc(amount)}</h2>
          <p class="hitl-text">La décision sera signée (HMAC-SHA256) et liée au hash de l'intention <span class="mono">${esc(fmt.shortHash(card.intent_hash))}</span>.</p>
          <label class="field-label" for="${uid}-pin">Code de confirmation</label>
          <input class="pin-input mono" id="${uid}-pin" name="pin" type="password" inputmode="numeric" autocomplete="off"
            maxlength="4" pattern="[0-9]{4}" required aria-describedby="${uid}-pin-help ${uid}-pin-error"
            ${state.error ? 'aria-invalid="true"' : ''}>
          <p class="help" id="${uid}-pin-help">${icon('fingerprint')}Simule la biométrie du téléphone. Code de démo : ${esc(C.DEMO_PIN)}.</p>
          <p class="field-error" id="${uid}-pin-error" role="alert">${state.error ? esc(state.error) : ''}</p>
          <p class="sr-only" id="${uid}-pin-count" aria-live="polite"></p>
          <div class="keypad" role="group" aria-label="Pavé numérique">
            ${keys}
            <button type="button" class="key key--muted" data-key="del" aria-label="Effacer le dernier chiffre" ${state.busy ? 'disabled' : ''}>${icon('backspace')}</button>
            <button type="button" class="key" data-key="0">0</button>
            <button type="submit" class="key key--ok" aria-label="Signer la décision" ${state.busy ? 'disabled' : ''}>${icon('check')}</button>
          </div>
          <div class="hitl-actions">
            <button type="submit" class="btn ${approve ? 'btn-primary' : 'btn-danger'} btn-lg btn-block" ${state.busy ? 'disabled aria-busy="true"' : ''}>
              ${icon('lock')}${state.busy ? 'Signature en cours…' : `Signer et ${approve ? 'approuver' : 'rejeter'}`}
            </button>
          </div>
        </form>`;
    }

    function reportView() {
      const record = state.record;
      if (!record) {
        return `<div class="hitl"><button type="button" class="btn-link" data-act="back">${icon('chevron', 'flip')}Retour</button>
          <p class="hitl-text">Fiche indisponible.</p></div>`;
      }
      const factors = record.factors
        .map((f) => `<li class="factor factor--${esc(f.effect)}"><p><strong>${esc(f.actor)}</strong> <span class="mono muted">#${esc(f.line)}</span></p><p>${esc(f.text)}</p></li>`)
        .join('');
      const unc = record.uncertainties.map((u) => `<li>${esc(u)}</li>`).join('');
      return `
        <div class="hitl" role="group" aria-labelledby="${uid}-rep-title">
          <button type="button" class="btn-link" data-act="back">${icon('chevron', 'flip')}Retour à la décision</button>
          <h2 class="hitl-title hitl-title--sm" id="${uid}-rep-title" tabindex="-1">Fiche explicative · ${esc(record.correlation_id)}</h2>
          <p class="hitl-text">${esc(record.summary)}</p>
          <section class="hitl-section"><h3>Facteurs journalisés</h3><ol class="factors">${factors}</ol></section>
          <section class="hitl-section"><h3>Incertitudes</h3><ul class="plain-list">${unc}</ul></section>
          <p class="hitl-note">Cette fiche reprend les règles et votes journalisés. Elle ne reconstitue pas un raisonnement interne de modèle.</p>
        </div>`;
    }

    function doneView() {
      const approved = state.action === 'approve';
      const elsewhere = state.result && state.result.elsewhere;
      const title = elsewhere ? 'Décision déjà prise' : approved ? 'Approbation signée' : 'Rejet signé';
      const text = elsewhere
        ? `Cette demande a été traitée sur un autre écran (${esc(state.result.label)}).`
        : options.demo
          ? 'Mode exemple : la signature a été calculée localement, rien n\'a été transmis.'
          : approved
            ? `Signature vérifiée. Le graphe reprend sur <span class="mono">${esc(card.thread_id)}</span>.`
            : "Signature vérifiée. L'exécuteur ne sera pas sollicité.";
      return `
        <div class="hitl hitl--done" role="status">
          <span class="done-icon ${approved && !elsewhere ? 'is-ok' : 'is-neutral'}">${icon(approved && !elsewhere ? 'checkCircle' : 'info')}</span>
          <h2 class="hitl-title hitl-title--sm" id="${uid}-done-title" tabindex="-1">${title}</h2>
          <p class="hitl-text">${text}</p>
          ${state.result && state.result.signature ? `<p class="hitl-meta">HMAC <span class="mono">${esc(state.result.signature.slice(0, 24))}…</span></p>` : ''}
        </div>`;
    }

    const views = { review: reviewView, pin: pinView, report: reportView, done: doneView };

    function render(focusSelector) {
      container.innerHTML = views[state.view]();
      bind();
      const target = focusSelector ? container.querySelector(focusSelector) : container.querySelector('.hitl-title');
      if (target) target.focus({ preventScroll: false });
    }

    function bind() {
      container.querySelectorAll('[data-act]').forEach((button) => {
        button.addEventListener('click', () => onAction(button.dataset.act));
      });
      const form = container.querySelector('form');
      if (!form) return;
      const input = form.querySelector('input[name="pin"]');
      const count = form.querySelector(`#${uid}-pin-count`);
      form.querySelectorAll('[data-key]').forEach((key) => {
        key.addEventListener('click', () => {
          if (key.dataset.key === 'del') input.value = input.value.slice(0, -1);
          else if (input.value.length < 4) input.value += key.dataset.key;
          // Pas de focus sur le champ : sur mobile, le clavier natif recouvrirait le pavé.
          count.textContent = `${input.value.length} chiffre${input.value.length > 1 ? 's' : ''} sur 4`;
        });
      });
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        submitPin(input.value.trim());
      });
    }

    function onAction(act) {
      if (act === 'approve' || act === 'reject') {
        state.action = act;
        state.error = null;
        state.view = 'pin';
        render(pinFocus());
      } else if (act === 'report') {
        state.record = options.getRecord ? options.getRecord() : null;
        if (options.onReport) options.onReport();
        state.view = 'report';
        render();
      } else if (act === 'back') {
        state.view = 'review';
        render();
      }
    }

    /** Sur écran tactile, le focus va au titre pour ne pas ouvrir le clavier natif par-dessus le pavé. */
    function pinFocus() {
      const coarse = root.matchMedia && root.matchMedia('(pointer: coarse)').matches;
      return coarse ? '.hitl-title' : 'input[name="pin"]';
    }

    async function submitPin(pin) {
      if (state.busy) return;
      if (!/^\d{4}$/.test(pin)) {
        state.error = 'Saisissez les 4 chiffres du code.';
        render(pinFocus());
        return;
      }
      if (!options.live && pin !== C.DEMO_PIN) {
        state.error = 'Code incorrect. La décision n\'a pas été signée.';
        render(pinFocus());
        return;
      }
      const timestamp = new Date().toISOString();
      let decision = { action: state.action, pin };
      if (!options.live) {
        const payload = MA.crypto.hitlPayload(card.thread_id, state.action, C.APPROVER_ID, timestamp, card.intent_hash);
        decision = {
          action: state.action,
          approver_id: C.APPROVER_ID,
          timestamp,
          signature: MA.crypto.hmacHex(C.DEMO_HMAC_KEY, payload),
        };
      }
      state.busy = true;
      render('.hitl-title');
      const result = options.demo ? { ok: true } : await options.onDecide(decision);
      state.busy = false;
      if (!result || !result.ok) {
        state.error = (result && result.error) || 'La décision n\'a pas pu être transmise.';
        render(pinFocus());
        return;
      }
      state.result = decision.signature ? { signature: decision.signature } : {};
      state.view = 'done';
      render();
    }

    render(null);

    return {
      threadId: card.thread_id,
      /** Signale que la décision a été prise ailleurs (autre écran). */
      resolvedElsewhere(status) {
        if (state.view === 'done') return;
        state.action = status === 'approved' ? 'approve' : 'reject';
        state.result = { elsewhere: true, label: status === 'approved' ? 'approuvée' : 'rejetée' };
        state.view = 'done';
        render();
      },
      get decided() {
        return state.view === 'done';
      },
    };
  }

  MA.HitlCard = { mount };
})(typeof window !== 'undefined' ? window : globalThis);

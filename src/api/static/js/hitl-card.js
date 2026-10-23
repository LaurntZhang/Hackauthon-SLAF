/*
 * ManAgent — carte de validation du gérant (Approuver / Refuser / Décider plus tard / Fiche explicative).
 * Partagée par le téléphone simulé de la salle de contrôle et par approval.html.
 * Le code PIN simule la biométrie ; la décision est signée en HMAC et liée au hash de l'intention.
 * « Décider plus tard » est un état d'affichage local : rien n'est transmis, l'opération reste suspendue.
 */
(function (root) {
  'use strict';
  const MA = (root.ManAgent = root.ManAgent || {});
  const C = MA.config;
  const fmt = MA.fmt;
  const esc = MA.esc;
  const icon = MA.icon;
  const W = MA.wording;

  const JUDGE_NAMES = { risk_judge: 'Contrôle risque', compliance_judge: 'Contrôle conformité' };
  const JUDGE_SUBJECT = { risk_judge: 'Le contrôle risque', compliance_judge: 'Le contrôle conformité' };
  let instance = 0;

  function statusHtml(code, label) {
    if (W) return W.status(code, label);
    return `<span class="status">${esc(label || code)}</span>`;
  }

  /** Retire le préfixe technique (ALLOW : / ESCALATE : / BLOCK :) d'une explication journalisée. */
  function plain(text) {
    const t = String(text || '').replace(/^(ALLOW|ESCALATE|BLOCK)\s*:\s*/, '');
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
  }

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
    const maxAmount = (card.policy && card.policy.effective_max) || C.LIMITS.autonomousMax;

    function reasonText(ruleId) {
      if (ruleId === 'QRM-001') {
        const dissent = (card.verdicts || []).filter((v) => v.vote !== 'approve');
        if (dissent.length) {
          const who = dissent
            .map((v) => `${JUDGE_SUBJECT[v.judge_id] || fmt.actor(v.judge_id)} ${v.vote === 'veto' ? 'oppose son veto' : "s'abstient"}`)
            .join(' et ');
          return `${who} : seul un humain peut trancher.`;
        }
      }
      return W ? W.rule(ruleId, { max: fmt.eur(maxAmount) }) : fmt.rule(ruleId);
    }

    function header() {
      return `
        <header class="hitl-head">
          <p class="hitl-eyebrow">${icon('pen')}Validation du gérant · AI Act art. 14</p>
          <p class="hitl-lead">Une décision est attendue</p>
          <h2 class="hitl-title" id="${uid}-title" tabindex="-1">${esc(fmt.side(intent.side))} de ${esc(amount)}</h2>
          <p class="hitl-asset">${esc(card.asset_label)} <span class="muted">· ${esc(C.ASSET_TYPE_LABELS[intent.asset_type] || intent.asset_type)}</span></p>
          <dl class="hitl-facts">
            <dt>Contrepartie</dt><dd>${esc(intent.counterparty)}</dd>
            <dt>Demandée à</dt><dd>${esc(fmt.time(card.requested_at))}</dd>
            <dt>Dossier</dt><dd><span class="mono">${esc(card.correlation_id)}</span></dd>
          </dl>
        </header>`;
    }

    function checksHtml() {
      const items = [];
      if (card.policy) {
        items.push(`
          <li class="check">
            <span class="check-name">Analyse du mandat</span>${statusHtml(card.policy.outcome, card.policy.outcome === 'ESCALATE' ? 'Seuil dépassé' : null)}
            <p class="check-text">${esc(plain(card.policy.explanation))}</p>
          </li>`);
      }
      for (const v of card.verdicts || []) {
        items.push(`
          <li class="check">
            <span class="check-name">${esc(JUDGE_NAMES[v.judge_id] || fmt.actor(v.judge_id))}</span>${statusHtml(v.vote)}
            <p class="check-text">${esc(v.justification)}</p>
          </li>`);
      }
      if (card.quorum) {
        items.push(`
          <li class="check">
            <span class="check-name">Décision des contrôles</span>${statusHtml(card.quorum.outcome)}
            <p class="check-text">${esc(plain(card.quorum.explanation))}</p>
          </li>`);
      }
      return items.join('');
    }

    function reviewView() {
      const reasons = (card.reasons || [])
        .map((r) => `<li>${esc(reasonText(r))}<span class="rule-ref" title="${esc(fmt.rule(r))}">Règle <span class="mono">${esc(r)}</span></span></li>`)
        .join('');
      return `
        <div class="hitl" role="group" aria-labelledby="${uid}-title">
          ${header()}
          ${options.demo ? '<p class="hitl-demo">Mode exemple : aucune décision n\'est transmise.</p>' : ''}
          <section class="hitl-section hitl-why" aria-labelledby="${uid}-why">
            <h3 id="${uid}-why">Pourquoi vous êtes sollicité</h3>
            <ul class="hitl-reasons">${reasons}</ul>
          </section>
          <section class="hitl-section" aria-labelledby="${uid}-checks">
            <h3 id="${uid}-checks">Contrôles déjà effectués</h3>
            <ol class="hitl-checks">${checksHtml()}</ol>
          </section>
          <section class="hitl-section" aria-labelledby="${uid}-prop">
            <h3 id="${uid}-prop">Ce que propose l'agent</h3>
            <p class="hitl-text">${esc(intent.rationale)} <span class="muted">Confiance déclarée ${esc(fmt.dec(intent.confidence))}.</span></p>
          </section>
          <section class="hitl-section" aria-labelledby="${uid}-proof">
            <h3 id="${uid}-proof">Éléments de preuve</h3>
            <dl class="hitl-proof">
              <dt>Empreinte de l'ordre</dt><dd>${esc(fmt.shortHash(card.intent_hash))}</dd>
              <dt>Traitement suspendu</dt><dd>${esc(card.thread_id)}</dd>
              <dt>Règles appliquées</dt><dd>${esc((card.policy && card.policy.policy_version) || C.POLICY_VERSION)}</dd>
            </dl>
            <p class="hitl-note">Votre signature sera liée à cette empreinte : si l'ordre change ensuite, il sera bloqué avant le marché.</p>
          </section>
          <div class="hitl-actions">
            <button type="button" class="btn btn-approve btn-lg" data-act="approve">${icon('check')}Approuver</button>
            <button type="button" class="btn btn-danger-outline btn-lg" data-act="reject">${icon('x')}Refuser</button>
            <button type="button" class="btn btn-ghost" data-act="later">${icon('pause')}Décider plus tard</button>
            <button type="button" class="btn btn-ghost" data-act="report">${icon('file')}Fiche explicative</button>
            <p class="hitl-reassure">${icon('lock')}<span>Rien n'est exécuté sans votre signature. Vous pouvez revenir en arrière jusqu'au moment de signer.</span></p>
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
          <button type="button" class="btn-link" data-act="back">${icon('chevron', 'flip')}Retour, sans signer</button>
          <header class="hitl-head">
            <p class="hitl-eyebrow">${icon('pen')}Signature</p>
            <h2 class="hitl-title" id="${uid}-pin-title" tabindex="-1">${approve ? 'Approuver' : 'Refuser'} ${esc(amount)}</h2>
            <p class="hitl-asset">${esc(card.asset_label)} <span class="muted">· ${esc(intent.counterparty)}</span></p>
          </header>
          <p class="hitl-text">La décision sera signée (HMAC-SHA256) et liée à l'empreinte de l'ordre <span class="mono">${esc(fmt.shortHash(card.intent_hash))}</span>. Elle sera inscrite au journal de preuve.</p>
          <label class="field-label" for="${uid}-pin">Code de confirmation</label>
          <input class="pin-input mono" id="${uid}-pin" name="pin" type="password" inputmode="numeric" autocomplete="off"
            maxlength="4" pattern="[0-9]{4}" required aria-describedby="${uid}-pin-help ${uid}-pin-error"
            ${state.error ? 'aria-invalid="true"' : ''}>
          <p class="help" id="${uid}-pin-help">${icon('fingerprint')}Simule la biométrie du téléphone. Code de démo : ${esc(C.DEMO_PIN)}.</p>
          <p class="field-error" id="${uid}-pin-error" role="alert">${state.error ? `${icon('alert')}${esc(state.error)}` : ''}</p>
          <p class="sr-only" id="${uid}-pin-count" aria-live="polite"></p>
          <div class="keypad" role="group" aria-label="Pavé numérique">
            ${keys}
            <button type="button" class="key key--muted" data-key="del" aria-label="Effacer le dernier chiffre" ${state.busy ? 'disabled' : ''}>${icon('backspace')}</button>
            <button type="button" class="key" data-key="0">0</button>
            <button type="submit" class="key key--ok" aria-label="Signer la décision" ${state.busy ? 'disabled' : ''}>${icon('check')}</button>
          </div>
          <div class="hitl-actions hitl-actions--single">
            <button type="submit" class="btn ${approve ? 'btn-approve' : 'btn-danger'} btn-lg btn-block" ${state.busy ? 'disabled aria-busy="true"' : ''}>
              ${icon('lock')}${state.busy ? 'Signature en cours…' : `Signer et ${approve ? 'approuver' : 'refuser'}`}
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
        .map((f) => `<li class="factor factor--${esc(f.effect)}"><p><strong>${esc(f.actor)}</strong> <span class="mono muted">n° ${esc(f.line)}</span></p><p>${esc(f.text)}</p></li>`)
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

    function laterView() {
      return `
        <div class="hitl hitl--later" role="status">
          <span class="done-icon is-human">${icon('pause')}</span>
          <h2 class="hitl-title hitl-title--sm" id="${uid}-later-title" tabindex="-1">Décision mise en attente</h2>
          <p class="hitl-text">L'opération de ${esc(amount)} sur ${esc(card.asset_label)} reste suspendue : aucun ordre ne part sans votre signature.</p>
          <button type="button" class="btn btn-primary btn-lg" data-act="resume">${icon('replay')}Reprendre la décision</button>
        </div>`;
    }

    function doneView() {
      const approved = state.action === 'approve';
      const elsewhere = state.result && state.result.elsewhere;
      const title = elsewhere ? 'Décision déjà prise' : approved ? 'Approbation signée' : 'Refus signé';
      const text = elsewhere
        ? `Cette demande a été traitée sur un autre écran (${esc(state.result.label)}).`
        : options.demo
          ? 'Mode exemple : la signature a été calculée localement, rien n\'a été transmis.'
          : approved
            ? `Signature vérifiée. Le traitement reprend sur <span class="mono">${esc(card.thread_id)}</span> ; l'ordre reste soumis aux contrôles d'intégrité et aux limites du jour.`
            : "Signature vérifiée. L'exécuteur ne sera pas sollicité.";
      const tone = elsewhere ? 'is-neutral' : approved ? 'is-ok' : 'is-block';
      const ic = elsewhere ? 'info' : approved ? 'checkCircle' : 'xCircle';
      return `
        <div class="hitl hitl--done" role="status">
          <span class="done-icon ${tone}">${icon(ic)}</span>
          <h2 class="hitl-title hitl-title--sm" id="${uid}-done-title" tabindex="-1">${title}</h2>
          <p class="hitl-text">${text}</p>
          ${state.result && state.result.signature ? `<p class="hitl-meta">Signature HMAC <span class="mono">${esc(state.result.signature.slice(0, 24))}…</span> · inscrite au journal de preuve</p>` : ''}
        </div>`;
    }

    const views = { review: reviewView, pin: pinView, report: reportView, later: laterView, done: doneView };

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
      } else if (act === 'later') {
        state.view = 'later';
        render();
      } else if (act === 'back' || act === 'resume') {
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
      if (pin !== C.DEMO_PIN) {
        state.error = 'Code incorrect. La décision n\'a pas été signée.';
        render(pinFocus());
        return;
      }
      const timestamp = new Date().toISOString();
      const payload = MA.crypto.hitlPayload(card.thread_id, state.action, C.APPROVER_ID, timestamp, card.intent_hash);
      const decision = {
        action: state.action,
        approver_id: C.APPROVER_ID,
        timestamp,
        signature: MA.crypto.hmacHex(C.DEMO_HMAC_KEY, payload),
      };
      state.busy = true;
      render('.hitl-title');
      const result = options.demo ? { ok: true } : await options.onDecide(decision);
      state.busy = false;
      if (!result || !result.ok) {
        state.error = (result && result.error) || 'La décision n\'a pas pu être transmise.';
        render(pinFocus());
        return;
      }
      state.result = { signature: decision.signature };
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
        state.result = { elsewhere: true, label: status === 'approved' ? 'approuvée' : 'refusée' };
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

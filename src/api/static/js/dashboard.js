/*
 * ManAgent — tour de contrôle (rendu et interactions).
 * La vue ne lit que le Store (dérivé des AuditEvent) ; les actions passent par le transport.
 * Le dashboard ne décide rien : il relaie des décisions humaines que le moteur vérifie (signature HMAC).
 */
(function () {
  'use strict';
  const MA = window.ManAgent;
  const C = MA.config;
  const fmt = MA.fmt;
  const esc = MA.esc;
  const icon = MA.icon;
  const $ = (id) => document.getElementById(id);

  const params = new URLSearchParams(window.location.search);
  const store = new MA.Store();
  const transport = params.get('mode') === 'live' ? new MA.LiveTransport(store) : new MA.SimTransport(store);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Même seuil que la media query CSS (max-width: 1500px) : libellés courts dans le chemin de décision.
  const narrowScreen = window.matchMedia('(max-width: 1500px)');

  const ui = {
    running: null,
    pinned: null,
    replay: null,
    tab: 'feed',
    openDetails: new Set(),
    runEls: new Map(),
    card: null,
    cardCorr: null,
    cardClosed: false,
    selectedLine: null,
    verifyTimer: null,
    issues: {},
    channel: null,
    lastError: null,
    errorTimer: null,
    lastBrokenScrolled: null,
    animateFrom: 0,
    lastAuditState: null,
  };

  const STATUS_LABELS = {
    ALLOW: 'ALLOW', ESCALATE: 'ESCALATE', BLOCK: 'BLOCK', approve: 'Approuve', veto: 'Veto', abstain: 'Abstention',
    pending: 'En attente', approved: 'Approuvé · signé', rejected: 'Rejeté · signé', filled: 'Exécuté', blocked: 'Bloqué',
    flagged: 'Signalé', penalty: 'Pénalité', quarantined: 'Quarantaine', released: 'Levée', revoked: 'Révoquée',
    open: 'Ouvert', closed: 'Fermé', engaged: 'Activé', requested: 'Demandé', report: 'Rapport demandé',
    broken: 'Chaîne rompue', mismatch: 'Écart', running: 'En cours',
  };
  const STATE_TEXT = {
    idle: 'en attente', active: 'en cours', pass: 'OK', escalate: 'escalade', warn: 'signalé', block: 'BLOCK',
    skipped: 'non traversé', revoked: 'révoquée',
  };
  const STATE_ICON = { pass: 'check', escalate: 'alert', warn: 'alert', block: 'xCircle', revoked: 'xCircle', active: 'clock' };
  const KIND_SHORT = { agent: 'Agent IA', control: 'FinGuard', world: 'Simulé' };
  const KIND_ABBR = { agent: 'IA', control: 'FG', world: 'SIM' };
  const STAGE_SHORT = { policy: 'policy', hitl: 'humain', integrity: 'intégrité', governor: 'governor' };
  const VOTE_SHORT = { approve: 'OK', veto: 'VETO', abstain: 'ABST.' };

  // ------------------------------------------------------------------ utilitaires

  /** Sélecteur stable d'un élément interactif, pour lui rendre le focus après un re-rendu. */
  function focusKey(el) {
    if (!el || !el.dataset) return null;
    if (el.dataset.cmd) {
      const attrs = ['key', 'corr', 'line', 'agent'].filter((k) => el.dataset[k] !== undefined);
      return `[data-cmd="${el.dataset.cmd}"]${attrs.map((k) => `[data-${k}="${CSS.escape(el.dataset[k])}"]`).join('')}`;
    }
    if (el.tagName === 'SUMMARY' && el.parentElement && el.parentElement.dataset.key) {
      return `details[data-key="${CSS.escape(el.parentElement.dataset.key)}"] > summary`;
    }
    return null;
  }

  function setHTML(el, html) {
    if (el.__html === html) return;
    const active = document.activeElement;
    const key = active && el.contains(active) ? focusKey(active) : null;
    el.innerHTML = html;
    el.__html = html;
    if (key) {
      const target = el.querySelector(key);
      if (target && !target.disabled) target.focus({ preventScroll: true });
      else if (el.closest('[tabindex]')) el.closest('[tabindex]').focus({ preventScroll: true });
    }
  }

  function hydrateIcons(rootEl) {
    (rootEl || document).querySelectorAll('[data-icon]').forEach((el) => {
      if (!el.firstElementChild) el.innerHTML = icon(el.dataset.icon);
    });
  }

  function plural(n, word) {
    return `${n} ${word}${n > 1 ? 's' : ''}`;
  }

  function announce(text) {
    const region = $('live-status');
    region.textContent = '';
    window.setTimeout(() => {
      region.textContent = text;
    }, 60);
  }

  function notify(message) {
    ui.lastError = message;
    announce(message);
    renderStatusbar();
    window.clearTimeout(ui.errorTimer);
    ui.errorTimer = window.setTimeout(() => {
      ui.lastError = null;
      renderStatusbar();
    }, 9000);
  }

  function guard(promise) {
    return Promise.resolve(promise).catch((err) => notify(err.message || String(err)));
  }

  function badge(status, label) {
    const text = label || STATUS_LABELS[status] || status;
    return `<span class="badge badge--${esc(status)}">${esc(text)}</span>`;
  }

  function txWhat(tx) {
    if (!tx.intent) return tx.corr;
    return `${fmt.side(tx.intent.side)} ${fmt.eur(tx.intent.amount)} · ${tx.assetLabel}`;
  }

  function txBadge(tx) {
    if (tx.final && tx.final.status === 'filled') return badge('filled', tx.hitl ? 'Exécuté · validé' : 'Exécuté');
    if (tx.final) return badge('blocked', `Bloqué · ${STAGE_SHORT[tx.final.stage] || tx.final.stage}`);
    if (tx.hitl && tx.hitl.status === 'pending') return badge('pending', 'En attente humaine');
    return badge('running');
  }

  function download(filename, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function confirmAction({ title, text, ok, danger }) {
    const dialog = $('confirm-dialog');
    $('confirm-title').textContent = title;
    $('confirm-text').textContent = text;
    const okBtn = $('confirm-ok');
    okBtn.textContent = ok;
    okBtn.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
    dialog.returnValue = '';
    dialog.showModal();
    // Action destructrice : le focus va sur « Annuler » pour qu'un Entrée réflexe ne fasse rien.
    (danger ? dialog.querySelector('button[value="cancel"]') : okBtn).focus();
    return new Promise((resolve) => {
      dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'), { once: true });
    });
  }

  function scrollIntoViewSoft(el) {
    if (el) el.scrollIntoView({ block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' });
  }

  function latestRun(scenarioId) {
    for (let i = store.runOrder.length - 1; i >= 0; i--) {
      const run = store.runs.get(store.runOrder[i]);
      if (run.scenario === scenarioId) return run;
    }
    return null;
  }

  // ------------------------------------------------------------------ en-tête, bannières, barre d'état

  function renderHeader() {
    const v = store.verification;
    const pill = $('audit-pill');
    pill.className = `audit-pill${v.state === 'valid' ? ' is-valid' : v.state === 'broken' ? ' is-broken' : ''}`;
    let pillHtml = `${icon('link')}Chaîne d'audit : non vérifiée`;
    if (v.state === 'valid') pillHtml = `${icon('link')}Chaîne d'audit intègre · ${plural(v.checked, 'ligne')}`;
    if (v.state === 'broken') pillHtml = `${icon('linkBroken')}Chaîne d'audit altérée · ligne #${v.broken_at + 1}`;
    setHTML(pill, pillHtml);

    const kill = $('kill-btn');
    kill.dataset.cmd = store.kill.global ? 'release-kill' : 'engage-kill';
    kill.className = store.kill.global ? 'btn btn-primary' : 'btn btn-danger';
    setHTML(kill, store.kill.global ? `${icon('power')}Réarmer l'exécution` : `${icon('power')}Kill switch`);
    kill.disabled = Boolean(ui.replay);

    $('mode-chip').textContent = transport.mode === 'live' ? `API live · ${store.connection || 'connexion…'}` : 'Simulation locale · hors ligne';
  }

  function renderBanners() {
    const parts = [];
    if (store.kill.global) {
      parts.push(`<div class="banner banner--danger">${icon('power')}<p>Kill switch global actif : aucun ordre n'atteint le marché. Déclenché par ${esc(fmt.actor(store.kill.by))} à ${esc(fmt.time(store.kill.at))}.</p><button type="button" class="btn btn-sm" data-cmd="release-kill">Réarmer</button></div>`);
    }
    const p = store.pending;
    if (p && !$('phone-dialog').open && !ui.replay) {
      const intent = p.card.intent;
      parts.push(`<div class="banner banner--warn">${icon('phone')}<p>Décision humaine en attente sur ${esc(p.corr)} : ${esc(fmt.side(intent.side).toLowerCase())} de ${esc(fmt.eur(intent.amount))} de ${esc(p.card.asset_label)}. Le graphe est suspendu (AI Act art. 14 · contrôle humain).</p><button type="button" class="btn btn-sm btn-primary" data-cmd="open-phone">Ouvrir la carte</button></div>`);
    }
    if (ui.replay) {
      parts.push(`<div class="banner banner--info">${icon('replay')}<p>Replay du journal (${ui.replay.index}/${ui.replay.total}) : lecture seule, aucune décision n'est rejouée.</p><button type="button" class="btn btn-sm" data-cmd="stop-replay">Arrêter</button></div>`);
    }
    setHTML($('banners'), parts.join(''));
  }

  function renderStatusbar() {
    const parts = [
      `<span>${plural(store.events.length, 'événement')} journalisé${store.events.length > 1 ? 's' : ''}</span>`,
      `<span class="${store.invalid ? 'is-bad' : ''}">${store.invalid} rejeté${store.invalid > 1 ? 's' : ''} par le contrat AuditEvent${store.lastInvalid ? ` (dernier : ${esc(store.lastInvalid)})` : ''}</span>`,
      transport.mode === 'sim'
        ? '<span>Simulation : règles du cadrage v1.0 rejouées dans le navigateur, en attendant l\'API FastAPI</span>'
        : '<span>Flux SSE GET /events</span>',
      '<span>Données synthétiques · marché simulé</span>',
    ];
    if (ui.lastError) parts.push(`<span class="is-bad" role="alert">${esc(ui.lastError)}</span>`);
    setHTML($('statusbar'), parts.join(''));
  }

  // ------------------------------------------------------------------ scénarios

  function issuesFor(key) {
    const list = [];
    if (key === 'salami') {
      for (const agent of ['proposer', 'executor']) {
        if (store.agents[agent].quarantined) {
          list.push({ code: 'quarantine', agent, message: `Le ${fmt.actor(agent)} est en quarantaine. Seul un humain peut la lever avant ce scénario.` });
        }
      }
      if (store.risk.breaker === 'open') list.push({ code: 'breaker', message: 'Le circuit breaker est ouvert. Un humain doit le réarmer.' });
      if (store.kill.global) list.push({ code: 'kill', message: 'Le kill switch global est actif. Un humain doit le réarmer.' });
    }
    for (const issue of ui.issues[key] || []) {
      if (!list.some((i) => i.code === issue.code && i.agent === issue.agent)) list.push(issue);
    }
    return list;
  }

  function fixButton(issue) {
    if (issue.code === 'quarantine') return `<button type="button" class="btn btn-sm" data-cmd="lift-quarantine" data-agent="${esc(issue.agent)}">${icon('user')}Lever la quarantaine</button>`;
    if (issue.code === 'breaker') return `<button type="button" class="btn btn-sm" data-cmd="reset-breaker">${icon('reset')}Réarmer le circuit breaker</button>`;
    if (issue.code === 'kill') return `<button type="button" class="btn btn-sm" data-cmd="release-kill">${icon('power')}Réarmer l'exécution</button>`;
    return '';
  }

  function renderScenarios() {
    const busy = Boolean(ui.running) || Boolean(ui.replay);
    const html = C.SCENARIOS.map((s) => {
      const run = latestRun(s.id);
      const running = ui.running === s.key;
      const issues = issuesFor(s.key);
      let cls = 'scenario';
      let status = '';
      if (running) {
        cls += ' is-running';
        status = store.pending ? 'En attente de la décision humaine' : 'En cours…';
      } else if (run && run.completed) {
        cls += run.completed.matched ? ' is-done-ok' : ' is-done-ko';
        status = `${run.completed.matched ? 'Résultat attendu' : 'Écart'} : ${esc(run.completed.obtained)}`;
      }
      const issueHtml = issues.length
        ? `<div class="scenario-issue">${issues.map((i) => `<p>${esc(i.message)}</p>${fixButton(i)}`).join('')}</div>`
        : '';
      const quote = running || (run && run.completed) ? `<p class="scenario-quote">${esc(s.quote)}</p>` : '';
      const label = running ? 'En cours' : run ? 'Relancer' : 'Lancer';
      const disabled = busy || issues.some((i) => ['quarantine', 'breaker', 'kill'].includes(i.code));
      return `
        <li class="${cls}">
          <div class="scenario-head">
            <span class="scenario-id">${s.id}</span>
            <h3 class="scenario-title">${esc(s.title)}</h3>
            <span class="scenario-time">${esc(s.duration)}</span>
          </div>
          <p class="scenario-input">${esc(s.input)}</p>
          <p class="scenario-expected">Attendu : ${esc(s.expected)}</p>
          ${issueHtml}
          ${quote}
          <div class="scenario-foot">
            <span class="scenario-status">${status}</span>
            <button type="button" class="btn btn-sm ${running ? '' : 'btn-primary'}" data-cmd="run-scenario" data-key="${s.key}"
              aria-label="${esc(`${label} ${s.id} : ${s.title}`)}" ${disabled ? 'disabled' : ''}>${icon('play')}${label}</button>
          </div>
        </li>`;
    }).join('');
    setHTML($('scenarios'), html);
    $('obj-submit').disabled = busy;
  }

  async function runScenario(key) {
    if (ui.running || ui.replay) return;
    ui.issues[key] = null;
    ui.running = key;
    ui.pinned = null;
    switchTab(key === 'audit_tamper' ? 'audit' : 'feed');
    renderScenarios();
    const scenario = C.SCENARIOS.find((s) => s.key === key);
    announce(`Scénario ${scenario.id} lancé : ${scenario.title}.`);
    try {
      await transport.runScenario(key);
      const run = latestRun(scenario.id);
      if (run && run.completed) announce(`${scenario.id} terminé : ${run.completed.matched ? 'conforme' : 'écart'}, ${run.completed.obtained}.`);
    } catch (err) {
      if (err instanceof MA.errors.PreconditionError) ui.issues[key] = err.issues;
      else if (err instanceof MA.errors.BusyError) notify(err.message);
      else {
        ui.issues[key] = [{ code: 'error', message: err.message }];
        console.error(err);
      }
    } finally {
      ui.running = null;
      renderScenarios();
      verifyNow();
    }
  }

  // ------------------------------------------------------------------ indicateurs

  function renderKpis() {
    const k = store.kpis();
    const stages = Object.entries(k.byStage).map(([stage, n]) => `${STAGE_SHORT[stage] || stage} ${n}`).join(' · ');
    const tiles = [
      { label: 'Décisions', value: k.total, sub: `${k.decided} terminée${k.decided > 1 ? 's' : ''} · ${k.pending} en attente`, cls: '' },
      { label: 'Exécutées', value: k.filled, sub: k.decided ? `${k.filled}/${k.decided} décisions terminées` : 'aucune décision terminée', cls: 'kpi--ok' },
      { label: 'Escaladées (HITL)', value: k.escalated, sub: `taux d'escalade ${k.escalated}/${k.total}`, cls: 'kpi--warn' },
      { label: 'Bloquées', value: k.blocked, sub: stages ? `avant marché : ${stages}` : 'aucun blocage', cls: 'kpi--danger' },
      { label: 'Alertes', value: k.alerts, sub: `superviseur · ${k.critical} critique${k.critical > 1 ? 's' : ''}`, cls: '' },
    ];
    setHTML(
      $('kpis'),
      tiles.map((t) => `<div class="kpi ${t.cls}"><p class="kpi-label">${t.label}</p><p class="kpi-value">${t.value}</p><p class="kpi-sub">${esc(t.sub)}</p></div>`).join(''),
    );
  }

  // ------------------------------------------------------------------ chemin de décision

  function nodeHtml(node, st, tx) {
    let body;
    if (node.id === 'judges' && tx && tx.verdicts.length) {
      body = `<p class="node-votes">${tx.verdicts
        .map((v) => `<span class="v-${esc(v.vote)}">${v.judge_id === 'risk_judge' ? 'Risque' : 'Conformité'} : ${esc(VOTE_SHORT[v.vote] || v.vote)}</span>`)
        .join('')}</p>`;
    } else {
      const sub = st.sub || STATE_TEXT[st.state];
      body = `<p class="node-state">${STATE_ICON[st.state] ? icon(STATE_ICON[st.state]) : ''}<span>${esc(sub)}</span></p>`;
    }
    return `
      <li class="node node--${node.kind} is-${st.state}">
        <div class="node-head">${icon(node.icon)}<span class="node-label">${esc(narrowScreen.matches && node.short ? node.short : node.label)}</span></div>
        <span class="node-kind" data-short="${KIND_ABBR[node.kind]}">${KIND_SHORT[node.kind]}</span>
        ${body}
        <span class="sr-only">État : ${esc(STATE_TEXT[st.state])}.</span>
      </li>`;
  }

  function currentCorr() {
    return ui.pinned || store.lastCorr;
  }

  function renderPipeline() {
    const corr = currentCorr();
    const tx = corr ? store.txs.get(corr) : null;
    const states = tx ? store.nodeStates(tx) : null;
    const rows = [
      { row: 1, label: 'Décider' },
      { row: 2, label: 'Exécuter sous contrôle' },
    ]
      .map(({ row, label }) => {
        const nodes = C.NODES.filter((n) => n.row === row)
          .map((n) => nodeHtml(n, states ? states[n.id] : { state: 'idle', sub: '' }, tx))
          .join('');
        return `<p class="pipe-row-label" aria-hidden="true">${row} · ${label}</p><ol class="pipe-row" aria-label="Étape ${row} : ${label}">${nodes}</ol>`;
      })
      .join('');
    setHTML($('pipeline'), rows);

    const head = tx
      ? `<span class="mono tx-id">${esc(tx.corr)}</span><span class="tx-what">${esc(txWhat(tx))}</span>${txBadge(tx)}
         ${ui.pinned ? `<button type="button" class="btn btn-sm btn-ghost" data-cmd="follow-live">${icon('replay')}Suivre en direct</button>` : ''}
         <button type="button" class="btn btn-sm btn-ghost" data-cmd="xai" data-corr="${esc(tx.corr)}">${icon('file')}Fiche XAI</button>`
      : '<span class="muted">Aucune transaction : lancez un scénario.</span>';
    setHTML($('pipeline-tx'), head);
  }

  // ------------------------------------------------------------------ fil de discussion

  function msgHtml(idx) {
    const e = store.events[idx];
    const ctx = e.context || {};
    const actor = C.ACTORS[e.agent_id] || { name: e.agent_id, kind: 'control', icon: 'info' };
    let severity = '';
    if (e.action === 'supervisor.alert') severity = ctx.severity === 'critical' ? 'critical' : 'warning';
    else if (['BLOCK', 'blocked', 'quarantined', 'open', 'engaged', 'broken', 'revoked'].includes(e.status)) severity = 'critical';
    else if (['ESCALATE', 'veto', 'abstain', 'flagged', 'pending'].includes(e.status)) severity = 'warning';

    const chips = [];
    if (e.action === 'supervisor.alert') chips.push(badge(severity === 'critical' ? 'critical' : 'warning', ctx.title || 'Alerte'));
    else if (e.status !== 'ok' && STATUS_LABELS[e.status]) chips.push(badge(e.status));
    for (const rule of ctx.triggered_rules || []) chips.push(`<span class="rule-chip mono" title="${esc(fmt.rule(rule))}">${esc(rule)}</span>`);

    const action =
      e.action === 'hitl.requested' && store.pending && store.pending.corr === e.correlation_id && !ui.replay
        ? `<p class="msg-action"><button type="button" class="btn btn-sm btn-primary" data-cmd="open-phone">${icon('phone')}Ouvrir la carte d'approbation</button></p>`
        : '';
    const fresh = idx >= ui.animateFrom ? ' is-new' : '';
    return `
      <li class="msg${severity ? ` is-${severity}` : ''}${fresh}">
        <span class="avatar avatar--${actor.kind}">${icon(actor.icon)}</span>
        <div class="msg-body">
          <p class="msg-meta"><strong>${esc(actor.name)}</strong><span class="tag tag--${actor.kind}">${esc(C.KIND_LABELS[actor.kind])}</span><time datetime="${esc(e.timestamp)}">${esc(fmt.time(e.timestamp))}</time><span class="mono line">ligne #${idx + 1}</span></p>
          <p class="msg-text">${esc(e.reasoning)}</p>
          <p class="msg-chips">${chips.join('')}</p>
          ${action}
        </div>
      </li>`;
  }

  function microHtml(idx) {
    const e = store.events[idx];
    return `<li><span class="mono">#${idx + 1}</span><span>${esc(fmt.actor(e.agent_id))}</span><span>${esc(e.reasoning)}</span></li>`;
  }

  function buildBlocks(run) {
    const blocks = [];
    const txBlocks = new Map();
    for (const idx of run.items) {
      const e = store.events[idx];
      if (e.action === 'scenario.completed') continue;
      if (e.action === 'scenario.started' && e.agent_id === 'sandbox') continue;
      if (e.correlation_id !== run.id) {
        let block = txBlocks.get(e.correlation_id);
        if (!block) {
          block = { type: 'tx', corr: e.correlation_id, main: [], detail: [] };
          txBlocks.set(e.correlation_id, block);
          blocks.push(block);
        }
        (store.isMain(e) ? block.main : block.detail).push(idx);
      } else {
        blocks.push({ type: 'msg', idx });
      }
    }
    return blocks;
  }

  function txActions(tx) {
    return `<span class="tx-actions">
      <button type="button" class="btn btn-sm btn-ghost" data-cmd="pin" data-corr="${esc(tx.corr)}" aria-label="Afficher le chemin de ${esc(tx.corr)}">${icon('target')}Chemin</button>
      <button type="button" class="btn btn-sm btn-ghost" data-cmd="xai" data-corr="${esc(tx.corr)}" aria-label="Fiche XAI de ${esc(tx.corr)}">${icon('file')}Fiche XAI</button>
    </span>`;
  }

  function txHtml(block, run) {
    const tx = store.txs.get(block.corr);
    if (!tx) return '';
    if (run.compact) {
      const notable = block.main.filter((i) => {
        const e = store.events[i];
        if (['supervisor.alert', 'breaker.opened', 'agent.quarantined', 'supervisor.kill_request'].includes(e.action)) return true;
        return ['BLOCK', 'flagged'].includes(e.status);
      });
      return `
        <section class="tx tx--compact" id="tx-${esc(tx.corr)}" data-corr="${esc(tx.corr)}" aria-label="Transaction ${esc(tx.corr)}">
          <div class="compact-row"><span class="mono tx-id">${esc(tx.corr)}</span><span>${esc(txWhat(tx))}${tx.intent ? ` · ${esc(tx.intent.rationale)}` : ''}</span>${txBadge(tx)}</div>
          ${notable.length ? `<ol class="msgs">${notable.map(msgHtml).join('')}</ol>` : ''}
        </section>`;
    }
    const key = `micro-${tx.corr}`;
    const micro = block.detail.length
      ? `<details class="micro" data-key="${esc(key)}" ${ui.openDetails.has(key) ? 'open' : ''}>
          <summary>${icon('chevron')}${plural(block.detail.length, 'étape')} de contrôle FinGuard (sous-fil technique)</summary>
          <ol>${block.detail.map(microHtml).join('')}</ol>
        </details>`
      : '';
    return `
      <section class="tx" id="tx-${esc(tx.corr)}" data-corr="${esc(tx.corr)}" aria-label="Transaction ${esc(tx.corr)}">
        <header class="tx-head"><span class="mono tx-id">${esc(tx.corr)}</span><span class="tx-what">${esc(txWhat(tx))}</span>${txBadge(tx)}${txActions(tx)}</header>
        <ol class="msgs">${block.main.map(msgHtml).join('')}</ol>
        ${micro}
      </section>`;
  }

  function runBadge(run) {
    if (!run.scenario) return badge('neutral', 'Action humaine');
    if (run.completed) return '';
    const pending = run.txIds.some((corr) => {
      const tx = store.txs.get(corr);
      return tx && tx.hitl && tx.hitl.status === 'pending';
    });
    if (pending) return badge('pending', 'En attente humaine');
    if (run.scenario === 'MANUEL') {
      const tx = store.txs.get(run.txIds[run.txIds.length - 1]);
      return tx && tx.final ? '' : badge('running');
    }
    return badge('running');
  }

  function runHtml(run) {
    const prefix = `${run.scenario} · `;
    const title = run.title.startsWith(prefix) ? run.title.slice(prefix.length) : run.title;
    const lead = run.scenario
      ? `<span class="scenario-id">${esc(run.scenario === 'MANUEL' ? 'OBJ' : run.scenario)}</span>`
      : `<span class="avatar avatar--human">${icon('user')}</span>`;
    const blocks = buildBlocks(run);
    const body = blocks.map((b) => (b.type === 'tx' ? txHtml(b, run) : `<ol class="msgs">${msgHtml(b.idx)}</ol>`)).join('');
    const c = run.completed;
    const outcome = c
      ? `<p class="run-outcome ${c.matched ? 'is-ok' : 'is-ko'}">${icon(c.matched ? 'checkCircle' : 'alert')}<span><strong>${c.matched ? 'Résultat attendu obtenu.' : "Écart avec l'attendu."}</strong> Attendu : ${esc(String(c.expected).toLowerCase())}. Obtenu : ${esc(c.obtained)}.</span></p>`
      : '';
    return `
      <header class="run-head">${lead}<h3>${esc(title)}</h3><span class="run-time">${esc(fmt.time(run.startedAt))}</span>${runBadge(run)}</header>
      <div class="run-body">${body}${outcome}</div>`;
  }

  function renderFeed(runIds) {
    const feed = $('feed');
    if (!store.runOrder.length) {
      ui.runEls.clear();
      feed.__html = null;
      feed.innerHTML = `
        <div class="empty">
          ${icon('shield')}
          <p><strong>Aucune décision pour l'instant.</strong></p>
          <p>Lancez S1 dans le bac à sable : les agents vont dialoguer dans ce fil, sous le contrôle de FinGuard.<br>
          Les étapes techniques restent repliées ; seules les décisions et les alertes s'affichent.</p>
        </div>`;
      return;
    }
    const empty = feed.querySelector('.empty');
    if (empty) empty.remove();
    for (const id of runIds) {
      const run = store.runs.get(id);
      if (!run) continue;
      let el = ui.runEls.get(id);
      if (!el) {
        el = document.createElement('article');
        el.dataset.run = id;
        feed.prepend(el);
        ui.runEls.set(id, el);
      }
      el.className = `run${run.scenario ? '' : ' run--human'}`;
      setHTML(el, runHtml(run));
    }
  }

  function updateFocusClass() {
    const corr = currentCorr();
    document.querySelectorAll('.tx.is-focused').forEach((el) => {
      if (el.dataset.corr !== corr) el.classList.remove('is-focused');
    });
    if (corr) {
      const el = document.getElementById(`tx-${corr}`);
      if (el) el.classList.add('is-focused');
    }
  }

  function gotoTx(corr) {
    switchTab('feed');
    ui.pinned = corr;
    renderPipeline();
    updateFocusClass();
    const el = document.getElementById(`tx-${corr}`);
    scrollIntoViewSoft(el);
  }

  // ------------------------------------------------------------------ agents, risque, alertes

  function renderAgents() {
    const html = C.AGENTS.map((a) => {
      const st = store.agents[a.id];
      const reduced = st.trust < C.LIMITS.trustReduced;
      const low = st.trust < C.LIMITS.trustQuarantine;
      const chip = st.quarantined ? badge('quarantined') : reduced ? badge('ESCALATE', 'Plafond ÷ 2') : badge('ok', 'Actif');
      const limits = a.max_amount
        ? `Plafond effectif ${fmt.eur(reduced ? a.max_amount / 2 : a.max_amount)} · outils : ${a.allowed_tools.join(', ')}`
        : `${a.mission}. Interdit : ${a.forbidden.charAt(0).toLowerCase()}${a.forbidden.slice(1)}.`;
      const valueText = `${st.trust} sur 100${st.quarantined ? ', en quarantaine' : reduced ? ', plafond divisé par deux' : ''}`;
      return `
        <li class="agent${st.quarantined ? ' is-quarantined' : ''}">
          <div class="agent-head">
            <span class="avatar avatar--agent">${icon((C.ACTORS[a.id] || {}).icon || 'bot')}</span>
            <div><span class="agent-name">${esc(a.name)}</span><span class="agent-nature">${esc(a.nature)}</span></div>
            ${chip}
          </div>
          <div class="trust">
            <div class="trust-track" role="meter" aria-label="Trust Score ${esc(a.name)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${st.trust}" aria-valuetext="${esc(valueText)}">
              <div class="trust-fill${low ? ' is-low' : reduced ? ' is-reduced' : ''}" style="width:${st.trust}%"></div>
              <span class="trust-mark" style="left:40%"></span><span class="trust-mark" style="left:70%"></span>
            </div>
            <span class="trust-value" aria-hidden="true">${st.trust}</span>
          </div>
          <p class="agent-limits">${esc(limits)}</p>
          ${st.quarantined ? `<button type="button" class="btn btn-sm btn-block" data-cmd="lift-quarantine" data-agent="${esc(a.id)}">${icon('user')}Lever la quarantaine (humain)</button>` : ''}
        </li>`;
    }).join('');
    setHTML($('agents'), html);
  }

  function meterHtml(label, value, max, text, note) {
    const ratio = max ? Math.min(1, value / max) : 0;
    const cls = ratio >= 1 ? ' is-danger' : ratio >= 0.8 ? ' is-warn' : '';
    return `
      <div class="meter">
        <div class="meter-head"><span>${esc(label)}</span><span class="mono">${esc(text)}</span></div>
        <div class="meter-track" role="meter" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="${max}" aria-valuenow="${value}" aria-valuetext="${esc(text)}">
          <div class="meter-fill${cls}" style="width:${(ratio * 100).toFixed(1)}%"></div>
        </div>
        ${note ? `<p class="meter-note">${esc(note)}</p>` : ''}
      </div>`;
  }

  function renderRisk() {
    const r = store.risk;
    const open = r.breaker === 'open';
    const human = `Hors opérations signées par le gérant (${fmt.eur(r.humanApproved)} validés aujourd'hui).`;
    const html = [
      meterHtml('Budget autonome du Proposer (jour)', r.daily, r.dailyLimit, `${fmt.eur(r.daily)} / ${fmt.eur(r.dailyLimit)}`, human),
      meterHtml('Ordres sur 60 s', r.freq, r.freqLimit, `${r.freq} / ${r.freqLimit}`, r.lastCheck ? `Dernier contrôle à ${fmt.time(r.lastCheck)}.` : 'Aucun contrôle pour l’instant.'),
      meterHtml('Rejets consécutifs', r.rejects, r.rejectLimit, `${r.rejects} / ${r.rejectLimit}`, 'Au-delà : circuit breaker.'),
      `<div class="state-line${open ? ' is-open' : ''}"><strong>Circuit breaker</strong>${open ? badge('open', 'Ouvert') : badge('closed', 'Fermé')}</div>`,
      open ? `<button type="button" class="btn btn-sm btn-block" data-cmd="reset-breaker">${icon('reset')}Réarmer (superviseur humain)</button>` : '',
      `<div class="state-line${store.kill.global ? ' is-open' : ''}"><strong>Kill switch global</strong>${store.kill.global ? badge('engaged', 'Actif') : badge('closed', 'Inactif')}</div>`,
    ].join('');
    setHTML($('risk'), html);
  }

  function renderAlerts() {
    const list = store.alerts.slice(0, 8);
    const html = list.length
      ? list
          .map(
            (a) => `
          <li class="alert alert--${esc(a.severity)}${a.index >= ui.animateFrom ? ' is-new' : ''}">
            ${icon(a.severity === 'critical' ? 'alert' : 'eye')}
            <div>
              <p class="alert-title">${esc(a.title)}</p>
              <p class="alert-text">${esc(a.text)}</p>
              <p class="alert-meta"><time datetime="${esc(a.at)}">${esc(fmt.time(a.at))}</time>${a.corr ? `<button type="button" class="btn-link" data-cmd="goto-tx" data-corr="${esc(a.corr)}">Voir ${esc(a.corr)}</button>` : ''}</p>
            </div>
          </li>`,
          )
          .join('') + (store.alerts.length > list.length ? `<li class="alerts-empty">${store.alerts.length - list.length} alerte(s) plus ancienne(s) dans le journal.</li>` : '')
      : `<li class="alerts-empty">Aucune alerte. Le superviseur lit le bus d'événements ; il peut demander une quarantaine, jamais décider ni exécuter.</li>`;
    setHTML($('alerts'), html);
  }

  // ------------------------------------------------------------------ journal d'audit

  function renderAudit() {
    $('audit-count').textContent = store.events.length;
    const v = store.verification;
    const statusEl = $('audit-status');
    let statusHtml = `${icon('info')}<span>Chaîne non vérifiée. Chaque ligne porte le hash de la précédente (prev_hash) et le sien (hash).</span>`;
    let statusCls = 'audit-status';
    if (v.state === 'valid') {
      const added = store.events.length - v.checked;
      statusCls += ' is-valid';
      statusHtml = `${icon('link')}<span>verify_chain() : ${plural(v.checked, 'ligne')} recalculée${v.checked > 1 ? 's' : ''}, chaîne intègre. Dernier hash <span class="mono">${esc(fmt.shortHash(v.last_hash))}</span>${added > 0 ? ` · ${plural(added, 'ligne')} ajoutée${added > 1 ? 's' : ''} depuis` : ''}.</span>`;
    } else if (v.state === 'broken') {
      statusCls += ' is-broken';
      const why = v.reason === 'hash' ? 'le contenu ne correspond plus à son hash' : 'le chaînage prev_hash est rompu';
      statusHtml = `${icon('linkBroken')}<span>verify_chain() en échec à la ligne #${v.broken_at + 1} : ${why}. Hash enregistré <span class="mono">${esc(fmt.shortHash(v.expected))}</span>, recalculé <span class="mono">${esc(fmt.shortHash(v.found))}</span>.</span>`;
    }
    statusEl.className = statusCls;
    setHTML(statusEl, statusHtml);

    const brokenAt = v.state === 'broken' ? v.broken_at : -1;
    const rows = [];
    for (let i = store.events.length - 1; i >= 0; i--) {
      const e = store.journalLine(i);
      const tampered = store.overrides.has(i);
      const cls = [tampered ? 'is-tampered' : '', i === brokenAt ? 'is-broken' : '', i === ui.selectedLine ? 'is-selected' : ''].filter(Boolean).join(' ');
      rows.push(`
        <tr class="${cls}" data-cmd="audit-line" data-line="${i}">
          <td><button type="button" class="row-btn" data-cmd="audit-line" data-line="${i}" aria-label="Afficher la ligne ${i + 1} en JSON">${i + 1}</button></td>
          <td class="mono">${esc(fmt.time(e.timestamp))}</td>
          <td class="mono">${esc(e.correlation_id)}</td>
          <td class="wrap">${esc(fmt.actor(e.agent_id))}</td>
          <td class="mono action">${esc(e.action)}</td>
          <td>${e.status === 'ok' ? '<span class="muted">ok</span>' : badge(e.status)}</td>
          <td class="reason">${esc(e.reasoning)}${tampered ? ` ${badge('broken', 'modifiée hors système')}` : ''}</td>
          <td class="mono hash">${esc(e.prev_hash.slice(0, 8))} → ${esc(e.hash.slice(0, 8))}</td>
        </tr>`);
    }
    setHTML($('audit-body'), rows.join('') || '<tr><td colspan="8" class="muted">Journal vide.</td></tr>');

    $('tamper-btn').disabled = !store.events.length || Boolean(store.tampered) || transport.mode === 'live' || Boolean(ui.replay);
    $('restore-btn').hidden = !store.tampered || transport.mode === 'live';
    $('replay-btn').disabled = !store.events.length || Boolean(ui.running) || Boolean(ui.replay);

    const jsonText =
      ui.selectedLine !== null && store.events[ui.selectedLine]
        ? `Ligne #${ui.selectedLine + 1}, telle qu'enregistrée dans audit.jsonl :\n${JSON.stringify(store.journalLine(ui.selectedLine), null, 2)}`
        : '';
    if ($('audit-json').textContent !== jsonText) $('audit-json').textContent = jsonText;

    if (brokenAt >= 0 && ui.lastBrokenScrolled !== `${brokenAt}-${v.at}`) {
      ui.lastBrokenScrolled = `${brokenAt}-${v.at}`;
      scrollIntoViewSoft(document.querySelector('#audit-body tr.is-broken'));
    }
  }

  async function verifyNow() {
    try {
      const result = await transport.verify();
      if (result && typeof result.valid === 'boolean') store.setVerification(result);
    } catch (err) {
      notify(`Vérification impossible : ${err.message}`);
    }
  }

  function scheduleVerify(scopes) {
    if (transport.mode !== 'sim' || ui.replay || !scopes.has('events')) return;
    window.clearTimeout(ui.verifyTimer);
    ui.verifyTimer = window.setTimeout(verifyNow, 350);
  }

  function startReplay() {
    if (ui.running || ui.replay || !store.events.length) return;
    closePhone();
    const events = store.events.slice();
    const overrides = new Map(store.overrides);
    const tampered = store.tampered;
    store.reset();
    store.overrides = overrides;
    store.tampered = tampered;
    ui.openDetails.clear();
    ui.pinned = null;
    const delay = Math.max(25, Math.min(220, Math.round(12000 / events.length)));
    ui.replay = { index: 0, total: events.length, events, timer: null };
    switchTab('feed');
    announce(`Replay de ${events.length} lignes d'audit.`);
    const tick = () => {
      if (!ui.replay) return;
      store.ingest(ui.replay.events[ui.replay.index]);
      ui.replay.index += 1;
      if (ui.replay.index >= ui.replay.total) {
        finishReplay();
        return;
      }
      ui.replay.timer = window.setTimeout(tick, delay);
    };
    ui.replay.timer = window.setTimeout(tick, delay);
    renderAll();
  }

  function stopReplay() {
    if (!ui.replay) return;
    window.clearTimeout(ui.replay.timer);
    while (ui.replay.index < ui.replay.total) {
      store.ingest(ui.replay.events[ui.replay.index]);
      ui.replay.index += 1;
    }
    finishReplay();
  }

  function finishReplay() {
    window.clearTimeout(ui.replay.timer);
    ui.replay = null;
    announce('Replay terminé.');
    verifyNow();
    renderAll();
  }

  function exportJournal() {
    const lines = store.events.map((_, i) => JSON.stringify(store.journalLine(i))).join('\n');
    download('audit.jsonl', lines ? `${lines}\n` : '', 'application/x-ndjson');
  }

  // ------------------------------------------------------------------ fiche XAI

  function xaiHtml(record) {
    const statusMap = { filled: ['filled', 'Exécuté'], blocked: ['blocked', 'Bloqué'], pending: ['pending', 'En attente humaine'], running: ['running', 'En cours'] };
    const [statusKey, statusLabel] = statusMap[record.status] || ['neutral', record.status];
    const path = record.path
      .map((p) => `<li class="xai-step is-${esc(p.state)}">${esc(p.label)}${p.sub ? ` · ${esc(p.sub)}` : ''}<span class="sr-only"> (${esc(STATE_TEXT[p.state])})</span></li>`)
      .join('');
    const factors = record.factors.length
      ? record.factors
          .map(
            (f) => `
            <li class="factor factor--${esc(f.effect)}">
              <p class="factor-head"><strong>${esc(f.actor)}</strong>${f.status !== 'ok' && STATUS_LABELS[f.status] ? badge(f.status) : ''}<span class="mono muted">ligne #${f.line} · ${esc(fmt.shortHash(f.hash))}</span></p>
              <p>${esc(f.text)}</p>
            </li>`,
          )
          .join('')
      : '<li class="muted">Aucun facteur journalisé pour l\'instant.</li>';
    const votes = record.votes.length
      ? `<table class="xai-table"><thead><tr><th scope="col">Juge</th><th scope="col">Vote</th><th scope="col">Confiance</th><th scope="col">Règles</th><th scope="col">Justification</th></tr></thead><tbody>${record.votes
          .map(
            (v) => `<tr><td>${esc(fmt.actor(v.judge_id))}</td><td>${badge(v.vote)}</td><td class="mono">${typeof v.confidence === 'number' ? esc(fmt.dec(v.confidence)) : '—'}</td><td>${(v.rule_ids || []).map((r) => `<span class="rule-chip mono">${esc(r)}</span>`).join(' ') || '—'}</td><td>${esc(v.justification)}</td></tr>`,
          )
          .join('')}</tbody></table>`
      : '<p class="muted">Aucun vote : la transaction a été arrêtée avant les juges.</p>';
    const rules = record.rules.map((r) => `<li><span class="rule-chip mono">${esc(r.id)}</span><span>${esc(r.label)}</span></li>`).join('') || '<li class="muted">Aucune règle déclenchée.</li>';
    const unc = record.uncertainties.map((u) => `<li>${esc(u)}</li>`).join('');
    const proofs = record.proofs.map((p) => `<dt>${esc(p.label)}</dt><dd>${esc(p.value)}</dd>`).join('');
    const redactions = record.redactions.length
      ? `<section class="xai-section"><h3>Masquages</h3><ul class="plain-list">${record.redactions.map((r) => `<li>${esc(r)}</li>`).join('')}</ul></section>`
      : '';
    return `
      <section class="xai-summary" aria-label="Résumé">
        <p>${badge(statusKey, statusLabel)}</p>
        <p>${esc(record.summary)}</p>
      </section>
      <section class="xai-section"><h3>Chemin suivi dans le graphe</h3><ol class="xai-path">${path}</ol></section>
      <section class="xai-section"><h3>Facteurs, dans l'ordre du journal</h3><ol class="factors">${factors}</ol></section>
      <section class="xai-section"><h3>Votes des juges</h3>${votes}</section>
      <section class="xai-section"><h3>Règles appliquées · ${esc(record.policy_version)}</h3><ul class="rules-list">${rules}</ul></section>
      <section class="xai-section"><h3>Incertitudes</h3><ul class="plain-list">${unc}</ul></section>
      <section class="xai-section"><h3>Preuves</h3><dl class="proofs">${proofs}</dl></section>
      ${redactions}
      <p class="xai-note">Fiche construite uniquement à partir des lignes d'audit de ${esc(record.correlation_id)} (AI Act art. 12 · journalisation). Elle décrit les règles, votes et décisions enregistrés ; elle ne reconstitue pas un raisonnement interne de modèle. La chaîne de hash rend toute altération détectable ; elle ne la rend pas impossible.</p>`;
  }

  function openXai(corr) {
    const record = store.decisionRecord(corr);
    if (!record) return;
    ui.xaiCorr = corr;
    $('xai-title').textContent = `Fiche de décision · ${corr}`;
    setHTML($('xai-body'), xaiHtml(record));
    const dialog = $('xai-dialog');
    if (!dialog.open) dialog.showModal();
    $('xai-close').focus();
  }

  function refreshXai() {
    const dialog = $('xai-dialog');
    if (!dialog.open || !ui.xaiCorr) return;
    const record = store.decisionRecord(ui.xaiCorr);
    if (record) setHTML($('xai-body'), xaiHtml(record));
  }

  // ------------------------------------------------------------------ téléphone (HITL)

  function broadcast(message) {
    if (ui.channel) ui.channel.postMessage(message);
  }

  function pendingMessage() {
    const p = store.pending;
    return p ? { type: 'pending', card: p.card, record: store.decisionRecord(p.corr) } : { type: 'idle' };
  }

  function mountCard(p) {
    ui.cardClosed = false;
    ui.cardCorr = p.corr;
    ui.card = MA.HitlCard.mount($('phone-body'), p.card, {
      onDecide: (decision) => transport.decide(p.card.thread_id, decision),
      onReport: () => guard(transport.requestReport(p.card.thread_id)),
      getRecord: () => store.decisionRecord(p.corr),
    });
  }

  function openPhone() {
    const dialog = $('phone-dialog');
    if (!dialog.open) dialog.showModal();
    const title = $('phone-body').querySelector('.hitl-title');
    if (title) title.focus();
    renderBanners();
  }

  function closePhone() {
    const dialog = $('phone-dialog');
    if (dialog.open) dialog.close();
  }

  function renderPhoneIdle() {
    setHTML(
      $('phone-body'),
      `<div class="phone-idle">${icon('phone')}<p><strong>Aucune décision en attente.</strong></p><p>La carte apparaît dès qu'une opération est escaladée (montant, veto ou abstention).</p></div>`,
    );
  }

  function syncPending() {
    const p = store.pending;
    if (p) {
      if (ui.replay) return;
      if (!ui.card || ui.card.threadId !== p.thread_id) {
        $('phone-body').__html = null;
        mountCard(p);
        broadcast(pendingMessage());
        openPhone();
        announce(`Décision humaine requise sur ${p.corr}.`);
      }
      return;
    }
    if (ui.card && !ui.cardClosed) {
      const tx = store.txs.get(ui.cardCorr);
      const status = tx && tx.hitl ? tx.hitl.status : 'rejected';
      if (!ui.card.decided) ui.card.resolvedElsewhere(status);
      broadcast({ type: 'resolved', thread_id: ui.card.threadId, status });
      ui.cardClosed = true;
      // L'écran « décision signée » est un moment de preuve : on le laisse lisible quelques secondes.
      if ($('phone-dialog').open) $('phone-close').focus({ preventScroll: true });
      window.setTimeout(() => {
        if (ui.cardClosed) closePhone();
      }, 5000);
    }
  }

  function setupChannel() {
    if (!('BroadcastChannel' in window)) return;
    ui.channel = new BroadcastChannel('managent-hitl');
    ui.channel.onmessage = async ({ data }) => {
      if (!data || typeof data !== 'object') return;
      if (data.type === 'hello') {
        broadcast(pendingMessage());
      } else if (data.type === 'decision' && typeof data.thread_id === 'string' && data.decision && typeof data.decision === 'object') {
        const d = data.decision;
        const decision = { action: String(d.action), approver_id: String(d.approver_id), timestamp: String(d.timestamp), signature: String(d.signature) };
        const result = await transport.decide(data.thread_id, decision);
        broadcast({ type: 'decision-result', thread_id: data.thread_id, ok: Boolean(result && result.ok), error: result && result.error });
      } else if (data.type === 'report' && typeof data.thread_id === 'string') {
        guard(transport.requestReport(data.thread_id));
      }
    };
  }

  // ------------------------------------------------------------------ onglets, formulaire, commandes

  function switchTab(name) {
    ui.tab = name;
    for (const key of ['feed', 'audit']) {
      const active = key === name;
      const tab = $(`tab-${key}`);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      $(`panel-${key}`).hidden = !active;
    }
    if (name === 'audit') renderAudit();
  }

  function setupTabs() {
    const tabs = [$('tab-feed'), $('tab-audit')];
    tabs.forEach((tab, i) => {
      tab.addEventListener('click', () => switchTab(tab.id.replace('tab-', '')));
      tab.addEventListener('keydown', (event) => {
        let next = null;
        if (event.key === 'ArrowRight') next = tabs[(i + 1) % tabs.length];
        if (event.key === 'ArrowLeft') next = tabs[(i - 1 + tabs.length) % tabs.length];
        if (event.key === 'Home') next = tabs[0];
        if (event.key === 'End') next = tabs[tabs.length - 1];
        if (next) {
          event.preventDefault();
          switchTab(next.id.replace('tab-', ''));
          next.focus();
        }
      });
    });
  }

  function setupForm() {
    $('obj-asset').innerHTML = Object.entries(C.ASSETS)
      .map(([id, a]) => {
        const outside = !['bond', 'equity', 'cash'].includes(a.type);
        return `<option value="${esc(id)}">${esc(a.label)} · ${esc(C.ASSET_TYPE_LABELS[a.type])}${outside ? ' (hors univers)' : ''}</option>`;
      })
      .join('');
    $('obj-asset').value = 'OAT-30A';
    $('obj-cpty').innerHTML = [
      ...C.COUNTERPARTIES.map((c) => `<option value="${esc(c)}">${esc(c)} · KYC</option>`),
      ...C.UNLISTED_COUNTERPARTIES.map((c) => `<option value="${esc(c)}">${esc(c)} · hors liste blanche</option>`),
    ].join('');

    const amountInput = $('obj-amount');
    $('objective-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      if (ui.running || ui.replay) return;
      const amount = Number(amountInput.value);
      const error = !Number.isFinite(amount) || amount <= 0 ? 'Saisissez un montant positif.' : amount > 1000000 ? 'Montant limité à 1 000 000 € dans la démo.' : '';
      $('obj-amount-error').textContent = error;
      amountInput.setAttribute('aria-invalid', String(Boolean(error)));
      if (error) {
        amountInput.focus();
        return;
      }
      ui.running = 'manual';
      ui.pinned = null;
      switchTab('feed');
      renderScenarios();
      try {
        await transport.submitObjective({
          asset: $('obj-asset').value,
          side: $('obj-side').value,
          amount,
          counterparty: $('obj-cpty').value,
        });
      } catch (err) {
        notify(err.message);
      } finally {
        ui.running = null;
        renderScenarios();
        verifyNow();
      }
    });
  }

  const READ_ONLY_COMMANDS = new Set(['stop-replay', 'xai', 'pin', 'follow-live', 'goto-tx', 'audit-line']);

  const commands = {
    'run-scenario': ({ key }) => runScenario(key),
    'lift-quarantine': async ({ agent }) => {
      const ok = await confirmAction({
        title: `Lever la quarantaine du ${fmt.actor(agent)} ?`,
        text: "L'agent pourra de nouveau proposer des ordres, avec son Trust Score actuel. L'action est journalisée au nom du superviseur humain.",
        ok: 'Lever la quarantaine',
      });
      if (ok) {
        ui.issues.salami = null;
        await guard(transport.liftQuarantine(agent));
      }
    },
    'reset-breaker': async () => {
      const ok = await confirmAction({
        title: 'Réarmer le circuit breaker ?',
        text: "Les compteurs de fréquence et de rejets repartent de zéro. L'action est journalisée au nom du superviseur humain.",
        ok: 'Réarmer',
      });
      if (ok) {
        ui.issues.salami = null;
        await guard(transport.resetBreaker());
      }
    },
    'engage-kill': async () => {
      const ok = await confirmAction({
        title: 'Déclencher le kill switch global ?',
        text: "Plus aucun ordre n'atteindra le marché tant qu'un humain n'aura pas réarmé l'exécution. Les événements restent journalisés. (AI Act art. 14 · réf. MiFID II RTS 6)",
        ok: "Couper l'exécution",
        danger: true,
      });
      if (ok) await guard(transport.killSwitch(true));
    },
    'release-kill': async () => {
      const ok = await confirmAction({
        title: "Réarmer l'exécution ?",
        text: 'Les ordres autorisés pourront de nouveau atteindre le marché simulé. Action journalisée.',
        ok: 'Réarmer',
      });
      if (ok) await guard(transport.killSwitch(false));
    },
    'open-phone': () => openPhone(),
    'stop-replay': () => stopReplay(),
    xai: ({ corr }) => openXai(corr),
    pin: ({ corr }) => {
      ui.pinned = corr;
      renderPipeline();
      updateFocusClass();
      scrollIntoViewSoft($('pipeline'));
    },
    'follow-live': () => {
      ui.pinned = null;
      renderPipeline();
      updateFocusClass();
    },
    'goto-tx': ({ corr }) => gotoTx(corr),
    'audit-line': ({ line }) => {
      ui.selectedLine = Number(line);
      renderAudit();
      announce(`Ligne ${ui.selectedLine + 1} affichée en JSON sous le tableau.`);
    },
  };

  function bindStatic() {
    document.addEventListener('click', (event) => {
      const el = event.target.closest('[data-cmd]');
      if (!el || el.disabled) return;
      const cmd = el.dataset.cmd;
      if (ui.replay && !READ_ONLY_COMMANDS.has(cmd)) return;
      if (commands[cmd]) commands[cmd](el.dataset, el);
    });

    document.addEventListener(
      'toggle',
      (event) => {
        const el = event.target;
        if (!(el instanceof HTMLDetailsElement) || !el.dataset.key) return;
        if (el.open) ui.openDetails.add(el.dataset.key);
        else ui.openDetails.delete(el.dataset.key);
      },
      true,
    );

    $('audit-pill').addEventListener('click', () => {
      switchTab('audit');
      verifyNow();
      $('tab-audit').focus();
    });
    $('verify-btn').addEventListener('click', async () => {
      await verifyNow();
      const v = store.verification;
      announce(v.state === 'valid' ? `Chaîne intègre : ${v.checked} lignes.` : v.state === 'broken' ? `Chaîne rompue à la ligne ${v.broken_at + 1}.` : 'Vérification impossible.');
    });
    $('replay-btn').addEventListener('click', startReplay);
    $('export-btn').addEventListener('click', exportJournal);
    $('tamper-btn').addEventListener('click', async () => {
      const info = await guard(transport.tamper());
      if (info && typeof info.index === 'number') {
        ui.selectedLine = info.index;
        announce(`Ligne ${info.index + 1} modifiée hors du système. Lancez la vérification.`);
        renderAudit();
      }
    });
    $('restore-btn').addEventListener('click', async () => {
      await guard(transport.restore());
      verifyNow();
    });
    $('reset-btn').addEventListener('click', async () => {
      const ok = await confirmAction({
        title: 'Réinitialiser la démo ?',
        text: 'Le journal local, les Trust Scores et les compteurs reviennent à leur état initial. Rien ne quitte le navigateur.',
        ok: 'Réinitialiser',
        danger: true,
      });
      if (!ok) return;
      if (ui.replay) stopReplay();
      closePhone();
      ui.card = null;
      ui.cardClosed = true;
      ui.issues = {};
      ui.pinned = null;
      ui.selectedLine = null;
      ui.openDetails.clear();
      renderPhoneIdle();
      await guard(transport.reset());
      broadcast({ type: 'idle' });
    });
    document.querySelectorAll('input[name="speed"]').forEach((input) => {
      input.addEventListener('change', () => transport.setFast(input.value === 'fast' && input.checked));
    });

    $('phone-close').addEventListener('click', closePhone);
    $('phone-dialog').addEventListener('close', () => renderBanners());
    $('xai-close').addEventListener('click', () => $('xai-dialog').close());
    $('xai-dialog').addEventListener('click', (event) => {
      if (event.target === $('xai-dialog')) $('xai-dialog').close();
    });
    $('xai-download').addEventListener('click', () => {
      const record = ui.xaiCorr ? store.decisionRecord(ui.xaiCorr) : null;
      if (record) download(`decision-${record.correlation_id}.json`, JSON.stringify(record, null, 2), 'application/json');
    });

    const tickClock = () => {
      $('phone-clock').textContent = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date());
    };
    tickClock();
    window.setInterval(tickClock, 15000);
  }

  // ------------------------------------------------------------------ rendu global

  function renderAll(scopes, runs) {
    const all = !scopes || scopes.has('all');
    renderHeader();
    renderBanners();
    renderStatusbar();
    renderKpis();
    renderPipeline();
    renderScenarios();
    if (all) {
      ui.runEls.clear();
      $('feed').innerHTML = '';
      $('feed').__html = null;
      renderFeed(new Set(store.runOrder));
    } else {
      renderFeed(runs || new Set());
    }
    updateFocusClass();
    renderAgents();
    renderRisk();
    renderAlerts();
    if (ui.tab === 'audit') renderAudit();
    else $('audit-count').textContent = store.events.length;
    refreshXai();
    syncPending();
    announceAuditChange();
    // Les éléments déjà affichés ne rejouent pas leur animation d'entrée au prochain rendu.
    ui.animateFrom = store.events.length;
  }

  /** Annonce uniquement les changements d'état de la chaîne (intègre ↔ altérée), pas chaque vérification. */
  function announceAuditChange() {
    const state = store.verification.state;
    if (state === ui.lastAuditState) return;
    const previous = ui.lastAuditState;
    ui.lastAuditState = state;
    if (state === 'broken') announce(`Chaîne d'audit altérée à la ligne ${store.verification.broken_at + 1}.`);
    else if (state === 'valid' && previous === 'broken') announce("Chaîne d'audit de nouveau intègre.");
  }

  store.subscribe((scopes, runs) => {
    renderAll(scopes, runs);
    scheduleVerify(scopes);
  });

  // Lancement automatique optionnel : ?run=nominal,veto_hitl&fast=1 (répétitions, captures d'écran).
  async function autoRun() {
    const keys = (params.get('run') || '')
      .split(',')
      .map((k) => k.trim())
      .filter((k) => C.SCENARIOS.some((s) => s.key === k));
    if (params.get('fast') === '1') {
      transport.setFast(true);
      const fast = document.querySelector('input[name="speed"][value="fast"]');
      if (fast) fast.checked = true;
    }
    for (const key of keys) await runScenario(key);
  }

  hydrateIcons();
  setupForm();
  setupTabs();
  setupChannel();
  bindStatic();
  renderPhoneIdle();
  narrowScreen.addEventListener('change', renderPipeline);
  if (transport.mode === 'live') {
    $('demo-hint').textContent = 'API FastAPI';
    $('reset-btn').hidden = true;
  }
  autoRun();
})();

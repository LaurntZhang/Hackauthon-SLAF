/*
 * ManAgent — salle de contrôle (rendu et interactions).
 * La vue ne lit que le Store (dérivé des AuditEvent) ; les actions passent par le transport.
 * Le dashboard ne décide rien : il relaie des décisions humaines que le moteur vérifie (signature HMAC).
 * Tout le vocabulaire affiché ici est une traduction métier des événements journalisés ; aucune règle n'est réévaluée.
 */
(function () {
  'use strict';
  const MA = window.ManAgent;
  const C = MA.config;
  const W = MA.wording;
  const fmt = MA.fmt;
  const esc = MA.esc;
  const icon = MA.icon;
  const $ = (id) => document.getElementById(id);

  const params = new URLSearchParams(window.location.search);
  const store = new MA.Store();
  const transport = params.get('mode') === 'live' ? new MA.LiveTransport(store) : new MA.SimTransport(store);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const ui = {
    running: null,
    pinned: null,
    replay: null,
    tab: 'feed',
    openDetails: new Set(),
    runEls: new Map(),
    stepEls: null,
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

  const STATE_TEXT = {
    idle: 'en attente', active: 'en cours', pass: 'validée', escalate: 'escalade', warn: 'signalée', block: 'bloquée',
    skipped: 'non traversée', revoked: 'révoquée',
  };
  const STAGE_HUMAN = { policy: 'analyse du mandat', hitl: 'refus du gérant', integrity: "contrôle d'intégrité", governor: 'limites du jour' };
  // Icônes métier des acteurs (pas de robot générique) ; les autres viennent du référentiel.
  const ACTOR_ICONS = { proposer: 'file', risk_judge: 'gauge', compliance_judge: 'scale', executor: 'clipboard', supervisor: 'eye' };
  const AGENT_ROLES = {
    proposer: 'Propose des opérations',
    risk_judge: 'Contrôle les expositions',
    compliance_judge: 'Contrôle KYC et univers',
    executor: "Prépare l'ordre autorisé",
    supervisor: 'Observe, alerte, demande un isolement',
  };
  const JUDGE_SUBJECT = { risk_judge: 'Le contrôle risque', compliance_judge: 'Le contrôle conformité' };

  // Cas de démonstration présentés comme des situations métier (les scénarios eux-mêmes sont inchangés).
  const CASES = {
    nominal: {
      icon: 'checkCircle', title: 'Opération simple autorisée',
      text: "Achat de 4 000 € d'OAT 10 ans, sous le seuil d'autonomie.",
      expected: 'autorisée et exécutée sans intervention humaine.',
    },
    veto_hitl: {
      icon: 'user', title: 'Montant élevé, contrôles en désaccord',
      text: "Achat de 85 000 € d'actions EuroTech ; le contrôle risque oppose son veto.",
      expected: "le gérant tranche et signe, puis l'ordre est exécuté.",
    },
    tampering: {
      icon: 'edit', title: 'Ordre modifié après accord',
      text: "L'OAT 10 ans est autorisée, mais l'exécuteur envoie EuroTech.",
      expected: "bloqué par le contrôle d'intégrité, avant le marché.",
    },
    injection: {
      icon: 'file', title: 'Document piégé',
      text: 'Une note externe exige un virement de 50 k€ vers un IBAN inconnu.',
      expected: 'outil interdit bloqué, agent mis en quarantaine.',
    },
    salami: {
      icon: 'split', title: 'Ordres fractionnés',
      text: '12 ordres de 900 € pour rester sous les seuils.',
      expected: 'coupe-circuit ouvert, alerte du superviseur.',
    },
    audit_tamper: {
      icon: 'linkBroken', title: 'Journal falsifié',
      text: 'Une ligne du journal est réécrite hors du système.',
      expected: "la vérification désigne l'événement altéré.",
    },
  };

  // Variantes passant par le formulaire « Composer une opération » (même chemin que l'objectif du gérant).
  const PRESETS = [
    {
      key: 'cpty', icon: 'building', title: 'Contrepartie non autorisée',
      text: "Achat de 5 000 € d'OAT 10 ans auprès de Kappa Offshore Ltd.",
      expected: "bloqué dès l'analyse du mandat (liste KYC).",
      spec: { asset: 'OAT-10A', side: 'buy', amount: 5000, counterparty: 'Kappa Offshore Ltd' },
    },
    {
      key: 'amount', icon: 'gauge', title: 'Montant au-delà du seuil',
      text: "Achat de 25 000 € d'OAT 30 ans ; les deux contrôles sont favorables.",
      expected: "validation humaine requise malgré l'accord des contrôles.",
      spec: { asset: 'OAT-30A', side: 'buy', amount: 25000, counterparty: 'Banque Horizon BFI' },
    },
  ];

  // Chaîne de décision lisible : 8 étapes métier, chacune agrégeant un ou plusieurs nœuds du graphe.
  const STEPS = [
    { id: 'proposal', name: 'Proposition', actor: 'Agent IA', icon: 'file' },
    { id: 'mandate', name: 'Analyse du mandat', actor: 'FinGuard', icon: 'target' },
    { id: 'risk', name: 'Contrôle risque', actor: 'Agent juge', icon: 'gauge' },
    { id: 'compliance', name: 'Contrôle conformité', actor: 'Agent juge', icon: 'scale' },
    { id: 'decision', name: 'Décision', actor: 'FinGuard', icon: 'gate' },
    { id: 'human', name: 'Validation humaine', actor: 'Gérant', icon: 'phone' },
    { id: 'execution', name: 'Exécution', actor: 'FinGuard', icon: 'send' },
    { id: 'proof', name: 'Preuve', actor: 'Journal', icon: 'link' },
  ];
  const EXEC_NODES = ['authorize', 'executor', 'integrity', 'governor', 'gateway', 'market'];
  const EXEC_ACTIVE = {
    authorize: "Émission de l'autorisation",
    executor: "Préparation de l'ordre",
    integrity: "Vérification d'intégrité",
    governor: 'Contrôle des limites du jour',
    gateway: 'Transmission au marché',
    market: 'Exécution au marché simulé',
  };
  const STATE_STATUS = {
    pass: ['ok', 'check'], escalate: ['human', 'user'], warn: ['human', 'alert'], block: ['block', 'lock'],
    revoked: ['block', 'xCircle'], active: ['active', 'clock'], idle: ['neutral', 'clock'], skipped: ['neutral', 'chevron'],
  };
  const RISK_WHY = {
    'RJ-SECT': 'Concentration sectorielle trop forte',
    'RJ-ISSU': 'Exposition émetteur au-delà de 5 %',
    'RJ-POS': 'Position insuffisante pour vendre',
    'CJ-UNIV': 'Actif hors périmètre du mandat',
  };
  const COMPLIANCE_WHY = {
    'CJ-KYC': 'Contrepartie hors liste KYC',
    'CJ-UNIV': "Actif hors de l'univers du mandat",
    'CJ-SRC': 'Source signalée : un humain doit trancher',
  };
  const GOVERNOR_WHY = {
    'RSK-001': 'Budget autonome du jour dépassé',
    'RSK-002': "Trop d'ordres en une minute",
    'RSK-004': "Arrêt d'urgence actif",
    'RSK-005': 'Coupe-circuit ouvert',
  };
  const RISK_LEVELS = ['En évaluation', 'Faible', 'Modéré', 'Élevé'];
  const RATIO = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

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

  function lowerFirst(text) {
    return text ? text.charAt(0).toLowerCase() + text.slice(1) : '';
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

  /** Statut lisible (icône + libellé). Conserve le nom historique pour limiter les changements. */
  function badge(status, label) {
    return W.status(status, label);
  }

  function actorIcon(agentId) {
    return ACTOR_ICONS[agentId] || (C.ACTORS[agentId] || {}).icon || 'info';
  }

  function txWhat(tx) {
    if (!tx.intent) return tx.corr;
    return `${fmt.side(tx.intent.side)} de ${fmt.eur(tx.intent.amount)} · ${tx.assetLabel}`;
  }

  function txBadge(tx) {
    if (tx.final && tx.final.status === 'filled') return badge('filled', tx.hitl ? 'Exécutée après validation' : 'Exécutée');
    if (tx.final) return badge('blocked', `Bloquée · ${STAGE_HUMAN[tx.final.stage] || tx.final.stage}`);
    if (tx.hitl && tx.hitl.status === 'pending') return badge('pending', 'En attente du gérant');
    return badge('running', 'En cours de contrôle');
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

  function scrollIntoViewSoft(el, block) {
    if (el) el.scrollIntoView({ block: block || 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' });
  }

  function latestRun(scenarioId) {
    for (let i = store.runOrder.length - 1; i >= 0; i--) {
      const run = store.runs.get(store.runOrder[i]);
      if (run.scenario === scenarioId) return run;
    }
    return null;
  }

  function scenarioByKey(key) {
    return C.SCENARIOS.find((s) => s.key === key);
  }

  function caseTitle(scenarioId) {
    const s = C.SCENARIOS.find((x) => x.id === scenarioId);
    return s && CASES[s.key] ? CASES[s.key].title : null;
  }

  // ------------------------------------------------------------------ en-tête, bannières, barre d'état

  function simState() {
    if (ui.replay) return ['Relecture du journal', 'is-running'];
    if (store.kill.global) return ['Exécution coupée', 'is-stopped'];
    if (store.pending) return ['En attente du gérant', 'is-human'];
    if (ui.running === 'manual') return ['Opération en cours', 'is-running'];
    if (ui.running) {
      const s = scenarioByKey(ui.running);
      return [`Cas ${s ? s.id : ''} en cours`, 'is-running'];
    }
    return ['Prête', ''];
  }

  function renderHeader() {
    const v = store.verification;
    const pill = $('audit-pill');
    pill.className = `audit-pill${v.state === 'valid' ? ' is-valid' : v.state === 'broken' ? ' is-broken' : ''}`;
    let pillHtml = `${icon('link')}<span>Preuve : <strong>non vérifiée</strong></span>`;
    if (v.state === 'valid') pillHtml = `${icon('link')}<span>Preuve : <strong>chaîne intègre</strong> · ${plural(v.checked, 'événement')}</span>`;
    if (v.state === 'broken') pillHtml = `${icon('linkBroken')}<span>Preuve : <strong>falsification détectée</strong> · n° ${v.broken_at + 1}</span>`;
    setHTML(pill, pillHtml);

    const kill = $('kill-btn');
    kill.dataset.cmd = store.kill.global ? 'release-kill' : 'engage-kill';
    kill.className = store.kill.global ? 'btn btn-primary' : 'btn btn-kill';
    setHTML(kill, store.kill.global ? `${icon('power')}Réarmer l'exécution` : `${icon('power')}Arrêt d'urgence`);
    kill.disabled = Boolean(ui.replay);

    $('mode-chip').textContent = transport.mode === 'live' ? `API live · ${store.connection || 'connexion…'}` : 'Simulation locale · hors ligne';
    const [stateText, stateCls] = simState();
    const stateEl = $('sim-state');
    stateEl.textContent = stateText;
    stateEl.className = `sim-state ${stateCls}`.trim();
  }

  function renderBanners() {
    const parts = [];
    if (store.kill.global) {
      parts.push(`<div class="banner banner--danger">${icon('power')}<p>Arrêt d'urgence actif : aucun ordre n'atteint le marché. Déclenché par ${esc(fmt.actor(store.kill.by))} à ${esc(fmt.time(store.kill.at))}.</p><button type="button" class="btn btn-sm" data-cmd="release-kill">Réarmer</button></div>`);
    }
    const p = store.pending;
    if (p && !$('phone-dialog').open && !ui.replay) {
      const intent = p.card.intent;
      parts.push(`<div class="banner banner--warn">${icon('user')}<p>Une décision attend le gérant sur ${esc(p.corr)} : ${esc(fmt.side(intent.side).toLowerCase())} de ${esc(fmt.eur(intent.amount))} de ${esc(p.card.asset_label)}. Le traitement est suspendu jusqu'à sa signature (AI Act art. 14).</p><button type="button" class="btn btn-sm btn-primary" data-cmd="open-phone">Ouvrir la validation</button></div>`);
    }
    if (ui.replay) {
      parts.push(`<div class="banner banner--info">${icon('replay')}<p>Relecture du journal (${ui.replay.index}/${ui.replay.total}) : lecture seule, aucune décision n'est rejouée.</p><button type="button" class="btn btn-sm" data-cmd="stop-replay">Arrêter</button></div>`);
    }
    setHTML($('banners'), parts.join(''));
  }

  function renderStatusbar() {
    const parts = [
      `<span>${plural(store.events.length, 'événement')} journalisé${store.events.length > 1 ? 's' : ''}</span>`,
      `<span class="${store.invalid ? 'is-bad' : ''}">${store.invalid} rejeté${store.invalid > 1 ? 's' : ''} par le contrat de données AuditEvent${store.lastInvalid ? ` (dernier : ${esc(store.lastInvalid)})` : ''}</span>`,
      transport.mode === 'sim'
        ? `<span>Simulation : règles ${esc(C.POLICY_VERSION)} rejouées dans le navigateur, en attendant l'API FastAPI</span>`
        : '<span>Flux temps réel GET /events</span>',
      '<span>Données synthétiques · marché simulé</span>',
    ];
    if (ui.lastError) parts.push(`<span class="is-bad" role="alert">${esc(ui.lastError)}</span>`);
    setHTML($('statusbar'), parts.join(''));
  }

  // ------------------------------------------------------------------ cas de démonstration

  function issuesFor(key) {
    const list = [];
    if (key === 'salami') {
      for (const agent of ['proposer', 'executor']) {
        if (store.agents[agent].quarantined) {
          list.push({ code: 'quarantine', agent, message: `Le ${fmt.actor(agent)} est en quarantaine. Seul un humain peut la lever avant ce cas.` });
        }
      }
      if (store.risk.breaker === 'open') list.push({ code: 'breaker', message: 'Le coupe-circuit est ouvert. Un humain doit le réarmer.' });
      if (store.kill.global) list.push({ code: 'kill', message: "L'arrêt d'urgence est actif. Un humain doit réarmer l'exécution." });
    }
    for (const issue of ui.issues[key] || []) {
      if (!list.some((i) => i.code === issue.code && i.agent === issue.agent)) list.push(issue);
    }
    return list;
  }

  function fixButton(issue) {
    if (issue.code === 'quarantine') return `<button type="button" class="btn btn-sm" data-cmd="lift-quarantine" data-agent="${esc(issue.agent)}">${icon('user')}Lever la quarantaine</button>`;
    if (issue.code === 'breaker') return `<button type="button" class="btn btn-sm" data-cmd="reset-breaker">${icon('reset')}Réarmer le coupe-circuit</button>`;
    if (issue.code === 'kill') return `<button type="button" class="btn btn-sm" data-cmd="release-kill">${icon('power')}Réarmer l'exécution</button>`;
    return '';
  }

  function renderScenarios() {
    const busy = Boolean(ui.running) || Boolean(ui.replay);
    const html = C.SCENARIOS.map((s) => {
      const meta = CASES[s.key] || { icon: 'play', title: s.title, text: s.input, expected: s.expected };
      const run = latestRun(s.id);
      const running = ui.running === s.key;
      const issues = issuesFor(s.key);
      let cls = 'case';
      let status = '';
      if (running) {
        cls += ' is-running';
        status = store.pending ? badge('pending', 'En attente du gérant') : badge('running', 'En cours…');
      } else if (run && run.completed) {
        cls += run.completed.matched ? ' is-done-ok' : ' is-done-ko';
        status = run.completed.matched
          ? badge('valid', `Conforme : ${run.completed.obtained}`)
          : badge('mismatch', `Écart : ${run.completed.obtained}`);
      }
      const issueHtml = issues.length
        ? `<div class="case-issue">${issues.map((i) => `<p>${esc(i.message)}</p>${fixButton(i)}`).join('')}</div>`
        : '';
      const quote = running || (run && run.completed) ? `<p class="case-quote">${esc(s.quote)}</p>` : '';
      const label = running ? 'En cours' : run ? 'Relancer' : 'Lancer';
      const disabled = busy || issues.some((i) => ['quarantine', 'breaker', 'kill'].includes(i.code));
      return `
        <li class="${cls}">
          <span class="case-icon">${icon(meta.icon)}</span>
          <div class="case-head"><span class="case-num">${esc(s.id)}</span><h3 class="case-title">${esc(meta.title)}</h3></div>
          <p class="case-text">${esc(meta.text)}</p>
          <p class="case-expected"><strong>Attendu :</strong> ${esc(meta.expected)}</p>
          ${issueHtml}
          ${quote}
          <div class="case-foot">
            ${status || '<span></span>'}
            <button type="button" class="btn btn-sm" data-cmd="run-scenario" data-key="${s.key}"
              aria-label="${esc(`${label} le cas ${s.id} : ${meta.title}`)}" ${disabled ? 'disabled' : ''}>${icon('play')}${label}</button>
          </div>
        </li>`;
    }).join('');
    setHTML($('scenarios'), html);

    const presets = PRESETS.map(
      (p) => `
        <li class="case case--preset">
          <span class="case-icon">${icon(p.icon)}</span>
          <div class="case-head"><h3 class="case-title">${esc(p.title)}</h3></div>
          <p class="case-text">${esc(p.text)}</p>
          <p class="case-expected"><strong>Attendu :</strong> ${esc(p.expected)}</p>
          <div class="case-foot"><span></span>
            <button type="button" class="btn btn-sm" data-cmd="preset" data-key="${p.key}" aria-label="${esc(`Pré-remplir le formulaire : ${p.title}`)}" ${busy ? 'disabled' : ''}>${icon('edit')}Pré-remplir</button>
          </div>
        </li>`,
    ).join('');
    setHTML($('presets'), presets);
    $('obj-submit').disabled = busy;
  }

  async function runScenario(key) {
    if (ui.running || ui.replay) return;
    ui.issues[key] = null;
    ui.running = key;
    ui.pinned = null;
    switchTab(key === 'audit_tamper' ? 'audit' : 'feed');
    renderScenarios();
    renderHeader();
    const scenario = scenarioByKey(key);
    announce(`Cas ${scenario.id} lancé : ${(CASES[key] || scenario).title}.`);
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
      renderHeader();
      verifyNow();
    }
  }

  // ------------------------------------------------------------------ bilan de séance

  function renderKpis() {
    const k = store.kpis();
    const items = [
      ['Dossiers', k.total],
      ['Exécutés', k.filled],
      ['Soumis au gérant', k.escalated],
      ['Bloqués', k.blocked],
      ['Alertes', k.alerts],
    ];
    setHTML($('kpis'), items.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join(''));
  }

  // ------------------------------------------------------------------ dossier en cours

  function currentCorr() {
    return ui.pinned || store.lastCorr;
  }

  function effectiveMax(tx) {
    return (tx.policy && typeof tx.policy.effective_max === 'number' && tx.policy.effective_max) || C.LIMITS.autonomousMax;
  }

  /** Niveau de risque affiché : synthèse des issues des contrôles déjà journalisées (aucun nouveau calcul de risque). */
  function riskLevel(tx) {
    const p = tx.policy;
    const votes = tx.verdicts;
    if (tx.final && tx.final.status === 'blocked' && tx.final.stage !== 'hitl') return 3;
    if (p && p.outcome === 'BLOCK') return 3;
    if (votes.some((v) => v.vote === 'veto')) return 3;
    if (votes.some((v) => v.vote === 'abstain') || (tx.firewall && tx.firewall.flagged)) return 2;
    if (p && p.outcome === 'ESCALATE') return 2;
    if (votes.length && votes.every((v) => v.vote === 'approve')) return 1;
    return 0;
  }

  function riskHtml(level) {
    const bars = [1, 2, 3].map((n) => `<span class="${level >= n ? 'is-on' : ''}"></span>`).join('');
    return `<span class="risk-level${level ? '' : ' is-pending'}"><span class="risk-bars" aria-hidden="true">${bars}</span><span>${RISK_LEVELS[level]}</span></span>`;
  }

  function thresholdHtml(amount, max) {
    const scale = Math.max(amount, max) * 1.15;
    const within = Math.min(amount, max);
    const fill = `<span class="threshold-fill" style="width:${((within / scale) * 100).toFixed(1)}%"></span>`;
    const over = amount > max
      ? `<span class="threshold-over" style="left:${((max / scale) * 100).toFixed(1)}%;width:${(((amount - max) / scale) * 100).toFixed(1)}%"></span>`
      : '';
    const mark = `<span class="threshold-mark" style="left:${((max / scale) * 100).toFixed(1)}%"></span>`;
    const text = amount > max
      ? `${RATIO.format(amount / max)} × le seuil : au-delà, le gérant décide`
      : `${fmt.eur(amount)} sur ${fmt.eur(max)} possibles sans validation`;
    return { bar: `<span class="threshold" aria-hidden="true">${fill}${over}${mark}</span>`, text, over: amount > max };
  }

  function expectedDecision(tx) {
    if (tx.final) return { text: `Décision rendue à ${fmt.time(tx.final.at)}`, cls: '' };
    if (tx.hitl && tx.hitl.status === 'pending') return { text: 'Signature du gérant', cls: 'is-human' };
    const p = tx.policy;
    const q = tx.quorum;
    if (!p) return { text: 'Analyse du mandat', cls: '' };
    if (p.outcome === 'BLOCK') return { text: 'Blocage', cls: 'is-block' };
    if (p.outcome === 'ESCALATE' || (q && q.outcome === 'ESCALATE')) return { text: 'Validation humaine', cls: 'is-human' };
    if (q && q.outcome === 'ALLOW') return { text: 'Exécution sous contrôle', cls: '' };
    return { text: 'Vote des deux contrôles', cls: '' };
  }

  const EMPTY_DOSSIER = `
    <svg viewBox="0 0 120 92" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true" focusable="false">
      <path d="M10 22h30l7 7h63v55H10z" fill="#efebe2"/>
      <rect x="25" y="9" width="62" height="54" fill="#fbfaf7"/>
      <path d="M33 21h38M33 29h46M33 37h30" stroke-linecap="round"/>
      <circle cx="74" cy="49" r="7"/>
      <path d="M70.8 49.2l2.2 2.2 4-4.4" stroke-linecap="round"/>
      <path d="M10 40h100v44H10z" fill="#fbfaf7"/>
      <path d="M22 54h34M22 62h22" stroke-linecap="round"/>
    </svg>`;

  function renderDossier(tx) {
    const el = $('dossier');
    if (!tx || !tx.intent) {
      const preparing = tx && !tx.intent;
      setHTML(
        el,
        `<div class="dossier-empty">
          ${EMPTY_DOSSIER}
          <div>
            <h3>${preparing ? `Dossier ${esc(tx.corr)} en préparation` : 'Aucune transaction en cours'}</h3>
            <p>${preparing ? 'Les données externes sont filtrées avant que l’agent ne formule sa proposition.' : "Lancez un cas de démonstration : le dossier s'ouvre ici avec le montant, l'actif, la contrepartie et le niveau de risque."}</p>
            ${preparing ? '' : '<a class="btn-link" href="#cases">Choisir un cas de démonstration</a>'}
          </div>
        </div>`,
      );
      return;
    }
    const i = tx.intent;
    const amount = Number(i.amount);
    const max = effectiveMax(tx);
    const kyc = C.COUNTERPARTIES.includes(i.counterparty);
    const assetType = C.ASSET_TYPE_LABELS[i.asset_type] || i.asset_type;
    const th = thresholdHtml(amount, max);
    const level = riskLevel(tx);
    const expected = expectedDecision(tx);
    const toolNote = tx.tool && tx.tool !== 'intent.emit'
      ? `<p class="fact-note is-block">${icon('lock')}<span>Outil demandé : <span class="mono">${esc(tx.tool)}</span>, interdit par le mandat</span></p>`
      : '';
    const reduced = max < C.LIMITS.autonomousMax ? ' (réduit : score de confiance sous 70)' : '';
    setHTML(
      el,
      `<article class="dossier" aria-label="Dossier ${esc(tx.corr)}">
        <p class="dossier-tab">${icon('folder')}Dossier <span class="mono">${esc(tx.corr)}</span><span class="muted">· ouvert à ${esc(fmt.time(tx.startedAt))}</span></p>
        <div class="dossier-sheet">
          <header class="dossier-head">
            <div>
              <p class="dossier-side">${icon(i.side === 'sell' ? 'arrowDownRight' : 'arrowUpRight')}${esc(fmt.side(i.side))}</p>
              <p class="dossier-amount">${esc(fmt.eur(amount))}</p>
              <p class="dossier-asset">${esc(tx.assetLabel || i.asset)} <span class="muted">· ${esc(assetType)}</span></p>
            </div>
            ${txBadge(tx).replace('class="status ', 'class="status status-lg ')}
          </header>
          <dl class="dossier-facts">
            <div>
              <dt>Contrepartie</dt>
              <dd>${esc(i.counterparty)}
                <span class="fact-note ${kyc ? 'is-ok' : 'is-block'}">${icon(kyc ? 'check' : 'lock')}${kyc ? 'En liste blanche KYC' : 'Hors liste blanche KYC'}</span>
              </dd>
            </div>
            <div>
              <dt>Seuil d'autonomie</dt>
              <dd>${esc(fmt.eur(max))}${esc(reduced)}${th.bar}<span class="fact-note ${th.over ? 'is-human' : ''}">${esc(th.text)}</span></dd>
            </div>
            <div>
              <dt>Niveau de risque</dt>
              <dd>${riskHtml(level)}<span class="fact-note">Synthèse des contrôles journalisés</span></dd>
            </div>
            <div>
              <dt>Décision attendue</dt>
              <dd>${esc(expected.text)}${tx.hitl && tx.hitl.status === 'pending' ? `<span class="fact-note is-human">${icon('clock')}Aucun ordre ne part sans signature</span>` : ''}</dd>
            </div>
          </dl>
          <footer class="dossier-foot">
            <p>Proposé par l'agent Proposer, confiance ${esc(fmt.dec(i.confidence))}. <q>${esc(i.rationale)}</q></p>
            ${toolNote}
            <button type="button" class="btn btn-sm btn-ghost" data-cmd="xai" data-corr="${esc(tx.corr)}">${icon('file')}Fiche de décision</button>
          </footer>
        </div>
      </article>`,
    );
  }

  // ------------------------------------------------------------------ décision actuelle

  function dissentSentence(tx) {
    const dissent = tx.verdicts.filter((v) => v.vote !== 'approve');
    if (!dissent.length) return W.rule('QRM-001');
    const who = dissent
      .map((v) => `${JUDGE_SUBJECT[v.judge_id] || fmt.actor(v.judge_id)} ${v.vote === 'veto' ? 'oppose son veto' : "s'abstient"}`)
      .join(' et ');
    return `${who} : seul un humain peut trancher.`;
  }

  function reasonsSentence(tx, rules) {
    const ctx = { max: fmt.eur(effectiveMax(tx)), tool: tx.tool };
    return rules.map((r) => (r === 'QRM-001' ? dissentSentence(tx) : W.rule(r, ctx))).join(' ');
  }

  function decisionModel(tx) {
    if (!tx) {
      return { sel: null, waiting: true, reason: 'Aucune opération à décider. Lancez un cas : la décision retenue et sa justification apparaîtront ici.' };
    }
    const p = tx.policy;
    const q = tx.quorum;
    const f = tx.final;
    if (f && f.status === 'filled') {
      const signed = tx.human && tx.human.timestamp ? ` à ${fmt.time(tx.human.timestamp)}` : '';
      return {
        sel: 'allow',
        reason: tx.hitl
          ? "Le gérant a validé et signé : l'ordre est parti par la passerelle unique."
          : "Montant sous le seuil d'autonomie et contrôles unanimes : exécutée sans intervention humaine.",
        outcome: tx.hitl ? ['pen', `Après validation humaine signée${signed}, exécutée à ${fmt.time(f.at)}.`] : ['checkCircle', `Exécutée à ${fmt.time(f.at)} sur le marché simulé.`],
      };
    }
    if (f && f.status === 'blocked') {
      const rules = f.rules || [];
      let reason;
      if (f.stage === 'hitl') reason = W.rule('HITL-REJECT');
      else if (f.stage === 'integrity') reason = `Autorisée par les contrôles, mais ${lowerFirst(W.rule(rules[0] || 'INT-001'))} Bloquée avant le marché.`;
      else if (f.stage === 'policy') reason = `${reasonsSentence(tx, rules)} Rien n'est transmis aux contrôles ni à l'exécuteur.`;
      else reason = `${reasonsSentence(tx, rules.slice(0, 1))} Ordre bloqué avant le marché.`;
      return { sel: 'block', reason, outcome: ['lock', `Bloquée à ${fmt.time(f.at)} · ${STAGE_HUMAN[f.stage] || f.stage}.`] };
    }
    if (tx.hitl && tx.hitl.status === 'pending') {
      const reasons = (tx.hitl.card && tx.hitl.card.reasons) || [];
      return { sel: 'human', pending: true, reason: reasonsSentence(tx, reasons), outcome: ['clock', "Le traitement est suspendu jusqu'à la signature du gérant."] };
    }
    if (p && p.outcome === 'BLOCK') return { sel: 'block', reason: reasonsSentence(tx, p.triggered_rules || []) };
    if ((p && p.outcome === 'ESCALATE') || (q && q.outcome === 'ESCALATE')) {
      const rules = [...(p && p.outcome === 'ESCALATE' ? p.triggered_rules || [] : []), ...(q && q.outcome === 'ESCALATE' ? q.triggered_rules || [] : [])];
      return { sel: 'human', reason: reasonsSentence(tx, rules) };
    }
    if (q && q.outcome === 'ALLOW') {
      return { sel: 'allow', reason: `${W.rule((q.triggered_rules || [])[0] || 'QRM-002')} Exécution sous contrôle en cours.` };
    }
    return { sel: null, waiting: true, reason: "Contrôles en cours : la décision n'est pas encore rendue." };
  }

  const VERDICT_OPTIONS = [
    { id: 'allow', cls: 'is-ok', icon: 'check', label: 'Autoriser', hint: 'Dans le mandat, contrôles favorables' },
    { id: 'human', cls: 'is-human', icon: 'user', label: 'Demander une validation humaine', hint: 'Seuil dépassé ou contrôles en désaccord' },
    { id: 'block', cls: 'is-block', icon: 'lock', label: 'Bloquer', hint: 'Règle enfreinte : rien ne part au marché' },
  ];

  function renderDecision(tx) {
    const m = decisionModel(tx);
    const options = VERDICT_OPTIONS.map((o) => {
      const selected = m.sel === o.id;
      return `<li class="verdict-opt ${o.cls}${selected ? ' is-selected' : ''}"${selected ? ' aria-current="true"' : ''}>
          <span class="verdict-mark" aria-hidden="true">${icon(o.icon)}</span>
          <span class="verdict-label">${o.label}${selected ? '<span class="sr-only"> : décision retenue</span>' : ''}</span>
          <span class="verdict-hint">${selected ? 'Décision retenue' : o.hint}</span>
        </li>`;
    }).join('');
    const outcome = m.outcome ? `<p class="verdict-outcome">${icon(m.outcome[0])}<span>${esc(m.outcome[1])}</span></p>` : '';
    const actions = [];
    if (m.pending && !ui.replay) actions.push(`<button type="button" class="btn btn-primary" data-cmd="open-phone">${icon('phone')}Ouvrir la validation du gérant</button>`);
    if (!tx) actions.push('<a class="btn btn-ghost" href="#cases">Choisir un cas</a>');
    setHTML(
      $('decision'),
      `<div class="verdict">
        <ol class="verdict-options" aria-label="Issues possibles">${options}</ol>
        <p class="verdict-reason${m.waiting ? ' is-waiting' : ''}">${esc(m.reason)}</p>
        ${outcome}
        ${actions.length ? `<div class="verdict-actions">${actions.join('')}</div>` : ''}
        <ul class="guarantees" aria-label="Garanties">
          <li>${icon('lock')}<span>Les agents ne peuvent pas exécuter directement.</span></li>
          <li>${icon('gate')}<span>Le contrôle FinGuard est la seule porte vers l'action.</span></li>
          <li>${icon('send')}<span>L'exécuteur ne décide pas : il applique l'autorisation.</span></li>
        </ul>
      </div>`,
    );
  }

  // ------------------------------------------------------------------ chaîne de décision

  function combine(list) {
    if (list.some((s) => s === 'block' || s === 'revoked')) return 'block';
    if (list.some((s) => s === 'active')) return 'active';
    if (list.some((s) => s === 'escalate' || s === 'warn')) return 'warn';
    if (list.every((s) => s === 'skipped')) return 'skipped';
    if (list.every((s) => s === 'pass' || s === 'skipped')) return 'pass';
    if (list.some((s) => s === 'pass')) return 'active';
    return 'idle';
  }

  function judgeStep(tx, nodeState, judgeId, whyMap, approveText) {
    const v = tx.verdicts.find((x) => x.judge_id === judgeId);
    if (v) {
      if (v.vote === 'approve') return { state: 'pass', label: 'Approuve', why: approveText };
      const rule = (v.rule_ids || [])[0];
      return { state: 'escalate', label: v.vote === 'veto' ? 'Veto' : 'Abstention', why: whyMap[rule] || "Un humain doit trancher" };
    }
    if (nodeState === 'active') return { state: 'active', label: 'Analyse en cours', why: 'Vote indépendant des autres agents' };
    if (nodeState === 'skipped') return { state: 'skipped', label: 'Non sollicité', why: 'Arrêté avant les contrôles' };
    return { state: 'idle', label: 'En attente', why: '' };
  }

  function stepData(tx) {
    const st = store.nodeStates(tx);
    const p = tx.policy;
    const q = tx.quorum;
    const f = tx.final;
    const out = {};

    // 1. Proposition (filtrage des données externes + proposition de l'agent).
    const propState = combine([st.firewall.state, st.proposer.state]);
    const flagged = st.firewall.state === 'warn';
    out.proposal = {
      state: propState === 'warn' ? 'warn' : propState,
      label: flagged ? 'Source signalée' : tx.intent ? 'Proposée' : propState === 'active' ? 'Lecture des données' : 'En attente',
      why: tx.intent
        ? `${fmt.side(tx.intent.side)} de ${fmt.eur(tx.intent.amount)}${flagged ? ' · source externe traitée comme simple donnée' : ` · confiance ${fmt.dec(tx.intent.confidence)}`}`
        : flagged ? 'Source externe traitée comme simple donnée' : '',
    };

    // 2. Analyse du mandat (Policy Engine).
    if (p) {
      const rules = p.triggered_rules || [];
      if (p.outcome === 'BLOCK') out.mandate = { state: 'block', label: 'Hors mandat', why: W.rule(rules[0], { tool: tx.tool }) };
      else if (p.outcome === 'ESCALATE') out.mandate = { state: 'escalate', label: 'Seuil dépassé', why: `Au-delà de ${fmt.eur(effectiveMax(tx))} en autonomie` };
      else out.mandate = { state: 'pass', label: 'Dans le mandat', why: tx.intent ? `${fmt.eur(tx.intent.amount)} ≤ ${fmt.eur(effectiveMax(tx))}, contrepartie KYC` : 'Conforme' };
    } else {
      out.mandate = { state: st.policy.state, label: st.policy.state === 'active' ? 'Vérification' : st.policy.state === 'skipped' ? 'Non atteinte' : 'En attente', why: '' };
    }

    // 3-4. Contrôles risque et conformité (agents juges, votes indépendants).
    out.risk = judgeStep(tx, st.judges.state, 'risk_judge', RISK_WHY, 'Expositions dans les limites');
    out.compliance = judgeStep(tx, st.judges.state, 'compliance_judge', COMPLIANCE_WHY, 'KYC et univers conformes');

    // 5. Décision (règles + quorum).
    if (p && p.outcome === 'BLOCK') out.decision = { state: 'block', label: 'Bloquer', why: 'Règle du mandat enfreinte' };
    else if (q && q.outcome === 'ESCALATE') out.decision = { state: 'escalate', label: "Escalader à l'humain", why: 'Désaccord entre les contrôles' };
    else if (q && p && p.outcome === 'ESCALATE') out.decision = { state: 'escalate', label: "Escalader à l'humain", why: "Seuil d'autonomie dépassé" };
    else if (q && q.outcome === 'ALLOW') {
      out.decision = {
        state: 'pass', label: 'Autoriser',
        why: q.mode === 'weighted' ? `Majorité pondérée ${fmt.dec(q.ratio)}` : `Unanimité des contrôles ${q.approvals}/${q.required}`,
      };
    } else {
      out.decision = { state: st.quorum.state, label: st.quorum.state === 'active' ? 'Décompte' : st.quorum.state === 'skipped' ? 'Non atteinte' : 'En attente', why: '' };
    }

    // 6. Validation humaine.
    const h = st.hitl.state;
    if (tx.hitl && tx.hitl.status === 'pending') out.human = { state: 'escalate', label: 'En attente du gérant', why: "Traitement suspendu jusqu'à sa signature" };
    else if (tx.hitl && tx.hitl.status === 'approved') out.human = { state: 'pass', label: 'Approuvée et signée', why: tx.human && tx.human.timestamp ? `Signature vérifiée à ${fmt.time(tx.human.timestamp)}` : 'Signature vérifiée' };
    else if (tx.hitl && tx.hitl.status === 'rejected') out.human = { state: 'block', label: 'Refusée et signée', why: "L'exécuteur n'est pas sollicité" };
    else if (h === 'skipped') {
      const before = f && f.status === 'blocked' && f.stage === 'policy';
      out.human = { state: 'skipped', label: before ? 'Non atteinte' : 'Non requise', why: before ? 'Bloqué avant toute décision' : 'Sous le seuil, contrôles unanimes' };
    } else out.human = { state: h === 'active' ? 'active' : 'idle', label: h === 'active' ? 'Sollicitation' : 'En attente', why: '' };

    // 7. Exécution sous contrôle (autorisation, exécuteur, intégrité, limites, passerelle, marché).
    const execStates = EXEC_NODES.map((id) => st[id].state);
    const execState = combine(execStates);
    if (f && f.status === 'filled') {
      out.execution = { state: 'pass', label: 'Exécutée', why: tx.order ? `Ordre ${tx.order.order_id} au marché simulé` : 'Au marché simulé' };
    } else if (f && f.stage === 'integrity') {
      out.execution = { state: 'block', label: 'Bloquée', why: "Ordre différent de l'autorisation" };
    } else if (f && f.stage === 'governor') {
      out.execution = { state: 'block', label: 'Bloquée', why: GOVERNOR_WHY[(f.rules || [])[0]] || 'Limites du jour' };
    } else if (execState === 'skipped' || (f && ['policy', 'hitl'].includes(f.stage))) {
      out.execution = { state: 'skipped', label: 'Non atteinte', why: 'Aucun ordre préparé' };
    } else if (execState === 'active') {
      const activeNode = EXEC_NODES.find((id) => st[id].state === 'active');
      out.execution = { state: 'active', label: 'En cours', why: EXEC_ACTIVE[activeNode] || 'Sous contrôle' };
    } else {
      out.execution = { state: 'idle', label: 'En attente', why: '' };
    }

    // 8. Preuve (journal chaîné).
    const v = store.verification;
    const n = tx.items.length;
    const last = n ? tx.items[n - 1] : -1;
    if (v.state === 'broken' && v.broken_at <= last) {
      out.proof = { state: 'block', label: 'Falsification détectée', why: `Événement n° ${v.broken_at + 1} modifié hors du système` };
    } else if (f && v.state === 'valid' && v.checked > last) {
      out.proof = { state: 'pass', label: 'Prouvée', why: `${plural(n, 'événement')} vérifié${n > 1 ? 's' : ''}` };
    } else {
      out.proof = { state: 'idle', label: 'Journalisée', why: `${plural(n, 'événement')} enregistré${n > 1 ? 's' : ''}` };
    }
    return out;
  }

  function stepStatus(state, label) {
    const [tone, ic] = STATE_STATUS[state] || STATE_STATUS.idle;
    return `<span class="status status--${tone}">${icon(ic)}<span>${esc(label)}</span></span>`;
  }

  function renderChain(tx) {
    const list = $('pipeline');
    if (!ui.stepEls) {
      list.innerHTML = STEPS.map((s) => `<li class="step is-idle" data-step="${s.id}"></li>`).join('');
      ui.stepEls = Array.from(list.children);
    }
    const data = tx ? stepData(tx) : null;
    STEPS.forEach((s, i) => {
      const d = data ? data[s.id] : { state: 'idle', label: 'En attente', why: '' };
      const el = ui.stepEls[i];
      const cls = `step is-${d.state}`;
      if (el.className !== cls) el.className = cls;
      setHTML(
        el,
        `<span class="step-node" aria-hidden="true">${icon(s.icon)}</span>
        <p class="step-num" aria-hidden="true">${String(i + 1).padStart(2, '0')}</p>
        <h3 class="step-name">${esc(s.name)}</h3>
        <p class="step-actor">${esc(s.actor)}</p>
        <p class="step-state">${stepStatus(d.state, d.label)}</p>
        ${d.why ? `<p class="step-why">${esc(d.why)}</p>` : ''}`,
      );
    });
  }

  // ------------------------------------------------------------------ preuve : chaîne d'événements

  function renderProof(tx) {
    const n = store.events.length;
    const v = store.verification;
    const MAX = 48;
    const txSet = new Set(tx ? tx.items : []);
    const brokenAt = v.state === 'broken' ? v.broken_at : -1;
    const verifiedUpTo = v.state === 'valid' ? v.checked : v.state === 'broken' ? v.broken_at : 0;
    // Fenêtres affichées : les derniers événements, plus le voisinage d'une rupture si elle est plus ancienne.
    const ranges = [];
    let tail = Math.max(0, n - MAX);
    const suspect = brokenAt >= 0 ? brokenAt : [...store.overrides.keys()].sort((a, b) => a - b)[0];
    if (suspect !== undefined && suspect < tail) {
      const from = Math.max(0, suspect - 4);
      const to = Math.min(n, suspect + 5);
      ranges.push([from, to]);
      tail = Math.max(to, n - (MAX - (to - from)));
    }
    ranges.push([tail, n]);
    const links = [];
    let cursor = 0;
    for (const [from, to] of ranges) {
      if (from > cursor) links.push(`<li class="more">+${from - cursor}</li>`);
      for (let i = from; i < to; i++) {
        const cls = [
          txSet.has(i) ? 'is-tx' : '',
          i < verifiedUpTo ? 'is-verified' : '',
          i === brokenAt ? 'is-broken' : '',
          store.overrides.has(i) ? 'is-tampered' : '',
        ].filter(Boolean).join(' ');
        links.push(`<li${cls ? ` class="${cls}"` : ''}></li>`);
      }
      cursor = to;
    }
    const start = ranges[0][0];

    let iconName = 'link';
    let title;
    let text;
    let cls = 'proof-summary';
    if (!n) {
      title = 'Journal vide';
      text = "Chaque événement sera relié au précédent par son empreinte : modifier l'un d'eux rompt la chaîne.";
    } else if (v.state === 'valid') {
      const added = n - v.checked;
      title = `${plural(n, 'événement')} reliés · chaîne vérifiée`;
      text = `Vérifiée à ${fmt.time(v.at)} : aucun événement n'a été modifié.${added > 0 ? ` ${plural(added, 'événement')} ajouté${added > 1 ? 's' : ''} depuis.` : ''}`;
    } else if (v.state === 'broken') {
      iconName = 'linkBroken';
      cls += ' is-broken';
      title = `Falsification détectée à l'événement n° ${v.broken_at + 1}`;
      text = v.reason === 'hash'
        ? 'Son contenu ne correspond plus à son empreinte : la preuve désigne précisément la ligne altérée.'
        : 'Le chaînage avec l’événement précédent est rompu : la preuve désigne précisément la ligne altérée.';
    } else {
      title = `${plural(n, 'événement')} reliés`;
      text = "Chaque événement contient l'empreinte du précédent. Vérification en attente.";
    }
    const times = n
      ? `<p class="proof-times" aria-hidden="true"><span>${esc(fmt.time(store.events[start].timestamp))}</span><span>${esc(fmt.time(store.events[n - 1].timestamp))}</span></p>`
      : '';
    setHTML(
      $('proof-strip'),
      `<div class="${cls}">${icon(iconName)}<div><strong>${esc(title)}</strong><p>${esc(text)}</p></div></div>
      <div class="section-tools">
        <button type="button" class="btn btn-sm" data-cmd="verify" ${n ? '' : 'disabled'}>${icon('link')}Vérifier maintenant</button>
        <button type="button" class="btn btn-sm btn-ghost" data-cmd="open-audit">${icon('listChecks')}Voir le journal</button>
      </div>
      ${n ? `<div class="proof-line">
        <ol class="proof-links" aria-hidden="true">${links.join('')}</ol>
        ${times}
        <p class="proof-key" aria-hidden="true"><span><i class="k-tx"></i>Événements du dossier affiché</span><span><i></i>Autres événements</span><span><i class="k-broken"></i>Événement altéré</span></p>
      </div>` : ''}`,
    );
  }

  /** Dossier, décision, chaîne et preuve : tout ce qui dépend de la transaction suivie. */
  function renderPipeline() {
    const corr = currentCorr();
    const tx = corr ? store.txs.get(corr) : null;
    renderDossier(tx);
    renderDecision(tx);
    renderChain(tx);
    renderProof(tx);
    setHTML(
      $('pipeline-tx'),
      tx && ui.pinned
        ? `<span class="muted">Dossier consulté</span><button type="button" class="btn btn-sm btn-ghost" data-cmd="follow-live">${icon('replay')}Suivre en direct</button>`
        : '',
    );
  }

  // ------------------------------------------------------------------ récit des décisions

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
    else if (e.status !== 'ok' && W.STATUS[e.status]) chips.push(badge(e.status));
    for (const rule of ctx.triggered_rules || []) chips.push(`<span class="rule-ref" title="${esc(fmt.rule(rule))}">${esc(rule)}</span>`);

    const action =
      e.action === 'hitl.requested' && store.pending && store.pending.corr === e.correlation_id && !ui.replay
        ? `<p class="msg-action"><button type="button" class="btn btn-sm btn-primary" data-cmd="open-phone">${icon('phone')}Ouvrir la validation du gérant</button></p>`
        : '';
    const fresh = idx >= ui.animateFrom ? ' is-new' : '';
    return `
      <li class="msg${severity ? ` is-${severity}` : ''}${fresh}">
        <span class="avatar avatar--${actor.kind}">${icon(actorIcon(e.agent_id))}</span>
        <div class="msg-body">
          <p class="msg-meta"><strong>${esc(actor.name)}</strong><span class="tag tag--${actor.kind}">${esc(C.KIND_LABELS[actor.kind])}</span><time datetime="${esc(e.timestamp)}">${esc(fmt.time(e.timestamp))}</time><span class="line">${esc(W.action(e.action))} · n° ${idx + 1}</span></p>
          <p class="msg-text">${esc(e.reasoning)}</p>
          <p class="msg-chips">${chips.join('')}</p>
          ${action}
        </div>
      </li>`;
  }

  function microHtml(idx) {
    const e = store.events[idx];
    return `<li><span class="mono">n° ${idx + 1}</span><span>${esc(fmt.actor(e.agent_id))}</span><span>${esc(e.reasoning)}</span></li>`;
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
      <button type="button" class="btn btn-sm btn-ghost" data-cmd="pin" data-corr="${esc(tx.corr)}" aria-label="Afficher le dossier ${esc(tx.corr)}">${icon('folder')}Dossier</button>
      <button type="button" class="btn btn-sm btn-ghost" data-cmd="xai" data-corr="${esc(tx.corr)}" aria-label="Fiche de décision de ${esc(tx.corr)}">${icon('file')}Fiche</button>
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
          <summary>${icon('chevron')}${plural(block.detail.length, 'vérification')} technique${block.detail.length > 1 ? 's' : ''} de FinGuard (détail)</summary>
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
    if (pending) return badge('pending', 'En attente du gérant');
    if (run.scenario === 'MANUEL') {
      const tx = store.txs.get(run.txIds[run.txIds.length - 1]);
      return tx && tx.final ? '' : badge('running');
    }
    return badge('running');
  }

  function runHtml(run) {
    const prefix = `${run.scenario} · `;
    const rawTitle = run.title.startsWith(prefix) ? run.title.slice(prefix.length) : run.title;
    const title = (run.scenario && caseTitle(run.scenario)) || (run.scenario === 'MANUEL' ? 'Opération composée par le gérant' : rawTitle);
    const lead = run.scenario
      ? `<span class="case-id">${esc(run.scenario === 'MANUEL' ? 'OBJ' : run.scenario)}</span>`
      : `<span class="avatar avatar--human">${icon('user')}</span>`;
    const blocks = buildBlocks(run);
    const body = blocks.map((b) => (b.type === 'tx' ? txHtml(b, run) : `<ol class="msgs">${msgHtml(b.idx)}</ol>`)).join('');
    const c = run.completed;
    const outcome = c
      ? `<p class="run-outcome ${c.matched ? 'is-ok' : 'is-ko'}">${icon(c.matched ? 'checkCircle' : 'alert')}<span><strong>${c.matched ? "Conforme à l'attendu." : "Écart avec l'attendu."}</strong> Attendu : ${esc(String(c.expected).toLowerCase())}. Obtenu : ${esc(c.obtained)}.</span></p>`
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
          <p>Lancez le cas S1 : le récit montre qui a proposé, qui a contrôlé, qui a décidé et pourquoi.<br>
          Les vérifications techniques restent repliées ; seules les décisions et les alertes s'affichent.</p>
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

  // ------------------------------------------------------------------ agents, limites, superviseur

  function renderAgents() {
    const html = C.AGENTS.map((a) => {
      const st = store.agents[a.id];
      const reduced = st.trust < C.LIMITS.trustReduced;
      const low = st.trust < C.LIMITS.trustQuarantine;
      const chip = st.quarantined
        ? badge('quarantined')
        : reduced
          ? `<span class="status status--human">${icon('arrowDownRight')}<span>Plafond ÷ 2</span></span>`
          : `<span class="status status--neutral">${icon('check')}<span>Actif</span></span>`;
      const forbidden = `${a.forbidden.charAt(0).toLowerCase()}${a.forbidden.slice(1)}`;
      const limits = a.max_amount
        ? `Plafond ${fmt.eur(reduced ? a.max_amount / 2 : a.max_amount)} · interdit : ${forbidden}.`
        : `Interdit : ${forbidden}.`;
      const valueText = `${st.trust} sur 100${st.quarantined ? ', en quarantaine' : reduced ? ', plafond divisé par deux' : ''}`;
      return `
        <li class="agent${st.quarantined ? ' is-quarantined' : ''}">
          <div class="agent-head">
            <span class="avatar avatar--agent">${icon(actorIcon(a.id))}</span>
            <div><span class="agent-name">${esc(a.name)}</span><span class="agent-role">${esc(AGENT_ROLES[a.id] || a.mission)}</span></div>
            ${chip}
          </div>
          <div class="trust">
            <div class="trust-track" role="meter" aria-label="Score de confiance ${esc(a.name)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${st.trust}" aria-valuetext="${esc(valueText)}">
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
    const flag = ratio >= 1 ? ' · limite atteinte' : ratio >= 0.8 ? ' · proche de la limite' : '';
    return `
      <div class="meter">
        <div class="meter-head"><span>${esc(label)}</span><span class="mono">${esc(text)}</span></div>
        <div class="meter-track" role="meter" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="${max}" aria-valuenow="${value}" aria-valuetext="${esc(text + flag)}">
          <div class="meter-fill${cls}" style="width:${(ratio * 100).toFixed(1)}%"></div>
        </div>
        ${note || flag ? `<p class="meter-note">${esc((flag ? flag.slice(3).replace(/^./, (c) => c.toUpperCase()) + '. ' : '') + (note || ''))}</p>` : ''}
      </div>`;
  }

  function renderRisk() {
    const r = store.risk;
    const open = r.breaker === 'open';
    const human = `Hors opérations signées par le gérant (${fmt.eur(r.humanApproved)} validés aujourd'hui).`;
    const html = [
      meterHtml('Budget autonome du Proposer', r.daily, r.dailyLimit, `${fmt.eur(r.daily)} / ${fmt.eur(r.dailyLimit)}`, human),
      meterHtml('Ordres sur 60 secondes', r.freq, r.freqLimit, `${r.freq} / ${r.freqLimit}`, r.lastCheck ? `Dernier contrôle à ${fmt.time(r.lastCheck)}.` : 'Aucun contrôle pour l’instant.'),
      meterHtml('Refus consécutifs', r.rejects, r.rejectLimit, `${r.rejects} / ${r.rejectLimit}`, 'Au-delà : le coupe-circuit s’ouvre.'),
      `<div><div class="state-line${open ? ' is-open' : ''}"><strong>Coupe-circuit</strong>${open ? badge('open', 'Ouvert') : badge('closed', 'Fermé')}</div>
      ${open ? `<button type="button" class="btn btn-sm btn-block" data-cmd="reset-breaker">${icon('reset')}Réarmer (superviseur humain)</button>` : ''}
      <div class="state-line${store.kill.global ? ' is-open' : ''}"><strong>Arrêt d'urgence</strong>${store.kill.global ? badge('engaged', 'Actif') : `<span class="status status--neutral">${icon('power')}<span>Inactif</span></span>`}</div></div>`,
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
              <p class="alert-title">${esc(a.title)} <span class="sr-only">(${a.severity === 'critical' ? 'critique' : 'vigilance'})</span></p>
              <p class="alert-text">${esc(a.text)}</p>
              <p class="alert-meta"><time datetime="${esc(a.at)}">${esc(fmt.time(a.at))}</time>${a.corr ? `<button type="button" class="btn-link" data-cmd="goto-tx" data-corr="${esc(a.corr)}">Voir le dossier ${esc(a.corr)}</button>` : ''}</p>
            </div>
          </li>`,
          )
          .join('') + (store.alerts.length > list.length ? `<li class="alerts-empty">${store.alerts.length - list.length} alerte(s) plus ancienne(s) dans le journal.</li>` : '')
      : `<li class="alerts-empty">Aucune alerte. Le superviseur lit le journal en continu ; il peut demander l'isolement d'un agent, jamais décider ni exécuter.</li>`;
    setHTML($('alerts'), html);
  }

  // ------------------------------------------------------------------ journal de preuve

  function renderAudit() {
    $('audit-count').textContent = store.events.length;
    const v = store.verification;
    const statusEl = $('audit-status');
    let statusHtml = `${icon('info')}<span>Chaîne non vérifiée. Chaque événement porte l'empreinte du précédent (prev_hash) et la sienne (hash) : lancez la vérification.</span>`;
    let statusCls = 'audit-status';
    if (v.state === 'valid') {
      const added = store.events.length - v.checked;
      statusCls += ' is-valid';
      statusHtml = `${icon('link')}<span>verify_chain() : ${plural(v.checked, 'événement')} recalculé${v.checked > 1 ? 's' : ''}, aucun n'a été modifié. Dernière empreinte <span class="mono">${esc(fmt.shortHash(v.last_hash))}</span>${added > 0 ? ` · ${plural(added, 'événement')} ajouté${added > 1 ? 's' : ''} depuis` : ''}.</span>`;
    } else if (v.state === 'broken') {
      statusCls += ' is-broken';
      const why = v.reason === 'hash' ? 'son contenu ne correspond plus à son empreinte' : 'le chaînage avec l’événement précédent est rompu';
      statusHtml = `${icon('linkBroken')}<span>verify_chain() en échec à l'événement n° ${v.broken_at + 1} : ${why}. Empreinte enregistrée <span class="mono">${esc(fmt.shortHash(v.expected))}</span>, recalculée <span class="mono">${esc(fmt.shortHash(v.found))}</span>.</span>`;
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
          <td><button type="button" class="row-btn" data-cmd="audit-line" data-line="${i}" aria-label="Afficher l'événement ${i + 1} tel qu'enregistré">${i + 1}</button></td>
          <td>${esc(fmt.time(e.timestamp))}</td>
          <td class="mono">${esc(e.correlation_id)}</td>
          <td class="wrap">${esc(fmt.actor(e.agent_id))}</td>
          <td class="wrap"><span class="step-label">${esc(W.action(e.action))}</span><span class="action">${esc(e.action)}</span></td>
          <td>${e.status === 'ok' ? '<span class="muted">conforme</span>' : badge(e.status)}</td>
          <td class="reason">${esc(e.reasoning)}${tampered ? ` <span class="tamper-note">${icon('alert')}modifié hors système</span>` : ''}</td>
          <td class="mono hash"><span class="hash-prev" title="Empreinte de l'événement précédent">${esc(e.prev_hash.slice(0, 8))} →</span>${esc(e.hash.slice(0, 8))}</td>
        </tr>`);
    }
    setHTML($('audit-body'), rows.join('') || '<tr><td colspan="8" class="muted">Journal vide.</td></tr>');

    $('tamper-btn').disabled = !store.events.length || Boolean(store.tampered) || transport.mode === 'live' || Boolean(ui.replay);
    $('restore-btn').hidden = !store.tampered || transport.mode === 'live';
    $('replay-btn').disabled = !store.events.length || Boolean(ui.running) || Boolean(ui.replay);

    const jsonText =
      ui.selectedLine !== null && store.events[ui.selectedLine]
        ? `Événement n° ${ui.selectedLine + 1}, tel qu'enregistré dans audit.jsonl :\n${JSON.stringify(store.journalLine(ui.selectedLine), null, 2)}`
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

  async function verifyAndAnnounce() {
    await verifyNow();
    const v = store.verification;
    announce(v.state === 'valid' ? `Chaîne intègre : ${v.checked} événements.` : v.state === 'broken' ? `Chaîne rompue à l'événement ${v.broken_at + 1}.` : 'Vérification impossible.');
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
    announce(`Relecture de ${events.length} événements du journal.`);
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
    announce('Relecture terminée.');
    verifyNow();
    renderAll();
  }

  function exportJournal() {
    const lines = store.events.map((_, i) => JSON.stringify(store.journalLine(i))).join('\n');
    download('audit.jsonl', lines ? `${lines}\n` : '', 'application/x-ndjson');
  }

  // ------------------------------------------------------------------ fiche de décision

  function xaiHtml(record) {
    const statusMap = {
      filled: ['filled', 'Exécutée'], blocked: ['blocked', 'Bloquée'], pending: ['pending', 'En attente du gérant'], running: ['running', 'En cours'],
    };
    const [statusKey, statusLabel] = statusMap[record.status] || ['neutral', record.status];
    const path = record.path
      .map((p) => `<li class="xai-step is-${esc(p.state)}">${esc(p.label)}${p.sub ? ` · ${esc(p.sub)}` : ''}<span class="sr-only"> (${esc(STATE_TEXT[p.state])})</span></li>`)
      .join('');
    const factors = record.factors.length
      ? record.factors
          .map(
            (f) => `
            <li class="factor factor--${esc(f.effect)}">
              <p class="factor-head"><strong>${esc(f.actor)}</strong>${f.status !== 'ok' && W.STATUS[f.status] ? badge(f.status) : ''}<span class="mono muted">n° ${f.line} · ${esc(fmt.shortHash(f.hash))}</span></p>
              <p>${esc(f.text)}</p>
            </li>`,
          )
          .join('')
      : '<li class="muted">Aucun facteur journalisé pour l\'instant.</li>';
    const votes = record.votes.length
      ? `<div class="xai-table-wrap"><table class="xai-table"><thead><tr><th scope="col">Contrôle</th><th scope="col">Vote</th><th scope="col">Confiance</th><th scope="col">Règles</th><th scope="col">Justification</th></tr></thead><tbody>${record.votes
          .map(
            (v) => `<tr><td>${esc(fmt.actor(v.judge_id))}</td><td>${badge(v.vote)}</td><td class="mono">${typeof v.confidence === 'number' ? esc(fmt.dec(v.confidence)) : '—'}</td><td>${(v.rule_ids || []).map((r) => `<span class="rule-ref">${esc(r)}</span>`).join(' ') || '—'}</td><td>${esc(v.justification)}</td></tr>`,
          )
          .join('')}</tbody></table></div>`
      : '<p class="muted">Aucun vote : la transaction a été arrêtée avant les contrôles.</p>';
    const rules = record.rules.map((r) => `<li><span class="rule-ref">${esc(r.id)}</span><span>${esc(r.label)}</span></li>`).join('') || '<li class="muted">Aucune règle déclenchée.</li>';
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
      <section class="xai-section"><h3>Chemin suivi</h3><ol class="xai-path">${path}</ol></section>
      <section class="xai-section"><h3>Facteurs, dans l'ordre du journal</h3><ol class="factors">${factors}</ol></section>
      <section class="xai-section"><h3>Votes des contrôles</h3>${votes}</section>
      <section class="xai-section"><h3>Règles appliquées · ${esc(record.policy_version)}</h3><ul class="rules-list">${rules}</ul></section>
      <section class="xai-section"><h3>Incertitudes</h3><ul class="plain-list">${unc}</ul></section>
      <section class="xai-section"><h3>Preuves</h3><dl class="proofs">${proofs}</dl></section>
      ${redactions}
      <p class="xai-note">Fiche construite uniquement à partir des événements journalisés de ${esc(record.correlation_id)} (AI Act art. 12 · journalisation). Elle décrit les règles, votes et décisions enregistrés ; elle ne reconstitue pas un raisonnement interne de modèle. La chaîne d'empreintes rend toute altération détectable ; elle ne la rend pas impossible.</p>`;
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
      `<div class="phone-idle">${icon('phone')}<p><strong>Aucune décision en attente.</strong></p><p>La demande apparaît dès qu'une opération est escaladée : montant au-delà du seuil, veto ou abstention d'un contrôle.</p></div>`,
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
      renderHeader();
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
        renderHeader();
        verifyNow();
      }
    });
  }

  function applyPreset(key) {
    const preset = PRESETS.find((p) => p.key === key);
    if (!preset) return;
    const composer = $('composer');
    composer.open = true;
    $('obj-asset').value = preset.spec.asset;
    $('obj-side').value = preset.spec.side;
    $('obj-amount').value = String(preset.spec.amount);
    $('obj-cpty').value = preset.spec.counterparty;
    $('obj-amount-error').textContent = '';
    $('obj-amount').setAttribute('aria-invalid', 'false');
    scrollIntoViewSoft(composer, 'start');
    $('obj-submit').focus({ preventScroll: true });
    announce(`Formulaire pré-rempli : ${preset.title}. Validez avec « Confier au Proposer ».`);
  }

  const READ_ONLY_COMMANDS = new Set(['stop-replay', 'xai', 'pin', 'follow-live', 'goto-tx', 'audit-line', 'open-audit']);

  const commands = {
    'run-scenario': ({ key }) => runScenario(key),
    preset: ({ key }) => applyPreset(key),
    'lift-quarantine': async ({ agent }) => {
      const ok = await confirmAction({
        title: `Lever la quarantaine du ${fmt.actor(agent)} ?`,
        text: "L'agent pourra de nouveau proposer des ordres, avec son score de confiance actuel. L'action est journalisée au nom du superviseur humain.",
        ok: 'Lever la quarantaine',
      });
      if (ok) {
        ui.issues.salami = null;
        await guard(transport.liftQuarantine(agent));
      }
    },
    'reset-breaker': async () => {
      const ok = await confirmAction({
        title: 'Réarmer le coupe-circuit ?',
        text: "Les compteurs de fréquence et de refus repartent de zéro. L'action est journalisée au nom du superviseur humain.",
        ok: 'Réarmer',
      });
      if (ok) {
        ui.issues.salami = null;
        await guard(transport.resetBreaker());
      }
    },
    'engage-kill': async () => {
      const ok = await confirmAction({
        title: "Déclencher l'arrêt d'urgence ?",
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
    verify: () => verifyAndAnnounce(),
    'open-audit': () => {
      switchTab('audit');
      $('tab-audit').focus();
    },
    xai: ({ corr }) => openXai(corr),
    pin: ({ corr }) => {
      ui.pinned = corr;
      renderPipeline();
      updateFocusClass();
      scrollIntoViewSoft($('center'), 'start');
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
      announce(`Événement ${ui.selectedLine + 1} affiché sous le tableau, tel qu'enregistré.`);
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
      scrollIntoViewSoft($('proof-title'), 'start');
      $('tab-audit').focus({ preventScroll: true });
    });
    $('verify-btn').addEventListener('click', verifyAndAnnounce);
    $('replay-btn').addEventListener('click', startReplay);
    $('export-btn').addEventListener('click', exportJournal);
    $('tamper-btn').addEventListener('click', async () => {
      const info = await guard(transport.tamper());
      if (info && typeof info.index === 'number') {
        ui.selectedLine = info.index;
        announce(`Événement ${info.index + 1} modifié hors du système. Lancez la vérification.`);
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
        text: 'Le journal local, les scores de confiance et les compteurs reviennent à leur état initial. Rien ne quitte le navigateur.',
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
    if (state === 'broken') announce(`Chaîne de preuve altérée à l'événement ${store.verification.broken_at + 1}.`);
    else if (state === 'valid' && previous === 'broken') announce('Chaîne de preuve de nouveau intègre.');
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
  if (transport.mode === 'live') {
    $('demo-hint').textContent = 'API FastAPI';
    $('reset-btn').hidden = true;
  }
  autoRun();
})();

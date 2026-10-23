/*
 * ManAgent — vue « mode jury » : le parcours d'une opération, de la proposition à la preuve.
 * Ce n'est qu'une autre représentation du même état que la salle de contrôle : Store dérivé des AuditEvent,
 * actions via le même transport (simulation locale ou API). Aucune règle de gouvernance n'est évaluée ici ;
 * cette couche choisit seulement les libellés métier et ce qui est montré au premier regard.
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
    replay: null,
    selected: null,
    pinned: false,
    txCorr: null,
    drawer: null,
    drawerReturn: null,
    card: null,
    cardCorr: null,
    cardClosed: true,
    phoneTimer: null,
    channel: null,
    issues: [],
    error: null,
    errorTimer: null,
    verifyTimer: null,
    lastVerdict: null,
    lastAudit: null,
    nodeEls: {},
    stepEls: {},
  };

  // ------------------------------------------------------------------ référentiel de la vue

  // Huit étapes métier ; chacune regroupe un ou plusieurs nœuds techniques du graphe FinGuard (visibles dans les détails).
  const STEPS = [
    {
      id: 'proposal', name: 'Proposition', nav: 'Proposition', icon: 'file',
      role: "Opération préparée par l'agent",
      purpose: "Un agent IA prépare l'opération. Il n'a aucun accès au marché ; un document externe reste une donnée, jamais un ordre.",
      tech: [
        { id: 'finguard.firewall', label: "Point d'entrée", role: 'Encapsule les contenus externes et signale les consignes suspectes.' },
        { id: 'proposer', label: 'Proposition', role: "Agent IA qui traduit l'objectif en opération, sans outil d'exécution ni de paiement." },
      ],
      agents: ['proposer'],
    },
    {
      id: 'mandate', name: 'Règles du mandat', nav: 'Règles du mandat', icon: 'listChecks',
      role: 'Actif, montant et contrepartie vérifiés',
      purpose: "Des règles fixes, sans IA, vérifient l'univers d'investissement, la contrepartie, l'outil demandé et le seuil d'autonomie.",
      tech: [{ id: 'finguard.policy', label: 'Règles du mandat', role: 'Moteur de règles déterministe et versionné : autoriser, escalader ou bloquer.' }],
    },
    {
      id: 'risk', name: 'Risque', nav: 'Analyse du risque', icon: 'gauge',
      role: "Exposition et seuil d'autonomie évalués",
      purpose: "Un contrôle indépendant de l'agent évalue l'exposition du fonds : concentration sectorielle, émetteur, position disponible.",
      tech: [{ id: 'risk_judge', label: 'Analyse du risque', role: "Agent juge : vote sur les expositions, sans pouvoir modifier l'opération." }],
      agents: ['risk_judge'],
    },
    {
      id: 'compliance', name: 'Conformité', nav: 'Contrôle conformité', icon: 'scale',
      role: 'Règles internes et restrictions contrôlées',
      purpose: "Un second contrôle, distinct du premier, vérifie la contrepartie (KYC), l'univers du mandat et les sources citées.",
      tech: [{ id: 'compliance_judge', label: 'Contrôle conformité', role: "Agent juge : vote sur KYC et univers, sans pouvoir modifier l'opération." }],
      agents: ['compliance_judge'],
    },
    {
      id: 'decision', name: 'Décision', nav: 'Décision', icon: 'gate',
      role: 'Autoriser, escalader ou bloquer',
      purpose: "Les avis sont consolidés selon une règle fixée d'avance : au-delà de 1 000 €, les deux contrôles doivent être favorables.",
      tech: [{ id: 'finguard.quorum', label: 'Décision consolidée', role: 'Quorum : unanimité au-delà de 1 000 €, majorité pondérée en dessous.' }],
    },
    {
      id: 'human', name: 'Validation humaine', nav: 'Validation humaine', icon: 'user',
      role: "Décision du gérant si le seuil l'exige",
      purpose: "Au-delà du seuil ou en cas de désaccord, le traitement s'arrête : le gérant décide et signe l'opération exacte.",
      tech: [
        { id: 'finguard.hitl', label: 'Validation humaine', role: "Suspend le traitement jusqu'à une décision signée du gérant." },
        { id: 'human:gerant-alpha', label: 'Gérant', role: 'Approuve ou refuse ; la décision est signée (HMAC) et journalisée.' },
      ],
    },
    {
      id: 'execution', name: 'Exécution', nav: 'Exécution', icon: 'send',
      role: 'Ordre transmis uniquement après contrôle',
      purpose: "L'ordre ne part qu'avec une autorisation valide ; s'il diffère de ce qui a été validé, il est bloqué avant le marché.",
      tech: [
        { id: 'finguard.authorizations', label: 'Autorisation', role: "Autorisation à durée limitée, liée à l'empreinte de l'opération." },
        { id: 'executor', label: 'Exécution', role: "Agent qui prépare l'ordre autorisé, sans pouvoir de décision." },
        { id: 'finguard.integrity', label: "Contrôle d'intégrité", role: "Vérifie que l'ordre envoyé est identique à l'opération autorisée." },
        { id: 'finguard.risk_governor', label: 'Surveillance', role: "Limites du jour, coupe-circuit et arrêt d'urgence." },
        { id: 'finguard.gateway', label: 'Marché simulé', role: 'Seul point de passage vers le marché (simulé dans la démo).' },
      ],
      agents: ['executor'],
    },
    {
      id: 'proof', name: 'Preuve', nav: 'Preuve', icon: 'link',
      role: 'Décision et justification enregistrées',
      purpose: "Chaque étape est inscrite dans un journal chaîné par empreintes : toute modification ultérieure devient détectable.",
      tech: [
        { id: 'finguard.audit', label: 'Preuve', role: 'Journal chaîné par empreintes SHA-256, vérifiable à tout moment.' },
        { id: 'finguard.integrity', label: 'Preuve', role: "Empreintes de l'opération autorisée et de l'ordre transmis." },
      ],
    },
  ];
  const STEP = Object.fromEntries(STEPS.map((s) => [s.id, s]));

  // Liens du parcours ; le tracé est calculé à partir de la position réelle des nœuds (bureau ou mobile).
  const EDGES = [
    ['proposal', 'mandate'], ['mandate', 'risk'], ['mandate', 'compliance'], ['risk', 'decision'],
    ['compliance', 'decision'], ['decision', 'human'], ['human', 'execution'], ['execution', 'proof'],
  ];

  const STATE_ICON = {
    idle: 'circleDashed', active: 'progress', pass: 'check', escalate: 'user', warn: 'alert', block: 'lock', skipped: 'minusCircle',
  };
  const STATE_TONE = { idle: 'idle', active: 'active', pass: 'ok', escalate: 'human', warn: 'human', block: 'block', skipped: 'idle' };
  const STATE_SHORT = {
    idle: 'En attente', active: 'En cours', pass: 'Validé', escalate: 'Attention', warn: 'Attention', block: 'Bloqué', skipped: 'Non requise',
  };

  const RISK_WHY = {
    'RJ-SECT': 'Concentration sectorielle trop forte.',
    'RJ-ISSU': 'Exposition par émetteur au-delà de 5 %.',
    'RJ-POS': 'Position insuffisante pour vendre.',
    'CJ-UNIV': 'Actif hors du périmètre du mandat.',
  };
  const COMPLIANCE_WHY = {
    'CJ-KYC': 'Contrepartie hors liste KYC.',
    'CJ-UNIV': "Actif hors de l'univers du mandat.",
    'CJ-SRC': 'Source signalée : un humain doit trancher.',
  };
  // Formulations neutres dans le temps : la carte reste juste après le réarmement de l'arrêt d'urgence.
  const GOVERNOR_WHY = {
    'RSK-001': 'Budget autonome du jour dépassé : ordre non exécuté.',
    'RSK-002': "Trop d'ordres en une minute : ordre non exécuté.",
    'RSK-003': 'Trop de refus consécutifs : ordre non exécuté.',
    'RSK-004': "Bloqué par l'arrêt d'urgence : ordre non exécuté.",
    'RSK-005': 'Bloqué par le coupe-circuit : ordre non exécuté.',
  };
  const GOVERNOR_REASON = {
    'RSK-001': 'Le budget autonome du jour aurait été dépassé.',
    'RSK-002': "Trop d'ordres en moins d'une minute : le coupe-circuit s'est ouvert.",
    'RSK-003': 'Trop de refus consécutifs.',
    'RSK-004': "L'arrêt d'urgence était actif au moment de l'ordre.",
    'RSK-005': "Le coupe-circuit était ouvert au moment de l'ordre.",
  };
  const EXEC_NODES = ['authorize', 'executor', 'integrity', 'governor', 'gateway', 'market'];
  const EXEC_ACTIVE = {
    authorize: "Émission de l'autorisation.",
    executor: "Préparation de l'ordre.",
    integrity: "Vérification de l'intégrité de l'ordre.",
    governor: 'Contrôle des limites du jour.',
    gateway: 'Transmission au marché simulé.',
    market: 'Exécution au marché simulé.',
  };
  const JUDGE_SUBJECT = { risk_judge: 'Le contrôle risque', compliance_judge: 'Le contrôle conformité' };

  // Rattachement des événements d'audit aux étapes (les autres suivent l'étape qui les précède).
  const ACTION_STEP = {
    'firewall.scanned': 'proposal', 'intent.proposed': 'proposal', 'policy.evaluated': 'mandate', 'quorum.decided': 'decision',
    'hitl.requested': 'human', 'hitl.report_requested': 'human', 'hitl.decided': 'human', 'authorization.created': 'execution',
    'authorization.revoked': 'execution', 'order.prepared': 'execution', 'integrity.checked': 'execution', 'risk.checked': 'execution',
    'execution.filled': 'execution', 'breaker.opened': 'execution',
  };
  const BLOCK_STEP = { policy: 'mandate', hitl: 'human', integrity: 'execution', governor: 'execution' };

  // Scénarios : les six cas existants, plus deux variantes saisies comme le ferait le gérant.
  const MENU = [
    { kind: 'scenario', key: 'nominal', icon: 'checkCircle', title: 'Opération simple autorisée', text: "4 000 € d'OAT 10 ans, sous le seuil d'autonomie" },
    { kind: 'preset', key: 'amount', icon: 'user', title: 'Montant élevé', text: "25 000 € d'OAT 30 ans : validation humaine", sentence: "Acheter 25 000 € d'OAT 30 ans auprès de Banque Horizon BFI" },
    { kind: 'preset', key: 'cpty', icon: 'building', title: 'Contrepartie non autorisée', text: "5 000 € d'OAT auprès de Kappa Offshore", sentence: "Acheter 5 000 € d'OAT 10 ans auprès de Kappa Offshore Ltd" },
    { kind: 'scenario', key: 'veto_hitl', icon: 'scale', title: 'Désaccord risque / conformité', text: "85 000 € d'actions EuroTech : veto du risque" },
    { kind: 'scenario', key: 'tampering', icon: 'edit', title: 'Ordre modifié après accord', text: "L'ordre envoyé diffère de l'autorisation" },
    { kind: 'scenario', key: 'injection', icon: 'file', title: 'Document piégé', text: 'Une note externe exige un virement' },
    { kind: 'scenario', key: 'salami', icon: 'split', title: 'Ordres fractionnés', text: '12 ordres de 900 € pour passer sous les seuils' },
    { kind: 'scenario', key: 'audit_tamper', icon: 'linkBroken', title: 'Journal falsifié', text: 'Une ligne du journal est réécrite' },
  ];

  // Interprétation déterministe d'une phrase vers l'objectif du gérant (même contrat que le formulaire de la salle de contrôle).
  const ASSET_WORDS = [
    [/oat\s*30|30\s*ans/, 'OAT-30A'], [/\boat\b|obligation|souverain/, 'OAT-10A'], [/eurotech/, 'EUROTECH'], [/voltea/, 'VOLTEA'],
    [/medicis/, 'MEDICIS'], [/monetaire|money market/, 'MONE-EUR'], [/bitcoin|\bbtc\b|crypto/, 'BTC-SYN'], [/future|stoxx|derive/, 'FUT-ESX'],
  ];
  const CPTY_WORDS = [
    [/kappa|offshore/, 'Kappa Offshore Ltd'], [/apex/, 'Apex Capital Partners'], [/nexus/, 'Nexus Trading Ltd'], [/horizon/, 'Banque Horizon BFI'],
  ];
  const DEFAULT_CPTY = 'Banque Horizon BFI';

  // ------------------------------------------------------------------ utilitaires

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
    ui.error = message;
    announce(message);
    renderNotices();
    window.clearTimeout(ui.errorTimer);
    ui.errorTimer = window.setTimeout(() => {
      ui.error = null;
      renderNotices();
    }, 9000);
  }

  function guard(promise) {
    return Promise.resolve(promise).catch((err) => notify(err.message || String(err)));
  }

  /** Remplace le contenu d'un conteneur en rendant le focus au même bouton s'il y était. */
  function setHTML(el, html) {
    if (el.__html === html) return;
    const active = document.activeElement;
    let key = null;
    if (active && el.contains(active) && active.dataset && active.dataset.cmd) {
      key = `[data-cmd="${CSS.escape(active.dataset.cmd)}"]${active.dataset.key ? `[data-key="${CSS.escape(active.dataset.key)}"]` : ''}`;
    }
    el.innerHTML = html;
    el.__html = html;
    if (key) {
      const target = el.querySelector(key);
      if (target && !target.disabled) target.focus({ preventScroll: true });
    }
  }

  function hydrateIcons(rootEl) {
    (rootEl || document).querySelectorAll('[data-icon]').forEach((el) => {
      if (!el.firstElementChild) el.innerHTML = icon(el.dataset.icon);
    });
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
    okBtn.className = `jv-btn ${danger ? 'jv-btn--danger' : 'jv-btn--primary'}`;
    dialog.returnValue = '';
    dialog.showModal();
    // Action destructrice : le focus va sur « Annuler » pour qu'un Entrée réflexe ne fasse rien.
    (danger ? dialog.querySelector('button[value="cancel"]') : okBtn).focus();
    return new Promise((resolve) => {
      dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'), { once: true });
    });
  }

  function statusHtml(tone, ic, label) {
    return `<span class="jv-status tone-${tone}">${icon(ic)}<span>${esc(label)}</span></span>`;
  }

  function effectiveMax(tx) {
    return (tx.policy && typeof tx.policy.effective_max === 'number' && tx.policy.effective_max) || C.LIMITS.autonomousMax;
  }

  /** « de » élidé devant une voyelle : « d'OAT 10 ans », « d'EuroTech SA », « de Voltéa Énergie ». */
  function ofLabel(label) {
    return /^[aeiouyhAEIOUYHÉÈÊ]/.test(label || '') ? `d'${label}` : `de ${label}`;
  }

  function txWhat(tx) {
    if (!tx || !tx.intent) return '';
    return `${fmt.side(tx.intent.side)} de ${fmt.eur(tx.intent.amount)} ${ofLabel(tx.assetLabel)}`;
  }

  function currentTx() {
    const corr = store.pending ? store.pending.corr : store.lastCorr;
    return corr ? store.txs.get(corr) || null : null;
  }

  function busy() {
    return Boolean(ui.running) || Boolean(ui.replay);
  }

  // ------------------------------------------------------------------ lecture métier de l'état

  function judgeStep(tx, nodeState, judgeId, whyMap, approveText) {
    const v = tx.verdicts.find((x) => x.judge_id === judgeId);
    if (v) {
      if (v.vote === 'approve') return { state: 'pass', label: 'Favorable', why: approveText };
      const rule = (v.rule_ids || [])[0];
      return { state: 'escalate', label: v.vote === 'veto' ? 'Veto' : 'Abstention', short: 'Attention', why: whyMap[rule] || 'Un humain doit trancher.' };
    }
    if (nodeState === 'active') return { state: 'active', label: 'En cours', why: 'Vote indépendant des autres agents.' };
    if (nodeState === 'skipped') return { state: 'skipped', label: 'Non sollicité', short: 'Non sollicité', why: 'Opération arrêtée avant ce contrôle.' };
    return { state: 'idle', label: 'En attente', why: '' };
  }

  /** État métier des huit étapes, lu uniquement dans les événements journalisés de la transaction. */
  function computeSteps(tx) {
    if (!tx) {
      return Object.fromEntries(STEPS.map((s) => [s.id, { state: 'idle', label: 'En attente', why: '' }]));
    }
    const st = store.nodeStates(tx);
    const p = tx.policy;
    const q = tx.quorum;
    const f = tx.final;
    const out = {};

    // 1. Proposition (point d'entrée + agent).
    const flagged = st.firewall.state === 'warn';
    if (tx.intent) {
      out.proposal = flagged
        ? { state: 'warn', label: 'Source signalée', why: 'Document externe suspect isolé : il reste une simple donnée.' }
        : { state: 'pass', label: 'Proposée', short: 'Validé', why: `${txWhat(tx)}.` };
    } else {
      const started = ['pass', 'warn', 'active'].includes(st.firewall.state) || st.proposer.state === 'active';
      out.proposal = { state: started ? 'active' : 'idle', label: started ? 'En préparation' : 'En attente', why: started ? 'Lecture des données de marché.' : '' };
    }

    // 2. Règles du mandat.
    if (p) {
      const rules = p.triggered_rules || [];
      if (p.outcome === 'BLOCK') {
        out.mandate = { state: 'block', label: 'Hors mandat', why: W.rule(rules[0], { tool: tx.tool }) };
      } else if (p.outcome === 'ESCALATE') {
        out.mandate = { state: 'escalate', label: 'Seuil dépassé', why: `Montant au-delà du seuil d'autonomie de ${fmt.eur(effectiveMax(tx))}.` };
      } else {
        out.mandate = { state: 'pass', label: 'Dans le mandat', why: 'Opération dans le mandat autorisé.' };
      }
    } else {
      const s = st.policy.state;
      out.mandate = { state: s === 'skipped' ? 'skipped' : s === 'active' ? 'active' : 'idle', label: s === 'active' ? 'En cours' : s === 'skipped' ? 'Non atteinte' : 'En attente', why: '' };
    }

    // 3-4. Contrôles indépendants.
    out.risk = judgeStep(tx, st.judges.state, 'risk_judge', RISK_WHY, 'Exposition dans les limites du fonds.');
    out.compliance = judgeStep(tx, st.judges.state, 'compliance_judge', COMPLIANCE_WHY, 'Contrepartie KYC et univers conformes.');

    // 5. Décision consolidée.
    if (p && p.outcome === 'BLOCK') out.decision = { state: 'block', label: 'Bloquer', why: 'Une règle du mandat est enfreinte.' };
    else if (q && q.outcome === 'ESCALATE') out.decision = { state: 'escalate', label: 'Escalader au gérant', short: 'Escalade', why: 'Les contrôles ne sont pas unanimes.' };
    else if (q && p && p.outcome === 'ESCALATE') out.decision = { state: 'escalate', label: 'Escalader au gérant', short: 'Escalade', why: "Seuil d'autonomie dépassé." };
    else if (q && q.outcome === 'ALLOW') {
      out.decision = { state: 'pass', label: 'Autoriser', short: 'Autorisée', why: q.mode === 'weighted' ? 'Majorité pondérée des contrôles atteinte.' : 'Les deux contrôles sont favorables.' };
    } else {
      const s = st.quorum.state;
      out.decision = { state: s === 'skipped' ? 'skipped' : s === 'active' ? 'active' : 'idle', label: s === 'active' ? 'En cours' : s === 'skipped' ? 'Non atteinte' : 'En attente', why: '' };
    }

    // 6. Validation humaine.
    const h = st.hitl.state;
    if (tx.hitl && tx.hitl.status === 'pending') {
      out.human = { state: 'escalate', label: 'En attente du gérant', short: 'Requise', why: 'Décision du gérant requise. Traitement suspendu.' };
    } else if (tx.hitl && tx.hitl.status === 'approved') {
      out.human = { state: 'pass', label: 'Approuvée et signée', short: 'Signée', icon: 'pen', why: tx.human && tx.human.timestamp ? `Signature du gérant vérifiée à ${fmt.time(tx.human.timestamp)}.` : 'Signature du gérant vérifiée.' };
    } else if (tx.hitl && tx.hitl.status === 'rejected') {
      out.human = { state: 'block', label: 'Refusée et signée', short: 'Refusée', icon: 'pen', why: "Le gérant a refusé : l'ordre n'est pas préparé." };
    } else if (h === 'skipped') {
      const before = f && f.status === 'blocked' && f.stage === 'policy';
      out.human = before
        ? { state: 'skipped', label: 'Non atteinte', short: 'Non atteinte', why: 'Opération bloquée avant toute décision.' }
        : { state: 'skipped', label: 'Non requise', short: 'Non requise', why: "Sous le seuil d'autonomie, contrôles favorables." };
    } else {
      out.human = { state: h === 'active' ? 'active' : 'idle', label: h === 'active' ? 'En cours' : 'En attente', why: '' };
    }

    // 7. Exécution sous contrôle.
    const execStates = EXEC_NODES.map((id) => st[id].state);
    if (f && f.status === 'filled') {
      out.execution = { state: 'pass', label: 'Exécuté', short: 'Exécuté', icon: 'checkCircle', why: 'Ordre transmis au marché simulé après contrôle.' };
    } else if (f && f.stage === 'integrity') {
      out.execution = { state: 'block', label: 'Bloqué', why: "L'ordre diffère de l'autorisation : non exécuté." };
    } else if (f && f.stage === 'governor') {
      out.execution = { state: 'block', label: 'Bloqué', why: GOVERNOR_WHY[(f.rules || [])[0]] || 'Limite du jour atteinte : ordre non exécuté.' };
    } else if (f || execStates.every((s) => s === 'skipped')) {
      out.execution = { state: 'skipped', label: 'Non atteinte', short: 'Non atteinte', why: "Aucun ordre préparé : l'ordre n'a pas été exécuté." };
    } else if (execStates.some((s) => s === 'active')) {
      const node = EXEC_NODES.find((id) => st[id].state === 'active');
      out.execution = { state: 'active', label: 'En cours', why: EXEC_ACTIVE[node] || 'Sous contrôle.' };
    } else if (execStates.some((s) => s === 'pass')) {
      out.execution = { state: 'active', label: 'En cours', why: 'Sous contrôle.' };
    } else {
      out.execution = { state: 'idle', label: 'En attente', why: '' };
    }

    // 8. Preuve.
    const v = store.verification;
    const n = tx.items.length;
    const last = n ? tx.items[n - 1] : -1;
    if (v.state === 'broken' && v.broken_at <= last) {
      out.proof = { state: 'block', label: 'Journal altéré', short: 'Altéré', icon: 'linkBroken', why: `Modification détectée dans le journal (événement n° ${v.broken_at + 1}).` };
    } else if (f && v.state === 'valid' && v.checked > last) {
      out.proof = { state: 'pass', label: 'Preuve enregistrée', short: 'Enregistrée', icon: 'link', why: `Chaîne valide · ${plural(n, 'événement')} pour cette opération.` };
    } else if (f && transport.mode === 'sim') {
      out.proof = { state: 'active', label: 'Vérification', why: 'Vérification de la chaîne du journal.' };
    } else if (f) {
      out.proof = { state: 'idle', label: 'Non vérifiée', why: 'Lancez la vérification du journal.' };
    } else {
      out.proof = { state: 'idle', label: 'En attente', why: n ? `${plural(n, 'événement')} déjà enregistré${n > 1 ? 's' : ''}.` : '' };
    }
    return out;
  }

  function dissentSentence(tx) {
    const parts = tx.verdicts.map((v) => {
      const who = JUDGE_SUBJECT[v.judge_id] || fmt.actor(v.judge_id);
      if (v.vote === 'approve') return `${who.toLowerCase()} y est favorable`;
      return `${who.toLowerCase()} ${v.vote === 'veto' ? "s'y oppose" : "s'abstient"}`;
    });
    if (!parts.length) return W.rule('QRM-001');
    const text = parts.join(' ; ');
    return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
  }

  function humanReason(tx) {
    const reasons = (tx.hitl && tx.hitl.card && tx.hitl.card.reasons) || [];
    const parts = [];
    if (reasons.includes('POL-005')) parts.push(`Le montant dépasse le seuil d'autonomie de ${fmt.eur(effectiveMax(tx))}.`);
    if (reasons.includes('QRM-001') || reasons.includes('QRM-003')) parts.push(dissentSentence(tx));
    if (!parts.length) parts.push(...reasons.map((r) => W.rule(r)));
    parts.push('Validation humaine requise.');
    return parts.join(' ');
  }

  function blockReason(tx) {
    const f = tx.final;
    const rules = f.rules || [];
    if (f.stage === 'policy') return rules.slice(0, 2).map((r) => W.rule(r, { tool: tx.tool, max: fmt.eur(effectiveMax(tx)) })).join(' ');
    if (f.stage === 'hitl') return "Le gérant a refusé l'opération et signé sa décision.";
    if (f.stage === 'integrity') return "L'ordre envoyé ne correspond pas à ce qui a été autorisé.";
    if (f.stage === 'governor') return GOVERNOR_REASON[rules[0]] || W.rule(rules[0] || 'RSK-004');
    return f.reason || '';
  }

  function verdictOf(tx, data) {
    if (!tx) {
      return { key: 'none', tone: 'idle', icon: 'circleDashed', label: 'Aucune opération en cours', text: "Saisissez une opération en bas de l'écran ou choisissez un scénario." };
    }
    const f = tx.final;
    if (f && f.status === 'filled') {
      const signed = tx.human && tx.human.timestamp ? ` à ${fmt.time(tx.human.timestamp)}` : '';
      return {
        key: `${tx.corr}-filled`, tone: 'ok', icon: 'checkCircle', label: 'Opération exécutée',
        text: tx.hitl ? `Exécutée après validation signée du gérant${signed}.` : 'Opération dans le mandat autorisé. Exécutée sans intervention humaine.',
      };
    }
    if (f) return { key: `${tx.corr}-blocked`, tone: 'block', icon: 'lock', label: 'Opération bloquée', text: `${blockReason(tx)} L'ordre n'a pas été exécuté.` };
    if (tx.hitl && tx.hitl.status === 'pending') {
      return { key: `${tx.corr}-pending`, tone: 'human', icon: 'user', label: 'Validation humaine requise', text: humanReason(tx), cta: true };
    }
    const active = STEPS.find((s) => data[s.id].state === 'active');
    return {
      key: `${tx.corr}-running`, tone: 'active', icon: 'progress', label: 'Vérification en cours',
      text: active ? `Étape en cours : ${active.nav.toLowerCase()}.` : "Les contrôles examinent l'opération.",
    };
  }

  /** Étape mise en avant automatiquement : l'étape qui bloque, attend ou travaille. */
  function autoStep(tx, data) {
    if (!tx) return 'proposal';
    const block = STEPS.find((s) => data[s.id].state === 'block');
    if (block) return block.id;
    if (tx.hitl && tx.hitl.status === 'pending') return 'human';
    const active = STEPS.find((s) => data[s.id].state === 'active');
    if (active) return active.id;
    if (tx.final) return 'proof';
    return 'proposal';
  }

  function displayedStep(tx, data) {
    return ui.pinned && ui.selected ? ui.selected : autoStep(tx, data);
  }

  // ------------------------------------------------------------------ construction initiale

  function buildNodes() {
    const list = $('jv-nodes');
    list.innerHTML = STEPS.map(
      (s, i) => `
      <li class="jv-node-item" data-area="${s.id}">
        ${s.id === 'risk' ? '<p class="jv-branch-cap">Contrôles indépendants</p>' : ''}
        <button type="button" class="jv-node is-idle" data-step="${s.id}" aria-pressed="false" aria-controls="jv-explain">
          <span class="jv-node-head">
            <span class="jv-node-icon">${icon(s.icon)}</span>
            <span class="jv-node-title">${esc(s.name)}</span>
          </span>
          <span class="jv-node-text">${esc(s.role)}</span>
          <span class="jv-node-foot"><span class="jv-node-state"></span><span class="jv-node-num" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span></span>
        </button>
      </li>`,
    ).join('');
    for (const s of STEPS) {
      const btn = list.querySelector(`button[data-step="${s.id}"]`);
      ui.nodeEls[s.id] = { btn, text: btn.querySelector('.jv-node-text'), state: btn.querySelector('.jv-node-state') };
      btn.addEventListener('click', () => selectStep(s.id, { fromNode: true }));
    }
  }

  function buildSteps() {
    const list = $('jv-steps');
    list.innerHTML = STEPS.map(
      (s) => `
      <li class="jv-step is-idle" data-step="${s.id}">
        <button type="button" class="jv-step-btn" data-step="${s.id}" aria-pressed="false">
          <span class="jv-step-marker">${icon(s.icon)}</span>
          <span class="jv-step-text"><span class="jv-step-name">${esc(s.nav)}</span><span class="jv-step-state"></span></span>
        </button>
      </li>`,
    ).join('');
    for (const s of STEPS) {
      const li = list.querySelector(`li[data-step="${s.id}"]`);
      const btn = li.querySelector('button');
      ui.stepEls[s.id] = { li, btn, state: li.querySelector('.jv-step-state') };
      btn.addEventListener('click', () => selectStep(s.id, { scroll: true }));
    }
  }

  function buildMenu() {
    const live = transport.mode === 'live';
    $('jv-scen-menu').innerHTML = `
      <p class="jv-menu-title" id="jv-menu-title">Scénarios de démonstration</p>
      <ul class="jv-menu-list" aria-labelledby="jv-menu-title">
        ${MENU.map(
          (m) => `
          <li><button type="button" class="jv-menu-item" data-cmd="menu" data-key="${m.key}">
            <span class="jv-menu-icon">${icon(m.icon)}</span>
            <span class="jv-menu-text"><span class="jv-menu-name">${esc(m.title)}</span><span class="jv-menu-hint">${esc(m.text)}</span></span>
          </button></li>`,
        ).join('')}
      </ul>
      ${live ? '' : `<div class="jv-menu-foot">
        <label class="jv-check"><input type="checkbox" id="jv-fast">Animation rapide</label>
        <button type="button" class="jv-menu-reset" data-cmd="reset">${icon('reset')}Réinitialiser</button>
      </div>`}`;
  }

  // ------------------------------------------------------------------ rendu

  function render() {
    const tx = currentTx();
    if (tx && tx.corr !== ui.txCorr) {
      // Nouvelle opération : la vue revient en suivi automatique.
      ui.txCorr = tx.corr;
      ui.pinned = false;
      ui.selected = null;
    }
    if (!tx) ui.txCorr = null;
    const data = computeSteps(tx);
    const shown = displayedStep(tx, data);
    const verdict = verdictOf(tx, data);

    renderTop();
    renderNotices();
    renderCards(tx, verdict);
    renderFlow(data, shown);
    renderSide(tx, data, shown);
    renderExplain(tx, data, shown);
    renderAction();
    scheduleEdges(data);
    if (ui.drawer) renderDrawer();
    syncPending();
    announceChanges(verdict);
  }

  function renderTop() {
    const kill = $('jv-kill-btn');
    kill.dataset.cmd = store.kill.global ? 'release-kill' : 'engage-kill';
    kill.classList.toggle('is-engaged', store.kill.global);
    setHTML(kill, store.kill.global ? `${icon('power')}<span>Réarmer l'exécution</span>` : `${icon('power')}<span>Arrêt d'urgence</span>`);
    kill.disabled = Boolean(ui.replay);
    const replay = $('jv-replay-btn');
    replay.dataset.cmd = ui.replay ? 'stop-replay' : 'replay';
    setHTML(replay, ui.replay ? `${icon('pause')}<span>Arrêter la relecture</span>` : `${icon('replay')}<span>Rejouer</span>`);
    replay.disabled = !ui.replay && (Boolean(ui.running) || !store.events.length);
    $('jv-export-btn').disabled = !store.events.length;
  }

  function renderNotices() {
    const parts = [];
    const fix = (cmd, label, extra = '') => `<button type="button" class="jv-btn jv-btn--sm" data-cmd="${cmd}" ${extra}>${label}</button>`;
    if (store.kill.global) {
      parts.push(`<div class="jv-notice tone-block">${icon('power')}<p><strong>Arrêt d'urgence actif.</strong> Aucun ordre n'atteint le marché ; les contrôles et le journal continuent.</p>${ui.replay ? '' : fix('release-kill', "Réarmer l'exécution")}</div>`);
    }
    if (ui.replay) {
      parts.push(`<div class="jv-notice tone-active">${icon('replay')}<p><strong>Relecture du journal</strong> (${ui.replay.index}/${ui.replay.total}) : lecture seule, aucune décision n'est rejouée.</p>${fix('stop-replay', 'Arrêter')}</div>`);
    }
    // La validation en attente n'a pas de bandeau : la carte Décision et le nœud du parcours la portent déjà.
    for (const agent of ['proposer', 'executor']) {
      if (store.agents[agent] && store.agents[agent].quarantined && !ui.replay) {
        parts.push(`<div class="jv-notice tone-human">${icon('lock')}<p><strong>${esc(agent === 'proposer' ? "L'agent de proposition" : "L'agent d'exécution")} est isolé</strong> après un comportement anormal. Toute nouvelle opération est bloquée jusqu'à une revue humaine.</p>${fix('lift-quarantine', 'Lever la quarantaine', `data-key="${agent}"`)}</div>`);
      }
    }
    if (store.risk.breaker === 'open' && !ui.replay) {
      parts.push(`<div class="jv-notice tone-human">${icon('gauge')}<p><strong>Coupe-circuit ouvert.</strong> Trop d'ordres en peu de temps : l'exécution reste suspendue jusqu'au réarmement humain.</p>${fix('reset-breaker', 'Réarmer le coupe-circuit')}</div>`);
    }
    for (const issue of ui.issues) {
      if (['quarantine', 'breaker', 'kill'].includes(issue.code)) continue;
      parts.push(`<div class="jv-notice tone-block" role="alert">${icon('alert')}<p>${esc(issue.message)}</p></div>`);
    }
    if (ui.error) parts.push(`<div class="jv-notice tone-block" role="alert">${icon('alert')}<p>${esc(ui.error)}</p></div>`);
    setHTML($('jv-notices'), parts.join(''));
  }

  function renderCards(tx, verdict) {
    // Opération.
    let op;
    if (tx && tx.intent) {
      const i = tx.intent;
      op = `
        <p class="jv-card-label" id="jv-card-op-label">${icon('folder')}Opération</p>
        <p class="jv-card-value">${esc(fmt.side(i.side))} · ${esc(fmt.eur(i.amount))}</p>
        <p class="jv-card-text">${esc(tx.assetLabel)} · ${esc(i.counterparty)}</p>
        <p class="jv-card-meta"><span class="mono">${esc(tx.corr)}</span> · proposée à ${esc(fmt.time(tx.startedAt))}</p>`;
    } else {
      op = `
        <p class="jv-card-label" id="jv-card-op-label">${icon('folder')}Opération</p>
        <p class="jv-card-value is-muted">${tx ? 'En préparation' : 'Aucune'}</p>
        <p class="jv-card-text">${tx ? "L'agent lit les données de marché." : `${esc(C.FUND.name)} · 10 M€ · profil prudent`}</p>`;
    }
    setHTML($('jv-card-op'), op);

    // Décision.
    const cta = verdict.cta && !ui.replay ? `<button type="button" class="jv-btn jv-btn--warn jv-btn--sm" data-cmd="open-phone">${icon('phone')}Ouvrir la validation</button>` : '';
    $('jv-card-decision').className = `jv-card jv-card--decision tone-${verdict.tone}`;
    setHTML(
      $('jv-card-decision'),
      `<div class="jv-card-row">
        <div class="jv-card-main">
          <p class="jv-card-label" id="jv-card-decision-label">${icon('gate')}Décision</p>
          <p class="jv-card-value tone-${verdict.tone}">${icon(verdict.icon)}<span>${esc(verdict.label)}</span></p>
        </div>
        ${cta}
      </div>
      <p class="jv-card-text">${esc(verdict.text)}</p>`,
    );

    // Preuve.
    const v = store.verification;
    let pv;
    if (v.state === 'broken') {
      pv = { tone: 'block', icon: 'linkBroken', label: 'Journal altéré', text: `Une modification a été détectée dans le journal (événement n° ${v.broken_at + 1}).` };
    } else if (v.state === 'valid' && v.checked) {
      pv = { tone: 'ok', icon: 'link', label: 'Journal intègre', text: `La preuve cryptographique du journal est valide · ${plural(v.checked, 'événement')}.` };
    } else {
      pv = { tone: 'idle', icon: 'circleDashed', label: store.events.length ? 'Non vérifié' : 'Journal vide', text: store.events.length ? `${plural(store.events.length, 'événement')} à vérifier.` : 'Chaque étape y sera inscrite et chaînée.' };
    }
    setHTML(
      $('jv-card-proof'),
      `<p class="jv-card-label" id="jv-card-proof-label">${icon('link')}Preuve</p>
      <p class="jv-card-value tone-${pv.tone}">${icon(pv.icon)}<span>${esc(pv.label)}</span></p>
      <p class="jv-card-text">${esc(pv.text)}</p>`,
    );
  }

  function stateHtml(d) {
    return statusHtml(STATE_TONE[d.state], d.icon || STATE_ICON[d.state], d.label);
  }

  function renderFlow(data, shown) {
    for (const s of STEPS) {
      const d = data[s.id];
      const el = ui.nodeEls[s.id];
      const cls = `jv-node is-${d.state}${shown === s.id ? ' is-selected' : ''}`;
      if (el.btn.className !== cls) el.btn.className = cls;
      el.btn.setAttribute('aria-pressed', String(shown === s.id));
      if (d.state === 'active' || (d.state === 'escalate' && s.id === 'human')) el.btn.setAttribute('aria-current', 'step');
      else el.btn.removeAttribute('aria-current');
      const text = d.why || s.role;
      if (el.text.textContent !== text) el.text.textContent = text;
      setHTML(el.state, stateHtml(d));
    }
  }

  function renderSide(tx, data, shown) {
    let sub = `${C.FUND.name} · aucune opération`;
    if (tx) {
      const f = tx.final;
      const state = f ? (f.status === 'filled' ? 'exécutée' : 'bloquée') : tx.hitl && tx.hitl.status === 'pending' ? 'en attente du gérant' : 'en cours';
      sub = `${C.FUND.name} · ${tx.corr} ${state}`;
    }
    $('jv-side-sub').textContent = sub;
    for (const s of STEPS) {
      const d = data[s.id];
      const el = ui.stepEls[s.id];
      const cls = `jv-step is-${d.state}${shown === s.id ? ' is-selected' : ''}`;
      if (el.li.className !== cls) el.li.className = cls;
      el.btn.setAttribute('aria-pressed', String(shown === s.id));
      if (d.state === 'active' || (d.state === 'escalate' && s.id === 'human')) el.btn.setAttribute('aria-current', 'step');
      else el.btn.removeAttribute('aria-current');
      const short = d.short || STATE_SHORT[d.state];
      setHTML(el.state, `${icon(d.icon || STATE_ICON[d.state])}<span>${esc(short)}</span>`);
    }
  }

  function renderExplain(tx, data, shown) {
    const s = STEP[shown];
    const d = data[shown];
    const index = STEPS.indexOf(s) + 1;
    const tone = STATE_TONE[d.state];
    const mode = ui.pinned ? 'Étape sélectionnée' : tx ? 'Suivi en direct' : 'Parcours';
    const result = tx
      ? `<p class="jv-explain-result">${stateHtml(d)}${d.why ? `<span class="jv-explain-why">${esc(d.why)}</span>` : ''}</p>`
      : '<p class="jv-explain-result"><span class="jv-explain-why">Saisissez une opération ou choisissez un scénario : chaque étape s\'éclaire au fil des contrôles.</span></p>';
    const pendingHere = shown === 'human' && store.pending && !ui.replay;
    $('jv-explain').className = `jv-explain tone-${tone}`;
    setHTML(
      $('jv-explain'),
      `<span class="jv-explain-icon">${icon(s.icon)}</span>
      <div class="jv-explain-body">
        <div class="jv-explain-head"><h2 class="jv-explain-title" id="jv-explain-title">${esc(s.nav)}</h2><span class="jv-explain-kicker">${esc(mode)} · étape ${index} sur ${STEPS.length}</span></div>
        ${result}
        <p class="jv-explain-text">${esc(s.purpose)}</p>
      </div>
      <div class="jv-explain-actions">
        ${pendingHere ? `<button type="button" class="jv-btn jv-btn--warn jv-btn--sm" data-cmd="open-phone">${icon('phone')}Ouvrir la validation</button>` : ''}
        <button type="button" class="jv-btn jv-btn--sm" data-cmd="details" data-key="${s.id}">${icon('terminal')}Voir les détails techniques</button>
        ${ui.pinned && tx ? `<button type="button" class="jv-btn jv-btn--ghost jv-btn--sm" data-cmd="follow">${icon('play')}Suivre en direct</button>` : ''}
      </div>`,
    );
  }

  function renderAction() {
    const disabled = busy();
    const submit = $('jv-submit');
    submit.disabled = disabled;
    submit.setAttribute('aria-busy', String(Boolean(ui.running)));
    setHTML(submit, ui.running ? `${icon('progress')}<span>Vérification en cours…</span>` : `${icon('play')}<span>Lancer la vérification</span>`);
    $('jv-scen-btn').disabled = disabled;
    $('jv-scen-menu').querySelectorAll('[data-cmd]').forEach((b) => {
      b.disabled = disabled;
    });
  }

  // ------------------------------------------------------------------ tracé des liens

  let edgesFrame = null;
  let lastEdgeData = null;

  function scheduleEdges(data) {
    if (data) lastEdgeData = data;
    if (edgesFrame) return;
    edgesFrame = window.requestAnimationFrame(() => {
      edgesFrame = null;
      drawEdges(lastEdgeData);
    });
  }

  function toneOf(state) {
    return { idle: 'idle', active: 'active', pass: 'done', escalate: 'human', warn: 'human', block: 'block', skipped: 'skipped' }[state] || 'idle';
  }

  function edgeTone(a, b, d) {
    // Une validation humaine « non requise » est traversée : le parcours continue sans s'y arrêter.
    const through = (id) => id === 'human' && d.human.state === 'skipped' && !['idle', 'skipped'].includes(d.execution.state);
    if (d[a].state === 'skipped' && !through(a)) return 'skipped';
    if (d[b].state === 'skipped') return through(b) ? 'done' : 'skipped';
    if (d[a].state === 'idle') return 'idle';
    return toneOf(d[b].state);
  }

  function roundedElbow(points) {
    // Polyligne orthogonale à coins arrondis (r ≤ 8 px).
    let path = `M${points[0][0]} ${points[0][1]}`;
    for (let i = 1; i < points.length - 1; i++) {
      const [px, py] = points[i - 1];
      const [x, y] = points[i];
      const [nx, ny] = points[i + 1];
      const r = Math.min(8, Math.hypot(x - px, y - py) / 2, Math.hypot(nx - x, ny - y) / 2);
      const bx = x - Math.sign(x - px) * r;
      const by = y - Math.sign(y - py) * r;
      const ax = x + Math.sign(nx - x) * r;
      const ay = y + Math.sign(ny - y) * r;
      path += ` L${bx} ${by} Q${x} ${y} ${ax} ${ay}`;
    }
    const end = points[points.length - 1];
    return `${path} L${end[0]} ${end[1]}`;
  }

  function drawEdges(data) {
    const svg = $('jv-edges');
    const flow = $('jv-flow');
    const box = flow.getBoundingClientRect();
    if (!box.width) return;
    const rect = (id) => {
      const r = ui.nodeEls[id].btn.getBoundingClientRect();
      return { l: r.left - box.left, r: r.right - box.left, t: r.top - box.top, b: r.bottom - box.top, cx: r.left - box.left + r.width / 2, cy: r.top - box.top + r.height / 2 };
    };
    const d = data || computeSteps(null);
    const paths = EDGES.map(([a, b]) => {
      const A = rect(a);
      const B = rect(b);
      let pts;
      if (B.l >= A.r - 2) {
        const xm = Math.round((A.r + B.l) / 2);
        pts = Math.abs(A.cy - B.cy) < 1 ? [[A.r, A.cy], [B.l - 2, B.cy]] : [[A.r, A.cy], [xm, A.cy], [xm, B.cy], [B.l - 2, B.cy]];
      } else {
        // Retour à la ligne (bureau) ou parcours vertical (mobile) : on passe dans l'allée au-dessus du nœud cible.
        const ym = Math.round(B.t - Math.min(34, (B.t - A.b) / 2));
        pts = Math.abs(A.cx - B.cx) < 1 ? [[A.cx, A.b], [B.cx, B.t - 2]] : [[A.cx, A.b], [A.cx, ym], [B.cx, ym], [B.cx, B.t - 2]];
      }
      const tone = edgeTone(a, b, d);
      return `<path class="jv-edge is-${tone}" d="${roundedElbow(pts)}" marker-end="url(#jv-arrow-${tone})"/>`;
    });
    const markers = ['idle', 'active', 'done', 'human', 'block', 'skipped']
      .map((t) => `<marker id="jv-arrow-${t}" class="jv-arrow is-${t}" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto"><path d="M0 0.5L7.5 4L0 7.5z"/></marker>`)
      .join('');
    svg.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
    svg.innerHTML = `<defs>${markers}</defs>${paths.join('')}`;
  }

  // ------------------------------------------------------------------ sélection d'étape

  function selectStep(id, opts = {}) {
    ui.selected = id;
    ui.pinned = true;
    render();
    const node = ui.nodeEls[id].btn;
    if (opts.scroll) {
      node.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' });
    }
    announce(`${STEP[id].nav} : ${node.querySelector('.jv-node-state').textContent.trim()}.`);
  }

  // ------------------------------------------------------------------ panneau de détails techniques

  function eventsByStep(tx) {
    const groups = Object.fromEntries(STEPS.map((s) => [s.id, []]));
    let current = 'proposal';
    for (const i of tx.items) {
      const e = store.journalLine(i);
      let step = ACTION_STEP[e.action];
      if (e.action === 'judge.voted') step = e.agent_id === 'risk_judge' ? 'risk' : e.agent_id === 'compliance_judge' ? 'compliance' : current;
      if (e.action === 'transaction.blocked') step = BLOCK_STEP[(e.context || {}).stage] || current;
      if (step) current = step;
      groups[step || current].push({ e, line: i + 1, index: i });
    }
    return groups;
  }

  function factsFor(stepId, tx) {
    const rows = [];
    const add = (k, v) => {
      if (v !== undefined && v !== null && v !== '') rows.push([k, v]);
    };
    if (!tx) return rows;
    const i = tx.intent;
    if (stepId === 'proposal') {
      if (i) {
        add('Opération', `${fmt.side(i.side)} de ${fmt.eur(i.amount)} · ${tx.assetLabel}`);
        add('Contrepartie', i.counterparty);
        add('Confiance déclarée', fmt.dec(i.confidence));
        add('Sources citées', (i.data_sources || []).join(', ') || 'aucune');
        add('Outil demandé', tx.tool);
        add('Justification', i.rationale);
      }
      if (tx.firewall) add('Donnée externe', `${tx.firewall.source}${tx.firewall.flagged ? ` · signalée (${tx.firewall.flags.join(', ')})` : ' · rien de suspect'}`);
    } else if (stepId === 'mandate' && tx.policy) {
      add('Résultat', W.statusInfo(tx.policy.outcome).label);
      add("Seuil d'autonomie", fmt.eur(effectiveMax(tx)));
      add('Version des règles', tx.policy.policy_version || C.POLICY_VERSION);
    } else if (stepId === 'risk' || stepId === 'compliance') {
      const v = tx.verdicts.find((x) => x.judge_id === (stepId === 'risk' ? 'risk_judge' : 'compliance_judge'));
      if (v) {
        add('Vote', W.statusInfo(v.vote).label);
        if (typeof v.confidence === 'number') add('Confiance', fmt.dec(v.confidence));
        add('Justification', v.justification);
      }
    } else if (stepId === 'decision' && tx.quorum) {
      const q = tx.quorum;
      add('Résultat', W.statusInfo(q.outcome).label);
      add('Règle de quorum', q.mode === 'weighted' ? 'Majorité pondérée (> 0,70)' : 'Unanimité au-delà de 1 000 €');
      if (typeof q.approvals === 'number') add('Avis favorables', `${q.approvals} sur ${q.required}`);
    } else if (stepId === 'human' && tx.hitl) {
      const card = tx.hitl.card || {};
      add('Statut', W.statusInfo(tx.hitl.status).label);
      add('Motifs', (card.reasons || []).map((r) => W.rule(r, { max: fmt.eur(effectiveMax(tx)) })).join(' '));
      if (tx.human && tx.human.approver_id) add('Signataire', fmt.actor(`human:${tx.human.approver_id}`));
      if (tx.human && tx.human.timestamp) add('Signée à', fmt.time(tx.human.timestamp));
      if (tx.human && tx.human.signature) add('Signature HMAC', `${tx.human.signature.slice(0, 24)}…`);
      if (card.intent_hash) add("Empreinte de l'opération", fmt.shortHash(card.intent_hash));
    } else if (stepId === 'execution') {
      if (tx.auth) add('Autorisation', `${tx.auth.auth_id}${tx.auth.revoked ? ' · révoquée' : ''}`);
      if (tx.order) add('Ordre', `${tx.order.order_id} · ${fmt.side(tx.order.side)} de ${fmt.eur(tx.order.amount)} · ${fmt.assetLabel(tx.order.asset)}`);
      if (tx.integrity) {
        add('Empreinte autorisée', fmt.shortHash(tx.integrity.expected_hash));
        add('Empreinte reçue', `${fmt.shortHash(tx.integrity.actual_hash)}${tx.integrity.ok ? ' · identique' : ' · différente'}`);
      }
      if (tx.risk) {
        add('Budget autonome du jour', `${fmt.eur(tx.risk.daily_cumul)} sur ${fmt.eur(tx.risk.daily_limit)}`);
        add('Ordres sur 60 s', `${tx.risk.orders_last_minute} sur ${tx.risk.freq_limit}`);
      }
    } else if (stepId === 'proof') {
      const v = store.verification;
      add('Vérification', v.state === 'valid' ? `Chaîne intègre · ${plural(v.checked, 'événement')}` : v.state === 'broken' ? `Rupture à l'événement n° ${v.broken_at + 1}` : 'Non vérifiée');
      const record = store.decisionRecord(tx.corr);
      for (const proof of record ? record.proofs : []) add(proof.label, proof.label.startsWith('Hash') || proof.label.startsWith('Signature') ? fmt.shortHash(proof.value) : proof.value);
    }
    return rows;
  }

  function stepDrawerHtml(stepId) {
    const s = STEP[stepId];
    const tx = currentTx();
    const d = computeSteps(tx)[stepId];
    const tech = s.tech
      .map((t) => {
        const actor = C.ACTORS[t.id] || { name: t.id, kind: 'control' };
        return `<li><p class="jv-tech-name">${esc(actor.name)} <span class="jv-tech-kind">${esc(C.KIND_LABELS[actor.kind] || '')}</span></p><p class="jv-tech-role">${esc(t.role)}</p></li>`;
      })
      .join('');
    const mandates = (s.agents || [])
      .map((id) => {
        const a = C.AGENTS.find((x) => x.id === id);
        if (!a) return '';
        const st = store.agents[id] || { trust: 100, quarantined: false };
        return `<dl class="jv-facts">
          <dt>Agent</dt><dd>${esc(a.name)} · ${esc(a.nature)}</dd>
          <dt>Mission</dt><dd>${esc(a.mission)}</dd>
          <dt>Outils autorisés</dt><dd><span class="mono">${esc(a.allowed_tools.join(', '))}</span></dd>
          ${a.max_amount ? `<dt>Plafond autonome</dt><dd>${esc(fmt.eur(a.max_amount))}</dd>` : ''}
          <dt>Interdit</dt><dd>${esc(a.forbidden)}</dd>
          <dt>Score de confiance</dt><dd>${esc(st.trust)} / 100${st.quarantined ? ' · en quarantaine' : ''}</dd>
        </dl>`;
      })
      .join('');
    const facts = factsFor(stepId, tx);
    const factsHtml = facts.length
      ? `<dl class="jv-facts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`
      : '<p class="jv-muted">Aucune donnée pour cette étape pour l\'instant.</p>';
    const events = tx ? eventsByStep(tx)[stepId] : [];
    const rules = new Set();
    for (const { e } of events) for (const r of (e.context && e.context.triggered_rules) || []) rules.add(r);
    const brokenAt = store.verification.state === 'broken' ? store.verification.broken_at : -1;
    const eventsHtml = events.length
      ? `<ol class="jv-events">${events.map(({ e, line, index }) => eventHtml(e, line, index === brokenAt)).join('')}</ol>`
      : '<p class="jv-muted">Aucun événement journalisé pour cette étape.</p>';
    const rulesHtml = rules.size
      ? `<ul class="jv-rules">${[...rules].map((r) => `<li><span class="mono">${esc(r)}</span><span>${esc(fmt.rule(r))}</span></li>`).join('')}</ul>`
      : '<p class="jv-muted">Aucune règle déclenchée.</p>';
    const proofActions = stepId === 'proof'
      ? `<div class="jv-drawer-actions">
          <button type="button" class="jv-btn jv-btn--sm" data-cmd="verify">${icon('link')}Vérifier la chaîne</button>
          <button type="button" class="jv-btn jv-btn--sm" data-cmd="export" ${store.events.length ? '' : 'disabled'}>${icon('download')}Exporter audit.jsonl</button>
        </div>`
      : '';
    return `
      <section class="jv-drawer-section">
        <p class="jv-drawer-status">${stateHtml(d)}</p>
        <p>${esc(d.why || s.role)}</p>
        ${tx ? `<p class="jv-muted">Opération <span class="mono">${esc(tx.corr)}</span>${tx.intent ? ` · ${esc(txWhat(tx))}` : ''}</p>` : ''}
      </section>
      <section class="jv-drawer-section"><h3>Composants techniques</h3><ul class="jv-tech">${tech}</ul></section>
      ${mandates ? `<section class="jv-drawer-section"><h3>Mandat</h3>${mandates}</section>` : ''}
      <section class="jv-drawer-section"><h3>Données analysées et résultat</h3>${factsHtml}</section>
      <section class="jv-drawer-section"><h3>Règles appliquées · ${esc(C.POLICY_VERSION)}</h3>${rulesHtml}</section>
      <section class="jv-drawer-section"><h3>Événements d'audit</h3>${eventsHtml}${proofActions}</section>
      <div class="jv-drawer-foot">
        ${tx ? `<button type="button" class="jv-btn jv-btn--sm" data-cmd="export-record">${icon('download')}Fiche de décision (JSON)</button>` : ''}
        <a class="jv-btn jv-btn--ghost jv-btn--sm" href="dashboard.html" target="_blank" rel="noopener">${icon('terminal')}Vue technique complète</a>
      </div>`;
  }

  function eventHtml(e, line, broken) {
    const info = W.statusInfo(e.status);
    const tone = { ok: 'ok', human: 'human', block: 'block', active: 'active' }[info.tone] || 'idle';
    return `
      <li class="jv-event${broken ? ' is-broken' : ''}">
        <p class="jv-event-head">
          <span class="mono jv-event-num">n° ${line}</span>
          <span class="jv-event-time">${esc(fmt.time(e.timestamp))}</span>
          <span class="jv-event-who">${esc(fmt.actor(e.agent_id))}</span>
          <span class="jv-event-what">${esc(W.action(e.action))}</span>
          ${info.label ? statusHtml(tone, info.icon, info.label) : ''}
          ${broken ? statusHtml('block', 'linkBroken', 'Ligne modifiée') : ''}
        </p>
        ${e.reasoning ? `<p class="jv-event-why">${esc(e.reasoning)}</p>` : ''}
        <p class="jv-event-hash mono">empreinte ${esc(fmt.shortHash(e.hash))}</p>
      </li>`;
  }

  function journalDrawerHtml() {
    const v = store.verification;
    const n = store.events.length;
    let status;
    if (v.state === 'valid') status = statusHtml('ok', 'link', `Chaîne intègre · ${plural(v.checked, 'événement')} vérifiés`);
    else if (v.state === 'broken') status = statusHtml('block', 'linkBroken', `Modification détectée à l'événement n° ${v.broken_at + 1}`);
    else status = statusHtml('idle', 'circleDashed', n ? 'Non vérifiée' : 'Journal vide');
    const brokenAt = v.state === 'broken' ? v.broken_at : -1;
    const MAX = 60;
    const start = Math.max(0, n - MAX);
    const indexes = [];
    for (let i = n - 1; i >= start; i--) indexes.push(i);
    if (brokenAt >= 0 && brokenAt < start) indexes.push(brokenAt);
    const rows = indexes.map((i) => eventHtml(store.journalLine(i), i + 1, i === brokenAt)).join('');
    const live = transport.mode === 'live';
    return `
      <section class="jv-drawer-section">
        <p class="jv-drawer-status">${status}</p>
        <p>Chaque événement contient l'empreinte du précédent : modifier une ligne après coup rompt la chaîne, et la vérification désigne la ligne en cause.</p>
        <div class="jv-drawer-actions">
          <button type="button" class="jv-btn jv-btn--primary jv-btn--sm" data-cmd="verify" ${n ? '' : 'disabled'}>${icon('link')}Vérifier la chaîne</button>
          <button type="button" class="jv-btn jv-btn--sm" data-cmd="replay" ${n && !busy() ? '' : 'disabled'}>${icon('replay')}Rejouer la séance</button>
          <button type="button" class="jv-btn jv-btn--sm" data-cmd="export" ${n ? '' : 'disabled'}>${icon('download')}Exporter audit.jsonl</button>
          ${store.tampered
            ? (live ? '' : `<button type="button" class="jv-btn jv-btn--sm" data-cmd="restore">${icon('reset')}Restaurer le journal</button>`)
            : `<button type="button" class="jv-btn jv-btn--danger-outline jv-btn--sm" data-cmd="tamper" ${n && !busy() ? '' : 'disabled'}>${icon('edit')}Simuler une falsification</button>`}
        </div>
      </section>
      <section class="jv-drawer-section">
        <h3>Derniers événements${n > MAX ? ` · ${MAX} sur ${n}` : n ? ` · ${n}` : ''}</h3>
        ${n ? `<ol class="jv-events">${rows}</ol>` : '<p class="jv-muted">Aucun événement pour l\'instant.</p>'}
      </section>
      <div class="jv-drawer-foot">
        <a class="jv-btn jv-btn--ghost jv-btn--sm" href="dashboard.html" target="_blank" rel="noopener">${icon('terminal')}Vue technique complète</a>
        <a class="jv-btn jv-btn--ghost jv-btn--sm" href="approval.html" target="_blank" rel="noopener">${icon('phone')}Écran mobile du gérant</a>
      </div>`;
  }

  function renderDrawer() {
    const dlg = $('jv-drawer');
    if (!ui.drawer) return;
    if (ui.drawer.type === 'journal') {
      $('jv-drawer-kicker').textContent = 'Preuve et audit';
      $('jv-drawer-title').textContent = 'Journal de preuve';
      setHTML($('jv-drawer-body'), journalDrawerHtml());
    } else {
      const s = STEP[ui.drawer.id];
      $('jv-drawer-kicker').textContent = 'Détails techniques';
      $('jv-drawer-title').textContent = s.nav;
      setHTML($('jv-drawer-body'), stepDrawerHtml(s.id));
    }
    if (!dlg.open) dlg.showModal();
  }

  function openDrawer(spec) {
    ui.drawerReturn = document.activeElement;
    ui.drawer = spec;
    $('jv-drawer-body').__html = null;
    renderDrawer();
    $('jv-drawer-body').scrollTop = 0;
    $('jv-drawer-title').focus();
  }

  function closeDrawer() {
    const dlg = $('jv-drawer');
    if (dlg.open) dlg.close();
  }

  // ------------------------------------------------------------------ preuve : vérification, rejeu, export

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
    announce(v.state === 'valid' ? `Chaîne intègre : ${v.checked} événements.` : v.state === 'broken' ? `Modification détectée à l'événement ${v.broken_at + 1}.` : 'Vérification impossible.');
  }

  function scheduleVerify(scopes) {
    if (transport.mode !== 'sim' || ui.replay || !scopes.has('events')) return;
    window.clearTimeout(ui.verifyTimer);
    ui.verifyTimer = window.setTimeout(verifyNow, 350);
  }

  function startReplay() {
    if (busy() || !store.events.length) return;
    closePhone();
    closeMenu();
    const events = store.events.slice();
    const overrides = new Map(store.overrides);
    const tampered = store.tampered;
    store.reset();
    store.overrides = overrides;
    store.tampered = tampered;
    ui.pinned = false;
    ui.selected = null;
    const delay = Math.max(25, Math.min(220, Math.round(12000 / events.length)));
    ui.replay = { index: 0, total: events.length, events, timer: null };
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
    render();
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
    render();
  }

  function exportJournal() {
    const lines = store.events.map((_, i) => JSON.stringify(store.journalLine(i))).join('\n');
    download('audit.jsonl', lines ? `${lines}\n` : '', 'application/x-ndjson');
    announce(`Journal exporté : ${plural(store.events.length, 'événement')}.`);
  }

  function exportRecord() {
    const tx = currentTx();
    const record = tx ? store.decisionRecord(tx.corr) : null;
    if (!record) return;
    download(`decision-${record.correlation_id}.json`, JSON.stringify(record, null, 2), 'application/json');
    announce(`Fiche de décision ${record.correlation_id} exportée.`);
  }

  // ------------------------------------------------------------------ validation du gérant (téléphone)

  function broadcast(message) {
    if (ui.channel) ui.channel.postMessage(message);
  }

  function pendingMessage() {
    const p = store.pending;
    return p ? { type: 'pending', card: p.card, record: store.decisionRecord(p.corr) } : { type: 'idle' };
  }

  function renderPhoneIdle() {
    $('phone-body').innerHTML = `<div class="phone-idle">${icon('phone')}<p><strong>Aucune décision en attente.</strong></p><p>La demande apparaît dès qu'une opération est escaladée : montant au-delà du seuil, veto ou abstention d'un contrôle.</p></div>`;
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
    window.clearTimeout(ui.phoneTimer);
    const dialog = $('phone-dialog');
    if (!dialog.open) dialog.showModal();
    const title = $('phone-body').querySelector('.hitl-title');
    if (title) title.focus();
    renderNotices();
  }

  function closePhone() {
    window.clearTimeout(ui.phoneTimer);
    const dialog = $('phone-dialog');
    if (dialog.open) dialog.close();
  }

  function syncPending() {
    const p = store.pending;
    if (p) {
      if (ui.replay) return;
      if (!ui.card || ui.card.threadId !== p.thread_id) {
        mountCard(p);
        broadcast(pendingMessage());
        announce(`Validation humaine requise sur ${p.corr}.`);
        // Le jury voit d'abord l'étape s'allumer dans le parcours, puis le téléphone du gérant s'ouvre.
        window.clearTimeout(ui.phoneTimer);
        ui.phoneTimer = window.setTimeout(() => {
          if (store.pending && store.pending.thread_id === p.thread_id && !ui.replay) openPhone();
        }, 1200);
      }
      return;
    }
    if (ui.card && !ui.cardClosed) {
      const tx = store.txs.get(ui.cardCorr);
      const status = tx && tx.hitl ? tx.hitl.status : 'rejected';
      if (!ui.card.decided) ui.card.resolvedElsewhere(status);
      broadcast({ type: 'resolved', thread_id: ui.card.threadId, status });
      ui.cardClosed = true;
      window.clearTimeout(ui.phoneTimer);
      // L'écran « décision signée » reste lisible un instant avant de rendre la main au parcours.
      ui.phoneTimer = window.setTimeout(() => {
        if (ui.cardClosed) closePhone();
      }, 2600);
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

  // ------------------------------------------------------------------ saisie et scénarios

  function parseObjective(text) {
    const t = String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (!t.trim()) return null;
    const side = /\b(vend|vente|ced|sell|allege)/.test(t) ? 'sell' : 'buy';
    let asset = null;
    for (const [re, id] of ASSET_WORDS) {
      if (re.test(t)) {
        asset = id;
        break;
      }
    }
    let counterparty = null;
    for (const [re, name] of CPTY_WORDS) {
      if (re.test(t)) {
        counterparty = name;
        break;
      }
    }
    // Montants : on préfère un nombre suivi de €, k ou M ; on ignore les maturités (« 10 ans »).
    const re = /(\d{1,3}(?:[ \u00a0\u202f.]\d{3})+|\d+)(?:,(\d+))?\s*(k|m|mille|millions?)?\s*(€|eur(?:os?)?)?(\s*ans?\b)?/g;
    let best = null;
    let m;
    while ((m = re.exec(t))) {
      if (m[5]) continue;
      let value = Number(m[1].replace(/[ \u00a0\u202f.]/g, '') + (m[2] ? `.${m[2]}` : ''));
      const unit = m[3] || '';
      if (unit === 'k' || unit === 'mille') value *= 1000;
      else if (unit.startsWith('m')) value *= 1000000;
      const score = (m[4] ? 2 : 0) + (unit ? 1 : 0);
      if (!best || score > best.score) best = { value, score };
    }
    const amount = best ? Math.round(best.value) : null;
    return { side, asset, amount, counterparty: counterparty || DEFAULT_CPTY, defaultCpty: !counterparty };
  }

  function parseHtml(parsed) {
    if (!parsed) return '';
    const missing = [];
    if (!parsed.amount) missing.push('un montant');
    if (!parsed.asset) missing.push('un actif (OAT, EuroTech, Voltéa, Médicis, monétaire…)');
    if (missing.length) return `${icon('info')}<span>Précisez ${missing.join(' et ')}.</span>`;
    const asset = C.ASSETS[parsed.asset].label;
    return `${icon('check')}<span>Compris : ${esc(fmt.side(parsed.side))} · ${esc(fmt.eur(parsed.amount))} · ${esc(asset)} · ${esc(parsed.counterparty)}${parsed.defaultCpty ? ' (contrepartie par défaut)' : ''}</span>`;
  }

  async function submitText(text) {
    if (busy()) return;
    const input = $('jv-input');
    const parsed = parseObjective(text);
    const parse = $('jv-parse');
    if (!parsed || !parsed.amount || !parsed.asset) {
      parse.className = 'jv-parse is-error';
      parse.innerHTML = parsed ? parseHtml(parsed) : `${icon('info')}<span>Décrivez l'opération, par exemple « acheter 4 000 € d'OAT ».</span>`;
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      return;
    }
    input.setAttribute('aria-invalid', 'false');
    // Une fois soumise, l'interprétation est portée par la carte Opération : la ligne d'aide se libère.
    parse.className = 'jv-parse';
    parse.innerHTML = '';
    ui.running = 'manual';
    ui.issues = [];
    closeMenu();
    render();
    announce(`Opération soumise : ${fmt.side(parsed.side)} de ${fmt.eur(parsed.amount)} de ${C.ASSETS[parsed.asset].label}.`);
    try {
      await transport.submitObjective({ asset: parsed.asset, side: parsed.side, amount: parsed.amount, counterparty: parsed.counterparty });
    } catch (err) {
      notify(err.message);
    } finally {
      ui.running = null;
      render();
      verifyNow();
    }
  }

  async function runScenario(key) {
    if (busy()) return;
    const scenario = C.SCENARIOS.find((s) => s.key === key);
    if (!scenario) return;
    ui.issues = [];
    ui.running = key;
    closeMenu();
    const meta = MENU.find((m) => m.key === key);
    // Un scénario n'est pas une saisie : on efface le champ pour ne pas afficher une opération qui n'est pas en cours.
    $('jv-input').value = '';
    $('jv-input').removeAttribute('aria-invalid');
    $('jv-parse').className = 'jv-parse';
    $('jv-parse').innerHTML = '';
    render();
    announce(`Scénario lancé : ${meta ? meta.title : scenario.title}.`);
    try {
      await transport.runScenario(key);
    } catch (err) {
      if (MA.errors && err instanceof MA.errors.PreconditionError) ui.issues = err.issues;
      else if (MA.errors && err instanceof MA.errors.BusyError) notify(err.message);
      else {
        ui.issues = [{ code: 'error', message: err.message }];
        console.error(err);
      }
    } finally {
      ui.running = null;
      render();
      verifyNow();
    }
  }

  function runMenu(key) {
    const item = MENU.find((m) => m.key === key);
    if (!item) return;
    if (item.kind === 'preset') {
      const input = $('jv-input');
      input.value = item.sentence;
      updateParse();
      submitText(item.sentence);
    } else {
      runScenario(key);
    }
  }

  function updateParse() {
    const input = $('jv-input');
    const parse = $('jv-parse');
    parse.className = 'jv-parse';
    input.removeAttribute('aria-invalid');
    parse.innerHTML = parseHtml(parseObjective(input.value));
  }

  function openMenu() {
    const btn = $('jv-scen-btn');
    const menu = $('jv-scen-menu');
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    const first = menu.querySelector('button:not(:disabled)');
    if (first) first.focus();
  }

  function closeMenu(returnFocus) {
    const btn = $('jv-scen-btn');
    const menu = $('jv-scen-menu');
    if (menu.hidden) return;
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    if (returnFocus) btn.focus();
  }

  // ------------------------------------------------------------------ commandes

  const READ_ONLY = new Set(['stop-replay', 'details', 'follow', 'open-journal', 'export', 'export-record', 'verify']);

  const commands = {
    menu: ({ key }) => runMenu(key),
    reset: async () => {
      closeMenu();
      const ok = await confirmAction({
        title: 'Réinitialiser la démonstration ?',
        text: 'Le journal local, les scores de confiance et les compteurs reviennent à leur état initial. Rien ne quitte le navigateur.',
        ok: 'Réinitialiser',
        danger: true,
      });
      if (!ok) return;
      if (ui.replay) stopReplay();
      closePhone();
      closeDrawer();
      ui.card = null;
      ui.cardClosed = true;
      ui.issues = [];
      ui.pinned = false;
      ui.selected = null;
      renderPhoneIdle();
      await guard(transport.reset());
      broadcast({ type: 'idle' });
      $('jv-flow-title').focus();
    },
    details: ({ key }) => openDrawer({ type: 'step', id: key }),
    follow: () => {
      ui.pinned = false;
      ui.selected = null;
      render();
    },
    'open-journal': () => {
      verifyNow();
      openDrawer({ type: 'journal' });
    },
    'open-phone': () => openPhone(),
    verify: () => verifyAndAnnounce(),
    replay: () => {
      closeDrawer();
      startReplay();
    },
    'stop-replay': () => stopReplay(),
    export: () => exportJournal(),
    'export-record': () => exportRecord(),
    tamper: async () => {
      const info = await guard(transport.tamper());
      if (info && typeof info.index === 'number') {
        announce(`Événement ${info.index + 1} modifié hors du système. Lancez la vérification.`);
        render();
      }
    },
    restore: async () => {
      await guard(transport.restore());
      await verifyNow();
      announce('Journal restauré.');
    },
    'engage-kill': async () => {
      const ok = await confirmAction({
        title: "Déclencher l'arrêt d'urgence ?",
        text: "Plus aucun ordre n'atteindra le marché tant qu'un humain n'aura pas réarmé l'exécution. Les contrôles et le journal continuent.",
        ok: "Couper l'exécution",
        danger: true,
      });
      if (ok) {
        await guard(transport.killSwitch(true));
        announce("Arrêt d'urgence actif : aucun ordre n'atteint le marché.");
      }
    },
    'release-kill': async () => {
      const ok = await confirmAction({
        title: "Réarmer l'exécution ?",
        text: 'Les ordres autorisés pourront de nouveau atteindre le marché simulé. Action journalisée.',
        ok: 'Réarmer',
      });
      if (ok) await guard(transport.killSwitch(false));
    },
    'lift-quarantine': async ({ key }) => {
      const ok = await confirmAction({
        title: `Lever la quarantaine du ${fmt.actor(key)} ?`,
        text: "L'agent pourra de nouveau intervenir, avec son score de confiance actuel. L'action est journalisée au nom du superviseur humain.",
        ok: 'Lever la quarantaine',
      });
      if (ok) {
        ui.issues = [];
        await guard(transport.liftQuarantine(key));
      }
    },
    'reset-breaker': async () => {
      const ok = await confirmAction({
        title: 'Réarmer le coupe-circuit ?',
        text: "Les compteurs de fréquence et de refus repartent de zéro. L'action est journalisée au nom du superviseur humain.",
        ok: 'Réarmer',
      });
      if (ok) {
        ui.issues = [];
        await guard(transport.resetBreaker());
      }
    },
  };

  function bindStatic() {
    document.addEventListener('click', (event) => {
      const el = event.target.closest('[data-cmd]');
      if (!el || el.disabled) return;
      const cmd = el.dataset.cmd;
      if (ui.replay && !READ_ONLY.has(cmd)) return;
      if (commands[cmd]) commands[cmd](el.dataset, el);
    });

    $('jv-journal-btn').addEventListener('click', () => commands['open-journal']());
    $('jv-export-btn').addEventListener('click', exportJournal);

    $('jv-form').addEventListener('submit', (event) => {
      event.preventDefault();
      submitText($('jv-input').value);
    });
    $('jv-input').addEventListener('input', updateParse);

    $('jv-scen-btn').addEventListener('click', () => {
      if ($('jv-scen-menu').hidden) openMenu();
      else closeMenu(true);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !$('jv-scen-menu').hidden) {
        event.preventDefault();
        closeMenu(true);
      }
    });
    document.addEventListener('pointerdown', (event) => {
      if (!$('jv-scen-menu').hidden && !event.target.closest('.jv-menu-wrap')) closeMenu();
    });
    $('jv-scen-menu').addEventListener('change', (event) => {
      if (event.target.id === 'jv-fast') transport.setFast(event.target.checked);
    });

    $('jv-drawer-close').addEventListener('click', closeDrawer);
    $('jv-drawer').addEventListener('click', (event) => {
      if (event.target === $('jv-drawer')) closeDrawer();
    });
    $('jv-drawer').addEventListener('close', () => {
      ui.drawer = null;
      const back = ui.drawerReturn;
      ui.drawerReturn = null;
      if (back && document.contains(back) && typeof back.focus === 'function') back.focus({ preventScroll: true });
    });

    $('phone-close').addEventListener('click', closePhone);
    $('phone-dialog').addEventListener('close', () => renderNotices());

    const tickClock = () => {
      $('phone-clock').textContent = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date());
    };
    tickClock();
    window.setInterval(tickClock, 15000);

    if ('ResizeObserver' in window) new ResizeObserver(() => scheduleEdges()).observe($('jv-flow'));
    else window.addEventListener('resize', () => scheduleEdges());
  }

  /** Annonce uniquement les changements de décision et d'état de la preuve, pas chaque événement. */
  function announceChanges(verdict) {
    if (verdict.key !== ui.lastVerdict) {
      const first = ui.lastVerdict === null;
      ui.lastVerdict = verdict.key;
      if (!first && verdict.key !== 'none' && !verdict.key.endsWith('-running')) announce(`${verdict.label}. ${verdict.text}`);
    }
    const audit = store.verification.state;
    if (audit !== ui.lastAudit) {
      const previous = ui.lastAudit;
      ui.lastAudit = audit;
      if (audit === 'broken') announce(`Journal altéré : modification détectée à l'événement ${store.verification.broken_at + 1}.`);
      else if (audit === 'valid' && previous === 'broken') announce('Journal de nouveau intègre.');
    }
  }

  store.subscribe((scopes) => {
    render();
    scheduleVerify(scopes);
  });

  // Lancement automatique optionnel : ?run=nominal,amount&fast=1 (répétitions, captures d'écran).
  async function autoRun() {
    const keys = (params.get('run') || '')
      .split(',')
      .map((k) => k.trim())
      .filter((k) => MENU.some((m) => m.key === k));
    if (params.get('fast') === '1') {
      transport.setFast(true);
      const fast = $('jv-fast');
      if (fast) fast.checked = true;
    }
    for (const key of keys) {
      const item = MENU.find((m) => m.key === key);
      if (item.kind === 'preset') {
        $('jv-input').value = item.sentence;
        await submitText(item.sentence);
      } else {
        await runScenario(key);
      }
    }
  }

  hydrateIcons();
  buildNodes();
  buildSteps();
  buildMenu();
  setupChannel();
  bindStatic();
  renderPhoneIdle();
  render();
  autoRun();
})();

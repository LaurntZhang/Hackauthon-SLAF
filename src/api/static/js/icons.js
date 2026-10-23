/*
 * ManAgent — icônes SVG au trait (24×24, currentColor). Aucune police d'icônes, aucun emoji.
 * Les icônes sont décoratives (aria-hidden) : le sens est toujours porté par un texte visible.
 */
(function (root) {
  'use strict';
  const MA = (root.ManAgent = root.ManAgent || {});

  const PATHS = {
    logo: '<path d="M12 2.5l8 3.2v6.1c0 4.9-3.3 8.4-8 9.7-4.7-1.3-8-4.8-8-9.7V5.7l8-3.2z"/><path d="M8.5 12.2l2.4 2.4 4.6-5"/>',
    wall: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 9.3h18M3 14.6h18M9 4v5.3M15 4v5.3M6 9.3v5.3M12 9.3v5.3M18 9.3v5.3M9 14.6V20M15 14.6V20"/>',
    bot: '<rect x="4.5" y="8" width="15" height="11" rx="2.5"/><path d="M12 8V5"/><circle cx="12" cy="4" r="1.2"/><path d="M9 13h.01M15 13h.01M9.5 16.2h5"/>',
    listChecks: '<path d="M3.5 6.5l1.8 1.8 3-3M3.5 13.5l1.8 1.8 3-3M11.5 7h9M11.5 14h9M11.5 20h9"/>',
    scale: '<path d="M12 4v16M8 20h8M5 7h14M12 4.5L5 7M12 4.5L19 7M5 7l-2.6 6a2.8 2.8 0 0 0 5.2 0L5 7zM19 7l-2.6 6a2.8 2.8 0 0 0 5.2 0L19 7z"/>',
    users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M16.5 14.1c2.6.4 4.5 2.8 4.5 5.9"/>',
    phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.2"/><path d="M11 18.5h2"/>',
    key: '<circle cx="7.5" cy="15.5" r="4"/><path d="M10.4 12.6L20 3M16.5 6.5l2.5 2.5M14 9l2 2"/>',
    clipboard: '<rect x="5.5" y="4.5" width="13" height="16.5" rx="2"/><path d="M9 4.5V3h6v1.5M9 10h6M9 13.5h6M9 17h3.5"/>',
    hash: '<path d="M5 9h14M5 15h14M10.5 3.5L8.5 20.5M15.5 3.5l-2 17"/>',
    gauge: '<path d="M3.5 17a8.5 8.5 0 1 1 17 0"/><path d="M12 17l4.2-5.6"/><circle cx="12" cy="17" r="1.2"/>',
    send: '<path d="M3 11.5L21 3l-8.5 18-2-7.5-7.5-2z"/><path d="M10.5 13.5L21 3"/>',
    chart: '<path d="M3 20.5h18M6 17V11M10.5 17V6.5M15 17v-4M19.5 17V8.5"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>',
    shield: '<path d="M12 2.5l8 3.2v6.1c0 4.9-3.3 8.4-8 9.7-4.7-1.3-8-4.8-8-9.7V5.7l8-3.2z"/>',
    flask: '<path d="M9 3h6M10 3v6.2L4.6 18.4A1.8 1.8 0 0 0 6.2 21h11.6a1.8 1.8 0 0 0 1.6-2.6L14 9.2V3"/><path d="M7.5 15h9"/>',
    power: '<path d="M12 3v8.5"/><path d="M6.4 6.6a8 8 0 1 0 11.2 0"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    checkCircle: '<circle cx="12" cy="12" r="9"/><path d="M8 12.3l2.8 2.8L16.2 9.5"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    xCircle: '<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>',
    alert: '<path d="M12 3.5l9.5 16.5h-19L12 3.5z"/><path d="M12 10v4.5M12 17.3h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8h.01"/>',
    play: '<path d="M7 4.5l12.5 7.5L7 19.5v-15z"/>',
    replay: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5"/><path d="M3.5 3.5v5h5"/>',
    download: '<path d="M12 3.5v11.5M7 10.5l5 5 5-5M4.5 20.5h15"/>',
    file: '<path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8L14 3z"/><path d="M14 3v5h5M8.5 13h7M8.5 16.5h7"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.1 1.1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.1-1.1"/>',
    linkBroken: '<path d="M15.7 14l3-3a4 4 0 0 0-5.7-5.7l-1.1 1.1"/><path d="M8.3 10l-3 3a4 4 0 0 0 5.7 5.7l1.1-1.1"/><path d="M4 4l3 3M17 17l3 3"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
    reset: '<path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1l2.6 2.6"/><path d="M20.5 3.5v5h-5"/>',
    chevron: '<path d="M9 6l6 6-6 6"/>',
    backspace: '<path d="M8.5 5H20a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H8.5L3 12l5.5-7z"/><path d="M11.5 9.5l5 5M16.5 9.5l-5 5"/>',
    fingerprint: '<path d="M7 11.5a5 5 0 0 1 10 0v1.5"/><path d="M12 11.5v3.5c0 2-.6 3.8-1.6 5.5"/><path d="M4.5 9a8 8 0 0 1 15 0M4 13.5c.1 2.5-.4 4.5-1 6M20 13v1.5c0 2-.4 4-1.1 5.5M9.5 14.5c0 2.3-.7 4.4-1.9 6.2M14.5 15c0 2-.4 3.8-1.2 5.5"/>',
    // Ajouts de la refonte « finance éditoriale » : mêmes règles de dessin (24×24, trait 1,8).
    gate: '<path d="M5 21V4M19 21V4M3 4h18"/><path d="M5 11.5h14"/><path d="M8.5 11.5V21M12 11.5V21M15.5 11.5V21"/>',
    folder: '<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h8.5A1.5 1.5 0 0 1 21 9.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5v-11z"/>',
    building: '<path d="M3 21h18M4.5 10h15M12 3l8 4.5H4L12 3z"/><path d="M6.5 10v8M10 10v8M14 10v8M17.5 10v8"/>',
    arrowUpRight: '<path d="M7 17L17 7M9 7h8v8"/>',
    arrowDownRight: '<path d="M7 7l10 10M17 9v8H9"/>',
    pause: '<rect x="6.5" y="5" width="3.5" height="14" rx="1"/><rect x="14" y="5" width="3.5" height="14" rx="1"/>',
    pen: '<path d="M3 20.5c2.5 0 3.5-3 5.5-3s2 2 4 2 2.5-1.5 4-1.5"/><path d="M14.5 4.5l3 3L9 16l-3.5.5.5-3.5 8.5-8.5z"/>',
    split: '<path d="M4 6h5l6 12h5M4 18h5l2-4M15 6h5M13 10l2-4"/>',
    // Ajouts de la vue « mode jury » : états de parcours et accès aux détails techniques.
    circleDashed: '<circle cx="12" cy="12" r="8.5" stroke-dasharray="3.2 3.2"/>',
    progress: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none"/>',
    minusCircle: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 12h7"/>',
    terminal: '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M7 9.5l3 2.5-3 2.5M12.5 15h4.5"/>',
    branch: '<circle cx="6" cy="6" r="2.2"/><circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="9" r="2.2"/><path d="M6 8.2v7.6M8 6.5c5 0 8 .5 9 1.5M8 17.5c4-1 7.5-3.5 9.2-6.4"/>',
  };

  /**
   * Retourne le balisage d'une icône décorative.
   * @param {string} name Nom de l'icône dans PATHS.
   * @param {string} [cls] Classes CSS supplémentaires.
   */
  function icon(name, cls) {
    const body = PATHS[name] || PATHS.info;
    return (
      '<svg class="icon' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      body +
      '</svg>'
    );
  }

  MA.icon = icon;
})(typeof window !== 'undefined' ? window : globalThis);

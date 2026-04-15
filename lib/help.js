// Help / onboarding section metadata.
// The actual prose lives in public/index.html (static HTML, matched by id).
// This module owns the canonical list of sections and which role sees which.
// Client and server both share the filter logic via getHelpSectionsForRole().

export const HELP_SECTIONS = [
  { id: 'help-getting-started', title: 'Getting started',          dmOnly: false },
  { id: 'help-moving',          title: 'Moving your token',        dmOnly: false },
  { id: 'help-tokens',          title: 'Tokens',                   dmOnly: false },
  { id: 'help-presets',         title: 'Creature & object presets',dmOnly: false },
  { id: 'help-walls',           title: 'Walls & doors',            dmOnly: true  },
  { id: 'help-fog',             title: 'Fog of war & light',       dmOnly: false },
  { id: 'help-approval',        title: 'Approval mode',            dmOnly: false },
  { id: 'help-maps',            title: 'Maps',                     dmOnly: true  },
  { id: 'help-random',          title: 'Random dungeons',          dmOnly: true  },
  { id: 'help-spells',          title: 'Spells & effects',         dmOnly: true  },
  { id: 'help-chat',            title: 'Chat & dice',              dmOnly: false },
  { id: 'help-undo',            title: 'Undo',                     dmOnly: true  },
  { id: 'help-interface',       title: 'Interface',                dmOnly: false },
];

// Returns the sections the given role should see, in display order.
// DMs get everything; players get shared (non-dmOnly) sections only.
export function getHelpSectionsForRole(role) {
  const isDM = role === 'dm';
  return HELP_SECTIONS.filter(s => isDM || !s.dmOnly).map(s => ({ ...s }));
}

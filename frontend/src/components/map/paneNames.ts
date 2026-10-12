/** Stacking order for everything drawn on the route map (higher z-index = on top). */
export const PANE = {
  traffic: 'traffic-flow',
  alt: 'alt-routes',
  halo: 'route-halo',
  casing: 'route-casing',
  core: 'route-core',
  sections: 'route-traffic',
} as const

export const PANE_Z: Record<string, number> = {
  [PANE.traffic]: 350,
  [PANE.alt]: 405,
  [PANE.halo]: 412,
  [PANE.casing]: 414,
  [PANE.core]: 416,
  [PANE.sections]: 418,
}

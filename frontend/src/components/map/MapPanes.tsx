import { useState } from 'react'
import { useMap } from 'react-leaflet'
import { PANE_Z } from './paneNames'

/** Creates the map panes once. Panes are created here, not by <Pane> components, because a pane
 *  cannot be created twice: remounting a layer (route change, traffic toggle) would throw
 *  "A pane with this name already exists". Layers just reference a pane by name. */
export function MapPanes() {
  const map = useMap()
  useState(() => {
    for (const [name, z] of Object.entries(PANE_Z)) {
      if (!map.getPane(name)) map.createPane(name).style.zIndex = String(z)
    }
    return null
  })
  return null
}

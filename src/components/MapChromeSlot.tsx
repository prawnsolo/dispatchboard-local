import { createContext, useContext, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

type Slot = {
  node: HTMLDivElement | null
  setNode: (node: HTMLDivElement | null) => void
}

const MapChromeContext = createContext<Slot | null>(null)

export function MapChromeProvider({ children }: { children: ReactNode }) {
  const [node, setNode] = useState<HTMLDivElement | null>(null)
  return <MapChromeContext.Provider value={{ node, setNode }}>{children}</MapChromeContext.Provider>
}

/** Right side of header row 2. Rendered only while Map is the open tab. */
export function MapChromeSlot() {
  const slot = useContext(MapChromeContext)
  if (!slot) return null
  return (
    <div
      ref={slot.setNode}
      className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1.5"
      data-testid="map-header-chrome"
    />
  )
}

export function MapChromePortal({ children }: { children: ReactNode }) {
  const slot = useContext(MapChromeContext)
  if (!slot?.node) return null
  return createPortal(children, slot.node)
}

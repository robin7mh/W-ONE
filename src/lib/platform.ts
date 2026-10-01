import { useEffect, useState } from 'react'

/** True inside the Electron shell on macOS (native traffic lights, no custom controls). */
export const isMac = window.wone?.platform === 'darwin'

/** Live native-fullscreen state (macOS hides the traffic lights while it lasts). */
export function useFullScreen(): boolean {
  const [full, setFull] = useState(false)
  useEffect(() => {
    window.wone?.isFullScreen().then(setFull).catch(() => {})
    return window.wone?.onFullScreenChange(setFull)
  }, [])
  return full
}

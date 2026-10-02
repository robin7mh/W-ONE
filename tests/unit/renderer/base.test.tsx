import { act, render, renderHook, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installBridge, settle } from './bridge'

import { cn } from '@/lib/cn'
import { clamp, formatDate, formatTime, formatUptime, pad2 } from '@/lib/format'
import { applyTheme, initialTheme, useTheme } from '@/lib/theme'
import { useClock } from '@/hooks/useClock'
import { useBoot } from '@/hooks/useBoot'
import { NAV_ITEMS } from '@/data/navigation'
import { BOOT_LINES } from '@/data/bootLines'
import { errorMessage, ipc, IpcError, onEvent } from '@shared/ipc/client'
import { IPC_CHANNELS, IPC_EVENTS } from '@shared/ipc/contract'
import { DEFAULT_GRAPH_STYLE, GRAPH_COLORS } from '@shared/types/memory'
import { EVENT_CATALOG } from '@shared/types/events'
import { renderMarkdown } from '@/features/memory/markdown'
import { themeFromTokens } from '@/features/terminal/theme'

afterEach(() => {
  vi.useRealTimers()
  document.documentElement.style.cssText = ''
})

describe('lib', () => {
  it('cn joins truthy class names', () => {
    expect(cn('a', false, null, undefined, '', 'b')).toBe('a b')
  })

  it('format helpers', () => {
    const d = new Date(2026, 9, 1, 9, 5, 3)
    expect(pad2(7)).toBe('07')
    expect(formatTime(d)).toBe('09:05:03')
    expect(formatDate(d)).toBe('THU 01 OCT 2026') // jsdom locale: en-US
    expect(formatUptime(3725)).toBe('01:02:05')
    expect(clamp(150)).toBe(100)
    expect(clamp(-5)).toBe(0)
    expect(clamp(5, 10, 20)).toBe(10)
  })

  it('theme: saved choice, else OS appearance; persisting survives storage errors', () => {
    expect(initialTheme()).toBe('dark')
    ;(globalThis as { matchMediaMatches: Record<string, boolean> }).matchMediaMatches['(prefers-color-scheme: light)'] = true
    expect(initialTheme()).toBe('light')
    localStorage.setItem('wone.theme', 'dark')
    expect(initialTheme()).toBe('dark')
    localStorage.setItem('wone.theme', 'bogus')
    expect(initialTheme()).toBe('light')

    applyTheme('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(localStorage.getItem('wone.theme')).toBe('bogus') // not persisted
    applyTheme('dark', true)
    expect(localStorage.getItem('wone.theme')).toBe('dark')

    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(initialTheme()).toBe('light')
    expect(() => applyTheme('light', true)).not.toThrow()
    get.mockRestore()
    set.mockRestore()
  })

  it('useTheme toggles and persists', () => {
    const { result } = renderHook(() => useTheme())
    expect(result.current[0]).toBe('dark') // no attribute yet → dark
    act(() => result.current[1]())
    expect(result.current[0]).toBe('light')
    expect(localStorage.getItem('wone.theme')).toBe('light')
    act(() => result.current[1]())
    expect(document.documentElement.dataset.theme).toBe('dark')

    document.documentElement.setAttribute('data-theme', 'light')
    expect(renderHook(() => useTheme()).result.current[0]).toBe('light')
  })
})

describe('platform', () => {
  it('detects macOS from the bridge and follows fullscreen changes', async () => {
    const bridge = installBridge({}, 'darwin')
    bridge.isFullScreen.mockResolvedValueOnce(true)
    vi.resetModules()
    const platform = await import('@/lib/platform')
    expect(platform.isMac).toBe(true)
    const { result, unmount } = renderHook(() => platform.useFullScreen())
    await act(settle)
    expect(result.current).toBe(true)
    act(() => bridge.setFullScreen(false))
    expect(result.current).toBe(false)
    unmount()

    bridge.isFullScreen.mockRejectedValueOnce(new Error('x'))
    renderHook(() => platform.useFullScreen())
    await act(settle)
  })

  it('is not macOS (and fullscreen stays false) without a bridge or on Windows', async () => {
    vi.resetModules()
    const noBridge = await import('@/lib/platform')
    expect(noBridge.isMac).toBe(false)
    const { result } = renderHook(() => noBridge.useFullScreen())
    expect(result.current).toBe(false)

    installBridge({}, 'win32')
    vi.resetModules()
    expect((await import('@/lib/platform')).isMac).toBe(false)
  })
})

describe('hooks', () => {
  it('useClock ticks every second and cleans up', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 0, 1, 10, 0, 0))
    const { result, unmount } = renderHook(() => useClock())
    expect(result.current.getSeconds()).toBe(0)
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(result.current.getSeconds()).toBe(1)
    unmount()
  })

  it('useBoot finishes after the total time, or immediately on skip', () => {
    vi.useFakeTimers()
    const a = renderHook(() => useBoot(500))
    expect(a.result.current.booted).toBe(false)
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(a.result.current.booted).toBe(true)

    const b = renderHook(() => useBoot(10_000))
    act(() => b.result.current.skip())
    expect(b.result.current.booted).toBe(true)
    b.unmount()
  })
})

describe('data & shared constants', () => {
  it('navigation and boot lines', () => {
    expect(NAV_ITEMS.map((n) => n.id)).toEqual(['core', 'terminal', 'projects', 'memory', 'agents', 'system', 'settings'])
    expect(NAV_ITEMS.filter((n) => n.ready).map((n) => n.id)).toEqual(['core', 'terminal', 'projects', 'memory'])
    expect(BOOT_LINES.length).toBeGreaterThan(3)
  })

  it('contract allowlists, graph palette and event catalog', async () => {
    expect(IPC_CHANNELS).toContain('memory:link')
    expect(new Set(IPC_CHANNELS).size).toBe(IPC_CHANNELS.length)
    expect(IPC_EVENTS).toEqual(['system:tick', 'context:progress', 'memory:changed', 'terminal:data', 'terminal:exit'])
    expect(GRAPH_COLORS).toHaveLength(8)
    expect(DEFAULT_GRAPH_STYLE).toEqual({ mode: 'colorful', color: 'cyan' })
    expect(EVENT_CATALOG['app.started']).toBe('activity')
    // type-only modules: loading them proves they compile to side-effect-free modules
    for (const mod of await Promise.all([
      import('@shared/types/context'),
      import('@shared/types/entity'),
      import('@shared/types/project'),
      import('@shared/types/settings'),
      import('@shared/types/system'),
      import('@shared/types/terminal'),
      import('@/types')
    ])) {
      expect(Object.keys(mod)).toEqual([])
    }
  })
})

describe('ipc client', () => {
  it('unwraps ok results and throws IpcError on failures', async () => {
    installBridge({ 'projects:list': () => [1], 'projects:remove': () => Promise.reject(Object.assign(new Error('gone'), { code: 'not-found' })) })
    expect(await ipc('projects:list')).toEqual([1])
    const err = await ipc('projects:remove', { id: 'x' }).catch((e) => e)
    expect(err).toBeInstanceOf(IpcError)
    expect(err).toMatchObject({ name: 'IpcError', code: 'not-found', message: 'gone' })
  })

  it('fails cleanly without a bridge; events no-op', async () => {
    await expect(ipc('projects:list')).rejects.toMatchObject({ code: 'no-bridge' })
    expect(onEvent('system:tick', () => {})()).toBeUndefined()
  })

  it('subscribes to push events', () => {
    const bridge = installBridge()
    const cb = vi.fn()
    const off = onEvent('system:tick', cb)
    bridge.emit('system:tick', { ts: 1 })
    expect(cb).toHaveBeenCalledWith({ ts: 1 })
    off()
    expect(bridge.listenerCount('system:tick')).toBe(0)
  })

  it('errorMessage', () => {
    expect(errorMessage(new IpcError('c', 'ipc'))).toBe('ipc')
    expect(errorMessage(new Error('plain'))).toBe('plain')
    expect(errorMessage('str')).toBe('str')
  })
})

describe('markdown', () => {
  it('renders wikilinks (alias, anchor, unresolved), tags, and sanitizes', () => {
    const html = renderMarkdown(
      'See [[A]] [[B|Bee]] [[C#Part]] [[Missing]] ![[Embed]] [[]] #tag #123 C#sharp\n\n<a class="wikilink">raw</a><script>x()</script><img src=x onerror=alert(1)>',
      { A: 'A.md', B: 'B.md', C: 'C.md', Embed: 'E.md' }
    )
    expect(html).toContain('<a class="wikilink" data-target="A">A</a>')
    expect(html).toContain('data-target="B">Bee</a>')
    expect(html).toContain('data-target="C">C › Part</a>')
    expect(html).toContain('class="wikilink unresolved" data-target="Missing"')
    expect(html).toContain('<a class="wikilink unresolved">raw</a>')
    expect(html).toContain('[[]]')
    expect(html).toContain('<span class="md-tag">#tag</span>')
    expect(html).not.toContain('#123</span>')
    expect(html).not.toContain('#sharp</span>')
    expect(html).not.toMatch(/<script|onerror/)
  })

  it('escapes HTML inside link labels and tags', () => {
    const html = renderMarkdown('[[a&b|<x>"]]', {})
    expect(html).toContain('data-target="a&amp;b"')
    expect(html).toContain('&lt;x&gt;"')
  })
})

describe('terminal theme', () => {
  it('maps CSS tokens to xterm colors with fallbacks', () => {
    document.documentElement.style.setProperty('--accent-cyan', '1 2 3')
    document.documentElement.style.setProperty('--text-primary', 'nope nope nope')
    const t = themeFromTokens()
    expect(t.cyan).toBe('#010203')
    expect(t.selectionBackground).toBe('#01020340')
    expect(t.foreground).toBe('#e2ecf7') // NaN → fallback
    expect(t.blue).toBe('#4a84ff') // unset → fallback
  })
})

describe('entry points', () => {
  it('main.tsx applies the theme before rendering <App/> into #root', async () => {
    const render = vi.fn()
    vi.doMock('react-dom/client', () => ({ default: { createRoot: vi.fn(() => ({ render })) } }))
    vi.doMock('@/App', () => ({ default: () => null }))
    document.body.innerHTML = '<div id="root"></div>'
    localStorage.setItem('wone.theme', 'light')
    vi.resetModules()
    await import('@/main')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(render).toHaveBeenCalledTimes(1)
    vi.doUnmock('react-dom/client')
    vi.doUnmock('@/App')
  })

  it('App renders the shell', async () => {
    vi.doMock('@/components/shell/AppShell', () => ({ AppShell: () => <div>shell</div> }))
    vi.resetModules()
    const { default: App } = await import('@/App')
    render(<App />)
    expect(screen.getByText('shell')).toBeInTheDocument()
    vi.doUnmock('@/components/shell/AppShell')
  })
})

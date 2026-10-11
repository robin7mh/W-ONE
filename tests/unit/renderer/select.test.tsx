import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FolderGit2 } from 'lucide-react'
import { Select } from '@/components/ui/Select'

const options = [
  { value: 'a', label: 'Alpha', hint: '/code/alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma' }
]
const box = () => screen.getByRole('combobox')
const menu = () => screen.queryByRole('listbox')
const activeOption = () => screen.getAllByRole('option').find((o) => o.className.includes('bg-cyan/10'))!.textContent

describe('Select', () => {
  it('opens below the field, marks the current option, picks with the mouse', () => {
    const onChange = vi.fn()
    render(<Select label="Project" icon={FolderGit2} value="b" options={options} onChange={onChange} />)
    expect(box()).toHaveTextContent('Beta')
    expect(box()).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(box())
    expect(box()).toHaveAttribute('aria-expanded', 'true')
    expect(menu()!.style.top).not.toBe('') // room below
    expect(screen.getByRole('option', { name: 'Beta' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('/code/alpha')).toBeInTheDocument()
    fireEvent.mouseEnter(screen.getByRole('option', { name: /Gamma/ }))
    expect(activeOption()).toBe('Gamma')
    fireEvent.mouseDown(screen.getByRole('option', { name: /Gamma/ })) // keeps focus, stays open
    expect(menu()).not.toBeNull()
    fireEvent.click(screen.getByRole('option', { name: /Gamma/ }))
    expect(onChange).toHaveBeenCalledWith('c')
    expect(menu()).toBeNull()
    expect(box()).toHaveFocus()

    fireEvent.click(box())
    fireEvent.click(screen.getByRole('option', { name: 'Beta' })) // the current one: nothing changes
    expect(onChange).toHaveBeenCalledTimes(1)
    fireEvent.click(box())
    fireEvent.click(box()) // toggles closed
    expect(menu()).toBeNull()
  })

  it('works from the keyboard: open, move, wrap at the ends, pick, Escape and Tab close', () => {
    const onChange = vi.fn()
    render(<Select label="Project" value="a" options={options} onChange={onChange} />)
    fireEvent.keyDown(box(), { key: 'x' }) // nothing while closed
    expect(menu()).toBeNull()
    fireEvent.keyDown(box(), { key: 'ArrowDown' })
    expect(activeOption()).toBe('Alpha/code/alpha')
    fireEvent.keyDown(box(), { key: 'ArrowUp' }) // already first
    fireEvent.keyDown(box(), { key: 'End' })
    expect(activeOption()).toBe('Gamma')
    fireEvent.keyDown(box(), { key: 'ArrowDown' }) // already last
    fireEvent.keyDown(box(), { key: 'ArrowUp' })
    expect(activeOption()).toBe('Beta')
    fireEvent.keyDown(box(), { key: 'Home' })
    fireEvent.keyDown(box(), { key: 'ArrowDown' })
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(onChange).toHaveBeenLastCalledWith('b')

    fireEvent.keyDown(box(), { key: ' ' })
    fireEvent.keyDown(box(), { key: 'ArrowDown' })
    fireEvent.keyDown(box(), { key: ' ' })
    expect(onChange).toHaveBeenLastCalledWith('b') // value stays 'a' here: the second entry again
    fireEvent.keyDown(box(), { key: 'Enter' })
    fireEvent.keyDown(box(), { key: 'q' }) // other keys while open: ignored
    fireEvent.keyDown(box(), { key: 'Escape' })
    expect(menu()).toBeNull()
    fireEvent.keyDown(box(), { key: 'ArrowUp' })
    fireEvent.keyDown(box(), { key: 'Tab' })
    expect(menu()).toBeNull()
  })

  it('opens upwards without room below; outside clicks, scrolling elsewhere and resizing close it', () => {
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: 700, bottom: 730, left: 10, width: 200 } as DOMRect)
    render(
      <div>
        <Select label="Project context" variant="quiet" value="" placeholder="No project" options={options} onChange={vi.fn()} />
        <p>elsewhere</p>
      </div>
    )
    expect(box()).toHaveTextContent('No project') // no matching option
    fireEvent.click(box())
    expect(menu()!.style.bottom).not.toBe('')
    fireEvent.mouseDown(screen.getByRole('option', { name: /Beta/ })) // inside: stays
    fireEvent.mouseDown(box())
    expect(menu()).not.toBeNull()
    fireEvent.mouseDown(screen.getByText('elsewhere'))
    expect(menu()).toBeNull()

    fireEvent.click(box())
    fireEvent.scroll(menu()!) // the menu's own list scrolls: stays
    expect(menu()).not.toBeNull()
    fireEvent.scroll(document) // the page (or another area) scrolls
    expect(menu()).toBeNull()
    fireEvent.click(box())
    act(() => void window.dispatchEvent(new Event('resize')))
    expect(menu()).toBeNull()
    rect.mockRestore()
  })

  it('is disabled without options; the quiet variant shows a chosen value brighter', () => {
    const { rerender } = render(<Select label="Model" value="" options={[]} onChange={vi.fn()} />)
    expect(box()).toBeDisabled()
    rerender(<Select label="Model" variant="quiet" value="a" options={options} onChange={vi.fn()} />)
    expect(box().className).toContain('text-text-secondary')
  })
})

/** A class property as declared in PHP (`private ?string $name;`). */
export interface PhpProperty {
  name: string
  /** Its type, if declared (`?string`, `int|float`, `\Foo\Bar`). */
  type?: string
  /** 1-based line of the declaration. */
  line: number
}

const PROPERTY = /^\s*(?:(?:public|protected|private|var)\s+)(?:static\s+)?(?:readonly\s+)?(\??[\w\\|]+\s+)?\$(\w+)\s*[=;]/

/** Properties declared on the given lines (1-based, inclusive). */
export function phpProperties(lines: string[], from: number, to: number): PhpProperty[] {
  const found: PhpProperty[] = []
  for (let n = from; n <= to; n += 1) {
    const m = PROPERTY.exec(lines[n - 1] ?? '')
    if (m && !/\bfunction\b/.test(lines[n - 1])) found.push({ name: m[2], type: m[1]?.trim() || undefined, line: n })
  }
  return found
}

/**
 * The line of the closing brace of the class around `line` (1-based), counting
 * braces outside strings and comments; undefined when there is none.
 */
export function phpClassEnd(lines: string[], line: number): number | undefined {
  let start = -1
  for (let n = line - 1; n >= 0; n -= 1) {
    if (/\b(class|trait|enum)\s+\w+/.test(lines[n])) {
      start = n
      break
    }
  }
  if (start < 0) return undefined
  let depth = 0
  let opened = false
  for (let n = start; n < lines.length; n += 1) {
    const code = lines[n].replace(/(["'])(?:\\.|(?!\1).)*\1/g, '').replace(/\/\/.*$|#.*$/, '')
    for (const ch of code) {
      if (ch === '{') {
        depth += 1
        opened = true
      } else if (ch === '}') {
        depth -= 1
        if (opened && depth === 0) return n + 1
      }
    }
  }
  return undefined
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** A getter like the VS Code extension writes it. */
export function phpGetter(p: PhpProperty, indent = '    '): string {
  const returns = p.type ? `: ${p.type}` : ''
  return [
    `${indent}/**`,
    `${indent} * Get the value of ${p.name}`,
    `${indent} */`,
    `${indent}public function get${cap(p.name)}()${returns}`,
    `${indent}{`,
    `${indent}${indent}return $this->${p.name};`,
    `${indent}}`
  ].join('\n')
}

/** A fluent setter (returns `self`). */
export function phpSetter(p: PhpProperty, indent = '    '): string {
  const param = p.type ? `${p.type} $${p.name}` : `$${p.name}`
  return [
    `${indent}/**`,
    `${indent} * Set the value of ${p.name}`,
    `${indent} */`,
    `${indent}public function set${cap(p.name)}(${param}): self`,
    `${indent}{`,
    `${indent}${indent}$this->${p.name} = $${p.name};`,
    '',
    `${indent}${indent}return $this;`,
    `${indent}}`
  ].join('\n')
}

/** The methods to add for these properties, minus the ones the class already has. */
export function phpAccessors(text: string, props: PhpProperty[], kinds: ('get' | 'set')[]): string {
  const indent = /\n([ \t]+)\S/.exec(text)?.[1] ?? '    '
  const blocks: string[] = []
  for (const p of props) {
    for (const kind of kinds) {
      const name = `${kind}${cap(p.name)}`
      if (new RegExp(`function\\s+${name}\\s*\\(`, 'i').test(text)) continue
      blocks.push(kind === 'get' ? phpGetter(p, indent) : phpSetter(p, indent))
    }
  }
  return blocks.map((b) => `\n${b}\n`).join('')
}

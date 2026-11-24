// SVG figures (§5.3, §5.4). A figure is inlined, not linked, so it inherits
// `currentColor` and the theme. Content is trusted but still constrained: the
// validator rejects an SVG with scripts, event handlers, external references
// or no `viewBox`, and the renderer strips the same things regardless, so a
// file that slipped past the validator still cannot run code or load anything.

import type { Element, ElementContent, Properties, Root } from "hast"
import { fromHtml } from "hast-util-from-html"

/** Elements a diagram may use. Everything else is dropped with its content. */
const ALLOWED_ELEMENTS = new Set([
  "svg",
  "g",
  "defs",
  "symbol",
  "use",
  "title",
  "desc",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "marker",
  "lineargradient",
  "radialgradient",
  "stop",
  "clippath",
  "mask",
  "pattern",
])

/** hast lowercases some SVG names in its `tagName` only when parsed as HTML. */
const normalizeTag = (tag: string) => tag.toLowerCase()

/** Property names (hast camelCase) whose value may hold `url(...)`. */
const URL_VALUE = /url\(\s*['"]?\s*([^)'"\s]*)/gi

export type SvgIssue = { message: string }

export type SanitizedSvg = {
  /** The `<svg>` element, or null when the file has none. */
  svg: Element | null
  /** What the validator rejects; the renderer has already removed it. */
  issues: SvgIssue[]
}

/**
 * Parses and sanitizes an SVG file.
 *
 * - Keeps only the drawing elements above, without comments or doctypes.
 * - Drops event handlers (`on*`), `style` (it can load URLs), and any `href`
 *   or `url(...)` that is not a same-document `#fragment`.
 * - Prefixes every `id` and its references with `idPrefix`, so two figures
 *   (or one brief rendered twice on a page) cannot collide.
 * - Removes the root's `width` and `height`, so the `viewBox` sets the aspect
 *   ratio and CSS sets the size; makes the root `role="img"` named by `alt`.
 */
export function sanitizeSvg(
  source: string,
  opts: { idPrefix: string; alt: string }
): SanitizedSvg {
  const issues: SvgIssue[] = []
  const tree: Root = fromHtml(source, { fragment: true })
  const roots = tree.children.filter((n): n is Element => n.type === "element")
  const svg = roots.length === 1 && roots[0].tagName === "svg" ? roots[0] : null
  if (!svg) {
    issues.push({ message: "must contain exactly one top-level <svg> element" })
    return { svg: null, issues }
  }

  const ids = new Set<string>()
  collectIds(svg, ids)
  const prefixed = (id: string) => `${opts.idPrefix}-${id}`

  const clean = (el: Element): Element => {
    const properties: Properties = {}
    for (const [key, value] of Object.entries(el.properties)) {
      if (value === null || value === undefined) continue
      const name = key.toLowerCase()
      if (name.startsWith("on")) {
        issues.push({
          message: `<${el.tagName}> has an event handler "${key}"`,
        })
        continue
      }
      if (name === "style") {
        issues.push({
          message: `<${el.tagName}> has a style attribute; use presentation attributes`,
        })
        continue
      }
      if (name === "href" || name === "xlinkhref") {
        const href = String(value).trim()
        if (!href.startsWith("#")) {
          issues.push({
            message: `<${el.tagName}> links outside the file (${JSON.stringify(href)})`,
          })
          continue
        }
        properties[key] = ids.has(href.slice(1))
          ? `#${prefixed(href.slice(1))}`
          : href
        continue
      }
      if (name === "id") {
        properties.id = prefixed(String(value))
        continue
      }
      if (name === "arialabelledby" || name === "ariadescribedby") {
        const refs = (Array.isArray(value) ? value : String(value).split(/\s+/))
          .map(String)
          .filter(Boolean)
        properties[key] = refs.map((r) => (ids.has(r) ? prefixed(r) : r))
        continue
      }
      if (typeof value === "string" && /url\(/i.test(value)) {
        let external = false
        const rewritten = value.replace(URL_VALUE, (match, target: string) => {
          if (!target.startsWith("#")) {
            external = true
            return match
          }
          const id = target.slice(1)
          return ids.has(id) ? match.replace(target, `#${prefixed(id)}`) : match
        })
        if (external) {
          issues.push({
            message: `<${el.tagName}> references a URL outside the file in "${key}"`,
          })
          continue
        }
        properties[key] = rewritten
        continue
      }
      properties[key] = value
    }

    const children: ElementContent[] = []
    for (const child of el.children) {
      if (child.type === "text") children.push(child)
      else if (child.type === "element") {
        if (ALLOWED_ELEMENTS.has(normalizeTag(child.tagName)))
          children.push(clean(child))
        else issues.push({ message: `<${child.tagName}> is not allowed` })
      }
      // Comments are dropped silently.
    }
    return { type: "element", tagName: el.tagName, properties, children }
  }

  const out = clean(svg)
  if (!out.properties.viewBox) issues.push({ message: "<svg> has no viewBox" })
  delete out.properties.width
  delete out.properties.height
  // The figure's `alt` is the accessible name; a labelledby pointing at the
  // file's own <title> would override it.
  delete out.properties.ariaLabelledBy
  delete out.properties.ariaDescribedBy
  out.properties.role = "img"
  out.properties.ariaLabel = opts.alt
  out.properties.focusable = "false"
  return { svg: out, issues }
}

function collectIds(el: Element, ids: Set<string>): void {
  if (typeof el.properties.id === "string") ids.add(el.properties.id)
  for (const child of el.children)
    if (child.type === "element") collectIds(child, ids)
}

/**
 * A copy of a sanitized `<svg>` with `-${suffix}` added to every id it
 * defines and to each reference to one (`href="#…"`, `url(#…)`,
 * `aria-labelledby`). The renderer's prefix keeps figures apart within one
 * brief; this keeps two renders of the same brief on one page apart.
 */
export function withIdSuffix(svg: Element, suffix: string): Element {
  const ids = new Set<string>()
  collectIds(svg, ids)
  if (!ids.size) return svg
  const map = (id: string) => (ids.has(id) ? `${id}-${suffix}` : id)

  const copy = (el: Element): Element => {
    const properties: Properties = {}
    for (const [key, value] of Object.entries(el.properties)) {
      const name = key.toLowerCase()
      if (name === "id" && typeof value === "string")
        properties[key] = map(value)
      else if (
        (name === "href" || name === "xlinkhref") &&
        typeof value === "string"
      )
        properties[key] = value.startsWith("#")
          ? `#${map(value.slice(1))}`
          : value
      else if (name === "arialabelledby" || name === "ariadescribedby")
        properties[key] = Array.isArray(value)
          ? value.map((v) => map(String(v)))
          : value
      else if (typeof value === "string" && /url\(/i.test(value))
        properties[key] = value.replace(URL_VALUE, (match, target: string) =>
          target.startsWith("#")
            ? match.replace(target, `#${map(target.slice(1))}`)
            : match
        )
      else properties[key] = value
    }
    return {
      type: "element",
      tagName: el.tagName,
      properties,
      children: el.children.map((c) => (c.type === "element" ? copy(c) : c)),
    }
  }
  return copy(svg)
}

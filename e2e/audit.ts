import AxeBuilder from "@axe-core/playwright"
import type { Page } from "@playwright/test"

// The accessibility and phone audit (T19, WF-I, WF-J), shared by the axe
// spec and the journeys.

/** Serious and critical axe violations, with the elements they hit (§10). */
export async function axe(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze()
  return violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }))
}

/**
 * Phone tap targets (WF-I, §9.4): every control is at least 44 px each way,
 * and in the player the answer and action buttons are 8 px apart. A radio
 * or checkbox is tapped through its label, so the label is measured. Links
 * inside running text (the brief, citation chips) are exempt, as in WCAG
 * 2.5.8. While a menu or dialog is open, only its controls count. Returns
 * the controls that fail.
 */
export async function tapTargets(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const MIN = 44
    const GAP = 8
    const selector = [
      "button",
      "a[href]",
      "input:not([type=hidden]):not([type=checkbox]):not([type=radio])",
      "textarea",
      "select",
      '[role="button"]',
      '[role="tab"]',
      '[role="menuitem"]',
      '[role="menuitemradio"]',
    ].join(",")
    const choice = '[role="radio"], [role="checkbox"]'

    const name = (el: Element) => {
      const text = (
        el.getAttribute("aria-label") ??
        (el as HTMLElement).innerText ??
        ""
      )
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 40)
      return `${el.tagName.toLowerCase()} "${text}"`
    }
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect()
      if (r.width <= 1 || r.height <= 1) return false
      for (let e: Element | null = el; e; e = e.parentElement) {
        const style = getComputedStyle(e)
        // Visually hidden until focused, like the skip link.
        if (style.clip.startsWith("rect") || style.clipPath.startsWith("inset"))
          return false
        if (style.visibility === "hidden" || style.display === "none")
          return false
      }
      return !el.closest("[aria-hidden=true], [inert]")
    }
    // A link in running text: the brief, an explanation, a prompt.
    const inText = (el: Element) =>
      el.matches("a") &&
      el.closest("nav, [data-slot=action-bar]") === null &&
      el.closest("p, li, td, blockquote, figcaption") !== null &&
      (getComputedStyle(el).display === "inline" ||
        el.matches("a[aria-label^='Source ']"))

    const overlay = [
      ...document.querySelectorAll('[role="dialog"], [role="menu"]'),
    ].at(-1)
    const scope = overlay ?? document.body

    const targets = new Set<Element>()
    for (const el of scope.querySelectorAll(selector)) {
      if (el.matches(choice) || el.closest(choice)) continue
      if (el.closest("label")?.querySelector(choice)) continue
      targets.add(el)
    }
    for (const el of scope.querySelectorAll(choice)) {
      targets.add(el.closest("label") ?? el)
    }
    const list = [...targets].filter((el) => visible(el) && !inText(el))
    // A control inside another one is the same tap.
    const outer = list.filter(
      (el) => !list.some((o) => o !== el && o.contains(el))
    )

    const failures: string[] = []
    for (const el of outer) {
      const r = el.getBoundingClientRect()
      if (r.height < MIN - 0.5 || r.width < MIN - 0.5)
        failures.push(
          `${name(el)} is ${Math.round(r.width)}×${Math.round(r.height)}`
        )
    }

    // Spacing, among the player's controls in the same layer: the pinned
    // action bar scrolls over the item, so the two are never side by side.
    const player = document.querySelector("[data-slot=player-main]")
    const layer = (el: Element) =>
      el.closest("[data-slot=action-bar]") ?? overlay ?? player
    const spaced = outer.filter((el) => player?.contains(el) || overlay)
    for (let i = 0; i < spaced.length; i++) {
      for (let j = i + 1; j < spaced.length; j++) {
        if (layer(spaced[i]) !== layer(spaced[j])) continue
        const a = spaced[i].getBoundingClientRect()
        const b = spaced[j].getBoundingClientRect()
        const dx = Math.max(0, b.left - a.right, a.left - b.right)
        const dy = Math.max(0, b.top - a.bottom, a.top - b.bottom)
        const gap = Math.max(dx, dy)
        if (gap < GAP - 0.5)
          failures.push(
            `${name(spaced[i])} and ${name(spaced[j])} are ${Math.round(gap)} px apart`
          )
      }
    }
    return failures
  })
}

/** Whether the test runs in the phone project (§10.1). */
export const isPhone = (projectName: string) => projectName === "phone"

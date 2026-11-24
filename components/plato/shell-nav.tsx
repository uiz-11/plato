"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { HouseIcon, LibraryIcon, PlusIcon, type LucideIcon } from "lucide-react"

import { buttonVariants } from "@/components/ui/button"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"

// The shell's navigation (§8.1, §9.4, WF-I): a sidebar on desktop, and on
// phone a header with "+" for New request and bottom tabs for Today and
// Library. Both are rendered; CSS at the `md` breakpoint (768px, as in
// `useIsMobile`) shows one, so nothing shifts after hydration.
//
// Today and Library are places; New request is an action, so it is a
// button outside the nav (WF-A1).

interface NavItem {
  href: string
  label: string
  icon: LucideIcon
}

const TODAY: NavItem = { href: "/", label: "Today", icon: HouseIcon }
const LIBRARY: NavItem = {
  href: "/library",
  label: "Library",
  icon: LibraryIcon,
}
const NEW_REQUEST_HREF = "/new"
const NEW_REQUEST_LABEL = "New request"

/**
 * Whether `href` is the current section. Course pages belong to Library,
 * where courses are listed.
 */
export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/"
  if (href === "/library")
    return pathname === "/library" || pathname.startsWith("/courses/")
  return pathname === href || pathname.startsWith(`${href}/`)
}

function useCurrent(href: string) {
  const pathname = usePathname()
  return isActive(pathname, href)
}

/** The "Plato" wordmark, linking to Today. 44px tall (WF-I). */
function Wordmark() {
  return (
    <Link
      href="/"
      data-slot="wordmark"
      className="inline-flex min-h-11 w-fit items-center rounded-md px-2 text-base font-semibold focus-ring"
    >
      Plato
    </Link>
  )
}

function SidebarLink({ item }: { item: NavItem }) {
  const current = useCurrent(item.href)
  const Icon = item.icon
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={current}
        // An indicator bar and weight as well as the shade (WF-J).
        className="relative data-active:font-semibold data-active:before:absolute data-active:before:inset-y-1.5 data-active:before:left-0 data-active:before:w-0.5 data-active:before:rounded-full data-active:before:bg-sidebar-accent-foreground"
        render={
          <Link href={item.href} aria-current={current ? "page" : undefined} />
        }
      >
        <Icon aria-hidden />
        <span>{item.label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

/** Desktop sidebar: Today and Library, then "+ New request" (WF-A1). */
export function AppSidebar() {
  const newCurrent = useCurrent(NEW_REQUEST_HREF)
  return (
    <Sidebar
      collapsible="none"
      className="sticky top-0 hidden h-svh border-r md:flex"
    >
      <SidebarHeader>
        <Wordmark />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <nav aria-label="Main">
              <SidebarMenu>
                <SidebarLink item={TODAY} />
                <SidebarLink item={LIBRARY} />
              </SidebarMenu>
            </nav>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          {/* A link styled as a button: Base UI's Button would give it
              role="button". */}
          <Link
            href={NEW_REQUEST_HREF}
            aria-current={newCurrent ? "page" : undefined}
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              // When current, a darker border and weight as well as the shade.
              "justify-start focus-visible:ring-ring aria-[current=page]:border-foreground aria-[current=page]:bg-muted aria-[current=page]:font-semibold"
            )}
          >
            <PlusIcon aria-hidden />
            {NEW_REQUEST_LABEL}
          </Link>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}

/**
 * Phone header: the wordmark and "+" for New request (WF-I1). It keeps the
 * wordmark rather than the page title; pages carry their own heading (§9.4).
 */
export function PhoneHeader() {
  const current = useCurrent(NEW_REQUEST_HREF)
  return (
    <header
      data-slot="phone-header"
      className="sticky top-0 z-20 flex h-(--phone-header-h) items-center justify-between border-b bg-background/95 px-2 backdrop-blur supports-backdrop-filter:bg-background/80 md:hidden"
    >
      <Wordmark />
      <Link
        href={NEW_REQUEST_HREF}
        aria-label={NEW_REQUEST_LABEL}
        aria-current={current ? "page" : undefined}
        className={cn(
          buttonVariants({ variant: "ghost", size: "icon-lg" }),
          // 44px tap target (WF-I). When current, a bar as well as the shade.
          "relative size-11 focus-visible:ring-ring aria-[current=page]:bg-muted aria-[current=page]:before:absolute aria-[current=page]:before:bottom-1 aria-[current=page]:before:left-1/2 aria-[current=page]:before:h-0.5 aria-[current=page]:before:w-4 aria-[current=page]:before:-translate-x-1/2 aria-[current=page]:before:rounded-full aria-[current=page]:before:bg-foreground"
        )}
      >
        <PlusIcon className="size-5" aria-hidden />
      </Link>
    </header>
  )
}

function TabLink({ item }: { item: NavItem }) {
  const current = useCurrent(item.href)
  const Icon = item.icon
  return (
    <Link
      href={item.href}
      aria-current={current ? "page" : undefined}
      className={cn(
        // Inset, so the ring isn't clipped by the fixed bar.
        "relative flex min-h-(--phone-tabs-h) flex-1 flex-col items-center justify-center gap-1 text-xs text-muted-foreground focus-ring focus-visible:ring-inset",
        // A short bar and weight as well as the shade (WF-J).
        current &&
          "font-semibold text-foreground before:absolute before:top-0 before:left-1/2 before:h-0.5 before:w-8 before:-translate-x-1/2 before:rounded-full before:bg-foreground"
      )}
    >
      <Icon className="size-5" aria-hidden />
      {item.label}
    </Link>
  )
}

/** Phone bottom tabs: Today and Library (WF-I1). */
export function PhoneTabs() {
  return (
    <nav
      aria-label="Main"
      data-slot="phone-tabs"
      className="fixed inset-x-0 bottom-0 z-20 flex border-t bg-background pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <TabLink item={TODAY} />
      <TabLink item={LIBRARY} />
    </nav>
  )
}

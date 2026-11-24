import {
  AppSidebar,
  PhoneHeader,
  PhoneTabs,
} from "@/components/plato/shell-nav"
import { SidebarProvider } from "@/components/ui/sidebar"

// Shell chrome (§8.1): the sidebar on desktop; on phone, a header with "+"
// for New request and bottom tabs for Today and Library (WF-I).
export default function ShellLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // The sidebar never collapses, so Cmd/Ctrl+B stays the browser's.
    <SidebarProvider keyboardShortcut={false}>
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-background px-3 py-2 text-sm focus-ring focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col bg-background">
        <PhoneHeader />
        {/* Bottom padding keeps content clear of the phone tabs: their
            height, 1px top border and the safe area (globals.css). */}
        <main
          id="main"
          tabIndex={-1}
          className="flex flex-1 flex-col pb-[calc(var(--phone-tabs-h)+1px+env(safe-area-inset-bottom))] outline-none md:pb-0"
        >
          {children}
        </main>
        <PhoneTabs />
      </div>
    </SidebarProvider>
  )
}

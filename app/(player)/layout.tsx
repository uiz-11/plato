// The player runs full-window, without the sidebar or tabs (§8.1, WF-D).
export default function PlayerLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <div className="flex min-h-svh flex-col">{children}</div>
}

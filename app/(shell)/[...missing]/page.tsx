import { notFound } from "next/navigation"

// Any URL no other route matches 404s inside the shell, so the navigation
// stays (§8.1). More specific routes always win over this catch-all.
export default function Missing() {
  notFound()
}

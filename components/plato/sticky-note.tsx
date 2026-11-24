import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const stickyNoteVariants = cva(
  // Hover only when it is something to click: a button, link or role=button.
  "flex min-h-24 w-full flex-col gap-2 rounded-lg border p-3 text-left text-sm focus-ring transition-colors [&:is(button,a,[role=button])]:cursor-pointer",
  {
    variants: {
      variant: {
        /** A note: the learner's words, then the lesson it came from. */
        note: "bg-muted/40 shadow-xs [&:is(button,a,[role=button])]:hover:bg-muted",
        /** The "+ Add note" slot (WF-C2, §9.4). */
        add: "items-center justify-center border-dashed bg-transparent text-muted-foreground [&:is(button,a,[role=button])]:hover:bg-muted/50 [&:is(button,a,[role=button])]:hover:text-foreground",
      },
    },
    defaultVariants: { variant: "note" },
  }
)

/**
 * An answer note (WF-C2, WF-E6): the learner's words with the lesson it is
 * labelled with underneath. A plain block by default; pass `render` (a
 * `PopoverTrigger` or a `<button>`) to make it the thing you click to edit.
 * `variant="add"` is the dashed "+ Add note" slot.
 */
export function StickyNote({
  label,
  variant = "note",
  children,
  className,
  render,
  ...props
}: useRender.ComponentProps<"div"> &
  VariantProps<typeof stickyNoteVariants> & {
    /** "Lesson 3". */
    label?: string
  }) {
  return useRender({
    defaultTagName: "div",
    render,
    props: mergeProps<"div">(
      {
        className: cn(stickyNoteVariants({ variant }), className),
        children:
          variant === "add" ? (
            children
          ) : (
            <>
              <span className="whitespace-pre-wrap">{children}</span>
              {label && (
                <span className="mt-auto text-xs font-medium text-muted-foreground">
                  {label}
                </span>
              )}
            </>
          ),
      },
      props
    ),
    state: { slot: "sticky-note", variant },
  })
}

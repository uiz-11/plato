"use client"

import { useId, useRef, useState, useTransition } from "react"
import { unstable_rethrow } from "next/navigation"
import { PlusIcon } from "lucide-react"
import { toast } from "sonner"

import { addNote, deleteNote, editNote, restoreNote } from "@/app/actions/notes"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Textarea } from "@/components/ui/textarea"

import { StickyNote } from "./sticky-note"

/** `NOTE_MAX_CHARS` in lib/dal/notes, which the action checks. */
const MAX_CHARS = 2000

export interface AnswerNote {
  id: string
  text: string
  /** "Lesson 2"; null for a note added on the Answers tab. */
  lessonLabel: string | null
}

/**
 * A key question's answer notes on the Answers tab (§9.4, WF-C2): each note
 * is a sticky note that opens an editor to edit or delete it, then the
 * "+ Add note" sticky. Nothing here is graded.
 */
export function AnswerNotes({
  courseId,
  keyQuestionId,
  notes,
}: {
  courseId: string
  keyQuestionId: string
  notes: AnswerNote[]
}) {
  const addRef = useRef<HTMLButtonElement>(null)
  const label = keyQuestionId.toUpperCase()
  // Undo outlives the deleted note's own editor, so it runs here.
  const [, startTransition] = useTransition()

  function deleted(note: AnswerNote) {
    // This note's trigger is gone; keep focus in the question.
    requestAnimationFrame(() => addRef.current?.focus())
    toast("Note deleted", {
      // Long enough to reach Undo by keyboard or screen reader.
      duration: 10_000,
      action: {
        label: "Undo",
        onClick: () =>
          startTransition(async () => {
            try {
              await restoreNote({ id: note.id })
            } catch (err) {
              unstable_rethrow(err)
              toast.error("Couldn't restore the note. Try again.")
            }
          }),
      },
    })
  }
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {notes.map((n) => (
        <li key={n.id}>
          <EditNote
            note={n}
            questionLabel={label}
            onDeleted={() => deleted(n)}
          />
        </li>
      ))}
      <li>
        <AddNote
          courseId={courseId}
          keyQuestionId={keyQuestionId}
          questionLabel={label}
          triggerRef={addRef}
        />
      </li>
    </ul>
  )
}

/** Runs an action in a transition, with a toast instead of the error screen. */
function useNoteAction() {
  const [pending, startTransition] = useTransition()
  function run(
    action: () => Promise<unknown>,
    failed: string,
    done: () => void
  ) {
    startTransition(async () => {
      try {
        await action()
      } catch (err) {
        // An expired cookie redirects to /unlock: let Next handle it.
        unstable_rethrow(err)
        toast.error(failed)
        return
      }
      done()
    })
  }
  return [pending, run] as const
}

function NoteForm({
  title,
  text,
  setText,
  pending,
  submitLabel,
  onSubmit,
  children,
}: {
  title: string
  text: string
  setText: (t: string) => void
  pending: boolean
  submitLabel: string
  onSubmit: () => void
  /** Buttons before the submit button. */
  children: React.ReactNode
}) {
  const id = useId()
  return (
    <form
      className="flex flex-col gap-2.5"
      onSubmit={(e) => {
        e.preventDefault()
        // Cmd/Ctrl+Enter submits even while the button is disabled, so a
        // second press during a save must not send it again.
        if (!pending && text.trim()) onSubmit()
      }}
    >
      <PopoverTitle render={<label htmlFor={id} />}>{title}</PopoverTitle>
      <Textarea
        id={id}
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={MAX_CHARS}
        rows={4}
        autoFocus
        onKeyDown={(e) => {
          // Cmd/Ctrl+Enter saves; Enter alone is a new line.
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            e.currentTarget.form?.requestSubmit()
          }
        }}
      />
      <div className="flex justify-end gap-2">
        {children}
        <Button
          type="submit"
          size="sm"
          disabled={pending || !text.trim()}
          className="min-h-11 md:min-h-7"
        >
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}

function EditNote({
  note,
  questionLabel,
  onDeleted,
}: {
  note: AnswerNote
  questionLabel: string
  onDeleted: () => void
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState(note.text)
  const [pending, run] = useNoteAction()

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        // Reopening starts from the saved text.
        if (next) setText(note.text)
        setOpen(next)
      }}
    >
      <PopoverTrigger
        render={
          <StickyNote
            render={<button type="button" />}
            label={note.lessonLabel ?? undefined}
            className="h-full"
          />
        }
      >
        <span className="sr-only">Edit note: </span>
        {note.text}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)]">
        <NoteForm
          title={`Edit note · ${questionLabel}`}
          text={text}
          setText={setText}
          pending={pending}
          submitLabel="Save"
          onSubmit={() =>
            run(
              () => editNote({ id: note.id, text }),
              "Couldn't save the note. Try again.",
              () => setOpen(false)
            )
          }
        >
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            className="mr-auto min-h-11 text-destructive hover:text-destructive md:min-h-7"
            onClick={() =>
              run(
                () => deleteNote({ id: note.id }),
                "Couldn't delete the note. Try again.",
                () => {
                  setOpen(false)
                  onDeleted()
                }
              )
            }
          >
            Delete
          </Button>
        </NoteForm>
      </PopoverContent>
    </Popover>
  )
}

function AddNote({
  courseId,
  keyQuestionId,
  questionLabel,
  triggerRef,
}: {
  courseId: string
  keyQuestionId: string
  questionLabel: string
  triggerRef: React.RefObject<HTMLButtonElement | null>
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState("")
  const [pending, run] = useNoteAction()

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <StickyNote
            variant="add"
            render={<button type="button" ref={triggerRef} />}
            className="h-full"
          />
        }
      >
        <span className="inline-flex items-center gap-1">
          <PlusIcon aria-hidden className="size-4" />
          Add note
          <span className="sr-only"> to {questionLabel}</span>
        </span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)]">
        <NoteForm
          title={`New note · ${questionLabel}`}
          text={text}
          setText={setText}
          pending={pending}
          submitLabel="Add note"
          onSubmit={() =>
            run(
              () => addNote({ courseId, keyQuestionId, text }),
              "Couldn't add the note. Try again.",
              () => {
                setText("")
                setOpen(false)
              }
            )
          }
        >
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            className="min-h-11 md:min-h-7"
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
        </NoteForm>
      </PopoverContent>
    </Popover>
  )
}

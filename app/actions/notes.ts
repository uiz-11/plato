"use server"

import { refresh } from "next/cache"
import { z } from "zod"

import { requireLearner } from "@/lib/auth/learner"
import { Id, QId } from "@/lib/content/schema"
import {
  insertNote,
  NOTE_MAX_CHARS,
  reinsertNote,
  removeNote,
  updateNote,
} from "@/lib/dal/notes"

const NoteText = z.string().trim().min(1).max(NOTE_MAX_CHARS)
const NoteId = z.uuid()

/** "+ Add note" on the Answers tab (WF-C2). */
export async function addNote(input: unknown): Promise<{ id: string }> {
  await requireLearner()
  const parsed = z
    .strictObject({ courseId: Id, keyQuestionId: QId, text: NoteText })
    .parse(input)
  const result = await insertNote(parsed)
  refresh()
  return result
}

export async function editNote(input: unknown): Promise<void> {
  await requireLearner()
  await updateNote(z.strictObject({ id: NoteId, text: NoteText }).parse(input))
  refresh()
}

export async function deleteNote(input: unknown): Promise<void> {
  await requireLearner()
  await removeNote(z.strictObject({ id: NoteId }).parse(input))
  refresh()
}

/** Undo in the "Note deleted" toast: the note returns as it was. */
export async function restoreNote(input: unknown): Promise<void> {
  await requireLearner()
  await reinsertNote(z.strictObject({ id: NoteId }).parse(input))
  refresh()
}

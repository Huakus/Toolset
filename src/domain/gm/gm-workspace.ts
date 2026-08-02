import { z } from "zod";
import { STABLE_ID_PATTERN } from "../../shared/id";

const StableIdSchema = z.string().regex(STABLE_ID_PATTERN);

export const GmNoteSchema = z.object({
  id: StableIdSchema,
  title: z.string().min(1),
  content: z.string(),
});

export const GmNoteGroupSchema = z.object({
  id: StableIdSchema,
  title: z.string().min(1),
  notes: z.array(GmNoteSchema),
});

export const GmRandomTableSchema = z.object({
  id: StableIdSchema,
  name: z.string().min(1),
  entries: z.array(z.string().min(1)),
});

export const GmWorkspaceSchema = z.object({
  noteGroups: z.array(GmNoteGroupSchema).default([]),
  randomTables: z.array(GmRandomTableSchema).default([]),
  googleDocsUrl: z.string().default(""),
});

export type GmWorkspace = z.infer<typeof GmWorkspaceSchema>;
export type GmNoteGroup = z.infer<typeof GmNoteGroupSchema>;
export type GmRandomTable = z.infer<typeof GmRandomTableSchema>;

export function removeGmNoteGroup(workspace: GmWorkspace, groupId: string): GmWorkspace {
  return GmWorkspaceSchema.parse({
    ...workspace,
    noteGroups: workspace.noteGroups.filter((group) => group.id !== groupId),
  });
}

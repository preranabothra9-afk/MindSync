import { z } from 'zod';

export const registerSchema = z.object({
  name: z.string().min(1, 'Name is required').max(50, 'Name is too long'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters long')
});

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required')
});

export const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address')
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Reset token is required'),
  password: z.string().min(6, 'Password must be at least 6 characters long')
});

export const createWorkspaceSchema = z.object({
  name: z.string().min(1, 'Workspace name is required').max(100, 'Name is too long'),
  description: z.string().max(500, 'Description is too long').optional()
});

export const inviteUserSchema = z.object({
  email: z.string().email('Invalid email address to invite')
});

export const createChannelSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  title: z.string().min(1, 'Channel title is required').max(100, 'Title is too long')
});

export const submitPromptSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  conversationId: z.string().min(1, 'Conversation ID is required'),
  promptText: z.string().min(1, 'Prompt content is required'),
  selectedModels: z.array(z.string()).min(1, 'Please select at least one AI agent')
});

// Evidence a member attaches to a claim. The shape is deliberately one union of
// optional fields rather than a discriminated union: the per-kind rules (a URL
// evidence needs a URL, a file needs its bytes, a quote needs an excerpt) are
// enforced in the route where they can return a precise 400 message.
export const attachEvidenceSchema = z.object({
  kind: z.enum(['url', 'file', 'quote', 'user'], {
    error: 'Evidence kind must be one of: url, file, quote, user'
  }),
  // Trimmed and min-checked together so a title of only spaces is rejected
  // here rather than surviving the schema and being stored as an empty string.
  title: z.string().trim().min(1, 'A short title is required').max(120, 'Title is too long'),
  url: z.string().trim().max(2048).optional(),
  excerpt: z.string().max(2000, 'Excerpt is too long').optional(),
  source: z.string().trim().max(200, 'Source attribution is too long').optional(),
  fileName: z.string().max(255).optional(),
  mimeType: z.string().max(127).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  // base64 data URI for file evidence.
  data: z.string().optional()
});

// Ids of the evidence a closer cites while resolving a contradiction.
export const citeEvidenceSchema = z.object({
  status: z.enum(['resolved', 'evidence-needed', 'dismissed']),
  resolution: z.string().max(500, 'Resolution note is too long'),
  citedEvidenceIds: z.array(z.string().min(1)).max(20, 'Cannot cite more than 20 pieces of evidence').optional()
});

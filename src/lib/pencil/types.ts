import { z } from "zod";

// ============================================================================
// Pencil Spaces API shapes (docs/pencil-spaces/api-notes.md, openapi spec).
// Response schemas are PERMISSIVE (`.passthrough()`, only the fields we rely
// on are required) so a vendor-side addition never breaks a lesson. Request
// bodies are plain TS types. Domain rows (pencil_users / pencil_spaces) live in
// src/lib/types.ts as PencilUser / PencilSpace — the `PencilApi*` names here
// are the wire shapes.
// ============================================================================

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

/** Roles we may create via the API (InstitutionAdmin/SiteAdmin are not creatable). */
export type PencilUserRole = "Student" | "Teacher";

export interface CreateApiUserBody {
  name: string;
  userRole: PencilUserRole;
  /** Our profiles.id — the intended mapping. */
  externalId?: string;
  languageCode?: string;
}

export interface PatchUserBody {
  name?: string;
  externalId?: string;
  languageCode?: string;
}

/** `{userId}` wins over `{email}` when both are sent; we only ever send userId. */
export type PencilUserRef = { userId: string } | { email: string };

export type PencilSpaceUserRole = "host" | "participant";

export interface CreateSpaceBody {
  title?: string;
  hosts?: PencilUserRef[];
  participants?: PencilUserRef[];
  visibility?: "public" | "private";
  /** REQUIRED by Pencil; we always send false (API users get no emails anyway). */
  notifyInvitees?: boolean;
  /** Must be unique per institution: `'<course_id>:<student_id>'`. */
  externalId?: string;
  owner?: PencilUserRef;
  spaceToCloneId?: string;
  siteId?: string;
}

export interface UpdateSpaceUsersBody {
  addUsers?: (PencilUserRef & { role: PencilSpaceUserRole })[];
  modifyUsers?: (PencilUserRef & { role: PencilSpaceUserRole })[];
  removeUsers?: PencilUserRef[];
  notifyInvitees?: boolean;
}

export interface SpaceSettingsPatch {
  /** Only matters once always-on recording is enabled at institution level (Phase 2). */
  disableAlwaysOnRecording?: boolean;
  enableWaitingRoom?: boolean;
}

export interface WebhookConfigBody {
  url: string;
  secret: string;
}

// ---------------------------------------------------------------------------
// Response schemas
// ---------------------------------------------------------------------------

export const PencilApiUserSchema = z
  .object({
    userId: z.string(),
    email: z.string().nullish(),
    name: z.string().nullish(),
    isApiManaged: z.boolean().optional(),
    userRole: z.string().optional(),
    externalId: z.string().nullish(),
  })
  .passthrough();
export type PencilApiUser = z.infer<typeof PencilApiUserSchema>;

export const PencilApiSpaceUserSchema = z
  .object({
    userId: z.string(),
    email: z.string().nullish(),
    name: z.string().nullish(),
  })
  .passthrough();
export type PencilApiSpaceUser = z.infer<typeof PencilApiSpaceUserSchema>;

export const PencilApiSpaceSettingsSchema = z
  .object({
    disableAlwaysOnRecording: z.boolean().optional(),
    enableWaitingRoom: z.boolean().optional(),
  })
  .passthrough();
export type PencilApiSpaceSettings = z.infer<typeof PencilApiSpaceSettingsSchema>;

export const PencilApiSpaceSchema = z
  .object({
    spaceId: z.string(),
    link: z.string(),
    title: z.string().nullish(),
    visibility: z.string().optional(),
    hosts: z.array(PencilApiSpaceUserSchema).optional(),
    participants: z.array(PencilApiSpaceUserSchema).optional(),
    archived: z.boolean().optional(),
    externalId: z.string().nullish(),
    settings: PencilApiSpaceSettingsSchema.nullish(),
    createdAt: z.string().optional(),
    editedAt: z.string().optional(),
  })
  .passthrough();
export type PencilApiSpace = z.infer<typeof PencilApiSpaceSchema>;

export const PencilApiSpaceListSchema = z
  .object({
    results: z.array(PencilApiSpaceSchema).default([]),
    pageNumber: z.number().optional(),
    pageSize: z.number().optional(),
    totalPages: z.number().optional(),
    totalRecords: z.number().optional(),
  })
  .passthrough();
export type PencilApiSpaceList = z.infer<typeof PencilApiSpaceListSchema>;

/** `GET /users/{id}/authorize` — the url IS a credential (valid 3600 s). */
export const PencilAuthorizeResponseSchema = z.object({ url: z.string().url() }).passthrough();
export type PencilAuthorizeResponse = z.infer<typeof PencilAuthorizeResponseSchema>;

/** `GET /webhooks` returns `{}` when nothing is configured. */
export const PencilWebhookConfigSchema = z
  .object({ url: z.string().optional(), secret: z.string().optional() })
  .passthrough();
export type PencilWebhookConfig = z.infer<typeof PencilWebhookConfigSchema>;

/** `PATCH /spaces/{id}/settings/` answers `{}`. */
export const PencilEmptySchema = z.object({}).passthrough();

/** Error body: `{err, error_code}` (some 401s use `error` instead of `err`). */
export const PencilErrorBodySchema = z
  .object({
    err: z.string().optional(),
    error: z.string().optional(),
    error_code: z.string().optional(),
    messages: z.array(z.string()).optional(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// Webhook payloads (consumed from Phase 2; declared now so the ledger table
// and the route agree on a shape). `_type` discriminates.
//
// Delivery (Pencil support, 2026-10-16): anything but a 2xx within 15 s is
// retried with exponential backoff (30 s growing to 10 min) for up to 10
// attempts — about an hour in all — and ORDER IS NOT GUARANTEED. So the route
// answers 2xx for every payload it stored or chose to ignore (an unknown
// `_type` included; a 4xx only buys ten pointless redeliveries), and no job
// may assume one event arrives before another.
// ---------------------------------------------------------------------------

export const SpaceUserEventSchema = z
  .object({
    _type: z.literal("SPACE_USER"),
    spaceId: z.string(),
    sessionId: z.string(),
    timestamp: z.union([z.string(), z.number()]),
    // Spec: joinSpace | leaveSpace | hideTab | unhideTab. Pencil support
    // (2026-10-16) names the tab events USER_ENTERED_BACKGROUND /
    // USER_ENTERED_FOREGROUND — a different naming scheme, not just a different
    // case — so the join/leave strings are confirmed only by the first staging
    // deliveries. Map known strings explicitly; ledger anything else `ignored`.
    eventType: z.string(),
    userId: z.string(),
    roomId: z.string().nullish(),
    userTabId: z.string().nullish(),
  })
  .passthrough();

export const SpaceSessionEventSchema = z
  .object({
    _type: z.literal("SPACE_SESSION"),
    spaceId: z.string(),
    sessionId: z.string(),
    timestamp: z.union([z.string(), z.number()]),
    eventType: z.string(), // SESSION_ENDED (analytics ready, about 6 min after the last person leaves)
  })
  .passthrough();

export const SpaceRecordingEventSchema = z
  .object({
    _type: z.literal("SPACE_RECORDING"),
    spaceId: z.string(),
    recordingId: z.string(),
    timestamp: z.union([z.string(), z.number()]),
    eventType: z.string(), // RECORDING_AVAILABLE | TRANSCRIPT_AVAILABLE (Pencil support, 2026-10-16)
  })
  .passthrough();

// COACHING_AVAILABLE (an AI Coach report completed WITH insights; any other
// outcome is only visible as `coaching.status` on GET /analytics/sessions/{id}/reports)
// is Pencil's recommended coach trigger, but its `_type` and fields are not
// documented yet — the Phase 2 route keys it on eventType and ledgers it raw.
export const PencilWebhookPayloadSchema = z.discriminatedUnion("_type", [
  SpaceUserEventSchema,
  SpaceSessionEventSchema,
  SpaceRecordingEventSchema,
]);
export type PencilWebhookPayload = z.infer<typeof PencilWebhookPayloadSchema>;

// ---------------------------------------------------------------------------
// Join vocabulary shared by routes, actions and the UI
// ---------------------------------------------------------------------------

/**
 * What a minted authorize URL is for — decides the Space URL params (urls.ts):
 *  - lesson   : startCall + standalone + broadcastEvents + gv (no skipCallHostCheck)
 *  - board    : standalone + mode=whiteboardonly (second device "use this device for writing")
 *  - homework : standalone + mode=whiteboardonly (Phase 3 deep link)
 */
export type JoinPurpose = "lesson" | "board" | "homework";

/** How the viewer opens the Space: desktop iframe, new tab, or the native app. */
export type JoinMode = "iframe" | "redirect" | "mobile";

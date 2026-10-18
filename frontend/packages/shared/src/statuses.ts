export const aiDraftStatuses = ['generating', 'pending_review', 'confirmed', 'rejected', 'failed'] as const
export type AiDraftStatus = (typeof aiDraftStatuses)[number]

export const taskStatuses = ['pending', 'in_progress', 'completed', 'not_done', 'transferred', 'cancelled', 'overdue'] as const
export type TaskStatus = (typeof taskStatuses)[number]

export const handoverStatuses = ['draft', 'submitted', 'received', 'clarifying', 'closed'] as const
export type HandoverStatus = (typeof handoverStatuses)[number]

export const familyCaseStatuses = ['received', 'verifying', 'replied', 'continuing', 'closed'] as const
export type FamilyCaseStatus = (typeof familyCaseStatuses)[number]

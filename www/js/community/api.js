// @ts-check
/**
 * The Community data layer has one interface and two implementations:
 *   - supabase.js  talks to OTI's Supabase project (auth + Postgres with RLS)
 *   - demo.js      in-memory sample data for the no-login review build and tests
 * Everything the UI needs goes through this interface, so the UI never knows
 * which one it is talking to.
 */

/** @typedef {import('./helpers.js').Channel} Channel */
/** @typedef {import('./helpers.js').Message} Message */
/** @typedef {import('./helpers.js').Profile} Profile */
/** @typedef {import('./helpers.js').Role} Role */

/**
 * @typedef {Object} Session
 * @property {string} userId
 * @property {string} email
 *
 * @typedef {Object} Report
 * @property {string} id
 * @property {string} messageId
 * @property {string} reason
 * @property {string} createdAt
 * @property {Message|null} message
 *
 * @typedef {Object} AllowlistEntry
 * @property {string} email
 * @property {Role} role
 * @property {string|null} note
 * @property {string} addedAt
 * @property {string|null} redeemedAt
 * @property {string|null} redeemedBy
 *
 * @typedef {Object} MemberProfile
 * @property {string} id
 * @property {string} displayName
 * @property {Role} role
 * @property {'active'|'removed'} status
 * @property {string} createdAt
 *
 * @typedef {Object} CommunityApi
 * @property {'supabase'|'demo'} mode
 * @property {() => Promise<Session|null>} getSession
 * @property {(cb: (s: Session|null) => void) => () => void} onAuthChange
 * @property {(email: string) => Promise<void>} requestCode
 * @property {(email: string, code: string) => Promise<Session>} verifyCode
 * @property {() => Promise<void>} signOut
 * @property {() => Promise<Profile|null>} getMe
 * @property {(patch: {displayName?: string, acceptGuidelines?: boolean}) => Promise<Profile>} updateMe
 * @property {() => Promise<Channel[]>} listChannels
 * @property {(channelId: string, opts?: {before?: string, limit?: number}) => Promise<Message[]>} listMessages
 * @property {(channelId: string, body: string) => Promise<Message>} sendMessage
 * @property {(id: string, body: string) => Promise<Message>} editMessage
 * @property {(id: string, hide: boolean) => Promise<void>} hideMessage
 * @property {(id: string) => Promise<void>} deleteMessage
 * @property {(id: string, reason: string) => Promise<void>} reportMessage
 * @property {() => Promise<Report[]>} listOpenReports
 * @property {(id: string) => Promise<void>} resolveReport
 * @property {(channelId: string) => Promise<void>} markRead
 * @property {() => Promise<Record<string, number>>} unreadCounts
 * @property {(channelId: string, onChange: (m: Message, kind: 'insert'|'update') => void) => () => void} subscribe
 * @property {() => Promise<{allowlist: AllowlistEntry[], profiles: MemberProfile[]}>} listMembers
 * @property {(email: string, role: Role, note?: string) => Promise<void>} addMember
 * @property {(email: string, role: Role) => Promise<void>} setMemberRole
 * @property {(userId: string) => Promise<void>} removeMember
 * @property {() => Promise<void>} [refreshSession]
 */

export {};

// @ts-check
/**
 * Supabase implementation of the Community API.
 * Authorization is NOT done here: every query runs under the member's JWT and
 * Row Level Security in supabase/schema.sql decides what comes back. This file
 * only shapes rows for the UI.
 */
import { cohortApi } from '../cohorts/api.js';
import { createClient } from '@supabase/supabase-js';

/** @typedef {import('./api.js').CommunityApi} CommunityApi */
/** @typedef {import('./helpers.js').Message} Message */
/** @typedef {import('./helpers.js').Channel} Channel */
/** @typedef {import('./helpers.js').Profile} Profile */

const MESSAGE_COLUMNS = 'id, channel_id, author_id, author_name, author_role, body, created_at, edited_at, hidden_at';

/** @param {any} r @returns {Message} */
function toMessage(r) {
  return { id: r.id, channelId: r.channel_id, authorId: r.author_id, authorName: r.author_name, authorRole: r.author_role, body: r.body, createdAt: r.created_at, editedAt: r.edited_at, hiddenAt: r.hidden_at };
}
/** @param {any} r @returns {Profile} */
function toProfile(r) {
  return { id: r.id, displayName: r.display_name, role: r.role, status: r.status, acceptedGuidelines: !!r.accepted_guidelines_at };
}

/**
 * @param {{url: string, anonKey: string, pollSeconds?: number}} cfg
 * @returns {CommunityApi}
 */
export function createSupabaseApi(cfg) {
  const client = createClient(cfg.url, cfg.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: 'implicit' },
  });
  const pollMs = (cfg.pollSeconds ?? 45) * 1000;

  /** @param {any} error */
  const raise = (error) => { if (error) throw new Error(error.message || String(error)); };

  async function me() {
    const { data: { user } } = await client.auth.getUser();
    return user;
  }

  return {
    ...cohortApi(client),
    mode: 'supabase',

    async getSession() {
      const { data: { session } } = await client.auth.getSession();
      return session?.user ? { userId: session.user.id, email: session.user.email || '' } : null;
    },

    onAuthChange(cb) {
      const { data } = client.auth.onAuthStateChange((_event, session) => {
        cb(session?.user ? { userId: session.user.id, email: session.user.email || '' } : null);
      });
      return () => data.subscription.unsubscribe();
    },

    async requestCode(email) {
      const { error } = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
      raise(error);
    },

    async verifyCode(email, code) {
      const { data, error } = await client.auth.verifyOtp({ email, token: code, type: 'email' });
      raise(error);
      if (!data.user) throw new Error('invalid code');
      return { userId: data.user.id, email: data.user.email || '' };
    },

    async signOut() { const {error}=await client.auth.signOut();raise(error); },

    async getMe() {
      const user = await me();
      if (!user) return null;
      const { data, error } = await client.from('profiles').select('id, display_name, role, status, accepted_guidelines_at').eq('id', user.id).maybeSingle();
      raise(error);
      return data ? toProfile(data) : null;
    },

    async updateMe(patch) {
      const user = await me();
      if (!user) throw new Error('not signed in');
      /** @type {Record<string, unknown>} */
      const row = {};
      if (patch.displayName != null) row.display_name = patch.displayName;
      if (patch.acceptGuidelines) row.accepted_guidelines_at = new Date().toISOString();
      const { data, error } = await client.from('profiles').update(row).eq('id', user.id).select('id, display_name, role, status, accepted_guidelines_at').single();
      raise(error);
      return toProfile(data);
    },

    async listChannels() {
      const [{ data: ch, error: e1 }, { data: acc, error: e2 }, prof, cohorts] = await Promise.all([
        client.from('channels').select('id, slug, name, description, pin_moderator_latest, sort_order, cohort_id').order('sort_order'),
        client.from('channel_access').select('channel_id, role, level'),
        this.getMe(),
        client.from('cohorts').select('id,name').then(({data,error})=>{raise(error);return data||[];}),
      ]);
      raise(e1); raise(e2);
      return (ch || []).map((c) => {
        const access = (acc || []).filter((a) => a.channel_id === c.id).map((a) => ({ role: a.role, level: a.level }));
        const mine = access.find((a) => a.role === prof?.role);
        return { id: c.id, slug: c.slug, name: c.name + ' · ' + (cohorts.find(x=>x.id===c.cohort_id)?.name||'Cohort'), description: c.description + ' · Private cohort', pinModeratorLatest: c.pin_moderator_latest, access, myLevel: mine ? mine.level : null };
      });
    },

    async listMessages(channelId, opts = {}) {
      let q = client.from('messages').select(MESSAGE_COLUMNS).eq('channel_id', channelId).order('created_at', { ascending: false }).limit(opts.limit ?? 50);
      if (opts.before) q = q.lt('created_at', opts.before);
      const { data, error } = await q;
      raise(error);
      return (data || []).map(toMessage);
    },

    async sendMessage(channelId, body) {
      const user = await me();
      if (!user) throw new Error('not signed in');
      const { data, error } = await client.from('messages').insert({ channel_id: channelId, author_id: user.id, body }).select(MESSAGE_COLUMNS).single();
      raise(error);
      return toMessage(data);
    },

    async editMessage(id, body) {
      const { data, error } = await client.from('messages').update({ body }).eq('id', id).select(MESSAGE_COLUMNS).single();
      raise(error);
      return toMessage(data);
    },

    async hideMessage(id, hide) { raise((await client.rpc('hide_message', { mid: id, hide })).error); },
    async deleteMessage(id) { raise((await client.rpc('delete_message', { mid: id })).error); },

    async reportMessage(id, reason) {
      const user = await me();
      if (!user) throw new Error('not signed in');
      const { error } = await client.from('reports').insert({ message_id: id, reporter_id: user.id, reason });
      if (error && /duplicate|unique/i.test(error.message)) return; // already reported by this member
      raise(error);
    },

    async listOpenReports() {
      const { data, error } = await client.from('reports').select('id, message_id, reason, created_at').is('resolved_at', null).order('created_at', { ascending: false }).limit(100);
      raise(error);
      const ids = [...new Set((data || []).map((r) => r.message_id))];
      /** @type {Map<string, Message>} */
      const msgs = new Map();
      if (ids.length) {
        const { data: m, error: e2 } = await client.from('messages').select(MESSAGE_COLUMNS).in('id', ids);
        raise(e2);
        for (const row of m || []) msgs.set(row.id, toMessage(row));
      }
      return (data || []).map((r) => ({ id: r.id, messageId: r.message_id, reason: r.reason, createdAt: r.created_at, message: msgs.get(r.message_id) || null }));
    },

    async resolveReport(id) { raise((await client.rpc('resolve_report', { rid: id })).error); },

    async markRead(channelId) { raise((await client.rpc('mark_read', { ch: channelId })).error); },

    async unreadCounts() {
      const { data, error } = await client.rpc('unread_counts');
      raise(error);
      /** @type {Record<string, number>} */
      const out = {};
      for (const r of data || []) out[r.channel_id] = Number(r.unread);
      return out;
    },

    subscribe(channelId, onChange) {
      let live = false;
      const chan = client.channel(`messages:${channelId}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `channel_id=eq.${channelId}` }, (p) => onChange(toMessage(p.new), 'insert'))
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `channel_id=eq.${channelId}` }, (p) => onChange(toMessage(p.new), 'update'))
        .subscribe((status) => { live = status === 'SUBSCRIBED'; });
      // Polling fallback: if realtime never connects (blocked network, old device), refresh on a timer.
      let lastSeen = new Date().toISOString();
      const timer = setInterval(async () => {
        if (live) return;
        try {
          const { data } = await client.from('messages').select(MESSAGE_COLUMNS).eq('channel_id', channelId).gt('created_at', lastSeen).order('created_at');
          for (const r of data || []) { onChange(toMessage(r), 'insert'); lastSeen = r.created_at; }
        } catch { /* try again next tick */ }
      }, pollMs);
      return () => { clearInterval(timer); client.removeChannel(chan); };
    },

    async listMembers() {
      const [{ data: a, error: e1 }, { data: p, error: e2 }] = await Promise.all([
        client.from('member_allowlist').select('email, role, note, added_at, redeemed_at, redeemed_by').order('added_at', { ascending: false }),
        client.from('profiles').select('id, display_name, role, status, created_at').order('created_at'),
      ]);
      raise(e1); raise(e2);
      return {
        allowlist: (a || []).map((r) => ({ email: r.email, role: r.role, note: r.note, addedAt: r.added_at, redeemedAt: r.redeemed_at, redeemedBy: r.redeemed_by })),
        profiles: (p || []).map((r) => ({ id: r.id, displayName: r.display_name, role: r.role, status: r.status, createdAt: r.created_at })),
      };
    },

    async addMember(email, role, note) {
      const user = await me();
      const { error } = await client.from('member_allowlist').upsert({ email, role, note: note || null, added_by: user?.id || null }, { onConflict: 'email' });
      raise(error);
    },

    async setMemberRole(email, role) {
      const { error } = await client.from('member_allowlist').update({ role }).eq('email', email);
      raise(error);
    },

    async removeMember(userId) {
      const { error } = await client.from('profiles').update({ status: 'removed' }).eq('id', userId);
      raise(error);
    },
  };
}


import { describe, expect, it } from 'vitest';
import { pickFixedHandlerSQLite, pickFixedHandlerSupabase } from './assignment.js';

function makeSupabaseClient({ channelMembers, users, roles }) {
  return {
    from(table) {
      const query = {
        select() { return this; },
        eq() { return this; },
        order() { return this; },
        then(resolve, reject) {
          const data = table === 'channel_members'
            ? channelMembers
            : table === 'users'
              ? users
              : roles;
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
}

describe('complaint assignment', () => {
  it('selects an Official from the channel team instead of other staff roles', async () => {
    const client = makeSupabaseClient({
      channelMembers: [
        { user_id: 1, user: { full_name: 'Tanod', role: 'TANOD', status: 'ACTIVE' } },
        { user_id: 2, user: { full_name: 'Official', role: 'OFFICIAL', status: 'ACTIVE' } },
      ],
      users: [],
      roles: [],
    });

    await expect(pickFixedHandlerSupabase(client, 10)).resolves.toEqual({
      user_id: 2,
      full_name: 'Official',
      role: 'OFFICIAL',
    });
  });

  it('falls back to an active Official when the channel has no Official member', async () => {
    const client = makeSupabaseClient({
      channelMembers: [
        { user_id: 1, user: { full_name: 'Tanod', role: 'TANOD', status: 'ACTIVE' } },
      ],
      users: [
        { id: 2, full_name: 'Lupon', role: 'LUPON', status: 'ACTIVE' },
        { id: 3, full_name: 'Official', role: 'OFFICIAL', status: 'ACTIVE' },
      ],
      roles: [],
    });

    await expect(pickFixedHandlerSupabase(client, 10)).resolves.toEqual({
      user_id: 3,
      full_name: 'Official',
      role: 'OFFICIAL',
    });
  });

  it('uses only an Official for SQLite assignments too', async () => {
    const db = {
      all: async (sql, params) => {
        if (sql.includes('FROM channel_members')) {
          return [{ user_id: 1, full_name: 'Tanod', role: 'TANOD' }];
        }
        expect(params).toEqual(['OFFICIAL']);
        return [{ user_id: 3, full_name: 'Official', role: 'OFFICIAL' }];
      },
    };

    await expect(pickFixedHandlerSQLite(db, 10)).resolves.toEqual({
      user_id: 3,
      full_name: 'Official',
      role: 'OFFICIAL',
    });
  });
});

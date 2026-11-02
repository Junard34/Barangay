import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from './AuthContext';

vi.mock('../lib/supabase', () => ({
  isSupabaseConfigured: false,
  supabase: {
    auth: {
      onAuthStateChange: vi.fn((callback) => {
        queueMicrotask(() => callback('INITIAL_SESSION', null));
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      }),
      signOut: vi.fn(),
    },
    channel: vi.fn(() => ({
      on() {
        return this;
      },
      subscribe() {
        return this;
      },
      track: vi.fn(),
      presenceState: () => ({}),
      untrack: vi.fn(),
    })),
    removeChannel: vi.fn(),
  },
}));

function AuthProbe() {
  const { user } = useAuth();
  return <div>{user ? `${user.name}:${user.role}` : 'signed out'}</div>;
}

function makeToken(expiration) {
  const payload = btoa(JSON.stringify({ exp: expiration }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `header.${payload}.signature`;
}

describe('AuthProvider session restoration', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('restores a valid login after a page reload', async () => {
    const user = {
      id: 'citizen-123',
      name: 'Test Citizen',
      role: 'CITIZEN',
    };
    localStorage.setItem(
      'authToken',
      makeToken(Math.floor(Date.now() / 1000) + 3600)
    );
    localStorage.setItem('barangay-saray-user', JSON.stringify(user));

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Test Citizen:CITIZEN')).toBeTruthy();
    });
    expect(localStorage.getItem('barangay-saray-user')).toBe(JSON.stringify(user));
  });

  it('does not restore an expired login', async () => {
    localStorage.setItem('authToken', makeToken(Math.floor(Date.now() / 1000) - 1));
    localStorage.setItem(
      'barangay-saray-user',
      JSON.stringify({ id: 'citizen-123', name: 'Test Citizen', role: 'CITIZEN' })
    );

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('signed out')).toBeTruthy();
    });
    expect(localStorage.getItem('authToken')).toBeNull();
    expect(localStorage.getItem('barangay-saray-user')).toBeNull();
  });
});

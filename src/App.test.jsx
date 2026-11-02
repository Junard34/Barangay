import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from './App';

vi.mock('./context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'citizen-123', role: 'CITIZEN' },
    loading: false,
  }),
  AuthProvider: ({ children }) => children,
}));

vi.mock('./pages/auth/LoginPage', () => ({
  default: () => <div>Login page</div>,
}));

vi.mock('./pages/auth/RegisterPage', () => ({
  default: () => <div>Register page</div>,
}));

vi.mock('./pages/citizen/CitizenDashboard', () => ({
  default: () => <div>Citizen dashboard</div>,
}));

vi.mock('./pages/tanod/TanodDashboard', () => ({
  default: () => <div>Tanod dashboard</div>,
}));

vi.mock('./pages/official/OfficialDashboard', () => ({
  default: () => <div>Official dashboard</div>,
}));

vi.mock('./pages/lupon/LuponDashboard', () => ({
  default: () => <div>Lupon dashboard</div>,
}));

vi.mock('./pages/admin/AdminDashboard', () => ({
  default: () => <div>Admin dashboard</div>,
}));

describe('application entry route', () => {
  it('shows the login page at the root URL even when a user is signed in', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <AppRoutes />
      </MemoryRouter>
    );

    expect(screen.getByText('Login page')).toBeTruthy();
  });

  it('keeps role dashboard URLs available for signed-in users', () => {
    render(
      <MemoryRouter initialEntries={['/citizen/dashboard']}>
        <AppRoutes />
      </MemoryRouter>
    );

    expect(screen.getByText('Citizen dashboard')).toBeTruthy();
  });
});

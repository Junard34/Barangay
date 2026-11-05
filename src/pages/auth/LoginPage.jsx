import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Eye, EyeOff, User } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { getDashboardPath } from '../../lib/adminAuth';

function getLoginErrorInfo(message = '') {
  const lower = message.toLowerCase();

  if (lower.includes('pending')) {
    return {
      tone: 'warning',
      title: 'Account pending verification',
      body: 'Your account is awaiting Barangay Clearance verification. Please wait for the admin to approve your registration before logging in.',
    };
  }

  if (lower.includes('reject')) {
    return {
      tone: 'danger',
      title: 'Registration rejected',
      body: 'Your registration was rejected. Please contact the Barangay Saray administrator, or re-register with a valid Barangay Clearance.',
    };
  }

  return {
    tone: 'danger',
    title: 'Login failed',
    body: message || 'Please check your email and password.',
  };
}

export default function LoginPage() {
  const [form, setForm] = useState({
    email: '',
    password: '',
    role: 'CITIZEN',
  });

  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [errorInfo, setErrorInfo] = useState(null);
  const [loading, setLoading] = useState(false);

  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (event) => {
    event.preventDefault();

    setError('');
    setErrorInfo(null);
    setLoading(true);

    try {
      const user = await login(
        form.email.trim(),
        form.password
      );

      const destination = getDashboardPath(user?.role);
      if (destination === '/login') {
        throw new Error(
          `Login succeeded, but your account role (${user?.role || 'unknown'}) is not mapped to a dashboard. Please contact the administrator.`
        );
      }

      navigate(destination, {
        replace: true,
      });
    } catch (err) {
      console.error('Login error:', err);

      const message =
        err.message ||
        'Login failed. Please check your email and password.';

      setError(message);
      setErrorInfo(getLoginErrorInfo(message));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-[#0b3d2e] via-[#1f5e3b] to-[#556b2f] p-6">
      {/* Soft blurred overlay */}
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" />

      <div className="relative z-10 w-full max-w-md">
        {/* Circular user icon */}
        <div className="mx-auto -mb-8 flex h-20 w-20 items-center justify-center rounded-full border-4 border-white/30 bg-white/20 backdrop-blur-md shadow-xl">
          <User className="h-10 w-10 text-white" />
        </div>

        {/* Glass card */}
        <div className="rounded-3xl border border-white/20 bg-white/10 p-8 pt-12 shadow-2xl backdrop-blur-xl">
          <h1 className="mb-1 text-center text-3xl font-bold text-white">
            Login
          </h1>

          <p className="mb-6 text-center text-sm text-white/80">
            Welcome back to your Barangay Saray account
          </p>

          <form className="space-y-4" onSubmit={handleSubmit}>
            {/* Email */}
            <div>
              <label className="mb-2 block text-sm font-medium text-white/90">
                Email Address
              </label>
              <input
                type="email"
                required
                value={form.email}
                onChange={(event) =>
                  setForm({ ...form, email: event.target.value })
                }
                className="w-full rounded-2xl border border-white/20 bg-white/10 px-5 py-3 text-white placeholder-white/60 outline-none transition focus:border-white/50 focus:bg-white/20"
                placeholder="Enter your email"
              />
            </div>

            {/* Password */}
            <div>
              <label className="mb-2 block text-sm font-medium text-white/90">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={form.password}
                  onChange={(event) =>
                    setForm({ ...form, password: event.target.value })
                  }
                  className="w-full rounded-2xl border border-white/20 bg-white/10 px-5 py-3 pr-12 text-white placeholder-white/60 outline-none transition focus:border-white/50 focus:bg-white/20"
                  placeholder="Enter your password"
                />
                <button
                  type="button"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  title={showPassword ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPassword((visible) => !visible)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-white/70 transition hover:text-white"
                >
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            </div>

            {/* Select Role */}
            <div>
              <label className="mb-2 block text-sm font-medium text-white/90">
                Select Role
              </label>
              <select
                value={form.role}
                onChange={(event) =>
                  setForm({ ...form, role: event.target.value })
                }
                className="w-full rounded-2xl border border-white/20 bg-white/10 px-5 py-3 text-white outline-none transition focus:border-white/50 focus:bg-white/20"
              >
                <option value="CITIZEN" className="text-gray-900">Citizen</option>
                <option value="TANOD" className="text-gray-900">Tanod</option>
                <option value="OFFICIAL" className="text-gray-900">Official</option>
                <option value="LUPON" className="text-gray-900">Lupon</option>
                <option value="ADMIN" className="text-gray-900">Admin</option>
              </select>
            </div>

            {/* Remember Me + Forgot Password */}
            <div className="flex items-center justify-between text-sm text-white/80">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-white/30 bg-white/10 text-[#0b3d2e] focus:ring-white/40"
                />
                Remember Me
              </label>
              <Link
                to="/forgot-password"
                className="font-medium text-white/90 transition hover:text-white hover:underline"
              >
                Forgot Password?
              </Link>
            </div>

            {/* Error */}
            {error && (
              <div
                className={`rounded-xl border p-3 text-sm ${
                  errorInfo?.tone === 'warning'
                    ? 'border-amber-300/60 bg-amber-500/20 text-amber-100'
                    : 'border-red-300/60 bg-red-500/20 text-red-100'
                }`}
              >
                {errorInfo?.title && (
                  <p className="mb-1 font-semibold">{errorInfo.title}</p>
                )}
                <p>{errorInfo?.body || error}</p>
              </div>
            )}

            {/* Login Button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-2xl bg-[#0b3d2e] px-4 py-3 font-semibold text-white shadow-md transition hover:bg-[#092f24] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? 'Logging in...' : 'Login'}
            </button>
          </form>

          {/* Register Link */}
          <div className="mt-6 text-center text-sm text-white/80">
            Don't have an account?{' '}
            <Link
              to="/register"
              className="font-semibold text-white transition hover:underline"
            >
              Register
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
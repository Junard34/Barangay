import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { isSupabaseConfigured } from '../../lib/supabase';
import { Eye, EyeOff, User } from 'lucide-react';

function RegisterPage() {
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    password: '',
    confirmPassword: '',
    role: 'CITIZEN',
  });

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [clearanceFile, setClearanceFile] = useState(null);

  const { register, logout } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (event) => {
    event.preventDefault();

    setError('');
    setSuccess('');

    // Validate fields
    if (
      !form.fullName.trim() ||
      !form.email.trim() ||
      !form.password ||
      !form.confirmPassword ||
      !address.trim() ||
      !clearanceFile
    ) {
      setError('All fields are required.');
      return;
    }

    // Validate password
    if (form.password !== form.confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    // Validate password length
    if (form.password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png'];
    if (!allowedTypes.includes(clearanceFile.type)) {
      setError('Barangay Clearance must be a PDF, JPG, or PNG file.');
      return;
    }

    if (clearanceFile.size > 5 * 1024 * 1024) {
      setError('Barangay Clearance must be 5 MB or smaller.');
      return;
    }

    // Optional mobile number: when provided, it must be a valid PH mobile.
    if (phone.trim()) {
      const phoneDigits = phone.replace(/[\s\-().+]/g, '');
      if (!/^(09\d{9}|639\d{9})$/.test(phoneDigits)) {
        setError('Please enter a valid Philippine mobile number (e.g. 09XXXXXXXXX).');
        return;
      }
    }

    setLoading(true);

    try {
      if (!isSupabaseConfigured) {
        throw new Error(
          'Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to the project .env file, then restart the app.'
        );
      }

      // Register the account
      await register({
        email: form.email.trim(),
        password: form.password,
        name: form.fullName.trim(),
        address: address.trim(),
        phone: phone.trim(),
        clearanceFile,
      });

      /*
       * IMPORTANT:
       * If Supabase email confirmation is disabled,
       * Supabase automatically creates a session after
       * registration.
       *
       * We sign the user out immediately so they must
       * login manually after registration.
       */
      try {
        await logout();
      } catch (logoutError) {
        console.warn(
          'Automatic logout after registration failed:',
          logoutError
        );
      }

      setSuccess(
        'Registration submitted. Your account is pending Barangay Clearance verification. Redirecting you to the login page...'
      );

      // Go to login page after registration
      setTimeout(() => {
        navigate('/login', { replace: true });
      }, 1500);
    } catch (err) {
      console.error('Registration error:', err);

      let message =
        err?.message || 'Registration failed. Please try again.';

      if (
        message
          .toLowerCase()
          .includes('user already registered')
      ) {
        message =
          'This email is already registered. Please login instead.';
      }

      setError(message);
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
            Register
          </h1>

          <p className="mb-6 text-center text-sm text-white/80">
            Create your Barangay Saray account
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Full Name */}
            <div>
              <label className="mb-2 block text-sm font-medium text-white/90">
                Full Name
              </label>
              <input
                type="text"
                value={form.fullName}
                onChange={(e) =>
                  setForm({ ...form, fullName: e.target.value })
                }
                className="w-full rounded-2xl border border-white/20 bg-white/10 px-5 py-3 text-white placeholder-white/60 outline-none focus:border-white/50 focus:bg-white/20"
                placeholder="Enter your full name"
                disabled={loading}
              />
            </div>

            {/* Email */}
            <div>
              <label className="mb-2 block text-sm font-medium text-white/90">
                Email Address
              </label>
              <input
                type="email"
                value={form.email}
                onChange={(e) =>
                  setForm({ ...form, email: e.target.value })
                }
                className="w-full rounded-2xl border border-white/20 bg-white/10 px-5 py-3 text-white placeholder-white/60 outline-none focus:border-white/50 focus:bg-white/20"
                placeholder="Enter your email"
                disabled={loading}
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
                  value={form.password}
                  onChange={(e) =>
                    setForm({ ...form, password: e.target.value })
                  }
                  className="w-full rounded-2xl border border-white/20 bg-white/10 px-5 py-3 pr-12 text-white placeholder-white/60 outline-none focus:border-white/50 focus:bg-white/20"
                  placeholder="Enter your password"
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  title={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white"
                  disabled={loading}
                >
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            </div>

            {/* Confirm Password */}
            <div>
              <label className="mb-2 block text-sm font-medium text-white/90">
                Confirm Password
              </label>
              <div className="relative">
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={form.confirmPassword}
                  onChange={(e) =>
                    setForm({ ...form, confirmPassword: e.target.value })
                  }
                  className="w-full rounded-2xl border border-white/20 bg-white/10 px-5 py-3 pr-12 text-white placeholder-white/60 outline-none focus:border-white/50 focus:bg-white/20"
                  placeholder="Confirm your password"
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  aria-label={showConfirmPassword ? 'Hide confirmation password' : 'Show confirmation password'}
                  title={showConfirmPassword ? 'Hide confirmation password' : 'Show confirmation password'}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white"
                  disabled={loading}
                >
                  {showConfirmPassword ? <EyeOff size={20} /> : <Eye size={20} />}
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
                disabled
                className="w-full rounded-2xl border border-white/20 bg-white/10 px-5 py-3 text-white/70 outline-none"
              >
                <option value="CITIZEN" className="text-gray-900">Citizen</option>
              </select>
              <p className="mt-1 text-xs text-white/60">
                Self-registration is available for citizens only.
              </p>
            </div>

            {/* Address */}
            <div>
              <label className="mb-2 block text-sm font-medium text-white/90">
                Address
              </label>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="w-full rounded-2xl border border-white/20 bg-white/10 px-5 py-3 text-white placeholder-white/60 outline-none focus:border-white/50 focus:bg-white/20"
                placeholder="Enter your address"
                disabled={loading}
              />
            </div>

            {/* Mobile Number (optional) */}
            <div>
              <label className="mb-2 block text-sm font-medium text-white/90">
                Mobile Number <span className="font-normal text-white/60">(optional)</span>
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full rounded-2xl border border-white/20 bg-white/10 px-5 py-3 text-white placeholder-white/60 outline-none focus:border-white/50 focus:bg-white/20"
                placeholder="09XXXXXXXXX"
                disabled={loading}
              />
            </div>

            {/* Barangay Clearance */}
            <div>
              <label className="mb-2 block text-sm font-medium text-white/90">
                Barangay Clearance *
              </label>
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                onChange={(e) => setClearanceFile(e.target.files?.[0] || null)}
                className="w-full rounded-2xl border border-white/20 bg-white/10 px-5 py-3 text-white file:mr-3 file:rounded-full file:border-0 file:bg-[#0b3d2e] file:px-4 file:py-2 file:text-white"
                disabled={loading}
              />
            </div>

            {/* Notice */}
            <div className="rounded-xl border border-amber-300/40 bg-amber-500/20 p-3 text-sm text-amber-100">
              Citizen accounts require admin verification before they can log in.
            </div>

            {/* Error Message */}
            {error && (
              <div className="rounded-xl border border-red-300/60 bg-red-500/20 p-3 text-center text-sm text-red-100">
                {error}
              </div>
            )}

            {/* Success Message */}
            {success && (
              <div className="rounded-xl border border-green-300/60 bg-green-500/20 p-3 text-center text-sm text-green-100">
                {success}
              </div>
            )}

            {/* Register Button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-2xl bg-[#0b3d2e] px-4 py-3 font-semibold text-white shadow-md transition hover:bg-[#092f24] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? 'Creating Account...' : 'Register'}
            </button>
          </form>

          {/* Login Link */}
          <div className="mt-6 text-center text-sm text-white/80">
            Already have an account?{' '}
            <Link
              to="/login"
              className="font-semibold text-white transition hover:underline"
            >
              Login
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default RegisterPage;
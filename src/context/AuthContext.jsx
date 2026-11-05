
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { supabase, isSupabaseConfigured } from '../lib/supabase';
import api from '../services/api';

const AuthContext = createContext(null);
const STORED_USER_KEY = 'barangay-saray-user';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const userRef = useRef(null);

  // Mirror the current user for event handlers so auth events can compare
  // against the live value instead of a stale closure.
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  // ==========================================
  // GET USER PROFILE FROM public.users
  // ==========================================
  const getUserData = async (authUser) => {
    if (!authUser) {
      return null;
    }

    try {
      const { data: profile, error } = await supabase
        .from('users')
        .select('*')
        .eq('auth_id', authUser.id)
        .maybeSingle();

      if (error) {
        console.error(
          'Error loading user profile:',
          error
        );
      }

      const rawRole =
        profile?.role ||
        authUser.user_metadata?.role ||
        authUser.user_metadata?.name ||
        'CITIZEN';

      let role = rawRole;
      if (role && typeof role === 'object') {
        role = role.name || role.role_name || role.role || 'CITIZEN';
      }
      role = String(role || 'CITIZEN').trim().toUpperCase() || 'CITIZEN';

      return {
        id: authUser.id,

        email:
          profile?.email ||
          authUser.email ||
          '',

        name:
          profile?.full_name ||
          authUser.user_metadata?.full_name ||
          authUser.user_metadata?.name ||
          '',

        role,

        phone:
          profile?.phone ||
          '',

        address:
          profile?.address ||
          '',

        status:
          profile?.status ||
          'ACTIVE',

        profileId:
          profile?.id ||
          null,

        authId: authUser.id,
      };
    } catch (error) {
      console.error(
        'Failed to get user data:',
        error
      );

      const fallbackRole =
        authUser.user_metadata?.role ||
        authUser.user_metadata?.name ||
        'CITIZEN';

      let role = fallbackRole;
      if (role && typeof role === 'object') {
        role = role.name || role.role_name || role.role || 'CITIZEN';
      }
      role = String(role || 'CITIZEN').trim().toUpperCase() || 'CITIZEN';

      return {
        id: authUser.id,
        email: authUser.email || '',
        name:
          authUser.user_metadata?.full_name ||
          authUser.user_metadata?.name ||
          '',
        role,
        phone: '',
        address: '',
        status: 'ACTIVE',
        profileId: null,
        authId: authUser.id,
      };
    }
  };

  // ==========================================
  // RESTORE THE AUTHENTICATED SESSION
  // ==========================================
  useEffect(() => {
    let mounted = true;
    let subscription;

    const initializeAuth = async () => {
      try {
        const token = localStorage.getItem('authToken');
        const storedUser = localStorage.getItem(STORED_USER_KEY);
        const tokenPayload = token?.split('.')[1];
        const normalizedPayload = tokenPayload
          ?.replace(/-/g, '+')
          .replace(/_/g, '/')
          .padEnd(Math.ceil(tokenPayload.length / 4) * 4, '=');
        const tokenData = normalizedPayload
          ? JSON.parse(atob(normalizedPayload))
          : null;
        const restoredUser = storedUser ? JSON.parse(storedUser) : null;

        if (
          tokenData?.exp > Date.now() / 1000 &&
          restoredUser?.id &&
          restoredUser?.role
        ) {
          userRef.current = restoredUser;
          setUser(restoredUser);
        } else {
          localStorage.removeItem('authToken');
          localStorage.removeItem(STORED_USER_KEY);
        }
      } catch (error) {
        console.warn('Could not restore the saved authentication session:', error);
        localStorage.removeItem('authToken');
        localStorage.removeItem(STORED_USER_KEY);
      }

      if (!mounted) return;

      const { data } = supabase.auth.onAuthStateChange(async (event, session) => {
        console.log('Auth event:', event);

        if (!mounted) return;

        if (session?.user) {
          if (event === 'INITIAL_SESSION') {
            setLoading(true);
          }
          // Keep the stored API token in sync (covers TOKEN_REFRESHED, so the
          // axios interceptor never sends a stale access token).
          try {
            const liveToken = session.access_token;
            if (liveToken && localStorage.getItem('authToken') !== liveToken) {
              localStorage.setItem('authToken', liveToken);
            }
          } catch {
            // storage may be unavailable; non-fatal
          }
          const userData = await getUserData(session.user);

          if (mounted) {
            if (userData.role === 'CITIZEN' && userData.status !== 'ACTIVE') {
              await supabase.auth.signOut();
              localStorage.removeItem('authToken');
              localStorage.removeItem(STORED_USER_KEY);
              setUser(null);
            } else {
              const prev = userRef.current;
              const profileUnchanged =
                event === 'TOKEN_REFRESHED' &&
                prev &&
                prev.id === userData.id &&
                prev.email === userData.email &&
                prev.name === userData.name &&
                prev.role === userData.role &&
                prev.status === userData.status &&
                prev.profileId === userData.profileId;

              if (profileUnchanged) {
                // Session refreshed (e.g., switching back to the tab): keep the
                // same user object so dashboards don't refetch/blank their UI.
                userRef.current = prev;
              } else {
                setUser(userData);
                localStorage.setItem(STORED_USER_KEY, JSON.stringify(userData));
                await syncUserToSQLite(session.user, userData);
              }
            }
          }
        } else if (event === 'SIGNED_OUT' || event === 'USER_DELETED') {
          localStorage.removeItem('authToken');
          localStorage.removeItem(STORED_USER_KEY);
          setUser(null);
        }

        if (mounted && (event === 'INITIAL_SESSION' || !isSupabaseConfigured)) {
          setLoading(false);
        }
      });

      subscription = data.subscription;
      if (!isSupabaseConfigured) {
        setLoading(false);
      }
    };

    initializeAuth();

    return () => {
      mounted = false;
      subscription?.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!user?.id) {
      setOnlineUsers([]);
      return undefined;
    }

    const presenceChannel = supabase.channel('barangay-dashboard-presence', {
      config: {
        presence: {
          key: String(user.id),
        },
      },
    });

    const updateOnlineUsers = () => {
      const presenceState = presenceChannel.presenceState();
      const users = Object.entries(presenceState).flatMap(
        ([userId, presences]) =>
          presences.map((presence) => ({
            id: userId,
            role: presence.role,
          }))
      );

      setOnlineUsers(users);
    };

    presenceChannel.on('presence', { event: 'sync' }, updateOnlineUsers);
    presenceChannel.on('presence', { event: 'join' }, updateOnlineUsers);
    presenceChannel.on('presence', { event: 'leave' }, updateOnlineUsers);

    presenceChannel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await presenceChannel.track({
          role: String(user.role || '').toUpperCase(),
        });
        updateOnlineUsers();
      }
    });

    return () => {
      presenceChannel.untrack();
      supabase.removeChannel(presenceChannel);
    };
  }, [user?.id, user?.role]);

  // ==========================================
  // SYNC USER TO SQLITE
  // ==========================================
  const syncUserToSQLite = async (authUser, userData) => {
    try {
      await api.post('/admin/sync-user', {
        authId: authUser.id,
        email: userData?.email || authUser.email,
        fullName: userData?.name || authUser.user_metadata?.full_name || authUser.user_metadata?.name || '',
        role: userData?.role || authUser.user_metadata?.role || 'CITIZEN',
      });
    } catch (error) {
      console.warn('Failed to sync user to SQLite:', error);
    }
  };

  // ==========================================
  // LOGIN
  // ==========================================
  const login = async (
    email,
    password
  ) => {
    try {
      const cleanEmail = email.trim();

      const { data } = await api.post('/auth/login', {
        email: cleanEmail,
        password,
      });

      if (!data?.user) {
        throw new Error('Login failed.');
      }

      const rawRole = data.user.role;
      let normalizedRole = rawRole;
      if (normalizedRole && typeof normalizedRole === 'object') {
        normalizedRole = normalizedRole.name || normalizedRole.role_name || normalizedRole.role || 'CITIZEN';
      }
      normalizedRole = String(normalizedRole || 'CITIZEN').trim().toUpperCase() || 'CITIZEN';

      const userData = {
        ...data.user,
        name: data.user.fullName || data.user.name || '',
        role: normalizedRole,
        profileId: data.user.profileId || data.user.id || null,
        authId: data.user.authId || data.user.id || null,
      };

      // Best-effort Supabase browser session for storage/admin UI.
      if (isSupabaseConfigured) {
        try {
          const { error: supabaseLoginError } = await supabase.auth.signInWithPassword({
            email: cleanEmail,
            password,
          });

          if (!supabaseLoginError) {
            const {
              data: { session },
            } = await supabase.auth.getSession();

            if (session?.user) {
              const profileData = await getUserData(session.user);
              if (profileData && profileData.role) {
                userData.profileId = profileData.profileId || userData.profileId;
                userData.authId = profileData.authId || userData.authId;
                if (profileData.status) {
                  userData.status = profileData.status;
                }
                if (profileData.address) {
                  userData.address = profileData.address;
                }
              }
            }
          } else {
            console.warn('Supabase session login warning:', supabaseLoginError.message);
          }
        } catch (sessionError) {
          console.warn('Supabase session setup skipped:', sessionError?.message || sessionError);
        }
      }

      localStorage.setItem('authToken', data.token);
      localStorage.setItem(STORED_USER_KEY, JSON.stringify(userData));
      setUser(userData);

      return userData;
    } catch (error) {
      if (isSupabaseConfigured) {
        try {
          await supabase.auth.signOut();
        } catch {
          // ignore cleanup errors
        }
      }

      const message = error.response?.data?.message || error.message;
      const detail = error.response?.data?.detail;
      const combined =
        detail && message && !String(message).includes(String(detail))
          ? `${message} (${detail})`
          : message;
      throw new Error(combined || 'Login failed.');
    }
  };

  // ==========================================
  // REGISTER
  // ==========================================
  const register = async ({
    email,
    password,
    name,
    address,
    phone,
    clearanceFile,
    photoFile,
  }) => {
    const cleanEmail =
      email.trim();

    const cleanName =
      name.trim();

    if (!clearanceFile) {
      throw new Error('Barangay Clearance is required.');
    }

    const documentContent = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = () => reject(new Error('Could not read the Barangay Clearance file.'));
      reader.readAsDataURL(clearanceFile);
    });

    let photoContent = null;
    if (photoFile) {
      photoContent = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = () => reject(new Error('Could not read the citizen photo.'));
        reader.readAsDataURL(photoFile);
      });
    }

    const payload = {
      fullName: cleanName,
      email: cleanEmail,
      password,
      address: address?.trim() || '',
      phone: phone?.trim() || '',
      clearance: {
        name: clearanceFile.name,
        type: clearanceFile.type,
        content: documentContent,
      },
    };

    if (photoFile && photoContent) {
      payload.photo = {
        name: photoFile.name,
        type: photoFile.type,
        content: photoContent,
      };
    }

    const { data } = await api.post('/auth/register', payload).catch((error) => {
      const message = error.response?.data?.message || error.message;
      const detail = error.response?.data?.detail;
      const combined =
        detail && message && !String(message).includes(String(detail))
          ? `${message} (${detail})`
          : message;
      throw new Error(combined || 'Registration failed. Please try again.');
    });

    // IMPORTANT:
    // Do not manually log the user in here.
    //
    // If Supabase email confirmation is enabled,
    // the user should verify their email and then
    // go to the Login page.

    return data;
  };

  // ==========================================
  // LOGOUT
  // ==========================================
  const logout = async () => {
    try {
      if (isSupabaseConfigured) {
        const { error } = await supabase.auth.signOut();
        if (error) {
          console.warn('Supabase logout warning:', error.message);
        }
      }
    } catch (error) {
      console.warn('Logout error (continuing local cleanup):', error?.message || error);
    }

    setUser(null);
    localStorage.removeItem('authToken');
    localStorage.removeItem(STORED_USER_KEY);
  };

  // ==========================================
  // CONTEXT VALUE
  // ==========================================
  const value = useMemo(
    () => ({
      user,
      loading,
      onlineUsers,
      login,
      register,
      logout,
    }),
    [user, loading, onlineUsers]
  );

  return (
    <AuthContext.Provider value={value}>
      {loading ? (
        <div className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
          <div className="text-center">
            <div className="mb-3 text-xl font-semibold">Loading...</div>
            <div className="text-sm text-slate-400">Checking your session</div>
          </div>
        </div>
      ) : children}
    </AuthContext.Provider>
  );
}

// ==========================================
// useAuth HOOK
// ==========================================
export function useAuth() {
  const context =
    useContext(AuthContext);

  if (!context) {
    throw new Error(
      'useAuth must be used inside an AuthProvider'
    );
  }

  return context;
}
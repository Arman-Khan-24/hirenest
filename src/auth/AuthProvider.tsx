import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import type { AppRole, Organization, Profile } from '../types/db';

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  organization: Organization | null;
  loading: boolean;
  isConfigured: boolean;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
  homeRoute: string;
  isImpersonating: boolean;
  impersonatedOrg: Organization | null;
  startImpersonating: (org: Organization) => void;
  stopImpersonating: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function getHomeRouteForRole(role: AppRole | null | undefined, status?: string): string {
  if (!role || role === 'pending' || status === 'pending_approval') return '/pending';
  if (status === 'suspended') return '/suspended';
  switch (role) {
    case 'admin':
      return '/admin';
    case 'recruiter':
      return '/recruiter';
    case 'client_manager':
    case 'client_member':
      return '/client';
    case 'vendor_admin':
    case 'vendor_recruiter':
      return '/vendor';
    case 'candidate':
      return '/candidate';
    default:
      return '/pending';
  }
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [loading, setLoading] = useState<boolean>(isSupabaseConfigured);

  const [impersonatedOrg, setImpersonatedOrg] = useState<Organization | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.sessionStorage.getItem('hirenest_impersonated_org');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  const loadProfileAndOrg = useCallback(async (userId: string) => {
    try {
      // Never trust user_metadata for role; read role & status from public.profiles
      const { data: profData, error: profErr } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (profErr || !profData) {
        setProfile(null);
        setOrganization(null);
        return;
      }

      const typedProfile = profData as Profile;
      setProfile(typedProfile);

      if (typedProfile.org_id) {
        const { data: orgData } = await supabase
          .from('organizations')
          .select('*')
          .eq('id', typedProfile.org_id)
          .maybeSingle();
        setOrganization((orgData as Organization) || null);
      } else {
        setOrganization(null);
      }
    } catch {
      setProfile(null);
      setOrganization(null);
    }
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    let mounted = true;

    supabase.auth.getSession().then(async ({ data: { session: initialSession } }) => {
      if (!mounted) return;
      setSession(initialSession);
      if (initialSession?.user) {
        await loadProfileAndOrg(initialSession.user.id);
      }
      if (mounted) setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, currentSession) => {
      if (!mounted) return;
      setSession(currentSession);
      if (event === 'SIGNED_OUT' || !currentSession?.user) {
        setProfile(null);
        setOrganization(null);
        queryClient.clear(); // Section 10: Clear in-memory TanStack Query cache on sign-out
        setLoading(false);
        return;
      }
      await loadProfileAndOrg(currentSession.user.id);
      if (mounted) setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [loadProfileAndOrg, queryClient]);

  const refreshProfile = useCallback(async () => {
    if (session?.user?.id) {
      await loadProfileAndOrg(session.user.id);
    }
  }, [session?.user?.id, loadProfileAndOrg]);

  const startImpersonating = useCallback(
    (targetOrg: Organization) => {
      try {
        window.sessionStorage.setItem('hirenest_impersonated_org', JSON.stringify(targetOrg));
      } catch {
        // ignore
      }
      setImpersonatedOrg(targetOrg);
      queryClient.clear();
    },
    [queryClient]
  );

  const stopImpersonating = useCallback(() => {
    try {
      window.sessionStorage.removeItem('hirenest_impersonated_org');
    } catch {
      // ignore
    }
    setImpersonatedOrg(null);
    queryClient.clear();
  }, [queryClient]);

  const signOut = useCallback(async () => {
    stopImpersonating();
    queryClient.clear();
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
    setOrganization(null);
  }, [queryClient, stopImpersonating]);

  // If active user is Admin / Recruiter and impersonating an org:
  const isActualHq = profile?.role === 'admin' || profile?.role === 'recruiter';
  const isImpersonating = Boolean(impersonatedOrg && isActualHq);

  const effectiveProfile: Profile | null = isImpersonating && profile && impersonatedOrg
    ? {
        ...profile,
        role: impersonatedOrg.type === 'vendor' ? 'vendor_admin' : 'client_manager',
        org_id: impersonatedOrg.id,
      }
    : profile;

  const effectiveOrganization: Organization | null = isImpersonating && impersonatedOrg
    ? impersonatedOrg
    : organization;

  const homeRoute = getHomeRouteForRole(effectiveProfile?.role, effectiveProfile?.status);

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        profile: effectiveProfile,
        organization: effectiveOrganization,
        loading,
        isConfigured: isSupabaseConfigured,
        refreshProfile,
        signOut,
        homeRoute,
        isImpersonating,
        impersonatedOrg,
        startImpersonating,
        stopImpersonating,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}

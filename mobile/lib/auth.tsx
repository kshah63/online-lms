import React, { createContext, useContext, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { registerForPush } from "./push";
import { authenticate, getBiometricEnabled, isBiometricAvailable } from "./biometric";
import type { Profile } from "./types";

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  ready: boolean; // initial auth check done
  locked: boolean; // biometric gate engaged (cold start with biometrics on)
  unlock: () => Promise<boolean>;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [ready, setReady] = useState(false);
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      // Cold start with biometrics enabled → keep the UI locked until the
      // device authenticates (the Supabase session itself stays signed in).
      if (data.session && (await getBiometricEnabled()) && (await isBiometricAvailable())) {
        setLocked(true);
      }
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  async function loadProfile(userId: string) {
    const { data } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
    setProfile((data as Profile) ?? null);
    if (data) registerForPush(userId);
  }

  useEffect(() => {
    if (!session?.user) {
      setProfile(null);
      return;
    }
    loadProfile(session.user.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  const value: AuthState = {
    session,
    profile,
    ready,
    locked,
    unlock: async () => {
      const ok = await authenticate();
      if (ok) setLocked(false);
      return ok;
    },
    signIn: async (email, password) => {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      return { error: error?.message };
    },
    signOut: async () => {
      await supabase.auth.signOut();
      setProfile(null);
      setLocked(false);
    },
    refreshProfile: async () => {
      if (session?.user) await loadProfile(session.user.id);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

"use client";

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { useRouter } from "next/navigation";

interface UserInfo {
    id: string;
    email: string;
    username: string;
}

interface AuthContextType {
    user: UserInfo | null;
    token: string | null;
    isLoading: boolean;
    login: (email: string, password: string) => Promise<void>;
    register: (email: string, username: string, password: string) => Promise<void>;
    logout: () => void;
    /** Helper to get auth headers for fetch calls */
    authHeaders: () => Record<string, string>;
}

const AuthContext = createContext<AuthContextType | null>(null);

const API_BASE = "http://localhost:8000";

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<UserInfo | null>(null);
    const [token, setToken] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const router = useRouter();

    // On mount, check for existing token
    useEffect(() => {
        const savedToken = localStorage.getItem("auth-token");
        if (savedToken) {
            // Validate token by calling /auth/me
            fetch(`${API_BASE}/auth/me`, {
                headers: { Authorization: `Bearer ${savedToken}` },
            })
                .then((res) => {
                    if (res.ok) return res.json();
                    throw new Error("Invalid token");
                })
                .then((userData) => {
                    setToken(savedToken);
                    setUser(userData);
                })
                .catch(() => {
                    // Token is invalid — clear it
                    localStorage.removeItem("auth-token");
                })
                .finally(() => setIsLoading(false));
        } else {
            setIsLoading(false);
        }
    }, []);

    const login = useCallback(async (email: string, password: string) => {
        const res = await fetch(`${API_BASE}/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password }),
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({ detail: "Login failed" }));
            throw new Error(err.detail || "Login failed");
        }

        const data = await res.json();
        localStorage.setItem("auth-token", data.token);
        setToken(data.token);
        setUser(data.user);
        router.push("/");
    }, [router]);

    const register = useCallback(async (email: string, username: string, password: string) => {
        const res = await fetch(`${API_BASE}/auth/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, username, password }),
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({ detail: "Registration failed" }));
            throw new Error(err.detail || "Registration failed");
        }

        const data = await res.json();
        localStorage.setItem("auth-token", data.token);
        setToken(data.token);
        setUser(data.user);
        router.push("/");
    }, [router]);

    const logout = useCallback(() => {
        localStorage.removeItem("auth-token");
        setToken(null);
        setUser(null);
        router.push("/login");
    }, [router]);

    const authHeaders = useCallback((): Record<string, string> => {
        if (!token) return {};
        return { Authorization: `Bearer ${token}` };
    }, [token]);

    return (
        <AuthContext.Provider value={{ user, token, isLoading, login, register, logout, authHeaders }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth(): AuthContextType {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error("useAuth must be used within an AuthProvider");
    }
    return context;
}

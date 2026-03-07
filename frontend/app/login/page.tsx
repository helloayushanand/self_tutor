"use client";

import { useState } from "react";
import { useAuth } from "@/components/auth-context";
import Link from "next/link";
import { Book, LogIn, Eye, EyeOff } from "lucide-react";

export default function LoginPage() {
    const { login } = useAuth();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState("");
    const [isLoading, setIsLoading] = useState(false);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError("");
        setIsLoading(true);

        try {
            await login(email, password);
        } catch (err: any) {
            setError(err.message || "Login failed");
        } finally {
            setIsLoading(false);
        }
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-stone-100 dark:bg-slate-900 transition-colors duration-300 px-4">
            <div className="w-full max-w-sm">
                {/* Logo */}
                <div className="text-center mb-8">
                    <div className="inline-flex items-center gap-2 mb-2">
                        <Book className="w-8 h-8 text-stone-700 dark:text-slate-200" />
                        <h1 className="text-3xl font-serif font-bold text-stone-700 dark:text-slate-200">
                            The Agora
                        </h1>
                    </div>
                    <p className="text-sm text-stone-500 dark:text-slate-400">
                        Your personal study companion
                    </p>
                </div>

                {/* Form */}
                <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg p-6 border border-stone-200 dark:border-slate-700 transition-colors duration-300">
                    <h2 className="text-xl font-serif font-semibold text-stone-800 dark:text-slate-200 mb-5">
                        Welcome back
                    </h2>

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-stone-600 dark:text-slate-300 mb-1.5">
                                Email
                            </label>
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                autoFocus
                                className="w-full px-3 py-2 border border-stone-300 dark:border-slate-600 rounded-lg bg-stone-50 dark:bg-slate-700 text-stone-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-stone-400 dark:focus:ring-slate-500 transition-colors"
                                placeholder="you@example.com"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-stone-600 dark:text-slate-300 mb-1.5">
                                Password
                            </label>
                            <div className="relative">
                                <input
                                    type={showPassword ? "text" : "password"}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                    className="w-full px-3 py-2 pr-10 border border-stone-300 dark:border-slate-600 rounded-lg bg-stone-50 dark:bg-slate-700 text-stone-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-stone-400 dark:focus:ring-slate-500 transition-colors"
                                    placeholder="••••••••"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-2.5 top-2 text-stone-400 dark:text-slate-500 hover:text-stone-600 dark:hover:text-slate-300"
                                >
                                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </button>
                            </div>
                        </div>

                        {error && (
                            <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-2.5">
                                {error}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={isLoading}
                            className="w-full flex items-center justify-center gap-2 bg-stone-800 dark:bg-slate-600 text-white py-2.5 rounded-lg font-medium text-sm hover:bg-stone-700 dark:hover:bg-slate-500 disabled:opacity-50 transition-colors"
                        >
                            {isLoading ? (
                                "Signing in..."
                            ) : (
                                <>
                                    <LogIn className="w-4 h-4" />
                                    Sign In
                                </>
                            )}
                        </button>
                    </form>

                    <div className="mt-5 text-center">
                        <p className="text-sm text-stone-500 dark:text-slate-400">
                            Don&apos;t have an account?{" "}
                            <Link
                                href="/register"
                                className="text-stone-700 dark:text-slate-200 font-medium hover:underline"
                            >
                                Register
                            </Link>
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}

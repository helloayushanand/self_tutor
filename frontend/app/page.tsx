"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { FileBrowser } from "@/components/file-browser";
import { FileUpload } from "@/components/file-upload";
import { useAuth } from "@/components/auth-context";
import { Send, Moon, Sun, Menu, X, LogOut, User } from "lucide-react";
import clsx from "clsx";

// Dynamically import PdfReader with SSR disabled to avoid DOMMatrix errors
const PdfReader = dynamic(() => import("@/components/pdf-reader").then(mod => ({ default: mod.PdfReader })), {
  ssr: false,
  loading: () => (
    <div className="flex-1 flex items-center justify-center bg-stone-100 dark:bg-slate-900 text-stone-400 dark:text-slate-500 font-serif italic transition-colors duration-300">
      Loading PDF reader...
    </div>
  )
});

export default function Home() {
  const { user, token, isLoading, logout, authHeaders } = useAuth();
  const router = useRouter();

  const [selectedBook, setSelectedBook] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [chatHistory, setChatHistory] = useState<{ role: 'user' | 'ai', content: string, sources?: string[] }[]>([]);
  const [isIngesting, setIsIngesting] = useState(false);
  const [previousBook, setPreviousBook] = useState<string | null>(null);
  const [darkMode, setDarkMode] = useState(false);
  const [isLibraryOpen, setIsLibraryOpen] = useState(true);
  const [ingestedBooks, setIngestedBooks] = useState<Set<string>>(new Set());
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!isLoading && !user) {
      router.push("/login");
    }
  }, [isLoading, user, router]);

  // Load preferences from localStorage on mount
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme-preference');
    const savedLibraryState = localStorage.getItem('library-open');

    if (savedTheme === 'dark') {
      setDarkMode(true);
      document.documentElement.classList.add('dark');
    }

    if (savedLibraryState !== null) {
      setIsLibraryOpen(savedLibraryState === 'true');
    }
  }, []);

  // Show loading state while checking auth
  if (isLoading || !user) {
    return (
      <div className="flex h-screen items-center justify-center bg-stone-100 dark:bg-slate-900">
        <p className="text-stone-400 dark:text-slate-500 font-serif italic">Loading...</p>
      </div>
    );
  }

  function toggleDarkMode() {
    const newDarkMode = !darkMode;
    setDarkMode(newDarkMode);

    const htmlElement = document.documentElement;
    if (newDarkMode) {
      htmlElement.classList.add('dark');
      localStorage.setItem('theme-preference', 'dark');
    } else {
      htmlElement.classList.remove('dark');
      localStorage.setItem('theme-preference', 'light');
    }
  }

  function toggleLibrary() {
    const newState = !isLibraryOpen;
    setIsLibraryOpen(newState);
    localStorage.setItem('library-open', newState.toString());
  }

  async function autoIngestBook(bookPath: string) {
    if (ingestedBooks.has(bookPath)) return;

    try {
      const encodedFilename = encodeURIComponent(bookPath);
      const response = await fetch(`http://localhost:8000/ingest?filename=${encodedFilename}`, {
        method: 'POST',
        headers: authHeaders(),
      });

      if (response.ok) {
        setIngestedBooks(prev => new Set(prev).add(bookPath));
        console.log(`Auto-ingested: ${bookPath}`);
      } else {
        console.warn(`Failed to auto-ingest ${bookPath}, but continuing...`);
      }
    } catch (error) {
      console.warn(`Auto-ingestion error for ${bookPath}:`, error);
    }
  }

  function handleBookSelect(book: string | null) {
    if (previousBook && previousBook !== book && book) {
      // Optionally clear chat when switching books
    }
    setPreviousBook(book);
    setSelectedBook(book);

    if (book && !ingestedBooks.has(book)) {
      autoIngestBook(book);
    }
  }

  async function handleSendMessage() {
    if (!query.trim()) return;

    const userMessage = query;
    const newHistory = [...chatHistory, { role: 'user' as const, content: userMessage }];
    setChatHistory(newHistory);
    setQuery("");

    try {
      const recentHistory = chatHistory.slice(-5).map(msg => ({
        role: msg.role,
        content: msg.content
      }));

      const res = await fetch("http://localhost:8000/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify({
          message: userMessage,
          book_context: selectedBook?.split('/').pop(),
          chat_history: recentHistory
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(errorData.detail || `Server error: ${res.status}`);
      }

      const data = await res.json();
      setChatHistory([...newHistory, {
        role: 'ai',
        content: data.reply,
        sources: data.sources || []
      }]);
    } catch (e: any) {
      console.error("Chat error:", e);
      const errorMsg = e.message || "Error contacting the tutor. Make sure the backend is running.";
      setChatHistory([...newHistory, {
        role: 'ai',
        content: `Error: ${errorMsg}`
      }]);
    }
  }

  async function handleIngest() {
    if (!selectedBook) return;
    setIsIngesting(true);
    try {
      const encodedFilename = encodeURIComponent(selectedBook);
      const response = await fetch(`http://localhost:8000/ingest?filename=${encodedFilename}`, {
        method: 'POST',
        headers: authHeaders(),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: response.statusText }));
        throw new Error(errorData.detail || `Server error: ${response.status}`);
      }

      const data = await response.json();
      setIngestedBooks(prev => new Set(prev).add(selectedBook));
      alert(`Success! ${data.message || 'Book ingrained in memory!'}`);
    } catch (e: any) {
      const errorMsg = e.message || "Failed to ingest book. Check backend logs.";
      alert(`Error: ${errorMsg}`);
      console.error("Ingest error:", e);
    } finally {
      setIsIngesting(false);
    }
  }

  function handleUploadComplete() {
    setRefreshKey(prev => prev + 1);
  }

  return (
    <div className="flex h-screen bg-stone-100 dark:bg-slate-900 font-sans transition-colors duration-300">
      {/* Sidebar */}
      {isLibraryOpen && (
        <div className="w-64 transition-all duration-300 ease-in-out">
          <FileBrowser
            onSelectBook={handleBookSelect}
            onClose={toggleLibrary}
            onUploadClick={() => setIsUploadOpen(true)}
            refreshKey={refreshKey}
            authHeaders={authHeaders}
          />
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col h-full w-full">
        {/* Header */}
        <header className="h-14 border-b bg-white dark:bg-slate-800 border-stone-200 dark:border-slate-700 flex items-center px-4 justify-between transition-colors duration-300">
          <div className="flex items-center gap-3">
            {!isLibraryOpen && (
              <button
                onClick={toggleLibrary}
                className="p-2 rounded hover:bg-stone-100 dark:hover:bg-slate-700 transition-colors"
                aria-label="Open library"
              >
                <Menu className="w-5 h-5 text-stone-600 dark:text-slate-300" />
              </button>
            )}
            <h1 className="font-serif font-bold text-stone-700 dark:text-slate-200">The Agora</h1>
          </div>
          <div className="flex items-center gap-3">
            {/* User info */}
            <span className="text-xs text-stone-500 dark:text-slate-400 flex items-center gap-1">
              <User className="w-3.5 h-3.5" />
              {user.username}
            </span>

            <button
              onClick={toggleDarkMode}
              className="p-2 rounded hover:bg-stone-100 dark:hover:bg-slate-700 transition-colors"
              aria-label="Toggle dark mode"
            >
              {darkMode ? (
                <Sun className="w-5 h-5 text-stone-600 dark:text-slate-300" />
              ) : (
                <Moon className="w-5 h-5 text-stone-600 dark:text-slate-300" />
              )}
            </button>

            <button
              onClick={logout}
              className="p-2 rounded hover:bg-stone-100 dark:hover:bg-slate-700 transition-colors"
              aria-label="Logout"
              title="Logout"
            >
              <LogOut className="w-4 h-4 text-stone-500 dark:text-slate-400" />
            </button>

            {selectedBook && (
              <div className="flex gap-2 items-center">
                <span className="text-sm text-stone-500 dark:text-slate-400 py-1">{selectedBook}</span>
                <button
                  onClick={handleIngest}
                  disabled={isIngesting}
                  className="text-xs bg-stone-800 dark:bg-slate-700 text-white dark:text-slate-100 px-2 py-1 rounded hover:bg-stone-600 dark:hover:bg-slate-600 disabled:opacity-50 transition-colors"
                >
                  {isIngesting ? "Memorizing..." : "Memorize Book"}
                </button>
                {chatHistory.length > 0 && (
                  <button
                    onClick={() => setChatHistory([])}
                    className="text-xs bg-stone-300 dark:bg-slate-700 text-stone-700 dark:text-slate-200 px-2 py-1 rounded hover:bg-stone-400 dark:hover:bg-slate-600 transition-colors"
                    title="Clear chat history"
                  >
                    Clear Chat
                  </button>
                )}
              </div>
            )}
          </div>
        </header>

        <div className="flex-1 flex overflow-hidden">
          {/* PDF Reader (Left) */}
          <div className="flex-1 border-r border-stone-200 dark:border-slate-700 relative transition-colors duration-300">
            <PdfReader file={selectedBook} authToken={token} />
          </div>

          {/* Chat (Right) */}
          <div className="w-[400px] flex flex-col bg-white dark:bg-slate-800 transition-colors duration-300">
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {chatHistory.length === 0 && (
                <p className="text-center text-stone-400 dark:text-slate-500 mt-10 italic">
                  Ask me anything about the text...
                </p>
              )}
              {chatHistory.map((msg, i) => (
                <div key={i} className={clsx(
                  "p-3 rounded-lg text-sm max-w-[90%]",
                  msg.role === 'user'
                    ? "bg-stone-100 dark:bg-slate-700 ml-auto text-stone-800 dark:text-slate-100"
                    : "bg-blue-50 dark:bg-blue-900/30 text-blue-900 dark:text-blue-100 border border-blue-100 dark:border-blue-800/50"
                )}>
                  <div>{msg.content}</div>
                  {msg.role === 'ai' && msg.sources && msg.sources.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-blue-200 dark:border-blue-800/50">
                      <div className="text-xs text-blue-700 dark:text-blue-300 font-semibold mb-1">Sources:</div>
                      <ul className="text-xs text-blue-600 dark:text-blue-400 space-y-1">
                        {msg.sources.map((source, idx) => (
                          <li key={idx} className="truncate">• {source}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="p-4 border-t border-stone-100 dark:border-slate-700 transition-colors duration-300">
              <div className="relative">
                <input
                  className="w-full bg-stone-50 dark:bg-slate-700 border border-stone-200 dark:border-slate-600 text-stone-900 dark:text-slate-100 rounded-full pl-4 pr-10 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-stone-400 dark:focus:ring-slate-500 transition-colors duration-300"
                  placeholder="Ask the tutor..."
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSendMessage()}
                />
                <button
                  onClick={handleSendMessage}
                  className="absolute right-2 top-1.5 text-stone-400 dark:text-slate-400 hover:text-stone-600 dark:hover:text-slate-200 transition-colors"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Upload modal */}
      {isUploadOpen && (
        <FileUpload
          onUploadComplete={handleUploadComplete}
          onClose={() => setIsUploadOpen(false)}
          authHeaders={authHeaders}
        />
      )}
    </div>
  );
}

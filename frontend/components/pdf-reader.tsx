"use client";

import { useState, useMemo, memo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface PdfReaderProps {
    file: string | null;
    authToken: string | null;
}

export const PdfReader = memo(function PdfReader({ file, authToken }: PdfReaderProps) {
    const [currentPage, setCurrentPage] = useState<number>(1);
    const [pageInput, setPageInput] = useState<string>("1");
    // Track file changes to reset page and generate a stable cache key
    const [fileKey, setFileKey] = useState<number>(0);
    const [prevFile, setPrevFile] = useState<string | null>(null);
    if (file !== prevFile) {
        setPrevFile(file);
        setFileKey(k => k + 1);
        setCurrentPage(1);
        setPageInput("1");
    }

    // Stable URL — only recalculated when file, fileKey, or authToken changes
    const basePdfUrl = useMemo(() => {
        if (!file) return null;
        const encodedFile = encodeURIComponent(file);
        const tokenParam = authToken ? `&token=${encodeURIComponent(authToken)}` : "";
        return `http://localhost:8000/files/${encodedFile}?_=${fileKey}${tokenParam}`;
    }, [file, fileKey, authToken]);

    const pdfUrl = basePdfUrl ? `${basePdfUrl}#page=${currentPage}` : null;

    function goToPrevPage() {
        if (currentPage > 1) {
            const newPage = currentPage - 1;
            setCurrentPage(newPage);
            setPageInput(newPage.toString());
        }
    }

    function goToNextPage() {
        const newPage = currentPage + 1;
        setCurrentPage(newPage);
        setPageInput(newPage.toString());
    }

    function handlePageInputChange(e: React.ChangeEvent<HTMLInputElement>) {
        setPageInput(e.target.value);
    }

    function handlePageInputSubmit(e: React.FormEvent) {
        e.preventDefault();
        const page = parseInt(pageInput);
        if (!isNaN(page) && page > 0) {
            setCurrentPage(page);
        } else {
            setPageInput(currentPage.toString());
        }
    }

    function handlePageInputBlur() {
        const page = parseInt(pageInput);
        if (isNaN(page) || page < 1) {
            setPageInput(currentPage.toString());
        } else {
            setCurrentPage(page);
        }
    }

    if (!file) {
        return (
            <div className="flex-1 flex items-center justify-center bg-stone-100 dark:bg-slate-900 text-stone-400 dark:text-slate-500 font-serif italic transition-colors duration-300">
                Select a book from the library to begin reading...
            </div>
        );
    }

    return (
        <div className="flex-1 bg-stone-200 dark:bg-slate-900 overflow-hidden flex flex-col h-full transition-colors duration-300">
            {/* Page Navigation Controls */}
            <div className="bg-white dark:bg-slate-800 border-b border-stone-200 dark:border-slate-700 px-4 py-2 flex items-center justify-center gap-4 transition-colors duration-300">
                <button
                    onClick={goToPrevPage}
                    disabled={currentPage <= 1}
                    className="p-2 rounded hover:bg-stone-100 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    aria-label="Previous page"
                >
                    <ChevronLeft className="w-5 h-5 text-stone-600 dark:text-slate-300" />
                </button>

                <form onSubmit={handlePageInputSubmit} className="flex items-center gap-2">
                    <span className="text-sm text-stone-600 dark:text-slate-300">Page</span>
                    <input
                        type="number"
                        min="1"
                        value={pageInput}
                        onChange={handlePageInputChange}
                        onBlur={handlePageInputBlur}
                        className="w-16 px-2 py-1 text-sm border border-stone-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-stone-900 dark:text-slate-100 rounded text-center focus:outline-none focus:ring-1 focus:ring-stone-400 dark:focus:ring-slate-500 transition-colors"
                    />
                </form>

                <button
                    onClick={goToNextPage}
                    className="p-2 rounded hover:bg-stone-100 dark:hover:bg-slate-700 transition-colors"
                    aria-label="Next page"
                >
                    <ChevronRight className="w-5 h-5 text-stone-600 dark:text-slate-300" />
                </button>
            </div>

            {/* PDF iframe — only re-mounts when basePdfUrl changes (i.e. file switch) */}
            <div className="flex-1 relative bg-stone-300 dark:bg-slate-900 transition-colors duration-300">
                {pdfUrl ? (
                    <iframe
                        key={basePdfUrl}
                        src={pdfUrl}
                        className="w-full h-full border-0"
                        title="PDF Viewer"
                    />
                ) : (
                    <div className="flex items-center justify-center h-full">
                        <p className="text-stone-500 dark:text-slate-400">Loading PDF...</p>
                    </div>
                )}
            </div>
        </div>
    );
});

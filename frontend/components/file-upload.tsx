"use client";

import { useState, useRef, useCallback } from "react";
import { Upload, X, FileText, Archive, CheckCircle, AlertCircle, Loader2 } from "lucide-react";

interface FileUploadProps {
    onUploadComplete: () => void;
    onClose: () => void;
}

type UploadStatus = "idle" | "uploading" | "success" | "error";

interface UploadResult {
    status: UploadStatus;
    message: string;
    files: string[];
}

export function FileUpload({ onUploadComplete, onClose }: FileUploadProps) {
    const [isDragging, setIsDragging] = useState(false);
    const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
    }, []);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);

        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) {
            processFiles(files);
        }
    }, []);

    const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length > 0) {
            processFiles(files);
        }
        // Reset input so the same file can be selected again
        if (fileInputRef.current) {
            fileInputRef.current.value = "";
        }
    }, []);

    async function processFiles(files: File[]) {
        setIsUploading(true);
        setUploadResult(null);

        // Separate PDFs and ZIPs
        const pdfFiles = files.filter(f => f.name.toLowerCase().endsWith(".pdf"));
        const zipFiles = files.filter(f => f.name.toLowerCase().endsWith(".zip"));
        const otherFiles = files.filter(
            f => !f.name.toLowerCase().endsWith(".pdf") && !f.name.toLowerCase().endsWith(".zip")
        );

        const allUploadedPaths: string[] = [];
        const errors: string[] = [];

        if (otherFiles.length > 0) {
            errors.push(`Skipped ${otherFiles.length} unsupported file(s) (only PDF and ZIP allowed)`);
        }

        // Upload PDFs
        if (pdfFiles.length > 0) {
            try {
                const formData = new FormData();
                pdfFiles.forEach(f => formData.append("files", f));

                const res = await fetch("http://localhost:8000/upload", {
                    method: "POST",
                    body: formData,
                });

                if (!res.ok) {
                    const err = await res.json().catch(() => ({ detail: res.statusText }));
                    errors.push(err.detail || "Failed to upload PDFs");
                } else {
                    const data = await res.json();
                    allUploadedPaths.push(...data.files);
                }
            } catch (e: any) {
                errors.push(`Upload error: ${e.message}`);
            }
        }

        // Upload ZIPs (one at a time)
        for (const zipFile of zipFiles) {
            try {
                const formData = new FormData();
                formData.append("file", zipFile);

                const res = await fetch("http://localhost:8000/upload-zip", {
                    method: "POST",
                    body: formData,
                });

                if (!res.ok) {
                    const err = await res.json().catch(() => ({ detail: res.statusText }));
                    errors.push(`${zipFile.name}: ${err.detail || "Failed to extract ZIP"}`);
                } else {
                    const data = await res.json();
                    allUploadedPaths.push(...data.files);
                }
            } catch (e: any) {
                errors.push(`${zipFile.name}: ${e.message}`);
            }
        }

        // Determine result
        if (allUploadedPaths.length > 0) {
            setUploadResult({
                status: "success",
                message: `Uploaded ${allUploadedPaths.length} file(s)${errors.length > 0 ? ` (${errors.length} issue(s))` : ""}`,
                files: allUploadedPaths,
            });
            onUploadComplete();
        } else if (errors.length > 0) {
            setUploadResult({
                status: "error",
                message: errors.join("; "),
                files: [],
            });
        }

        setIsUploading(false);
    }

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-md overflow-hidden transition-colors duration-300">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-stone-200 dark:border-slate-700">
                    <h3 className="text-lg font-serif font-semibold text-stone-800 dark:text-slate-200">
                        Upload Books
                    </h3>
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-lg hover:bg-stone-100 dark:hover:bg-slate-700 transition-colors"
                        aria-label="Close upload dialog"
                    >
                        <X className="w-5 h-5 text-stone-500 dark:text-slate-400" />
                    </button>
                </div>

                {/* Drop Zone */}
                <div className="p-5">
                    <div
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                        onClick={() => fileInputRef.current?.click()}
                        className={`
                            relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer
                            transition-all duration-200 ease-in-out
                            ${isDragging
                                ? "border-blue-400 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-500 scale-[1.02]"
                                : "border-stone-300 dark:border-slate-600 hover:border-stone-400 dark:hover:border-slate-500 hover:bg-stone-50 dark:hover:bg-slate-750"
                            }
                            ${isUploading ? "pointer-events-none opacity-60" : ""}
                        `}
                    >
                        {isUploading ? (
                            <div className="flex flex-col items-center gap-3">
                                <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
                                <p className="text-sm text-stone-600 dark:text-slate-300">
                                    Uploading...
                                </p>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center gap-3">
                                <div className="p-3 bg-stone-100 dark:bg-slate-700 rounded-full">
                                    <Upload className="w-7 h-7 text-stone-500 dark:text-slate-400" />
                                </div>
                                <div>
                                    <p className="text-sm font-medium text-stone-700 dark:text-slate-200">
                                        Drop files here or click to browse
                                    </p>
                                    <p className="text-xs text-stone-400 dark:text-slate-500 mt-1.5">
                                        PDF files or ZIP archives containing PDFs
                                    </p>
                                </div>
                                <div className="flex gap-3 mt-1">
                                    <span className="inline-flex items-center gap-1 text-xs text-stone-400 dark:text-slate-500 bg-stone-100 dark:bg-slate-700 px-2 py-1 rounded-full">
                                        <FileText className="w-3 h-3" /> PDF
                                    </span>
                                    <span className="inline-flex items-center gap-1 text-xs text-stone-400 dark:text-slate-500 bg-stone-100 dark:bg-slate-700 px-2 py-1 rounded-full">
                                        <Archive className="w-3 h-3" /> ZIP
                                    </span>
                                </div>
                            </div>
                        )}
                    </div>

                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".pdf,.zip"
                        multiple
                        onChange={handleFileSelect}
                        className="hidden"
                    />

                    {/* Size limits info */}
                    <p className="text-xs text-stone-400 dark:text-slate-500 mt-3 text-center">
                        Max 50 MB per PDF · Max 200 MB per ZIP
                    </p>
                </div>

                {/* Result feedback */}
                {uploadResult && (
                    <div className={`mx-5 mb-5 p-3 rounded-lg text-sm ${uploadResult.status === "success"
                            ? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800"
                            : "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800"
                        }`}>
                        <div className="flex items-start gap-2">
                            {uploadResult.status === "success" ? (
                                <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                            ) : (
                                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                            )}
                            <div>
                                <p className="font-medium">{uploadResult.message}</p>
                                {uploadResult.files.length > 0 && (
                                    <ul className="mt-1.5 space-y-0.5">
                                        {uploadResult.files.map((f, i) => (
                                            <li key={i} className="text-xs opacity-75 truncate">
                                                • {f.replace("uploads/", "")}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

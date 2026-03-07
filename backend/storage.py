from abc import ABC, abstractmethod
from typing import List, Optional
import os
import glob
import shutil
import zipfile
import uuid

# Uploads directory lives alongside backend code
UPLOADS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads")
os.makedirs(UPLOADS_DIR, exist_ok=True)


class StorageProvider(ABC):
    @abstractmethod
    def list_files(self) -> List[dict]:
        """List all PDF files in the storage. Returns dicts with filename, path, source."""
        pass

    @abstractmethod
    def get_file_path(self, filename: str) -> str:
        """Get the absolute path or URL for a file."""
        pass


class LocalStorageProvider(StorageProvider):
    def __init__(self, base_dir: str = "library"):
        self.base_dir = os.path.abspath(base_dir)

    def list_files(self) -> List[dict]:
        results = []

        # 1. Library files (existing LIBRARY_PATH)
        if os.path.isdir(self.base_dir):
            lib_files = glob.glob(os.path.join(self.base_dir, "**/*.pdf"), recursive=True)
            for f in lib_files:
                rel = os.path.relpath(f, self.base_dir)
                results.append({
                    "filename": os.path.basename(f),
                    "path": rel,
                    "source": "library",
                })

        # 2. Uploaded files
        if os.path.isdir(UPLOADS_DIR):
            upload_files = glob.glob(os.path.join(UPLOADS_DIR, "**/*.pdf"), recursive=True)
            for f in upload_files:
                rel = os.path.relpath(f, UPLOADS_DIR)
                results.append({
                    "filename": os.path.basename(f),
                    "path": f"uploads/{rel}",
                    "source": "uploads",
                })

        return results

    def get_file_path(self, filename: str) -> str:
        """Resolve a file path — supports both library and uploads."""
        # Check if path starts with 'uploads/'
        if filename.startswith("uploads/"):
            rel = filename[len("uploads/"):]
            full_path = os.path.abspath(os.path.join(UPLOADS_DIR, rel))
            if not full_path.startswith(os.path.abspath(UPLOADS_DIR)):
                raise ValueError("Access denied")
            return full_path

        # Otherwise resolve from library
        full_path = os.path.abspath(os.path.join(self.base_dir, filename))
        if not full_path.startswith(self.base_dir):
            raise ValueError("Access denied")
        return full_path

    def save_uploaded_file(self, file_content: bytes, original_filename: str) -> str:
        """Save an uploaded PDF file. Returns the relative path (uploads/...)."""
        # Sanitize filename — keep original name but ensure no path traversal
        safe_name = os.path.basename(original_filename)
        if not safe_name.lower().endswith(".pdf"):
            raise ValueError("Only PDF files are allowed")

        # If file already exists, make it unique
        dest_path = os.path.join(UPLOADS_DIR, safe_name)
        if os.path.exists(dest_path):
            name, ext = os.path.splitext(safe_name)
            safe_name = f"{name}_{uuid.uuid4().hex[:8]}{ext}"
            dest_path = os.path.join(UPLOADS_DIR, safe_name)

        with open(dest_path, "wb") as f:
            f.write(file_content)

        return f"uploads/{safe_name}"

    def save_zip(self, file_content: bytes, original_filename: str) -> List[str]:
        """Extract PDFs from a ZIP file. Returns list of relative paths (uploads/...)."""
        if not original_filename.lower().endswith(".zip"):
            raise ValueError("Only ZIP files are allowed")

        # Save ZIP to temp location
        temp_zip = os.path.join(UPLOADS_DIR, f"_temp_{uuid.uuid4().hex}.zip")
        try:
            with open(temp_zip, "wb") as f:
                f.write(file_content)

            extracted_paths = []
            with zipfile.ZipFile(temp_zip, "r") as zf:
                for member in zf.namelist():
                    # Skip directories and non-PDF files
                    if member.endswith("/") or not member.lower().endswith(".pdf"):
                        continue

                    # Skip hidden files and __MACOSX
                    if any(part.startswith(".") or part == "__MACOSX" for part in member.split("/")):
                        continue

                    # Extract with directory structure preserved
                    # Sanitize path to prevent zip slip
                    safe_path = os.path.normpath(member)
                    if safe_path.startswith("..") or os.path.isabs(safe_path):
                        continue

                    dest = os.path.join(UPLOADS_DIR, safe_path)

                    # Handle duplicate names
                    if os.path.exists(dest):
                        name, ext = os.path.splitext(safe_path)
                        safe_path = f"{name}_{uuid.uuid4().hex[:8]}{ext}"
                        dest = os.path.join(UPLOADS_DIR, safe_path)

                    os.makedirs(os.path.dirname(dest), exist_ok=True)

                    with zf.open(member) as src, open(dest, "wb") as dst:
                        shutil.copyfileobj(src, dst)

                    extracted_paths.append(f"uploads/{safe_path}")

            return extracted_paths
        finally:
            # Clean up temp ZIP
            if os.path.exists(temp_zip):
                os.remove(temp_zip)

    def delete_uploaded_file(self, file_path: str) -> bool:
        """Delete an uploaded file. Only works for files in uploads/."""
        if not file_path.startswith("uploads/"):
            raise ValueError("Can only delete uploaded files")

        rel = file_path[len("uploads/"):]
        full_path = os.path.abspath(os.path.join(UPLOADS_DIR, rel))

        # Security check
        if not full_path.startswith(os.path.abspath(UPLOADS_DIR)):
            raise ValueError("Access denied")

        if not os.path.exists(full_path):
            return False

        os.remove(full_path)

        # Clean up empty parent directories
        parent = os.path.dirname(full_path)
        while parent != os.path.abspath(UPLOADS_DIR):
            if not os.listdir(parent):
                os.rmdir(parent)
                parent = os.path.dirname(parent)
            else:
                break

        return True


# Factory to get the correct provider
def get_storage_provider() -> StorageProvider:
    # Future: Check env var to return CloudStorageProvider
    return LocalStorageProvider()

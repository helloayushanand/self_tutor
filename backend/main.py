from fastapi import FastAPI, HTTPException, UploadFile, File, Depends
from fastapi.responses import FileResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr
from typing import List, Optional
import os
from urllib.parse import unquote
from dotenv import load_dotenv
from sqlalchemy.orm import Session

from storage import LocalStorageProvider
from rag_engine import rag_engine
from database import get_db, User
from auth import (
    hash_password,
    verify_password,
    create_access_token,
    get_current_user,
)

# Load environment variables
load_dotenv()

app = FastAPI(title="Book Study Platform API")

# Allow CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# USER CONFIG: Point to your library folder
LIBRARY_PATH = "/Users/ayush/Desktop/self/MAPY-first year"
storage = LocalStorageProvider(base_dir=LIBRARY_PATH)

# Upload size limits
MAX_PDF_SIZE = 50 * 1024 * 1024   # 50 MB
MAX_ZIP_SIZE = 200 * 1024 * 1024  # 200 MB


# ---------- Request/Response Models ----------

class BookResponse(BaseModel):
    filename: str
    path: str
    source: str = "library"

class ChatRequest(BaseModel):
    message: str
    book_context: str = None
    chat_history: List[dict] = []

class ChatResponse(BaseModel):
    reply: str
    sources: List[str] = []

class UploadResponse(BaseModel):
    status: str
    files: List[str]
    message: str

class RegisterRequest(BaseModel):
    email: str
    username: str
    password: str

class LoginRequest(BaseModel):
    email: str
    password: str

class AuthResponse(BaseModel):
    token: str
    user: dict

class UserResponse(BaseModel):
    id: str
    email: str
    username: str


# ---------- Auth Endpoints (Public) ----------

@app.post("/auth/register", response_model=AuthResponse)
def register(request: RegisterRequest, db: Session = Depends(get_db)):
    """Register a new user."""
    # Validate input
    if not request.email or not request.password or not request.username:
        raise HTTPException(status_code=400, detail="All fields are required")

    if len(request.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    if len(request.username) < 2:
        raise HTTPException(status_code=400, detail="Username must be at least 2 characters")

    # Check if email already exists
    existing = db.query(User).filter(User.email == request.email).first()
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")

    # Check if username already exists
    existing_username = db.query(User).filter(User.username == request.username).first()
    if existing_username:
        raise HTTPException(status_code=409, detail="Username already taken")

    # Create user
    user = User(
        email=request.email,
        username=request.username,
        password_hash=hash_password(request.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    # Generate JWT
    token = create_access_token(user.id, user.email)

    return {
        "token": token,
        "user": {"id": user.id, "email": user.email, "username": user.username},
    }


@app.post("/auth/login", response_model=AuthResponse)
def login(request: LoginRequest, db: Session = Depends(get_db)):
    """Login with email and password."""
    user = db.query(User).filter(User.email == request.email).first()
    if not user or not verify_password(request.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    token = create_access_token(user.id, user.email)

    return {
        "token": token,
        "user": {"id": user.id, "email": user.email, "username": user.username},
    }


@app.get("/auth/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    """Get current user info."""
    return {
        "id": current_user.id,
        "email": current_user.email,
        "username": current_user.username,
    }


# ---------- Health Endpoints (Public) ----------

@app.get("/")
def health_check():
    return {"status": "ok", "library": LIBRARY_PATH}


@app.get("/health/rag")
def rag_health_check():
    """Check if RAG engine is properly configured."""
    try:
        api_key_set = bool(os.getenv("GROQ_API_KEY"))
        return {
            "status": "ok",
            "api_key_set": api_key_set,
            "api_provider": "Groq (free tier)",
            "llm_model": "llama-3.1-8b-instant",
            "embeddings": "HuggingFace (free, local)",
        }
    except Exception as e:
        return {"status": "error", "error": str(e)}


# ---------- Protected Endpoints ----------

@app.get("/books", response_model=List[BookResponse])
def list_books(current_user: User = Depends(get_current_user)):
    """List all available PDFs from library and user's uploads."""
    try:
        files = storage.list_files(user_id=current_user.id)
        return files
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error accessing files: {str(e)}")


@app.post("/ingest")
def ingest_book(filename: str, current_user: User = Depends(get_current_user)):
    """Trigger manual ingestion of a book into the user's collection."""
    try:
        decoded_filename = unquote(filename)
        full_path = storage.get_file_path(decoded_filename, user_id=current_user.id)

        if not os.path.exists(full_path):
            raise HTTPException(
                status_code=404,
                detail=f"File not found: {full_path}. Make sure the file exists.",
            )

        if not full_path.lower().endswith(".pdf"):
            raise HTTPException(status_code=400, detail="Only PDF files can be ingested.")

        print(f"Starting ingestion of: {full_path} for user {current_user.id}")
        rag_engine.ingest_file(full_path, user_id=current_user.id)
        print(f"Successfully ingested: {full_path}")

        return {
            "status": "ingested",
            "file": decoded_filename,
            "message": f"Successfully ingested {os.path.basename(decoded_filename)}",
        }
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"Error ingesting file '{filename}': {str(e)}",
        )


@app.post("/upload", response_model=UploadResponse)
async def upload_pdfs(
    files: List[UploadFile] = File(...),
    current_user: User = Depends(get_current_user),
):
    """Upload one or more PDF files."""
    uploaded_paths = []
    errors = []

    for file in files:
        if not file.filename or not file.filename.lower().endswith(".pdf"):
            errors.append(f"Skipped '{file.filename}': not a PDF file")
            continue

        content = await file.read()
        if len(content) > MAX_PDF_SIZE:
            errors.append(f"Skipped '{file.filename}': exceeds {MAX_PDF_SIZE // (1024*1024)} MB limit")
            continue

        try:
            path = storage.save_uploaded_file(content, file.filename, user_id=current_user.id)
            uploaded_paths.append(path)
        except Exception as e:
            errors.append(f"Failed to save '{file.filename}': {str(e)}")

    if not uploaded_paths and errors:
        raise HTTPException(status_code=400, detail="; ".join(errors))

    message_parts = [f"Uploaded {len(uploaded_paths)} file(s)"]
    if errors:
        message_parts.append(f" ({len(errors)} skipped)")

    return {
        "status": "uploaded",
        "files": uploaded_paths,
        "message": "".join(message_parts),
    }


@app.post("/upload-zip", response_model=UploadResponse)
async def upload_zip(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    """Upload a ZIP file containing PDFs."""
    if not file.filename or not file.filename.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="Only ZIP files are accepted")

    content = await file.read()
    if len(content) > MAX_ZIP_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"ZIP file exceeds {MAX_ZIP_SIZE // (1024*1024)} MB limit",
        )

    try:
        extracted_paths = storage.save_zip(content, file.filename, user_id=current_user.id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error extracting ZIP: {str(e)}")

    if not extracted_paths:
        raise HTTPException(status_code=400, detail="No PDF files found in the ZIP archive")

    return {
        "status": "extracted",
        "files": extracted_paths,
        "message": f"Extracted {len(extracted_paths)} PDF(s) from ZIP",
    }


@app.delete("/upload/{file_path:path}")
def delete_uploaded_file(
    file_path: str,
    current_user: User = Depends(get_current_user),
):
    """Delete an uploaded file (only for files owned by the current user)."""
    try:
        decoded_path = unquote(file_path)
        if not decoded_path.startswith("uploads/"):
            decoded_path = f"uploads/{decoded_path}"

        deleted = storage.delete_uploaded_file(decoded_path, user_id=current_user.id)
        if not deleted:
            raise HTTPException(status_code=404, detail="File not found")

        return {"status": "deleted", "file": decoded_path}
    except ValueError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error deleting file: {str(e)}")


@app.post("/chat", response_model=ChatResponse)
def chat(request: ChatRequest, current_user: User = Depends(get_current_user)):
    """Ask a question to the RAG system (searches user's own collection)."""
    try:
        if not request.message or not request.message.strip():
            raise HTTPException(status_code=400, detail="Message cannot be empty")

        answer, sources = rag_engine.query(
            request.message,
            user_id=current_user.id,
            filter_filename=request.book_context,
            chat_history=request.chat_history,
        )
        return {"reply": answer, "sources": sources}
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"Error processing chat request: {str(e)}",
        )


@app.get("/files/{file_path:path}")
def get_file(file_path: str, current_user: User = Depends(get_current_user)):
    """Serve a PDF file securely (from library or user's uploads).
    
    Accepts auth via Authorization header OR ?token= query param (needed for iframe src).
    """
    try:
        decoded_path = unquote(file_path)
        full_path = storage.get_file_path(decoded_path, user_id=current_user.id)

        if not os.path.exists(full_path):
            raise HTTPException(status_code=404, detail=f"File not found: {decoded_path}")

        if not full_path.lower().endswith(".pdf"):
            raise HTTPException(status_code=400, detail="Only PDF files can be served")

        return FileResponse(
            full_path,
            media_type="application/pdf",
            headers={
                "Content-Disposition": f'inline; filename="{os.path.basename(decoded_path)}"'
            },
        )
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=404, detail=f"Error serving file: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

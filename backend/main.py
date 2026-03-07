from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.responses import FileResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import os
from urllib.parse import unquote
from dotenv import load_dotenv
from storage import LocalStorageProvider
from rag_engine import rag_engine

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
# Hardcoded to your MAPY library
LIBRARY_PATH = "/Users/ayush/Desktop/self/MAPY-first year"
storage = LocalStorageProvider(base_dir=LIBRARY_PATH)

# Upload size limits
MAX_PDF_SIZE = 50 * 1024 * 1024   # 50 MB
MAX_ZIP_SIZE = 200 * 1024 * 1024  # 200 MB


class BookResponse(BaseModel):
    filename: str
    path: str
    source: str = "library"

class ChatRequest(BaseModel):
    message: str
    book_context: str = None  # Optional: specific book to filter by
    chat_history: List[dict] = []  # Optional: conversation history

class ChatResponse(BaseModel):
    reply: str
    sources: List[str] = []

class UploadResponse(BaseModel):
    status: str
    files: List[str]
    message: str


@app.get("/")
def health_check():
    return {"status": "ok", "library": LIBRARY_PATH}

@app.get("/health/rag")
def rag_health_check():
    """Check if RAG engine is properly configured."""
    try:
        # Check API key
        api_key_set = bool(os.getenv("GROQ_API_KEY"))
        
        # Try to check vector store
        try:
            collection = rag_engine.vector_store._collection
            doc_count = collection.count() if collection else 0
        except:
            doc_count = "unknown"
        
        return {
            "status": "ok",
            "api_key_set": api_key_set,
            "api_provider": "Groq (free tier)",
            "llm_model": "llama-3.1-8b-instant",
            "embeddings": "HuggingFace (free, local)",
            "documents_in_store": doc_count
        }
    except Exception as e:
        return {"status": "error", "error": str(e)}

@app.get("/books", response_model=List[BookResponse])
def list_books():
    """List all available PDFs from library and uploads."""
    try:
        files = storage.list_files()
        return files
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error accessing files: {str(e)}")

@app.post("/ingest")
def ingest_book(filename: str):
    """Trigger manual ingestion of a book."""
    try:
        # URL decode the filename in case it's encoded
        decoded_filename = unquote(filename)
        
        # Get the full path
        full_path = storage.get_file_path(decoded_filename)
        
        # Check if file exists
        if not os.path.exists(full_path):
            raise HTTPException(
                status_code=404, 
                detail=f"File not found: {full_path}. Make sure the file exists in your library."
            )
        
        # Check if it's a PDF
        if not full_path.lower().endswith('.pdf'):
            raise HTTPException(
                status_code=400,
                detail="Only PDF files can be ingested."
            )
        
        # Ingest the file
        print(f"Starting ingestion of: {full_path}")
        rag_engine.ingest_file(full_path)
        print(f"Successfully ingested: {full_path}")
        
        return {
            "status": "ingested", 
            "file": decoded_filename,
            "message": f"Successfully ingested {os.path.basename(decoded_filename)}"
        }
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        error_detail = str(e)
        traceback.print_exc()
        raise HTTPException(
            status_code=500, 
            detail=f"Error ingesting file '{filename}': {error_detail}"
        )


@app.post("/upload", response_model=UploadResponse)
async def upload_pdfs(files: List[UploadFile] = File(...)):
    """Upload one or more PDF files."""
    uploaded_paths = []
    errors = []

    for file in files:
        # Validate file type
        if not file.filename or not file.filename.lower().endswith(".pdf"):
            errors.append(f"Skipped '{file.filename}': not a PDF file")
            continue

        # Read content and check size
        content = await file.read()
        if len(content) > MAX_PDF_SIZE:
            errors.append(f"Skipped '{file.filename}': exceeds {MAX_PDF_SIZE // (1024*1024)} MB limit")
            continue

        try:
            path = storage.save_uploaded_file(content, file.filename)
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
async def upload_zip(file: UploadFile = File(...)):
    """Upload a ZIP file containing PDFs."""
    # Validate file type
    if not file.filename or not file.filename.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="Only ZIP files are accepted")

    # Read content and check size
    content = await file.read()
    if len(content) > MAX_ZIP_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"ZIP file exceeds {MAX_ZIP_SIZE // (1024*1024)} MB limit"
        )

    try:
        extracted_paths = storage.save_zip(content, file.filename)
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
def delete_uploaded_file(file_path: str):
    """Delete an uploaded file."""
    try:
        decoded_path = unquote(file_path)

        # Ensure the path includes the uploads/ prefix
        if not decoded_path.startswith("uploads/"):
            decoded_path = f"uploads/{decoded_path}"

        deleted = storage.delete_uploaded_file(decoded_path)
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
def chat(request: ChatRequest):
    """Ask a question to the RAG system."""
    try:
        # Validate request
        if not request.message or not request.message.strip():
            raise HTTPException(status_code=400, detail="Message cannot be empty")
        
        # If book_context is provided, we could filter, but for now we search all
        # Pass chat history for conversational context
        answer, sources = rag_engine.query(
            request.message, 
            filter_filename=request.book_context,
            chat_history=request.chat_history
        )
        return {"reply": answer, "sources": sources}
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        error_detail = str(e)
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Error processing chat request: {error_detail}")

@app.get("/files/{file_path:path}")
def get_file(file_path: str):
    """Serve a PDF file securely (from library or uploads)."""
    try:
        # URL decode the file path
        decoded_path = unquote(file_path)
        
        # Get the full path (handles both library and uploads)
        full_path = storage.get_file_path(decoded_path)
        
        # Check if file exists
        if not os.path.exists(full_path):
            raise HTTPException(
                status_code=404, 
                detail=f"File not found: {decoded_path}"
            )
        
        # Check if it's a PDF (security check)
        if not full_path.lower().endswith('.pdf'):
            raise HTTPException(
                status_code=400,
                detail="Only PDF files can be served"
            )
        
        # Return the file with proper headers for inline display (not download)
        return FileResponse(
            full_path,
            media_type="application/pdf",
            headers={
                "Content-Disposition": f'inline; filename="{os.path.basename(decoded_path)}"'
            }
        )
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=404, 
            detail=f"Error serving file: {str(e)}"
        )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

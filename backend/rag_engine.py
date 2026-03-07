
import os
from typing import List, Tuple, Optional
from langchain_community.document_loaders import PyPDFLoader
# Using Groq for LLM (free tier) and HuggingFace for embeddings (free, no API key needed)
from langchain_groq import ChatGroq
from langchain_community.embeddings import HuggingFaceEmbeddings
from langchain_community.vectorstores import Chroma
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_classic.chains import ConversationalRetrievalChain
from langchain_core.prompts import PromptTemplate
import shutil

class RAGEngine:
    def __init__(self, persist_directory: str = "db_storage"):
        self.persist_directory = persist_directory
        # Check for Groq API Key
        if not os.getenv("GROQ_API_KEY"):
            print("WARNING: GROQ_API_KEY not found. Please export it.")
            print("Get your free API key at: https://console.groq.com/")

        # Use HuggingFace embeddings (free, no API key needed)
        # Using a lightweight, fast model
        print("Loading embeddings model (this may take a moment on first run)...")
        self.embeddings = HuggingFaceEmbeddings(
            model_name="sentence-transformers/all-MiniLM-L6-v2",
            model_kwargs={'device': 'cpu'},  # Use CPU (no GPU needed)
            encode_kwargs={'normalize_embeddings': True}
        )
        print("Embeddings model loaded!")
        
        # Using Groq LLM (free tier)
        # Available models: llama-3.1-8b-instant (fast), llama-3.1-70b-versatile (better quality), mixtral-8x7b-32768
        self.llm = ChatGroq(
            groq_api_key=os.getenv("GROQ_API_KEY"),
            model_name="llama-3.1-8b-instant",  # Fast and free tier friendly
            temperature=0.3,
        )

        # Cache of per-user vector stores
        self._user_stores = {}

    def _get_user_store(self, user_id: str) -> Chroma:
        """Get or create a ChromaDB collection for a specific user."""
        if user_id not in self._user_stores:
            collection_name = f"user_{user_id}"
            self._user_stores[user_id] = Chroma(
                persist_directory=self.persist_directory,
                embedding_function=self.embeddings,
                collection_name=collection_name,
            )
        return self._user_stores[user_id]

    def ingest_file(self, file_path: str, user_id: str, collection_name: str = "default"):
        """Reads a PDF, chunks it, and saves vectors to the user's collection."""
        try:
            print(f"Ingesting: {file_path} for user {user_id}")
            
            # Check if file exists
            if not os.path.exists(file_path):
                raise FileNotFoundError(f"File not found: {file_path}")
            
            # Load PDF
            try:
                loader = PyPDFLoader(file_path)
                documents = loader.load()
            except Exception as e:
                raise ValueError(f"Failed to load PDF: {str(e)}. The file might be corrupted or not a valid PDF.")
            
            if not documents or len(documents) == 0:
                raise ValueError("PDF appears to be empty or could not be read.")
            
            # Split into chunks
            text_splitter = RecursiveCharacterTextSplitter(chunk_size=2000, chunk_overlap=200)
            chunks = text_splitter.split_documents(documents)
            
            if not chunks or len(chunks) == 0:
                raise ValueError("No text chunks could be extracted from the PDF.")

            # Add metadata
            for chunk in chunks:
                chunk.metadata["source"] = os.path.basename(file_path)

            # Check API key before trying to embed
            if not os.getenv("GROQ_API_KEY"):
                raise ValueError("GROQ_API_KEY is not set. Please set it in your environment variables. Get your free key at: https://console.groq.com/")
            
            # Add to the user's vector store
            user_store = self._get_user_store(user_id)
            try:
                user_store.add_documents(chunks)
            except Exception as e:
                error_msg = str(e)
                if "API key" in error_msg or "authentication" in error_msg.lower():
                    raise ValueError(f"API authentication failed: {error_msg}")
                raise ValueError(f"Failed to add documents to vector store: {error_msg}")
            
            print(f"Successfully ingested {len(chunks)} chunks from {file_path} for user {user_id}")
        except Exception as e:
            print(f"Error during ingestion: {str(e)}")
            raise

    def query(self, question: str, user_id: str, filter_filename: str = None, chat_history: Optional[List] = None) -> Tuple[str, List[str]]:
        """Query the RAG system with conversational context and return both answer and source documents."""
        try:
            user_store = self._get_user_store(user_id)

            search_kwargs = {"k": 8}  # Retrieve more documents for better context
            if filter_filename:
                search_kwargs["filter"] = {"source": filter_filename}

            # Check if store has documents
            try:
                collection = user_store._collection
                if collection:
                    count = collection.count()
                    print(f"Vector store for user {user_id} has {count} documents")
                    if count == 0:
                        return (
                            "I don't have any books in my memory yet. Please ingest a book first by clicking 'Memorize Book' on a selected PDF.",
                            []
                        )
                else:
                    print("WARNING: Vector store collection is None")
                    return (
                        "I don't have any books in my memory yet. Please ingest a book first by clicking 'Memorize Book' on a selected PDF.",
                        []
                    )
            except Exception as e:
                print(f"Error checking document count: {e}")
                # Proceed anyway - might still work
            
            retriever = user_store.as_retriever(
                search_kwargs=search_kwargs,
                search_type="mmr",  # Use MMR for better diversity
                search_type_kwargs={"k": 8, "fetch_k": 20}
            )
            
            # Create a better prompt template for study assistance
            system_prompt = """You are an intelligent study assistant helping a student understand their course materials. 
Your role is to:
1. Understand the context of questions even if they're phrased informally (e.g., "this chapter", "this pdf", "summarize this")
2. Provide comprehensive, helpful answers based on the retrieved documents
3. Connect concepts and provide explanations, not just quote text
4. If the question is vague, infer context from the conversation history and retrieved documents
5. When asked to summarize, provide a clear, structured summary of the key points

Use the following pieces of retrieved context to answer the question. If you don't know the answer based on the context, say so, but try to be helpful.

Context from the documents:
{context}

Previous conversation:
{chat_history}

Question: {question}

Provide a helpful, comprehensive answer:"""
            
            prompt = PromptTemplate(
                template=system_prompt,
                input_variables=["context", "question", "chat_history"]
            )
            
            qa_chain = ConversationalRetrievalChain.from_llm(
                llm=self.llm,
                retriever=retriever,
                combine_docs_chain_kwargs={"prompt": prompt},
                return_source_documents=True,
                verbose=True
            )

            print(f"Querying RAG with question: {question[:50]}...")
            invoke_input = {"question": question}
            if chat_history:
                invoke_input["chat_history"] = []
                for i in range(0, len(chat_history) - 1, 2):
                    if i + 1 < len(chat_history):
                        user_msg = chat_history[i].get("content", "") if chat_history[i].get("role") == "user" else ""
                        ai_msg = chat_history[i + 1].get("content", "") if chat_history[i + 1].get("role") == "ai" else ""
                        if user_msg and ai_msg:
                            invoke_input["chat_history"].append((user_msg, ai_msg))
            else:
                invoke_input["chat_history"] = []
            
            result = qa_chain.invoke(invoke_input)
            print(f"RAG query completed. Result type: {type(result)}")
            
            # Extract answer
            answer = result.get("answer", "") if isinstance(result, dict) else str(result)
            if not answer:
                print("WARNING: Empty answer from RAG chain")
                answer = "I couldn't generate a response. Please try rephrasing your question."
            
            # Extract sources from source documents
            sources = []
            if isinstance(result, dict) and "source_documents" in result:
                seen_sources = set()
                for doc in result["source_documents"]:
                    source = doc.metadata.get("source", "Unknown")
                    if source not in seen_sources:
                        sources.append(source)
                        seen_sources.add(source)
            
            print(f"Returning answer (length: {len(answer)}), sources: {sources}")
            return answer, sources
        except Exception as e:
            error_msg = str(e)
            print(f"RAG query error: {error_msg}")
            
            # Provide helpful error messages
            if "GROQ_API_KEY" in error_msg or "API key" in error_msg.lower() or "groq" in error_msg.lower():
                return (
                    "Error: Groq API key is missing or invalid. Please check your GROQ_API_KEY environment variable. Get your free key at: https://console.groq.com/",
                    []
                )
            elif "empty" in error_msg.lower() or "no documents" in error_msg.lower():
                return (
                    "I don't have any books in my memory yet. Please ingest a book first by clicking 'Memorize Book'.",
                    []
                )
            else:
                return (
                    f"I encountered an error while processing your question: {error_msg}. Please try again or check the backend logs.",
                    []
                )

rag_engine = RAGEngine()

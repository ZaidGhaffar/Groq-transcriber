from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import uvicorn
import asyncio
import io
import tempfile
import os
import uuid
import logging
import requests
import json
from dotenv import load_dotenv
import base64

# Load environment variables
load_dotenv()
GROQ_API_KEY = os.getenv("GROQ_API_KEY")

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

# Updated CORS configuration
origins = [
    "http://localhost:3000",
    "https://groq-transcriber-wintax.vercel.app",
    "https://www.groq-transcriber-wintax.vercel.app",
    "https://e5c2-2407-d000-d-e7da-31c0-365e-f0dd-3320.ngrok.io",
    "wss://e5c2-2407-d000-d-e7da-31c0-365e-f0dd-3320.ngrok.io"
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create a temporary directory to store audio chunks
TEMP_DIR = tempfile.mkdtemp()
logger.info(f"Created temporary directory at {TEMP_DIR}")

# Health check endpoint
@app.get("/")
async def root():
    return {"status": "online"}

@app.get("/health")
async def health_check():
    return JSONResponse(content={"status": "healthy", "service": "groq-transcriber-backend"})

class ConnectionManager:
    def __init__(self):
        self.active_connections: dict[str, WebSocket] = {}
        
    async def connect(self, websocket: WebSocket) -> str:
        await websocket.accept()
        client_id = str(uuid.uuid4())
        self.active_connections[client_id] = websocket
        return client_id
        
    def disconnect(self, client_id: str):
        if client_id in self.active_connections:
            del self.active_connections[client_id]
            
    async def send_text(self, client_id: str, message: str):
        if client_id in self.active_connections:
            await self.active_connections[client_id].send_text(message)

manager = ConnectionManager()

async def transcribe_audio(audio_file_path):
    """
    Transcribe audio using Groq's Speech-to-Text API
    """
    try:
        # Read the audio file directly
        with open(audio_file_path, "rb") as audio_file:
            audio_data = audio_file.read()
        
        # Prepare headers for the API request
        headers = {
            "Authorization": f"Bearer {GROQ_API_KEY}",
            "Content-Type": "multipart/form-data"
        }
        
        # Prepare the files for the API request
        files = {
            'file': (os.path.basename(audio_file_path), audio_data),
            'model': (None, 'whisper-large-v3-turbo'),
            'language': (None, 'en')
        }
        
        # Make the API request
        response = requests.post(
            "https://api.groq.com/openai/v1/audio/transcriptions",
            headers={"Authorization": f"Bearer {GROQ_API_KEY}"},
            files=files
        )
        
        # Check if the request was successful
        if response.status_code == 200:
            result = response.json()
            return result.get("text", "")
        else:
            logger.error(f"Error from Groq API: {response.status_code} - {response.text}")
            return f"Transcription error: {response.status_code}"
            
    except Exception as e:
        logger.error(f"Error transcribing audio: {str(e)}")
        return f"Error: {str(e)}"

async def process_audio_chunks(client_id, client_dir):
    """
    Process all audio chunks for a client and transcribe them
    """
    try:
        # Get all chunk files
        chunk_files = sorted([os.path.join(client_dir, f) for f in os.listdir(client_dir) if f.endswith('.webm')])
        
        if not chunk_files:
            return "No audio chunks to process"
        
        # Combine all chunks into a single file
        combined_file = os.path.join(client_dir, "combined.webm")
        with open(combined_file, 'wb') as outfile:
            for chunk_file in chunk_files:
                with open(chunk_file, 'rb') as infile:
                    outfile.write(infile.read())
        
        # Transcribe the combined audio
        transcription = await transcribe_audio(combined_file)
        return transcription
        
    except Exception as e:
        logger.error(f"Error processing audio chunks: {str(e)}")
        return f"Error: {str(e)}"

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    client_id = await manager.connect(websocket)
    logger.info(f"Client connected: {client_id}")
    
    # Create a directory for this client's audio chunks
    client_dir = os.path.join(TEMP_DIR, client_id)
    os.makedirs(client_dir, exist_ok=True)
    
    chunk_count = 0
    last_transcription_time = 0
    transcription_interval = 2  # seconds
    
    try:
        while True:
            # Receive audio chunk
            audio_data = await websocket.receive_bytes()
            
            # Save the chunk to a temporary file
            chunk_filename = os.path.join(client_dir, f"chunk_{chunk_count}.webm")
            with open(chunk_filename, "wb") as f:
                f.write(audio_data)
            
            logger.info(f"Received and saved audio chunk {chunk_count} from client {client_id}")
            chunk_count += 1
            
            # Process for transcription every few chunks
            current_time = asyncio.get_event_loop().time()
            if current_time - last_transcription_time >= transcription_interval and chunk_count > 1:
                last_transcription_time = current_time
                
                # Process audio chunks in the background
                transcription_task = asyncio.create_task(process_audio_chunks(client_id, client_dir))
                
                # Wait for transcription to complete
                transcription = await transcription_task
                
                # Send transcription back to client
                if transcription:
                    await manager.send_text(client_id, transcription)
                    logger.info(f"Sent transcription to client {client_id}")
            
    except WebSocketDisconnect:
        logger.info(f"Client disconnected: {client_id}")
        manager.disconnect(client_id)
        
        # Final transcription before cleanup
        try:
            final_transcription = await process_audio_chunks(client_id, client_dir)
            if final_transcription:
                await manager.send_text(client_id, final_transcription)
                logger.info(f"Sent final transcription to client {client_id}")
        except Exception as e:
            logger.error(f"Error sending final transcription: {str(e)}")
        
        # Clean up client directory when they disconnect
        if os.path.exists(client_dir):
            for file in os.listdir(client_dir):
                try:
                    os.remove(os.path.join(client_dir, file))
                except Exception as e:
                    logger.error(f"Error removing file: {str(e)}")
            try:
                os.rmdir(client_dir)
                logger.info(f"Cleaned up directory for client {client_id}")
            except Exception as e:
                logger.error(f"Error removing directory: {str(e)}")

if __name__ == "__main__":
    # Get port from environment variable for production deployment
    port = int(os.environ.get("PORT", 8000))
    
    # In production, don't use reload
    is_dev = os.environ.get("ENVIRONMENT", "development") == "development"
    
    uvicorn.run(
        "main:app", 
        host="0.0.0.0", 
        port=port, 
        reload=is_dev
    )


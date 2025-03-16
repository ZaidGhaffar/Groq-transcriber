# Groq Transcriber Backend

Backend service for the Groq Transcriber application that handles WebSocket connections and audio transcription.

## Setup

1. Install dependencies:
   ```
   pip install -r requirements.txt
   ```

2. Create a `.env` file with your Groq API key:
   ```
   GROQ_API_KEY=your_api_key_here
   ```

## Development

Run the server locally:
```
python main.py
```

The server will start on http://localhost:8000

## Deployment

This backend is configured to be deployed to platforms like Heroku, Render, or Railway.

### Environment Variables

Set the following environment variables in your deployment platform:

- `GROQ_API_KEY`: Your Groq API key
- `PORT`: The port to run the server on (usually set automatically by the platform)
- `ENVIRONMENT`: Set to "production" for production deployments

### Testing the Connection

You can test if the backend is running correctly by accessing the health check endpoint:
```
GET /health
```

The WebSocket endpoint is available at:
```
ws://{your-backend-url}/ws
``` 
"use client"

import { useState, useEffect, useRef } from "react"
import { Mic, MicOff, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

interface Transcription {
  id: number
  text: string
  timestamp: Date
  isProcessing?: boolean
}

// Declare SpeechRecognition type
declare global {
  interface Window {
    webkitSpeechRecognition: unknown
    SpeechRecognition: unknown
  }
}

export default function VoiceTranscriber() {
  const [isListening, setIsListening] = useState(false)
  const [transcriptions, setTranscriptions] = useState<Transcription[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const websocketRef = useRef<WebSocket | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const [isTranscribing, setIsTranscribing] = useState(false)

  useEffect(() => {
    // Initialize WebSocket connection
    const connectWebSocket = () => {
      try {
        // Use the environment variable directly or fallback to relative path
        const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 
          (window.location.protocol === 'https:' ? 'wss://' : 'ws://') + 
          window.location.host + '/ws';
        
        console.log('Attempting to connect to WebSocket at:', wsUrl);
        
        const ws = new WebSocket(wsUrl);
        
        ws.onopen = () => {
          console.log('WebSocket connection established successfully');
          setError(null);
        };
        
        ws.onclose = (event) => {
          console.log('WebSocket connection closed:', event.code, event.reason);
          setError('Connection closed. Attempting to reconnect...');
          // Try to reconnect after a delay
          setTimeout(connectWebSocket, 3000);
        };
        
        ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          setError('Failed to connect to the server. Please try again later.');
        };
        
        ws.onmessage = (event) => {
          console.log('Received message:', event.data);
          try {
            const message = event.data;
            if (typeof message === 'string') {
              if (message.startsWith('Error:') || message.startsWith('Transcription error:')) {
                setError(message);
                return;
              }
              
              setTranscriptions(prev => {
                if (prev.length > 0 && prev[prev.length - 1].isProcessing) {
                  const newTranscriptions = [...prev];
                  newTranscriptions[newTranscriptions.length - 1] = {
                    id: Date.now(),
                    text: message,
                    timestamp: new Date(),
                    isProcessing: false
                  };
                  return newTranscriptions;
                } else {
                  return [
                    ...prev,
                    {
                      id: Date.now(),
                      text: message,
                      timestamp: new Date(),
                      isProcessing: false
                    }
                  ];
                }
              });
              
              setIsTranscribing(false);
            }
          } catch (error) {
            console.error('Error processing message:', error);
            setIsTranscribing(false);
          }
        };
        
        websocketRef.current = ws;
      } catch (error) {
        console.error('Error creating WebSocket:', error);
        setError('Failed to create WebSocket connection');
      }
    };
    
    connectWebSocket();
    
    return () => {
      if (websocketRef.current) {
        websocketRef.current.close();
      }
    };
  }, []);

  useEffect(() => {
    // Scroll to bottom when new transcription is added
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight
    }
  }, [transcriptions])

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      
      // Create a new MediaRecorder instance
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      mediaRecorderRef.current = mediaRecorder
      audioChunksRef.current = []
      
      // Event handler for when data is available
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)
          
          // Send the audio chunk to the server via WebSocket
          if (websocketRef.current && websocketRef.current.readyState === WebSocket.OPEN) {
            websocketRef.current.send(event.data)
            
            // Add a processing indicator if we're not already transcribing
            if (!isTranscribing) {
              setIsTranscribing(true)
              setTranscriptions(prev => [
                ...prev,
                {
                  id: Date.now(),
                  text: "Processing audio...",
                  timestamp: new Date(),
                  isProcessing: true
                }
              ])
            }
          }
        }
      }
      
      // Start recording
      mediaRecorder.start(100) // Collect data every 100ms
      setIsListening(true)
      setIsLoading(false)
      
      // Clear previous transcriptions when starting a new recording session
      setTranscriptions([])
      
    } catch {
      console.error('Error starting recording:')
      setError("Microphone permission denied. Please allow microphone access.")
      setIsLoading(false)
    }
  }
  
  const stopRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop()
      
      // Stop all audio tracks
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop())
      
      setIsListening(false)
      
      // Add a final processing indicator
      if (!isTranscribing) {
        setIsTranscribing(true)
        setTranscriptions(prev => [
          ...prev,
          {
            id: Date.now(),
            text: "Processing final transcription...",
            timestamp: new Date(),
            isProcessing: true
          }
        ])
      }
    }
  }

  const toggleListening = async () => {
    if (isListening) {
      stopRecording()
    } else {
      setIsLoading(true)
      await startRecording()
    }
  }

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  }

  return (
    <div className="flex flex-col items-center justify-between min-h-screen p-4 bg-gray-50 dark:bg-gray-900">
      <div className="w-full max-w-2xl mx-auto flex flex-col items-center flex-grow">
        <h1 className="text-3xl font-bold mt-8 mb-4 text-center">Mine AI Voice Transcriber</h1>

        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4 w-full">{error}</div>
        )}

        <div className="flex-grow flex items-center justify-center w-full my-8">
          <Button
            onClick={toggleListening}
            disabled={isLoading || !!error}
            size="lg"
            className={cn(
              "rounded-full w-24 h-24 transition-all duration-300",
              isListening ? "bg-red-500 hover:bg-red-600" : "bg-primary hover:bg-primary/90",
            )}
          >
            {isLoading ? (
              <Loader2 className="h-10 w-10 animate-spin" />
            ) : isListening ? (
              <MicOff className="h-10 w-10" />
            ) : (
              <Mic className="h-10 w-10" />
            )}
          </Button>
        </div>

        <div className="w-full">
          <Card className="w-full">
            <CardContent className="p-0">
              <div className="p-4 border-b flex justify-between items-center">
                <h2 className="font-semibold">Transcriptions</h2>
                {isTranscribing && (
                  <div className="flex items-center text-sm text-gray-500">
                    <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                    Transcribing...
                  </div>
                )}
              </div>
              <ScrollArea className="h-[400px] p-4" ref={scrollAreaRef}>
                {transcriptions.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-gray-500">
                    Speak to see transcriptions here
                  </div>
                ) : (
                  <div className="space-y-4">
                    {transcriptions.map((item) => (
                      <div key={item.id} className="flex flex-col">
                        <div className={cn(
                          "rounded-lg p-3 max-w-[90%]",
                          item.isProcessing ? "bg-gray-100 dark:bg-gray-800" : "bg-primary/10"
                        )}>
                          <p className={item.isProcessing ? "text-gray-500 italic" : ""}>{item.text}</p>
                        </div>
                        <span className="text-xs text-gray-500 mt-1">{formatTime(item.timestamp)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </div>

      <footer className="w-full text-center py-4 text-sm text-gray-500">
        Click the microphone button to start/stop recording
      </footer>
    </div>
  )
}


// src/components/voice/VoiceRecorder.jsx
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { FaStop, FaPaperPlane, FaTimes, FaRedo, FaMicrophone } from 'react-icons/fa';
import { formatDuration } from '../../chat/utils/formatters';
import { APP_CONFIG } from '../../chat/utils/constants';
import toast from 'react-hot-toast';

// Voice format validation
const validateAudioFormat = (blob) => {
  const supportedTypes = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/wav',
    'audio/mp4',
    'audio/ogg;codecs=opus',
    'audio/ogg'
  ];
  
  // Check if MIME type is supported
  const isSupported = supportedTypes.some(type => 
    blob.type === type || blob.type.startsWith(type.split(';')[0])
  );
  
  if (!isSupported) {
    console.warn(`Unsupported audio format: ${blob.type}. Converting to WAV...`);
    // Return false to trigger WAV fallback recording
    return false;
  }
  
  // Check file size (max 10MB)
  if (blob.size > 10 * 1024 * 1024) {
    toast.error('Voice message too large. Max 10MB.');
    return false;
  }
  
  return true;
};

export const VoiceRecorder = React.memo(function VoiceRecorder({ 
  onSend, 
  onCancel,
  maxDuration = APP_CONFIG.MAX_VOICE_DURATION,
}) {
  const [duration, setDuration] = useState(0);
  const [audioBlob, setAudioBlob] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [volume, setVolume] = useState(0);
  
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const streamRef = useRef(null);
  const isMountedRef = useRef(true);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      cleanup();
    };
  }, [cleanup]);

  const cleanup = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    // Don't revoke URL here - parent needs it
    if (audioContextRef.current) {
      audioContextRef.current.close();
    }
    clearInterval(timerRef.current);
  }, []);

  // Start recording immediately on mount
  useEffect(() => {
    let cancelled = false;
    
    const init = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          } 
        });
        
        if (cancelled || !isMountedRef.current) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        
        streamRef.current = stream;
        
        // Set up audio analysis for visualizer
        try {
          audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
          const source = audioContextRef.current.createMediaStreamSource(stream);
          analyserRef.current = audioContextRef.current.createAnalyser();
          analyserRef.current.fftSize = 256;
          source.connect(analyserRef.current);
    } catch {
          console.log('Audio analysis not available');
        }
        
        // Detect best MIME type - prefer WAV for reliability and universal playback
        const mimeType = [
          'audio/wav',
          'audio/mp4',
          'audio/webm;codecs=opus',
          'audio/webm',
          'audio/ogg;codecs=opus'
        ].find(type => MediaRecorder.isTypeSupported(type)) || 'audio/wav';
        
        const mediaRecorder = new MediaRecorder(stream, {
          mimeType,
          audioBitsPerSecond: 128000,
        });
        
        mediaRecorderRef.current = mediaRecorder;
        chunksRef.current = [];

        mediaRecorder.ondataavailable = (e) => {
          if (e.data?.size > 100) {
            chunksRef.current.push(e.data);
          }
        };

        mediaRecorder.onstop = () => {
          if (!isMountedRef.current) return;
          
          const validChunks = chunksRef.current.filter(c => c.size > 100);
          if (validChunks.length === 0) {
            toast.error('No audio captured');
            setIsProcessing(false);
            onCancel();
            return;
          }
          
          const blob = new Blob(validChunks, { type: mimeType });
          const url = URL.createObjectURL(blob);
          
          setAudioBlob(blob);
          setAudioUrl(url);
          setIsProcessing(false);
          
          // Stop tracks but keep URL valid
          stream.getTracks().forEach(track => track.stop());
          streamRef.current = null;
        };

        mediaRecorder.onerror = (e) => {
          console.error('Recording error:', e);
          toast.error('Recording failed');
          setIsProcessing(false);
          onCancel();
        };

        mediaRecorder.start(1000);
        
        // Timer with volume monitoring
        let seconds = 0;
        timerRef.current = setInterval(() => {
          seconds++;
          if (isMountedRef.current) {
            setDuration(seconds);
            
            // Update volume meter
            if (analyserRef.current) {
              const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
              analyserRef.current.getByteFrequencyData(dataArray);
              const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
              setVolume(average / 255);
            }
          }
          if (seconds >= maxDuration) {
            stopRecording();
          }
        }, 1000);
        
      } catch (err) {
        console.error('Recording init failed:', err);
        let msg = 'Could not access microphone';
        if (err.name === 'NotAllowedError') msg = 'Microphone permission denied';
        else if (err.name === 'NotFoundError') msg = 'No microphone found';
        else if (err.name === 'NotReadableError') msg = 'Microphone is in use by another app';
        toast.error(msg);
        onCancel();
      }
    };
    
    init();
    
    return () => { cancelled = true; };
  }, [maxDuration, onCancel, stopRecording]);

  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder?.state === 'recording') {
      setIsProcessing(true);
      try {
        recorder.requestData?.();
        recorder.stop();
      } catch (e) {
        console.error('Stop error:', e);
        setIsProcessing(false);
      }
    }
    clearInterval(timerRef.current);
  }, []);

  const sendRecording = useCallback(() => {
    if (!audioBlob || audioBlob.size === 0) {
      toast.error('No audio to send');
      return;
    }
    if (audioBlob.size < 1000) {
      toast.error('Recording too short (min 1 second)');
      return;
    }
    
    // Validate audio format before sending
    if (!validateAudioFormat(audioBlob)) {
      toast.error('Recording format not supported. Please try again.', {
        duration: 4000,
        icon: '🎤'
      });
      return;
    }
    
    // Send blob and duration - parent will handle the URL
    onSend(audioBlob, duration, audioUrl);
    
    // Clean up our local state but DON'T revoke URL yet
    cleanup();
    setAudioBlob(null);
    setAudioUrl(null);
    setDuration(0);
    setVolume(0);
  }, [audioBlob, duration, audioUrl, onSend, cleanup]);

  const discardRecording = useCallback(() => {
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }
    cleanup();
    onCancel();
  }, [audioUrl, cleanup, onCancel]);

  const restartRecording = useCallback(() => {
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }
    cleanup();
    setAudioBlob(null);
    setAudioUrl(null);
    setDuration(0);
    setVolume(0);
    setIsProcessing(false);
    // Re-trigger mount effect
    onCancel();
  }, [audioUrl, cleanup, onCancel]);

  // ============================================================================
  // 🔑 Preview mode (after recording stops) - COMPACT MOBILE LAYOUT
  // ============================================================================
  if (audioBlob) {
    return (
      <div className="flex items-center gap-2 bg-gray-100 dark:bg-gray-700 rounded-2xl px-2 sm:px-4 py-2 w-full">
        <audio 
          src={audioUrl} 
          controls 
          className="flex-1 h-8 sm:h-10 min-w-0" 
          preload="metadata"
          onError={(e) => {
            console.error('Audio preview error:', e);
            toast.error('Audio preview failed');
          }}
        />
        <span className="text-xs sm:text-sm font-mono text-gray-600 dark:text-gray-400 flex-shrink-0">
          {formatDuration(duration)}
        </span>
        <div className="flex gap-1 sm:gap-2 flex-shrink-0">
          <button 
            onClick={sendRecording}
            disabled={isProcessing}
            className="p-2 bg-green-600 text-white rounded-full hover:bg-green-700 disabled:opacity-50 transition shadow-lg"
            title="Send voice message"
            aria-label="Send voice message"
          >
            <FaPaperPlane className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </button>
          <button 
            onClick={restartRecording}
            className="p-2 bg-yellow-500 text-white rounded-full hover:bg-yellow-600 transition shadow-lg"
            title="Re-record"
            aria-label="Re-record voice message"
          >
            <FaRedo className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </button>
          <button 
            onClick={discardRecording}
            className="p-2 bg-red-500 text-white rounded-full hover:bg-red-600 transition shadow-lg"
            title="Cancel"
            aria-label="Cancel voice message"
          >
            <FaTimes className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </button>
        </div>
      </div>
    );
  }

  // ============================================================================
  // 🔑 Recording mode (live) - COMPACT MOBILE LAYOUT
  // ============================================================================
  return (
    <div className="flex items-center gap-2 bg-red-50 dark:bg-red-900/30 px-2 sm:px-4 py-2 rounded-2xl border-2 border-red-200 dark:border-red-800 w-full">
      <button
        onClick={stopRecording}
        disabled={isProcessing}
        className="p-2 sm:p-3 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white rounded-full transition animate-pulse shadow-lg flex-shrink-0"
        title="Stop recording"
        aria-label="Stop recording"
      >
        <FaStop className="w-4 h-4 sm:w-5 sm:h-5" />
      </button>
      
      <div className="flex flex-col min-w-[50px] sm:min-w-[60px]">
        <span className="font-mono text-red-700 dark:text-red-300 font-bold text-base sm:text-lg">
          {formatDuration(duration)}
        </span>
        <span className="text-[10px] sm:text-xs text-red-600 dark:text-red-400 font-medium">
          {isProcessing ? 'Processing...' : 'Recording...'}
        </span>
      </div>
      
      {/* Volume Visualizer - Simplified for mobile */}
      <div className="flex-1 flex items-center justify-center gap-0.5 h-8 sm:h-10 overflow-hidden">
        {[...Array(8)].map((_, i) => (
          <div
            key={i}
            className="w-1 sm:w-1.5 bg-red-500 dark:bg-red-400 rounded-full transition-all duration-100"
            style={{
              height: `${Math.max(20, Math.min(100, volume * 100 * (0.3 + (i/8) * 0.7)))}%`,
              opacity: 0.4 + (volume * 0.6)
            }}
          />
        ))}
      </div>
      
      <button
        onClick={discardRecording}
        disabled={isProcessing}
        className="text-red-600 dark:text-red-400 hover:text-red-800 px-2 sm:px-4 py-1 sm:py-2 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/50 transition font-medium text-xs sm:text-sm flex-shrink-0"
      >
        Cancel
      </button>
    </div>
  );
});
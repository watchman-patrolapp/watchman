// src/chat/components/MessageInput.jsx
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { 
  FaPaperPlane, 
  FaImage, 
  FaMapMarkerAlt, 
  FaMicrophone, 
  FaBolt,
  FaSpinner,
  FaTimes,
  FaExclamationTriangle,
  FaExclamationCircle,
  FaStop,
  FaRedo,
  FaPlay,
  FaPause,
  FaClock,
  FaCheckCircle,
  FaEye,
  FaCheck,
  FaClipboard
} from 'react-icons/fa';
import { APP_CONFIG, QUICK_TEMPLATES, CATEGORY_COLORS, EmergencyLevel } from '../utils/constants';
import { QuickTemplates } from './QuickTemplates'; // ✅ Import external component
import toast from 'react-hot-toast';

// ============================================================================
// INLINE: VoiceRecorder Component (KEPT INTACT - WORKING RELIABLY)
// ============================================================================
const VoiceRecorder = React.memo(function VoiceRecorder({ onSend, onCancel, maxDuration = 60 }) {
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

  const formatDuration = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      cleanup();
    };
  }, [cleanup]);

  const cleanup = useCallback(() => {
    if (streamRef.current) streamRef.current.getTracks().forEach(track => track.stop());
    if (audioContextRef.current) audioContextRef.current.close();
    clearInterval(timerRef.current);
  }, []);

  useEffect(() => {
    let cancelled = false;
    
    const init = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } 
        });
        
        if (cancelled || !isMountedRef.current) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        
        streamRef.current = stream;
        
        try {
          audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
          const source = audioContextRef.current.createMediaStreamSource(stream);
          analyserRef.current = audioContextRef.current.createAnalyser();
          analyserRef.current.fftSize = 256;
          source.connect(analyserRef.current);
        } catch { console.log('Audio analysis not available'); }
        
        const mimeType = ['audio/wav', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']
          .find(type => MediaRecorder.isTypeSupported(type)) || 'audio/wav';
        
        const mediaRecorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 128000 });
        mediaRecorderRef.current = mediaRecorder;
        chunksRef.current = [];

        mediaRecorder.ondataavailable = (e) => { if (e.data?.size > 100) chunksRef.current.push(e.data); };
        
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
          
          console.log('Recording complete:', { size: blob.size, type: blob.type, url });
          
          setAudioBlob(blob);
          setAudioUrl(url);
          setIsProcessing(false);
          stream.getTracks().forEach(track => track.stop());
          streamRef.current = null;
        };

        mediaRecorder.onerror = () => {
          console.error('Recording error');
          toast.error('Recording failed');
          setIsProcessing(false);
          onCancel();
        };

        mediaRecorder.start(1000);
        
        let seconds = 0;
        timerRef.current = setInterval(() => {
          seconds++;
          if (isMountedRef.current) {
            setDuration(seconds);
            if (analyserRef.current) {
              const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
              analyserRef.current.getByteFrequencyData(dataArray);
              setVolume(dataArray.reduce((a, b) => a + b) / dataArray.length / 255);
            }
          }
          if (seconds >= maxDuration) stopRecording();
        }, 1000);
        
      } catch (err) {
        console.error('Recording init error:', err);
        let msg = 'Could not access microphone';
        if (err.name === 'NotAllowedError') msg = 'Microphone permission denied';
        else if (err.name === 'NotFoundError') msg = 'No microphone found';
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
      try { recorder.requestData?.(); recorder.stop(); } catch { setIsProcessing(false); }
    }
    clearInterval(timerRef.current);
  }, [setIsProcessing]);

  const sendRecording = useCallback(() => {
    if (!audioBlob || audioBlob.size < 1000) {
      toast.error('Recording too short');
      return;
    }
    
    console.log('Sending voice:', { blobSize: audioBlob.size, blobType: audioBlob.type, duration, url: audioUrl });
    onSend(audioBlob, duration, audioUrl);
  }, [audioBlob, duration, audioUrl, onSend]);

  const discardRecording = useCallback(() => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    cleanup();
    onCancel();
  }, [audioUrl, cleanup, onCancel]);

  const restartRecording = useCallback(() => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    cleanup();
    setAudioBlob(null);
    setAudioUrl(null);
    setDuration(0);
    setVolume(0);
    setIsProcessing(false);
    onCancel();
  }, [audioUrl, cleanup, onCancel]);

  // Preview mode
  if (audioBlob) {
    return (
      <div className="flex items-center gap-3 bg-gray-100 dark:bg-gray-700 rounded-2xl px-4 py-3 flex-1">
        <audio src={audioUrl} controls className="flex-1 h-10 max-w-[200px]" preload="metadata" />
        <span className="text-sm font-mono text-gray-600 dark:text-gray-400">{formatDuration(duration)}</span>
        <div className="flex gap-2 ml-auto">
          <button onClick={sendRecording} disabled={isProcessing} className="p-2.5 bg-green-600 text-white rounded-full hover:bg-green-700 disabled:opacity-50 transition" title="Send">
            <FaPaperPlane className="w-4 h-4" />
          </button>
          <button onClick={restartRecording} className="p-2.5 bg-yellow-500 text-white rounded-full hover:bg-yellow-600 transition" title="Re-record">
            <FaRedo className="w-4 h-4" />
          </button>
          <button onClick={discardRecording} className="p-2.5 bg-red-500 text-white rounded-full hover:bg-red-600 transition" title="Cancel">
            <FaTimes className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  // Recording mode
  return (
    <div className="flex items-center gap-3 bg-red-50 dark:bg-red-900/30 px-4 py-3 rounded-2xl border-2 border-red-200 dark:border-red-800 flex-1">
      <button onClick={stopRecording} disabled={isProcessing} className="p-3 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white rounded-full transition animate-pulse shadow-lg">
        <FaStop className="w-5 h-5" />
      </button>
      <div className="flex flex-col min-w-[60px]">
        <span className="font-mono text-red-700 dark:text-red-300 font-bold text-lg">{formatDuration(duration)}</span>
        <span className="text-xs text-red-600 dark:text-red-400 font-medium">{isProcessing ? 'Processing...' : 'Recording...'}</span>
      </div>
      <div className="flex-1 flex items-center justify-center gap-1 h-10">
        {[...Array(10)].map((_, i) => (
          <div key={i} className="w-1.5 bg-red-500 dark:bg-red-400 rounded-full transition-all duration-100" 
               style={{ height: `${Math.max(15, Math.min(100, volume * 100 * (0.3 + (i/10) * 0.7)))}%`, opacity: 0.4 + (volume * 0.6) }} />
        ))}
      </div>
      <button onClick={discardRecording} disabled={isProcessing} className="text-red-600 dark:text-red-400 hover:text-red-800 px-4 py-2 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/50 transition font-medium">
        Cancel
      </button>
    </div>
  );
});

// ============================================================================
// MAIN: MessageInput Component (MOBILE-OPTIMIZED FORM)
// ============================================================================
export const MessageInput = React.memo(function MessageInput({
  onSendText,
  onSendImage,
  onSendVoice,
  onSendLocation,
  isOnline,
  disabled,
  isEmergencyMode,
}) {
  const [text, setText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isGettingLocation, setIsGettingLocation] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const fileInputRef = useRef(null);

  const handleSubmit = useCallback(async (e) => {
    e?.preventDefault();
    if (!text.trim() || isSending || disabled) return;
    setIsSending(true);
    try {
      await onSendText(text.trim());
      setText('');
    } finally {
      setIsSending(false);
    }
  }, [text, onSendText, isSending, disabled]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  const handleImageSelect = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error('Image too large (max 10MB)');
      e.target.value = '';
      return;
    }
    try {
      await onSendImage(file);
    } catch {
      toast.error('Failed to send image');
    } finally {
      e.target.value = '';
    }
  }, [onSendImage]);

  const handleLocation = useCallback(async () => {
    if (!navigator.geolocation) {
      toast.error('Geolocation not supported');
      return;
    }
    setIsGettingLocation(true);
    try {
      const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: APP_CONFIG.LOCATION_TIMEOUT_MS,
          maximumAge: 0,
        });
      });
      await onSendLocation(position);
      toast.success('Location sent');
    } catch (error) {
      let msg = 'Could not get location';
      const errorCode = error.code;
      if (errorCode === 1) msg = 'Permission denied';
      else if (errorCode === 2) msg = 'Unavailable';
      else if (errorCode === 3) msg = 'Timed out';
      toast.error(msg);
    } finally {
      setIsGettingLocation(false);
    }
  }, [onSendLocation]);

  // ✅ Voice send handler (unchanged)
  const handleVoiceSend = useCallback(async (blob, duration, previewUrl) => {
    console.log('handleVoiceSend called:', { blobSize: blob.size, blobType: blob.type, duration, previewUrl });
    
    setIsRecording(false);
    
    try {
      await onSendVoice(blob, duration, previewUrl);
      toast.success('Voice message sent');
    } catch (error) {
      console.error('Voice send error:', error);
      toast.error('Failed to send voice');
    }
  }, [onSendVoice]);

  // 🔑 Handle template selection from external QuickTemplates
  const applyTemplate = useCallback(async (template) => {
    await onSendText(template.text, template.location ? { location: template.location } : undefined);
    setShowTemplates(false);
  }, [onSendText]);

  // ============================================================================
  // 🔑 MOBILE-OPTIMIZED FORM SECTION (Replaces lines ~280-350)
  // ============================================================================
  return (
    <form onSubmit={handleSubmit} className="p-2 sm:p-4 border-t dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 relative safe-area-bottom">
      
      {/* Quick Templates Panel */}
      {showTemplates && (
        <div className="absolute bottom-full left-0 right-0 mb-2 z-50 px-2">
          <QuickTemplates 
            onSelect={applyTemplate}
            onClose={() => setShowTemplates(false)}
            isOnline={isOnline}
            getLocation={handleLocation}
          />
        </div>
      )}

      <div className="flex gap-2 items-end max-w-full">
        
        {/* Quick Templates Toggle */}
        <button
          type="button"
          onClick={() => setShowTemplates(!showTemplates)}
          disabled={disabled || !isOnline}
          className={`p-2.5 sm:p-3 rounded-xl transition flex-shrink-0 disabled:opacity-50 ${
            showTemplates
              ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300 border-2 border-yellow-400 shadow-md'
              : 'bg-white border border-gray-300 text-yellow-600 dark:bg-gray-700 dark:border-gray-600 dark:text-yellow-400 hover:bg-yellow-50 dark:hover:bg-gray-600'
          }`}
          title="Quick messages"
          aria-label="Toggle quick messages"
        >
          <FaBolt className="w-4 h-4 sm:w-5 sm:h-5" />
        </button>

        {/* Voice Recorder or Input Row */}
        {isRecording ? (
          <div className="flex-1 min-w-0 overflow-hidden">
            <VoiceRecorder 
              onSend={handleVoiceSend} 
              onCancel={() => setIsRecording(false)} 
              maxDuration={APP_CONFIG.MAX_VOICE_DURATION} 
            />
          </div>
        ) : (
          <>
            {/* Text Input - Mobile Optimized */}
            <div className="flex-1 min-w-0 relative">
              <input
                type="text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={isOnline ? "Type message..." : "Offline..."}
                maxLength={APP_CONFIG.MAX_MESSAGE_LENGTH}
                disabled={disabled || !isOnline}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-3 py-2.5 pr-16 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white text-gray-900 text-base disabled:opacity-50 placeholder-gray-500 dark:placeholder-gray-400"
                aria-label="Message input"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 dark:text-gray-500">
                {text.length}/{APP_CONFIG.MAX_MESSAGE_LENGTH}
              </span>
              {isEmergencyMode && (
                <FaExclamationTriangle className="absolute right-14 top-1/2 -translate-y-1/2 w-4 h-4 text-red-500 animate-pulse" aria-hidden="true" />
              )}
            </div>

            {/* Hidden File Input */}
            <input type="file" accept="image/*" ref={fileInputRef} onChange={handleImageSelect} className="hidden" aria-label="Select image" />
            
            {/* Action Buttons - Responsive */}
            <div className="flex gap-1 sm:gap-2 flex-shrink-0">
              {/* Image - Hidden on smallest screens */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={!isOnline || disabled}
                className="hidden sm:flex p-2.5 sm:p-3 rounded-xl bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 transition disabled:opacity-50"
                title="Send image"
                aria-label="Send image"
              >
                <FaImage className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>

              {/* Location */}
              <button
                type="button"
                onClick={handleLocation}
                disabled={!isOnline || disabled || isGettingLocation}
                className="p-2.5 sm:p-3 rounded-xl bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 transition disabled:opacity-50"
                title="Share location"
                aria-label="Share location"
              >
                {isGettingLocation ? <FaSpinner className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" /> : <FaMapMarkerAlt className="w-4 h-4 sm:w-5 sm:h-5" />}
              </button>

              {/* Voice */}
              <button
                type="button"
                onClick={() => setIsRecording(true)}
                disabled={!isOnline || disabled}
                className="p-2.5 sm:p-3 rounded-xl bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 transition disabled:opacity-50"
                title="Record voice"
                aria-label="Record voice message"
              >
                <FaMicrophone className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>

              {/* Send Button - Always visible */}
              <button
                type="submit"
                disabled={!text.trim() || isSending || disabled || !isOnline}
                className="p-2.5 sm:p-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl transition flex items-center justify-center min-w-[40px] sm:min-w-[48px]"
                title="Send message"
                aria-label="Send message"
              >
                {isSending ? <FaSpinner className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" /> : <FaPaperPlane className="w-4 h-4 sm:w-5 sm:h-5" />}
              </button>
            </div>
          </>
        )}
      </div>
      
      {/* Emergency Mode Indicator */}
      {isEmergencyMode && (
        <div className="mt-2 flex items-center gap-2 text-xs text-red-600 dark:text-red-400 animate-pulse" role="alert">
          <span className="w-2 h-2 bg-red-500 rounded-full" />
          <FaExclamationTriangle className="w-3 h-3" />
          EMERGENCY MODE ACTIVE
        </div>
      )}
    </form>
  );
});

export default MessageInput;
// src/chat/components/MessageInput.jsx
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { 
  FaPaperPlane, 
  FaImage, 
  FaMapMarkerAlt, 
  FaMicrophone, 
  FaBolt,
  FaSpinner,
  FaTimes,
  FaExclamationTriangle,
  FaStop,
  FaRedo,
  FaPlus,
  FaChevronDown,
  FaVolumeUp,
  FaVolumeMute,
  FaKeyboard,
  FaBell,
  FaBellSlash,
  FaSmile,
} from 'react-icons/fa';
import { APP_CONFIG } from '../utils/constants';
import {
  getChatGeolocationPosition,
  buildManualGeolocationPosition,
  parseLatLngFromUserInput,
  GEO_ERR_TAB_BACKGROUND,
} from '../utils/getChatGeolocation';
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

  const cleanup = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      try {
        audioContextRef.current.close();
      } catch {
        /* already closed */
      }
      audioContextRef.current = null;
    }
    clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder?.state === 'recording') {
      setIsProcessing(true);
      try {
        recorder.requestData?.();
        recorder.stop();
      } catch {
        setIsProcessing(false);
      }
    }
    clearInterval(timerRef.current);
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      cleanup();
    };
  }, [cleanup]);

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
    return () => {
      cancelled = true;
    };
  }, [maxDuration, onCancel, stopRecording]);

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
  onQuickTemplateSend,
  getLocationForTemplates,
  isOnline,
  disabled,
  isEmergencyMode,
  soundEnabled = true,
  onToggleSound,
  notificationsEnabled = false,
  onToggleNotifications,
  onComposerTyping,
  replyToMessage = null,
  onClearReply,
}) {
  const [text, setText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isGettingLocation, setIsGettingLocation] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [manualLocOpen, setManualLocOpen] = useState(false);
  const [manualLat, setManualLat] = useState('');
  const [manualLng, setManualLng] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const fileInputRef = useRef(null);
  const attachMenuRef = useRef(null);
  const emojiPickerRef = useRef(null);
  const messageTextareaRef = useRef(null);

  const adjustComposerHeight = useCallback(() => {
    const el = messageTextareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const maxPx = 120;
    el.style.height = `${Math.min(el.scrollHeight, maxPx)}px`;
  }, []);

  const composerEmojis = [
    '😀', '😁', '😂', '🤣', '😊', '😍', '😮', '😢',
    '🙏', '👍', '👎', '👏', '🔥', '✅', '🚨', '🆘',
    '🔍', '📹', '🚓', '📍', '💡', '⚠️', '👀', '❤️'
  ];

  const handleSubmit = useCallback(async (e) => {
    e?.preventDefault();
    if (!text.trim() || isSending || disabled) return;
    setIsSending(true);
    try {
      await onSendText(text.trim(), {
        replyToMessageId: replyToMessage?.id || null,
        replyPreviewText:
          replyToMessage?.reply_preview_text ||
          replyToMessage?.text ||
          (replyToMessage?.type ? `[${replyToMessage.type}]` : null),
      });
      setText('');
      onClearReply?.();
    } finally {
      setIsSending(false);
    }
  }, [text, onSendText, isSending, disabled, replyToMessage, onClearReply]);

  /** Enter = newline (mobile-friendly). Ctrl/Cmd+Enter sends (desktop). */
  const handleComposerKeyDown = useCallback(
    (e) => {
      if (e.key !== 'Enter') return;
      if (e.nativeEvent?.isComposing || e.keyCode === 229) return;
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      void handleSubmit(e);
    },
    [handleSubmit]
  );

  useEffect(() => {
    if (text === '') adjustComposerHeight();
  }, [text, adjustComposerHeight]);

  const handleImageSelect = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error('Image too large (max 10MB)');
      e.target.value = '';
      return;
    }
    setAttachMenuOpen(false);
    try {
      await onSendImage(file);
    } catch {
      toast.error('Failed to send image');
    } finally {
      e.target.value = '';
    }
  }, [onSendImage]);

  const getLocationCoordsOnly = useCallback(async () => {
    const pos = await getChatGeolocationPosition();
    return { lat: pos.coords.latitude, lng: pos.coords.longitude };
  }, []);

  const handleLocation = useCallback(async () => {
    if (!navigator.geolocation) {
      toast.error('Geolocation not supported');
      return;
    }
    setAttachMenuOpen(false);
    setIsGettingLocation(true);
    try {
      const position = await getChatGeolocationPosition();
      await onSendLocation(position);
    } catch (error) {
      let msg = 'Could not get location';
      const errorCode = error.code;
      if (errorCode === 1) msg = 'Permission denied';
      else if (errorCode === GEO_ERR_TAB_BACKGROUND) {
        msg =
          'Chrome pauses this tab when it is in the background. Bring this tab to the front, then tap Share location again.';
      } else if (errorCode === 2) msg = 'Location unavailable';
      else if (errorCode === 3) msg = 'Location timed out';
      const embeddedHint =
        errorCode === 2 || errorCode === 3 || errorCode === 0
          ? ' IDE preview browsers (e.g. Cursor) often block GPS — use “Manual coordinates” or open the app in Chrome.'
          : '';
      toast.error(`${msg}${embeddedHint ? `. ${embeddedHint}` : ''}`, { duration: 6500 });
    } finally {
      setIsGettingLocation(false);
    }
  }, [onSendLocation]);

  useEffect(() => {
    if (!attachMenuOpen) return;
    const onDoc = (e) => {
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target)) {
        setAttachMenuOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setAttachMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [attachMenuOpen]);

  useEffect(() => {
    if (!showEmojiPicker) return;
    const onDoc = (e) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target)) {
        setShowEmojiPicker(false);
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setShowEmojiPicker(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [showEmojiPicker]);

  const insertEmoji = useCallback((emoji) => {
    setText((prev) => {
      const next = `${prev}${emoji}`;
      return next.length > APP_CONFIG.MAX_MESSAGE_LENGTH ? prev : next;
    });
    onComposerTyping?.();
    setShowEmojiPicker(false);
  }, [onComposerTyping]);

  const submitManualLocation = useCallback(async () => {
    const parsed = parseLatLngFromUserInput(manualLat, manualLng);
    if (!parsed) {
      toast.error('Enter valid latitude and longitude (decimal degrees)');
      return;
    }
    setManualLocOpen(false);
    setAttachMenuOpen(false);
    setManualLat('');
    setManualLng('');
    setIsGettingLocation(true);
    try {
      const position = buildManualGeolocationPosition(parsed.lat, parsed.lng);
      await onSendLocation(position);
    } catch (err) {
      console.error('Manual location send failed:', err);
      toast.error(err?.message || 'Could not send location');
    } finally {
      setIsGettingLocation(false);
    }
  }, [manualLat, manualLng, onSendLocation]);

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

  const applyTemplate = useCallback(async (messageData, options) => {
    try {
      if (onQuickTemplateSend) {
        await onQuickTemplateSend(messageData, options);
      } else {
        await onSendText(messageData?.text ?? '');
      }
    } catch (err) {
      console.error('Quick template send failed:', err);
      toast.error('Failed to send message');
    } finally {
      setShowTemplates(false);
    }
  }, [onQuickTemplateSend, onSendText]);

  // ============================================================================
  // 🔑 MOBILE-OPTIMIZED FORM SECTION (Replaces lines ~280-350)
  // ============================================================================
  return (
    <form
      onSubmit={handleSubmit}
      className="relative z-10 border-t border-gray-200 bg-gray-50 px-2 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))] dark:border-gray-700 dark:bg-gray-800/50 sm:px-4 sm:pt-4 sm:pb-[calc(1rem+env(safe-area-inset-bottom,0px))]"
    >
      
      {/* Quick Templates Panel */}
      {showTemplates && (
        <div className="absolute bottom-full left-0 right-0 z-[5000] mb-2 px-2">
          <QuickTemplates 
            onSelect={applyTemplate}
            onClose={() => setShowTemplates(false)}
            isOnline={isOnline}
            getLocation={getLocationForTemplates || getLocationCoordsOnly}
          />
        </div>
      )}

      <div className="flex gap-2 items-end max-w-full">
        {/* Quick Templates Toggle */}
        <button
          type="button"
          onClick={() => setShowTemplates(!showTemplates)}
          disabled={disabled || !isOnline}
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition disabled:opacity-50 sm:h-12 sm:w-12 ${
            showTemplates
              ? 'border-2 border-yellow-400 bg-yellow-100 text-yellow-700 shadow-md dark:bg-yellow-900/40 dark:text-yellow-300'
              : 'border border-gray-300 bg-white text-yellow-600 hover:bg-yellow-50 dark:border-gray-600 dark:bg-gray-700 dark:text-yellow-400 dark:hover:bg-gray-600'
          }`}
          title="Quick messages"
          aria-label="Toggle quick messages"
        >
          <FaBolt className="h-4 w-4 sm:h-5 sm:w-5" />
        </button>

        {isRecording ? (
          <div className="min-w-0 flex-1 overflow-hidden">
            <VoiceRecorder
              onSend={handleVoiceSend}
              onCancel={() => setIsRecording(false)}
              maxDuration={APP_CONFIG.MAX_VOICE_DURATION}
            />
          </div>
        ) : (
          <>
            <div className="relative shrink-0" ref={attachMenuRef}>
              <input
                type="file"
                accept="image/*"
                ref={fileInputRef}
                onChange={handleImageSelect}
                className="hidden"
                aria-label="Select image to send"
              />
              <button
                type="button"
                onClick={() => setAttachMenuOpen((o) => !o)}
                disabled={!isOnline || disabled}
                aria-expanded={attachMenuOpen}
                aria-haspopup="menu"
                aria-label={attachMenuOpen ? 'Close attach menu' : 'Open attach menu'}
                className={`flex h-11 w-11 items-center justify-center rounded-xl border transition disabled:opacity-50 sm:h-12 sm:w-12 ${
                  attachMenuOpen
                    ? 'border-teal-500 bg-teal-50 text-teal-800 shadow-md dark:border-teal-400 dark:bg-teal-900/30 dark:text-teal-200'
                    : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                {attachMenuOpen ? (
                  <FaChevronDown className="h-4 w-4 sm:h-5 sm:w-5" />
                ) : (
                  <FaPlus className="h-4 w-4 sm:h-5 sm:w-5" />
                )}
              </button>
              {attachMenuOpen && (
                <div
                  role="menu"
                  className="absolute bottom-full left-0 z-[5000] mb-2 min-w-[12.5rem] overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-xl dark:border-gray-600 dark:bg-gray-800"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={!isOnline || disabled}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm text-gray-800 hover:bg-teal-50 disabled:opacity-50 dark:text-gray-100 dark:hover:bg-gray-700"
                  >
                    <FaImage className="h-4 w-4 shrink-0 text-teal-600 dark:text-teal-400" />
                    <span>Send photo</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => void handleLocation()}
                    disabled={!isOnline || disabled || isGettingLocation}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm text-gray-800 hover:bg-gray-100 disabled:opacity-50 dark:text-gray-100 dark:hover:bg-gray-700"
                  >
                    {isGettingLocation ? (
                      <FaSpinner className="h-4 w-4 shrink-0 animate-spin text-gray-500" />
                    ) : (
                      <FaMapMarkerAlt className="h-4 w-4 shrink-0 text-red-500 dark:text-red-400" />
                    )}
                    <span>Share location (GPS)</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setAttachMenuOpen(false);
                      setManualLocOpen(true);
                    }}
                    disabled={!isOnline || disabled}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm text-gray-800 hover:bg-amber-50 disabled:opacity-50 dark:text-gray-100 dark:hover:bg-gray-700"
                  >
                    <FaKeyboard className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                    <span className="leading-tight">Manual coordinates</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setAttachMenuOpen(false);
                      setIsRecording(true);
                    }}
                    disabled={!isOnline || disabled}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm text-gray-800 hover:bg-gray-100 disabled:opacity-50 dark:text-gray-100 dark:hover:bg-gray-700"
                  >
                    <FaMicrophone className="h-4 w-4 shrink-0 text-violet-600 dark:text-violet-400" />
                    <span>Voice message</span>
                  </button>
                  {(typeof onToggleSound === 'function' ||
                    (typeof onToggleNotifications === 'function' && 'Notification' in window)) && (
                    <>
                      <div className="my-1 border-t border-gray-100 dark:border-gray-600" role="separator" />
                      {typeof onToggleSound === 'function' && (
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => onToggleSound()}
                          className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm text-gray-800 hover:bg-gray-100 dark:text-gray-100 dark:hover:bg-gray-700"
                        >
                          {soundEnabled ? (
                            <FaVolumeUp className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
                          ) : (
                            <FaVolumeMute className="h-4 w-4 shrink-0 text-gray-500" />
                          )}
                          <span>{soundEnabled ? 'Mute chat sounds' : 'Unmute chat sounds'}</span>
                        </button>
                      )}
                      {typeof onToggleNotifications === 'function' && 'Notification' in window && (
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => onToggleNotifications()}
                          className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm text-gray-800 hover:bg-gray-100 dark:text-gray-100 dark:hover:bg-gray-700"
                        >
                          {notificationsEnabled ? (
                            <FaBell className="h-4 w-4 shrink-0 text-green-600 dark:text-green-400" />
                          ) : (
                            <FaBellSlash className="h-4 w-4 shrink-0 text-gray-500" />
                          )}
                          <span>
                            {notificationsEnabled
                              ? 'Mute desktop alerts'
                              : Notification.permission === 'denied'
                                ? 'Notifications blocked (browser settings)'
                                : 'Enable desktop alerts'}
                          </span>
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="flex min-w-0 flex-1 items-end gap-2">
              <div className="min-w-0 flex-1">
                {replyToMessage && (
                  <div className="mb-2 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-xs dark:border-teal-700 dark:bg-teal-900/30">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium text-teal-700 dark:text-teal-300">
                        Replying to {replyToMessage.sender_name || 'message'}
                      </p>
                      <button
                        type="button"
                        onClick={() => onClearReply?.()}
                        className="text-teal-700 hover:text-teal-900 dark:text-teal-300 dark:hover:text-teal-100"
                        title="Cancel reply"
                      >
                        <FaTimes className="h-3 w-3" />
                      </button>
                    </div>
                    <p className="mt-1 truncate text-gray-700 dark:text-gray-200">
                      {replyToMessage.reply_preview_text || replyToMessage.text || '[Attachment]'}
                    </p>
                  </div>
                )}
                <div className="relative">
                  <textarea
                    ref={messageTextareaRef}
                    value={text}
                    rows={1}
                    enterKeyHint="enter"
                    onChange={(e) => {
                      setText(e.target.value);
                      onComposerTyping?.();
                      adjustComposerHeight();
                    }}
                    onKeyDown={handleComposerKeyDown}
                    placeholder={isOnline ? 'Message…' : 'Offline…'}
                    maxLength={APP_CONFIG.MAX_MESSAGE_LENGTH}
                    disabled={disabled || !isOnline}
                    className="max-h-[7.5rem] min-h-[2.75rem] w-full resize-none overflow-y-auto rounded-xl border border-gray-300 px-3 py-2.5 pr-16 text-base leading-snug text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
                    aria-label="Message input"
                  />
                  {isEmergencyMode && (
                    <FaExclamationTriangle
                      className="pointer-events-none absolute right-12 top-3 h-4 w-4 animate-pulse text-red-500"
                      aria-hidden="true"
                    />
                  )}
                  <div className="absolute right-3 top-2.5" ref={emojiPickerRef}>
                    <button
                      type="button"
                      onClick={() => setShowEmojiPicker((v) => !v)}
                      disabled={disabled || !isOnline}
                      className="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-600 dark:hover:text-gray-200"
                      title="Insert emoji"
                      aria-label="Insert emoji"
                    >
                      <FaSmile className="h-4 w-4" />
                    </button>
                    {showEmojiPicker && (
                      <div className="absolute bottom-full right-0 z-[6000] mb-2 w-64 rounded-xl border border-gray-200 bg-white p-2 shadow-xl dark:border-gray-600 dark:bg-gray-800">
                        <div className="grid grid-cols-8 gap-1">
                          {composerEmojis.map((emoji) => (
                            <button
                              key={emoji}
                              type="button"
                              onClick={() => insertEmoji(emoji)}
                              className="rounded-md p-1.5 text-base hover:bg-gray-100 dark:hover:bg-gray-700"
                              title={`Insert ${emoji}`}
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={!text.trim() || isSending || disabled || !isOnline}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal-600 text-white transition hover:bg-teal-700 disabled:opacity-50 sm:h-12 sm:w-12"
                title="Send message"
                aria-label="Send message"
              >
                {isSending ? (
                  <FaSpinner className="h-4 w-4 animate-spin sm:h-5 sm:w-5" />
                ) : (
                  <FaPaperPlane className="h-4 w-4 sm:h-5 sm:w-5" />
                )}
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

      {manualLocOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-[10000] flex items-end justify-center bg-black/50 p-4 pb-[max(1rem,calc(4rem+env(safe-area-inset-bottom,0px)))] sm:items-center sm:pb-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="manual-loc-title"
            onClick={() => setManualLocOpen(false)}
          >
            <div
              className="max-h-[min(90vh,calc(100dvh-5rem))] w-full max-w-sm overflow-y-auto rounded-2xl border border-gray-200 bg-white p-4 shadow-2xl dark:border-gray-600 dark:bg-gray-800"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 id="manual-loc-title" className="text-sm font-semibold text-gray-900 dark:text-white">
                Manual coordinates
              </h3>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                For browsers without GPS (e.g. Cursor’s preview). Enter decimal degrees, or paste a Google Maps link in the first field.
              </p>
              <label className="mt-3 block text-xs font-medium text-gray-600 dark:text-gray-300">
                Latitude or paste Maps link
                <input
                  type="text"
                  value={manualLat}
                  onChange={(e) => setManualLat(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                  placeholder="-33.9123 or paste maps.google.com/…@lat,lng…"
                  autoComplete="off"
                />
              </label>
              <label className="mt-2 block text-xs font-medium text-gray-600 dark:text-gray-300">
                Longitude (if not parsed from link)
                <input
                  type="text"
                  value={manualLng}
                  onChange={(e) => setManualLng(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                  placeholder="25.6012"
                  autoComplete="off"
                />
              </label>
              <div className="mt-4 flex justify-end gap-2 pb-[env(safe-area-inset-bottom,0px)]">
                <button
                  type="button"
                  onClick={() => setManualLocOpen(false)}
                  className="rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void submitManualLocation()}
                  disabled={!isOnline || disabled}
                  className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
                >
                  Send location
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </form>
  );
});

export default MessageInput;
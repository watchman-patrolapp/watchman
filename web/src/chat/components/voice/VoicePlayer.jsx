import React, { useState, useRef, useEffect, useCallback } from 'react';
import { FaPlay, FaPause, FaSpinner, FaRedo, FaExclamationTriangle, FaUpload } from 'react-icons/fa';
import toast from 'react-hot-toast';

export const VoicePlayer = React.memo(function VoicePlayer({ 
  src, 
  blob, 
  duration: initialDuration = 0,
  status = 'sent'
}) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(initialDuration);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [objectUrl, setObjectUrl] = useState(null);
  
  const audioRef = useRef(null);

  const formatTime = (seconds) => {
    if (!seconds || isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  useEffect(() => {
    let url = src;
    
    // If we have a blob but no src, create an object URL
    if (blob instanceof Blob && !src) {
      url = URL.createObjectURL(blob);
      setObjectUrl(url);
      console.log('Created object URL from blob:', url);
    } else if (src) {
      console.log('Using provided src:', src);
      // Check if it's a blob URL (local only) or http URL (server)
      if (src.startsWith('blob:')) {
        console.log('This is a local blob URL - only accessible to sender');
      } else if (src.startsWith('http')) {
        console.log('This is a server URL - should be accessible to all');
      }
    }

    return () => {
      if (objectUrl && blob instanceof Blob) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [src, blob, objectUrl]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleCanPlay = () => {
      setIsLoading(false);
      if (audio.duration && !isNaN(audio.duration) && audio.duration !== Infinity) {
        setDuration(audio.duration);
      }
    };

    const handleLoadedMetadata = () => {
      if (audio.duration && !isNaN(audio.duration) && audio.duration !== Infinity) {
        setDuration(audio.duration);
      }
    };

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    const handleError = (e) => {
      console.error('Audio error:', e);
      console.error('Audio src:', audio.src);
      console.error('Audio error code:', audio.error?.code);
      console.error('Audio error message:', audio.error?.message);
      
      // Provide user-friendly error message
      if (audio.error?.code === 4 || audio.error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
        setError('Audio format not supported or file not found');
      } else if (audio.error?.code === 2 || audio.error?.code === MediaError.MEDIA_ERR_NETWORK) {
        setError('Network error - cannot load audio');
      } else if (audio.error?.code === 3 || audio.error?.code === MediaError.MEDIA_ERR_DECODE) {
        setError('Audio decoding error');
      } else {
        setError('Failed to load audio');
      }
      
      setIsLoading(false);
      setIsPlaying(false);
    };

    const handleWaiting = () => {
      setIsLoading(true);
    };

    const handlePlaying = () => {
      setIsLoading(false);
    };

    audio.addEventListener('canplay', handleCanPlay);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);
    audio.addEventListener('waiting', handleWaiting);
    audio.addEventListener('playing', handlePlaying);

    // Force load
    if (audio.src) {
      audio.load();
    }

    return () => {
      audio.removeEventListener('canplay', handleCanPlay);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
      audio.removeEventListener('waiting', handleWaiting);
      audio.removeEventListener('playing', handlePlaying);
    };
  }, [objectUrl, src]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || isLoading || status === 'sending') return;

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.play()
        .then(() => setIsPlaying(true))
        .catch(err => {
          console.error('Play failed:', err);
          setIsPlaying(false);
          toast.error('Could not play audio: ' + err.message);
        });
    }
  }, [isPlaying, isLoading, status]);

  const handleRetry = useCallback(() => {
    setError(null);
    setIsLoading(true);
    const audio = audioRef.current;
    if (audio) {
      audio.load();
    }
  }, []);

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
  const effectiveSrc = objectUrl || src;

  // Check if this is a local blob URL that won't work for other users
  const isLocalBlobUrl = effectiveSrc?.startsWith('blob:') && !blob;
  const isUploading = status === 'sending';

  const getButtonIcon = () => {
    if (isUploading) return <FaUpload className="w-4 h-4 animate-bounce" />;
    if (isLoading) return <FaSpinner className="w-4 h-4 animate-spin" />;
    if (error) return <FaRedo className="w-4 h-4" />;
    if (isPlaying) return <FaPause className="w-4 h-4" />;
    return <FaPlay className="w-4 h-4 ml-0.5" />;
  };

  // Show warning if this is a local blob URL without access to the blob
  if (isLocalBlobUrl && !blob && status === 'sent') {
    return (
      <div className="flex items-center gap-3 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 min-w-[240px]">
        <div className="w-10 h-10 rounded-full bg-amber-400 text-white flex items-center justify-center flex-shrink-0">
          <FaExclamationTriangle className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200">Voice message pending</p>
          <p className="text-xs text-amber-600 dark:text-amber-400">Upload in progress...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-3 p-3 rounded-xl min-w-[240px] max-w-[320px] ${
      status === 'sending' ? 'bg-amber-100 dark:bg-amber-900/30 border border-amber-200' :
      status === 'failed' ? 'bg-red-100 dark:bg-red-900/30 border border-red-200' :
      error ? 'bg-red-50 dark:bg-red-900/20 border border-red-200' :
      'bg-indigo-100 dark:bg-indigo-900/30'
    }`}>
      <audio ref={audioRef} src={effectiveSrc} preload="auto" crossOrigin="anonymous" />
      
      <button
        onClick={error ? handleRetry : togglePlay}
        disabled={isUploading || (!effectiveSrc && !blob)}
        className={`w-10 h-10 rounded-full flex items-center justify-center transition shadow-md flex-shrink-0 ${
          isPlaying ? 'bg-indigo-600 text-white' : 
          isUploading ? 'bg-amber-400 text-white' :
          status === 'failed' ? 'bg-red-500 text-white' :
          error ? 'bg-red-400 text-white hover:bg-red-500' :
          'bg-white text-indigo-600 hover:bg-indigo-50'
        } disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        {getButtonIcon()}
      </button>

      <div className="flex-1 flex flex-col gap-1 min-w-0">
        <div className="h-2 bg-indigo-200 dark:bg-indigo-800 rounded-full overflow-hidden">
          <div 
            className={`h-full transition-all duration-100 rounded-full ${
              isUploading ? 'bg-amber-400 animate-pulse' : 
              status === 'failed' || error ? 'bg-red-500' : 'bg-indigo-600'
            }`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        
        <div className="flex justify-between items-center text-xs text-indigo-700 dark:text-indigo-300 font-medium">
          <span className="font-mono">{formatTime(currentTime)}</span>
          <div className="flex items-center gap-2">
            {isUploading && <span className="text-amber-600 dark:text-amber-400 animate-pulse">Uploading...</span>}
            {status === 'failed' && <span className="text-red-600 dark:text-red-400 flex items-center gap-1"><FaExclamationTriangle className="w-3 h-3" /> Failed</span>}
            {error && <span className="text-red-600 dark:text-red-400">{error}</span>}
            <span className="font-mono">{formatTime(duration)}</span>
          </div>
        </div>
      </div>
    </div>
  );
});
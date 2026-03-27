import React from 'react';
import { VoicePlayer } from '../../../components/voice/VoicePlayer';

export const VoiceMessage = React.memo(function VoiceMessage({ 
  content, 
  metadata,
  blob,
  src,
  url,
  duration,
  status
}) {
  const audioSrc = src || url || content?.url || content?.media_url || metadata?.url;
  const audioDuration = duration || metadata?.duration || content?.duration || 0;
  const audioBlob = blob || content?.blob;

  if (!audioSrc && !audioBlob) {
    return (
      <div className="text-red-500 text-sm italic p-2 bg-red-50 rounded-lg">
        🎤 Voice message unavailable
      </div>
    );
  }

  return (
    <VoicePlayer 
      src={audioSrc} 
      blob={audioBlob}
      duration={audioDuration}
      status={status}
    />
  );
});
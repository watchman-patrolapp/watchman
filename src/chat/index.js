// src/chat/index.js

// ==================== COMPONENTS ====================
export { default as ChatContainer } from './components/ChatContainer';
export { default as EmergencyButton } from './components/common/EmergencyButton';

// Add MessageBubble export (recommended)
export { MessageBubble } from './components/MessageBubble/index.jsx';

// ==================== HOOKS ====================
export { useNetworkStatus } from './hooks/useNetworkStatus';
export { useMessageQueue } from './hooks/useMessageQueue';
export { useScrollToBottom } from './hooks/useScrollToBottom';
export { useEmergencyMode } from './hooks/useEmergencyMode';
export { useSound } from './hooks/useSound';

// NEW EXPORTS for Dashboard
export { useChatNotifications } from './hooks/useChatNotifications';
export { useUnreadCount } from './hooks/useUnreadCount';

// ==================== SERVICES ====================
export { messageService } from './services/messageService';
export { storageService } from './services/storageService';

// ==================== UTILS ====================
export { emergencyDetector, analyzeEmergency } from './utils/emergencyDetection';
export { 
  APP_CONFIG, 
  MessageType, 
  MessageStatus, 
  EmergencyLevel, 
  QUICK_TEMPLATES,
  CRITICAL_KEYWORDS,
  CATEGORY_COLORS 
} from './utils/constants';

// Optional: Export formatters if needed elsewhere
export { 
  getInitials, 
  formatDuration, 
  formatMessageTime 
} from './utils/formatters';

// Optional: Export security utils if needed
export { 
  sanitizeInput,
  detectCriticalMessage,
  generateSecureId,
  RateLimiter,
  validateFile
} from './utils/security';
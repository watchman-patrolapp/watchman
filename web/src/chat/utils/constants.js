// src/chat/utils/constants.js
// ==========================================
// 📦 APP-WIDE CONSTANTS & CONFIGURATION
// ==========================================

const createEnum = (obj) => Object.freeze({ __proto__: null, ...obj });

// ==========================================
// 📨 MESSAGE TYPES
// ==========================================

export const MessageType = createEnum({
  TEXT: 'text',
  IMAGE: 'image',
  VOICE: 'voice',
  LOCATION: 'location',
});

// ==========================================
// 📊 MESSAGE STATUS
// ==========================================

export const MessageStatus = createEnum({
  SENDING: 'sending',
  SENT: 'sent',
  DELIVERED: 'delivered',
  READ: 'read',
  FAILED: 'failed',
  PRIORITY_QUEUED: 'priority_queued',
});

// ==========================================
// 🚨 EMERGENCY LEVELS (0 = Highest Priority)
// ==========================================

export const EmergencyLevel = createEnum({
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  INFO: 4,
});

// ==========================================
// ⚙️ APP CONFIGURATION
// ==========================================

export const APP_CONFIG = Object.freeze({
  __proto__: null,
  MAX_MESSAGE_LENGTH: 1000,
  MAX_MESSAGES: 100,
  LOCATION_TIMEOUT_MS: 10000,
  MESSAGE_EXPIRY_HOURS: 24,
  MAX_VOICE_DURATION: 300,
  MAX_IMAGE_SIZE_MB: 10,
  SUPPORTED_IMAGE_TYPES: Object.freeze([
    'image/jpeg',
    'image/png', 
    'image/webp',
    'image/gif'
  ]),
});

// ==========================================
// 🎨 CATEGORY COLORS (Tailwind CSS classes)
// ==========================================

export const CATEGORY_COLORS = Object.freeze({
  __proto__: null,
  
  emergency: Object.freeze({
    bg: 'bg-red-100',
    text: 'text-red-800',
    border: 'border-red-200',
    darkBg: 'dark:bg-red-900/30',
    darkText: 'dark:text-red-200',
  }),
  
  suspicious: Object.freeze({
    bg: 'bg-amber-100',
    text: 'text-amber-800',
    border: 'border-amber-200',
    darkBg: 'dark:bg-amber-900/30',
    darkText: 'dark:text-amber-200',
  }),
  
  status: Object.freeze({
    bg: 'bg-green-100',
    text: 'text-green-800',
    border: 'border-green-200',
    darkBg: 'dark:bg-green-900/30',
    darkText: 'dark:text-green-200',
  }),
  
  report: Object.freeze({
    bg: 'bg-indigo-100',
    text: 'text-indigo-800',
    border: 'border-indigo-200',
    darkBg: 'dark:bg-indigo-900/30',
    darkText: 'dark:text-indigo-200',
  }),
});

export const CategoryColors = CATEGORY_COLORS;

// ==========================================
// 🔍 CRITICAL KEYWORDS
// ==========================================

export const CRITICAL_KEYWORDS = Object.freeze([
  'emergency', 'urgent', 'help', 'injured', 'fire', 'ambulance',
  'police', 'suspect', 'fleeing', 'backup', 'officer down',
  'shots fired', 'weapon', 'knife', 'gun', 'attack', 'assault',
  'robbery', 'break-in', 'intruder', 'danger', 'hazard',
]);

// ==========================================
// ⚡ QUICK MESSAGE TEMPLATES (ALL autoSend: true)
// ==========================================

export const QUICK_TEMPLATES = Object.freeze([
  
  // ════════════════════════════════════════
  // 🚨 EMERGENCY (autoSend: true)
  // ════════════════════════════════════════
  Object.freeze({
    id: 'emergency-1',
    text: "🆘 URGENT BACKUP REQUIRED",
    category: 'emergency',
    level: EmergencyLevel.CRITICAL,
    autoSend: true,
    requireLocation: true,
    sound: 'emergency',
  }),
  Object.freeze({
    id: 'emergency-2',
    text: "🚨 SUSPECT FLEEING - NEED IMMEDIATE BACKUP",
    category: 'emergency',
    level: EmergencyLevel.CRITICAL,
    autoSend: true,
    requireLocation: true,
    sound: 'emergency',
  }),
  Object.freeze({
    id: 'emergency-3',
    text: "⚠️ REQUEST AMBULANCE",
    category: 'emergency',
    level: EmergencyLevel.CRITICAL,
    autoSend: true,
    requireLocation: true,
    sound: 'emergency',
  }),
  Object.freeze({
    id: 'emergency-4',
    text: "🔥 FIRE EMERGENCY",
    category: 'emergency',
    level: EmergencyLevel.CRITICAL,
    autoSend: true,
    requireLocation: true,
    sound: 'emergency',
  }),

  // ════════════════════════════════════════
  // 👁️ SUSPICIOUS (autoSend: true)
  // ════════════════════════════════════════
  Object.freeze({
    id: 'suspicious-1',
    text: "👁️ Drunk person on foot",
    category: 'suspicious',
    level: EmergencyLevel.MEDIUM,
    autoSend: true,
    requireLocation: false,
    sound: 'alert',
  }),
  Object.freeze({
    id: 'suspicious-2',
    text: "🚗 Suspicious vehicle in the area",
    category: 'suspicious',
    level: EmergencyLevel.MEDIUM,
    autoSend: true,
    requireLocation: true,
    sound: 'alert',
  }),
  Object.freeze({
    id: 'suspicious-3',
    text: "🚶 Suspicious person on foot",
    category: 'suspicious',
    level: EmergencyLevel.MEDIUM,
    autoSend: true,
    requireLocation: false,
    sound: 'alert',
  }),
  Object.freeze({
    id: 'suspicious-4',
    text: "📝 Unfamiliar vehicle parked – taking note",
    category: 'suspicious',
    level: EmergencyLevel.MEDIUM,
    autoSend: true,
    requireLocation: true,
    sound: 'alert',
  }),
  Object.freeze({
    id: 'suspicious-5',
    text: "👀 Someone acting strangely",
    category: 'suspicious',
    level: EmergencyLevel.MEDIUM,
    autoSend: true,
    requireLocation: false,
    sound: 'alert',
  }),

  // ════════════════════════════════════════
  // ✅ STATUS (autoSend: true) - CHANGED FROM false
  // ════════════════════════════════════════
  Object.freeze({
    id: 'status-1',
    text: "🚔 Heading to incident location",
    category: 'status',
    level: EmergencyLevel.LOW,
    autoSend: true,
    requireLocation: false,
    sound: 'standard',
  }),
  Object.freeze({
    id: 'status-2',
    text: "✅ All clear in my zone",
    category: 'status',
    level: EmergencyLevel.LOW,
    autoSend: true,
    requireLocation: false,
    sound: 'standard',
  }),
  Object.freeze({
    id: 'status-3',
    text: "🚶 On patrol",
    category: 'status',
    level: EmergencyLevel.LOW,
    autoSend: true,
    requireLocation: false,
    sound: 'standard',
  }),
  Object.freeze({
    id: 'status-4',
    text: "🏁 Completing patrol — signing off",
    category: 'status',
    level: EmergencyLevel.LOW,
    autoSend: true,
    requireLocation: false,
    sound: 'standard',
  }),

  // ════════════════════════════════════════
  // 📋 REPORTS (autoSend: true) - CHANGED FROM false
  // ════════════════════════════════════════
  Object.freeze({
    id: 'report-1',
    text: "💡 Street light out on [street]",
    category: 'report',
    level: EmergencyLevel.INFO,
    autoSend: true,
    requireLocation: true,
    sound: 'standard',
  }),
  Object.freeze({
    id: 'report-2',
    text: "🚧 Gate/fence damage spotted",
    category: 'report',
    level: EmergencyLevel.INFO,
    autoSend: true,
    requireLocation: true,
    sound: 'standard',
  }),
  Object.freeze({
    id: 'report-3',
    text: "⚠️ Pothole hazard",
    category: 'report',
    level: EmergencyLevel.INFO,
    autoSend: true,
    requireLocation: true,
    sound: 'standard',
  }),
  Object.freeze({
    id: 'report-4',
    text: "🔧 General maintenance request",
    category: 'report',
    level: EmergencyLevel.INFO,
    autoSend: true,
    requireLocation: false,
    sound: 'standard',
  }),
  
]);
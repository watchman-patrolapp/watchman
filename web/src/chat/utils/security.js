// src/chat/utils/security.js
import DOMPurify from 'dompurify';
import { CRITICAL_KEYWORDS } from './constants';

export const sanitizeInput = (dirty) => {
  if (typeof dirty !== 'string') return '';
  
  const clean = DOMPurify.sanitize(dirty, { ALLOWED_TAGS: [] });
  
  return clean
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
};

export const detectCriticalMessage = (text) => {
  if (!text) return false;
  const lower = text.toLowerCase();
  return CRITICAL_KEYWORDS.some(keyword => lower.includes(keyword));
};

export const generateSecureId = () => {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return `msg-${Date.now()}-${Array.from(array, b => b.toString(16).padStart(2, '0')).join('')}`;
};

export const validateFile = (file) => {
  if (!file) return { valid: false, error: 'No file' };
  
  const MAX_SIZE = 10 * 1024 * 1024;
  if (file.size > MAX_SIZE) {
    return { valid: false, error: 'File too large (max 10MB)' };
  }

  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!allowed.includes(file.type)) {
    return { valid: false, error: 'Invalid file type' };
  }

  return { valid: true };
};

export class RateLimiter {
  constructor(maxRequests = 30, windowMs = 60000) {
    this.requests = [];
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  canProceed() {
    const now = Date.now();
    this.requests = this.requests.filter(time => now - time < this.windowMs);
    
    if (this.requests.length >= this.maxRequests) {
      return false;
    }
    
    this.requests.push(now);
    return true;
  }

  getRetryAfter() {
    if (this.requests.length === 0) return 0;
    const oldest = Math.min(...this.requests);
    return Math.max(0, this.windowMs - (Date.now() - oldest));
  }
}
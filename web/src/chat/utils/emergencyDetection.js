// src/chat/utils/emergencyDetection.js
import { EmergencyLevel, CRITICAL_KEYWORDS } from './constants';

/**
 * Advanced emergency detection with context analysis
 */
export class EmergencyDetector {
  constructor() {
    this.contextHistory = [];
    this.maxHistory = 10;
  }

  /**
   * Analyze message for emergency level
   * @param {string} text - Message text
   * @param {Object} context - Additional context
   * @returns {Object} Analysis result
   */
  analyze(text, context = {}) {
    const lowerText = text.toLowerCase();
    const scores = {
      critical: 0,
      high: 0,
      medium: 0,
    };

    // Keyword analysis with weights
    const criticalPatterns = [
      { pattern: /officer\s+(down|injured|hurt|shot|stabbed)/, weight: 10 },
      { pattern: /need\s+(backup|help|assistance)\s+(now|urgent|immediate)/, weight: 9 },
      { pattern: /suspect\s+(armed|weapon|gun|knife)/, weight: 9 },
      { pattern: /(attack|assault|fight|violent)/, weight: 7 },
      { pattern: /(chase|pursuit|fleeing|running)/, weight: 6 },
      { pattern: /(break\s*in|burglary|theft)/, weight: 5 },
      { pattern: /(fire|smoke|burning)/, weight: 8 },
      { pattern: /(ambulance|medical|injured|bleeding)/, weight: 9 },
    ];

    criticalPatterns.forEach(({ pattern, weight }) => {
      if (pattern.test(lowerText)) scores.critical += weight;
    });

    // Check for critical keywords
    CRITICAL_KEYWORDS.forEach(keyword => {
      if (lowerText.includes(keyword.toLowerCase())) {
        scores.critical += 2;
      }
    });

    // Context analysis
    if (context.isNightTime) scores.high += 2;
    if (context.isHighCrimeArea) scores.high += 3;
    if (context.userIsAlone) scores.medium += 2;
    if (context.recentNearbyIncident) scores.critical += 5;

    // History analysis (escalation detection)
    this.addToHistory(text);
    const recentSimilar = this.findRecentSimilar(text);
    if (recentSimilar.length >= 2) {
      scores.critical += 5; // Escalating situation
    }

    // Determine level
    let level = EmergencyLevel.INFO;
    if (scores.critical >= 10) level = EmergencyLevel.CRITICAL;
    else if (scores.critical >= 5 || scores.high >= 5) level = EmergencyLevel.HIGH;
    else if (scores.high >= 3 || scores.medium >= 5) level = EmergencyLevel.MEDIUM;
    else if (scores.medium >= 2) level = EmergencyLevel.LOW;

    return {
      level,
      scores,
      isEmergency: level <= EmergencyLevel.MEDIUM,
      confidence: this.calculateConfidence(scores),
      suggestedActions: this.getSuggestedActions(level, context),
    };
  }

  addToHistory(text) {
    this.contextHistory.push({
      text: text.toLowerCase(),
      timestamp: Date.now(),
    });
    if (this.contextHistory.length > this.maxHistory) {
      this.contextHistory.shift();
    }
  }

  findRecentSimilar(text) {
    const lowerText = text.toLowerCase();
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    
    return this.contextHistory.filter(h => 
      h.timestamp > fiveMinutesAgo &&
      this.calculateSimilarity(h.text, lowerText) > 0.6
    );
  }

  calculateSimilarity(a, b) {
    const setA = new Set(a.split(/\s+/));
    const setB = new Set(b.split(/\s+/));
    const intersection = new Set([...setA].filter(x => setB.has(x)));
    return intersection.size / Math.max(setA.size, setB.size);
  }

  calculateConfidence(scores) {
    const total = scores.critical + scores.high + scores.medium;
    return Math.min(total / 20, 1);
  }

  getSuggestedActions(level, context) {
    const actions = [];
    
    if (level <= EmergencyLevel.HIGH) {
      actions.push('notifySupervisor');
      actions.push('shareLocation');
    }
    if (level === EmergencyLevel.CRITICAL) {
      actions.push('autoBackupRequest');
      actions.push('recordAudio');
      actions.push('alertNearbyUnits');
    }
    if (!context.locationShared) {
      actions.push('promptLocation');
    }
    
    return actions;
  }
}

// Singleton instance
export const emergencyDetector = new EmergencyDetector();

// Convenience function
export const analyzeEmergency = (text, context) => {
  return emergencyDetector.analyze(text, context);
};
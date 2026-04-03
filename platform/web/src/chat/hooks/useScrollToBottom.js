// src/chat/hooks/useScrollToBottom.js
import { useRef, useCallback, useEffect } from 'react';

export const useScrollToBottom = (dependencies) => {
  const containerRef = useRef(null);
  const endRef = useRef(null);
  const shouldScrollRef = useRef(true);

  const scrollToBottom = useCallback((behavior = 'smooth', force = false) => {
    if (force || shouldScrollRef.current) {
      endRef.current?.scrollIntoView({ behavior });
    }
  }, []);

  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    shouldScrollRef.current = scrollHeight - scrollTop - clientHeight < 100;
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  useEffect(() => {
    scrollToBottom();
  }, [scrollToBottom, dependencies]);

  return { containerRef, endRef, scrollToBottom };
};
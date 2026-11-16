import { useCallback, useEffect, useRef, useState } from 'react';
import { publicInterviewApi, type MonitorEvent } from '../api/aiInterviews';

/**
 * Records what a browser can legitimately observe during the interview: leaving the tab or window,
 * pasting, and device interruptions, plus a heartbeat so recruiters can see the candidate is online.
 * It cannot see another device or another person; the summary shown to recruiters says so.
 */
export function useInterviewMonitor(opts: { token: string; active: boolean; questionNo: number | null }) {
  const { token, active, questionNo } = opts;
  const queue = useRef<MonitorEvent[]>([]);
  const qn = useRef(questionNo);
  qn.current = questionNo;
  const [awayCount, setAwayCount] = useState(0);

  const flush = useCallback(() => {
    if (!queue.current.length) return;
    const batch = queue.current.splice(0, 20);
    publicInterviewApi.events(token, batch).catch(() => {
      // keep a bounded backlog so a long outage cannot grow memory
      queue.current = [...batch, ...queue.current].slice(0, 100);
    });
  }, [token]);

  const report = useCallback((e: MonitorEvent) => {
    queue.current.push({ questionNo: qn.current ?? undefined, ...e });
  }, []);

  useEffect(() => {
    if (!active) return;
    let hiddenAt = 0;
    let blurAt = 0;
    let blurTimer: number | undefined;

    const onVisibility = () => {
      if (document.hidden) {
        hiddenAt = Date.now();
        report({ type: 'tab_hidden' });
        setAwayCount((c) => c + 1);
        flush();
      } else if (hiddenAt) {
        report({ type: 'tab_visible', durationMs: Date.now() - hiddenAt });
        hiddenAt = 0;
        flush();
      }
    };
    const onBlur = () => {
      window.clearTimeout(blurTimer);
      // A hidden tab also blurs the window; only count a blur that happens while the page stays visible.
      blurTimer = window.setTimeout(() => {
        if (document.hidden || hiddenAt || blurAt) return;
        blurAt = Date.now();
        report({ type: 'window_blur' });
        setAwayCount((c) => c + 1);
      }, 300);
    };
    const onFocus = () => {
      window.clearTimeout(blurTimer);
      if (blurAt) {
        report({ type: 'window_focus', durationMs: Date.now() - blurAt });
        blurAt = 0;
        flush();
      }
    };
    const onPaste = () => report({ type: 'paste' });
    const onCopy = () => report({ type: 'copy' });
    const onFullscreen = () => {
      if (!document.fullscreenElement) report({ type: 'fullscreen_exit' });
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    document.addEventListener('paste', onPaste);
    document.addEventListener('copy', onCopy);
    document.addEventListener('fullscreenchange', onFullscreen);

    const flushTimer = window.setInterval(flush, 4000);
    const pingTimer = window.setInterval(() => void publicInterviewApi.ping(token), 15000);
    void publicInterviewApi.ping(token);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('paste', onPaste);
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('fullscreenchange', onFullscreen);
      window.clearInterval(flushTimer);
      window.clearInterval(pingTimer);
      window.clearTimeout(blurTimer);
      flush();
    };
  }, [active, token, flush, report]);

  return { awayCount, report, flush };
}

import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { FaPrint, FaFilePdf } from 'react-icons/fa';
import { supabase } from '../supabase/client';
import { downloadDomAsPdf } from '../utils/downloadDomAsPdf';
import { displayPatrolZone } from '../config/neighborhoodRegions';
import BrandedLoader from '../components/layout/BrandedLoader';

export default function PrintPatrolLogs() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pdfBusy, setPdfBusy] = useState(false);
  const printRootRef = useRef(null);
  const pdfAutoTriggered = useRef(false);

  useEffect(() => {
    pdfAutoTriggered.current = false;
  }, []);

  const handleDownloadPdf = useCallback(async () => {
    const el = printRootRef.current;
    if (!el) {
      toast.error('Content not ready yet.');
      return;
    }
    setPdfBusy(true);
    toast.loading('Building PDF…', { id: 'pdf-patrol-logs' });
    try {
      await downloadDomAsPdf(
        el,
        `patrol-logs-${format(new Date(), 'yyyy-MM-dd')}.pdf`,
        { waitForImages: false }
      );
      toast.success('PDF saved', { id: 'pdf-patrol-logs' });
    } catch (e) {
      console.error('PDF export:', e);
      toast.error('Could not build PDF. Use Print → Save as PDF.', { id: 'pdf-patrol-logs' });
    } finally {
      setPdfBusy(false);
    }
  }, []);

  const pdfIntent = searchParams.get('intent');
  useEffect(() => {
    if (loading) return;
    if (pdfIntent !== 'pdf') return;
    if (pdfAutoTriggered.current) return;
    pdfAutoTriggered.current = true;
    const t = window.setTimeout(() => {
      void handleDownloadPdf().finally(() => {
        const next = new URLSearchParams(window.location.search);
        next.delete('intent');
        setSearchParams(next, { replace: true });
      });
    }, 400);
    return () => clearTimeout(t);
  }, [loading, pdfIntent, handleDownloadPdf, setSearchParams]);

  useEffect(() => {
    async function fetchLogs() {
      try {
        const { data, error } = await supabase
          .from('patrol_logs')
          .select('*')
          .order('start_time', { ascending: false });

        if (error) throw error;

        const formattedData = (data || []).map((log) => ({
          id: log.id,
          userName: log.user_name,
          start: log.start_time ? new Date(log.start_time) : null,
          end: log.end_time ? new Date(log.end_time) : null,
          durationMinutes: log.duration_minutes,
          zone: log.zone,
        }));
        setLogs(formattedData);
      } catch (err) {
        console.error('Error fetching logs:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchLogs();
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
        <BrandedLoader message="Loading print data…" size="lg" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 py-8 px-4 print:p-4 dark:from-gray-900 dark:to-gray-800">
      <div className="mx-auto max-w-6xl">
        <div className="mb-4 flex flex-wrap justify-between gap-2 print:hidden">
          <button
            type="button"
            onClick={() => navigate('/admin')}
            className="rounded-xl bg-gray-200 px-4 py-2 text-gray-800 transition hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
          >
            ← Back to Admin
          </button>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              <FaPrint className="h-4 w-4" />
              Print
            </button>
            <button
              type="button"
              disabled={pdfBusy}
              onClick={() => void handleDownloadPdf()}
              className="inline-flex items-center gap-2 rounded-xl bg-purple-700 px-4 py-2 text-sm font-medium text-white hover:bg-purple-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <FaFilePdf className="h-4 w-4" />
              {pdfBusy ? 'Saving…' : 'Save as PDF'}
            </button>
          </div>
        </div>

        <div
          ref={printRootRef}
          id="patrol-logs-pdf-root"
          className="rounded-2xl border border-gray-100 bg-white p-6 shadow-soft print:p-0 print:shadow-none dark:border-gray-700 dark:bg-gray-800"
        >
          <h1 className="mb-2 text-2xl font-bold text-gray-900 dark:text-white">
            Patrol Logs – Neighbourhood Watch
          </h1>
          <p className="mb-6 text-sm text-gray-500 dark:text-gray-400">
            Generated on {new Date().toLocaleString()}
          </p>

          <div className="overflow-x-auto">
            <table className="min-w-full border border-gray-200 print:border-black dark:border-gray-700">
              <thead className="bg-gray-50 print:bg-gray-300 dark:bg-gray-900">
                <tr>
                  <th className="border px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Volunteer
                  </th>
                  <th className="border px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Date
                  </th>
                  <th className="border px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Start
                  </th>
                  <th className="border px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    End
                  </th>
                  <th className="border px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Duration
                  </th>
                  <th className="border px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Zone
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {logs.map((log) => (
                  <tr key={log.id} className="print:break-inside-avoid">
                    <td className="border px-4 py-2 text-sm text-gray-900 dark:text-gray-200">{log.userName}</td>
                    <td className="border px-4 py-2 text-sm text-gray-900 dark:text-gray-200">
                      {log.start?.toLocaleDateString()}
                    </td>
                    <td className="border px-4 py-2 text-sm text-gray-900 dark:text-gray-200">
                      {log.start?.toLocaleTimeString()}
                    </td>
                    <td className="border px-4 py-2 text-sm text-gray-900 dark:text-gray-200">
                      {log.end?.toLocaleTimeString()}
                    </td>
                    <td className="border px-4 py-2 text-sm text-gray-900 dark:text-gray-200">
                      {log.durationMinutes} min
                    </td>
                    <td className="border px-4 py-2 text-sm text-gray-900 dark:text-gray-200">
                      {displayPatrolZone(log.zone) || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-8 hidden text-center text-xs print:block">
            Neighbourhood Watch Platform – Confidential – For internal use only
          </div>
        </div>
      </div>
    </div>
  );
}

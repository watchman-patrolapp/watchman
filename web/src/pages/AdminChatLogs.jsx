import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { supabase } from "../supabase/client";
import ExcelJS from 'exceljs';
import toast from "react-hot-toast";
import { FaArrowLeft, FaFileExcel, FaFilter, FaTimes } from "react-icons/fa";

const PAGE_SIZE = 50;

export default function AdminChatLogs() {
  const navigate = useNavigate();
  const { user } = useAuth();

  // Role guard — redirect non-admins who navigate here directly
  useEffect(() => {
    if (user && user.role !== 'admin' && user.role !== 'committee') {
      toast.error("Access denied.");
      navigate("/dashboard", { replace: true });
    }
  }, [user, navigate]);

  const [messages, setMessages] = useState([]);
  const [filter, setFilter] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState(0);

  // ---------------------------------------------------------------------------
  // Fetch — useCallback with explicit deps so the effect stays stable
  // ---------------------------------------------------------------------------
  const fetchMessages = useCallback(async (currentPage = 0, currentFilter = filter, currentStart = startDate, currentEnd = endDate) => {
    setLoading(true);
    try {
      const from = currentPage * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      let query = supabase
        .from('chat_messages')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(from, to);

      if (currentFilter.trim()) {
        query = query.ilike('sender_name', `%${currentFilter.trim()}%`);
      }
      if (currentStart) {
        query = query.gte('created_at', currentStart);
      }
      if (currentEnd) {
        // Add end of day so messages on endDate are included
        query = query.lte('created_at', `${currentEnd}T23:59:59`);
      }

      const { data, error, count } = await query;
      if (error) throw error;

      setMessages(data || []);
      setTotalCount(count || 0);
      setHasMore((count || 0) > (currentPage + 1) * PAGE_SIZE);
    } catch (err) {
      console.error("Error fetching chat logs:", err);
      toast.error("Failed to load chat logs.");
    } finally {
      setLoading(false);
    }
  }, [filter, startDate, endDate]);

  useEffect(() => {
    fetchMessages(0);
  }, [fetchMessages]);

  // ---------------------------------------------------------------------------
  // Apply filters — reset to page 0
  // ---------------------------------------------------------------------------
  const handleApplyFilters = () => {
    setPage(0);
    fetchMessages(0, filter, startDate, endDate);
  };

  // ---------------------------------------------------------------------------
  // Clear filters — pass cleared values directly to avoid stale state
  // ---------------------------------------------------------------------------
  const handleClearFilters = () => {
    setFilter("");
    setStartDate("");
    setEndDate("");
    setPage(0);
    fetchMessages(0, "", "", "");
  };

  // ---------------------------------------------------------------------------
  // Pagination
  // ---------------------------------------------------------------------------
  const handlePrev = () => {
    const newPage = Math.max(0, page - 1);
    setPage(newPage);
    fetchMessages(newPage);
  };

  const handleNext = () => {
    const newPage = page + 1;
    setPage(newPage);
    fetchMessages(newPage);
  };

  // ---------------------------------------------------------------------------
  // Export — fetches ALL matching rows (no page limit) for the export
  // ---------------------------------------------------------------------------
  const exportToExcel = async () => {
    setExporting(true);
    try {
      // Fetch all rows matching current filters for export
      let query = supabase
        .from('chat_messages')
        .select('*')
        .order('created_at', { ascending: false });

      if (filter.trim()) query = query.ilike('sender_name', `%${filter.trim()}%`);
      if (startDate) query = query.gte('created_at', startDate);
      if (endDate) query = query.lte('created_at', `${endDate}T23:59:59`);

      const { data, error } = await query;
      if (error) throw error;

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Chat Logs');
      worksheet.columns = [
        { header: 'Sender',   key: 'sender',   width: 20 },
        { header: 'Message',  key: 'message',  width: 50 },
        { header: 'Time',     key: 'time',     width: 22 },
        { header: 'Expires',  key: 'expires',  width: 22 },
        { header: 'Critical', key: 'critical', width: 10 },
      ];

      // Style header row
      worksheet.getRow(1).font = { bold: true };
      worksheet.getRow(1).fill = {
        type: 'pattern', pattern: 'solid',
        fgColor: { argb: 'FFE8EAF6' },
      };

      (data || []).forEach(m => {
        worksheet.addRow({
          sender:   m.sender_name || '—',
          message:  m.text || '',
          time:     new Date(m.created_at).toLocaleString(),
          expires:  m.expires_at ? new Date(m.expires_at).toLocaleString() : '—',
          critical: m.is_critical ? 'Yes' : 'No',
        });
      });

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });

      // Create, click, then immediately revoke to prevent memory leak
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `chat_logs_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url); // revoke after click

      toast.success(`Exported ${(data || []).length} messages.`);
    } catch (err) {
      console.error("Export failed:", err);
      toast.error("Export failed: " + err.message);
    } finally {
      setExporting(false);
    }
  };

  const startRow = page * PAGE_SIZE + 1;
  const endRow = Math.min((page + 1) * PAGE_SIZE, totalCount);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <button
            onClick={() => navigate("/admin")}
            className="inline-flex items-center gap-2 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-xl hover:bg-gray-300 dark:hover:bg-gray-600 transition text-sm font-medium"
          >
            <FaArrowLeft className="w-3 h-3" />
            Back to Admin
          </button>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Emergency Chat Logs</h1>
          <button
            onClick={exportToExcel}
            disabled={exporting || messages.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-xl transition text-sm font-medium shadow-sm"
          >
            <FaFileExcel className="w-4 h-4" />
            {exporting ? 'Exporting...' : 'Export to Excel'}
          </button>
        </div>

        {/* Filters */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-soft border border-gray-100 dark:border-gray-700 p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <FaFilter className="w-4 h-4 text-indigo-500" />
            Filter Messages
          </h2>
          <div className="flex flex-wrap gap-3">
            <input
              type="text"
              placeholder="Filter by sender name"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleApplyFilters()}
              className="flex-1 min-w-[200px] rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
            />
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
            />
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
            />
            <button
              onClick={handleApplyFilters}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition text-sm font-medium shadow-sm"
            >
              Apply
            </button>
            <button
              onClick={handleClearFilters}
              className="inline-flex items-center gap-1 px-4 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-xl transition text-sm font-medium"
            >
              <FaTimes className="w-3 h-3" />
              Clear
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-soft border border-gray-100 dark:border-gray-700 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-20 text-gray-500 dark:text-gray-400">
              Loading chat logs...
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-900">
                    <tr>
                      {['Sender', 'Message', 'Time', 'Expires', 'Critical'].map(h => (
                        <th key={h} className="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {messages.map((m) => (
                      <tr key={m.id} className={`hover:bg-gray-50 dark:hover:bg-gray-700 transition ${m.is_critical ? 'bg-red-50/40 dark:bg-red-900/10' : ''}`}>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-200">
                          {m.sender_name || '—'}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400 max-w-xs">
                          <span className="line-clamp-2">{m.text}</span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                          {new Date(m.created_at).toLocaleString()}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                          {m.expires_at ? new Date(m.expires_at).toLocaleString() : '—'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-center">
                          {m.is_critical
                            ? <span className="px-2 py-0.5 bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 text-xs rounded-full font-medium">Critical</span>
                            : <span className="text-gray-300 dark:text-gray-600">—</span>
                          }
                        </td>
                      </tr>
                    ))}
                    {messages.length === 0 && (
                      <tr>
                        <td colSpan={5} className="text-center py-12 text-gray-500 dark:text-gray-400">
                          No messages found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalCount > PAGE_SIZE && (
                <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 dark:border-gray-700">
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Showing {startRow}–{endRow} of {totalCount} messages
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={handlePrev}
                      disabled={page === 0}
                      className="px-3 py-1.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-30 text-gray-700 dark:text-gray-300 text-sm rounded-lg transition disabled:cursor-not-allowed"
                    >
                      Previous
                    </button>
                    <button
                      onClick={handleNext}
                      disabled={!hasMore}
                      className="px-3 py-1.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-30 text-gray-700 dark:text-gray-300 text-sm rounded-lg transition disabled:cursor-not-allowed"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
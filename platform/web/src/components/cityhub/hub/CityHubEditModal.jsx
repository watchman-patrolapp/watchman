import { useEffect, useState } from "react";
import toast from "../../../utils/notify";
import { FaTimes } from "react-icons/fa";
import { POST_TYPES } from "./cityHubConfig";

export default function CityHubEditModal({ post, busy, onClose, onSave }) {
  const [type, setType] = useState(post.type);
  const [title, setTitle] = useState(post.title || "");
  const [content, setContent] = useState(post.content || "");

  useEffect(() => {
    setType(post.type);
    setTitle(post.title || "");
    setContent(post.content || "");
  }, [post]);

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!title.trim() || !content.trim()) {
      toast.error("Title and content are required.");
      return;
    }
    void onSave({ type, title: title.trim(), content: content.trim() });
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center p-0 sm:p-4 bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="city-hub-edit-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-t-2xl sm:rounded-2xl bg-white dark:bg-gray-800 shadow-xl border border-gray-200 dark:border-gray-600 max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-600">
          <h2 id="city-hub-edit-title" className="text-lg font-semibold text-gray-900 dark:text-white">
            Edit City Hub post
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
            aria-label="Close"
            disabled={busy}
          >
            <FaTimes />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="px-4 py-3 overflow-y-auto flex-1 min-h-0 space-y-3">
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="input border w-full"
              disabled={busy}
            >
              {POST_TYPES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="input border w-full"
              required
              disabled={busy}
            />
            <textarea
              rows={8}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="w-full border rounded-lg p-3 bg-white dark:bg-gray-900 dark:border-gray-700 dark:text-white"
              required
              disabled={busy}
            />
          </div>
          <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-600 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || !title.trim() || !content.trim()}
              className="px-4 py-2 rounded-xl text-sm font-medium bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
